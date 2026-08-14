/* ============================================================================
   dataService.js
   ----------------------------------------------------------------------------
   Camada única de acesso a dados. Fala com a API (Node + PostgreSQL) via
   fetch(). Todo o resto do projeto (auth.js, products.js, orders.js,
   adminPanel.js etc.) continua chamando exatamente os mesmos métodos de
   antes — só o "miolo" mudou de localStorage para chamadas HTTP.

   A única exceção é o Carrinho (DataService.Cart): continua salvo no
   localStorage do navegador, por simplicidade — não precisa de login pra
   existir e não faz sentido "sincronizar entre aparelhos" antes da compra
   ser finalizada.

   Configuração: veja js/apiConfig.js (window.API_BASE_URL).
   ============================================================================ */

(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    SESSION: 'vitrine_session',
    CART_PREFIX: 'vitrine_cart_'
  };

  const API_BASE_URL = (global.API_BASE_URL || '').replace(/\/$/, '');

  // --------------------------------------------------------------------------
  // Helpers de storage local (usados só pela sessão e pelo carrinho)
  // --------------------------------------------------------------------------
  function readJSON(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(storage, key, value) {
    storage.setItem(key, JSON.stringify(value));
  }

  function resolveAsync(value) {
    return Promise.resolve(value);
  }

  // --------------------------------------------------------------------------
  // Cliente HTTP: monta a URL, injeta o token de login e trata erros
  // --------------------------------------------------------------------------
  function getToken() {
    const session = readJSON(sessionStorage, STORAGE_KEYS.SESSION, null);
    return session ? session.token : null;
  }

  function apiFetch(path, options) {
    if (!API_BASE_URL) {
      return Promise.reject(
        new Error('A API ainda não foi configurada. Edite js/apiConfig.js com a URL do seu servidor.')
      );
    }

    const opts = Object.assign({}, options);
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, options && options.headers);

    const token = getToken();
    if (token) opts.headers.Authorization = `Bearer ${token}`;

    return fetch(API_BASE_URL + path, opts).then((response) =>
      response.json().catch(() => ({})).then((body) => {
        if (!response.ok) {
          if (response.status === 401) {
            sessionStorage.removeItem(STORAGE_KEYS.SESSION);
            global.dispatchEvent(new CustomEvent('vitrine:session-expired'));
          }
          throw new Error(body.message || 'Não foi possível completar a operação. Tente novamente.');
        }
        return body;
      })
    );
  }

  // ============================================================================
  // REPOSITÓRIO: Autenticação / Sessão
  // ============================================================================
  let lastAuthToken = null; // guardado entre login()/register() e saveSession()

  const AuthRepository = {
    login(email, password) {
      return apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      }).then((data) => {
        lastAuthToken = data.token;
        return data.user;
      });
    },

    register(payload) {
      return apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      }).then((data) => {
        lastAuthToken = data.token;
        return data.user;
      });
    },

    saveSession(user) {
      writeJSON(sessionStorage, STORAGE_KEYS.SESSION, { token: lastAuthToken, user });
      return resolveAsync(user);
    },

    getSession() {
      const session = readJSON(sessionStorage, STORAGE_KEYS.SESSION, null);
      return session ? session.user : null;
    },

    restoreSession() {
      const session = readJSON(sessionStorage, STORAGE_KEYS.SESSION, null);
      if (!session || !session.token) return resolveAsync(null);
      return apiFetch('/api/auth/me')
        .then((user) => {
          writeJSON(sessionStorage, STORAGE_KEYS.SESSION, { token: session.token, user });
          return user;
        })
        .catch(() => {
          sessionStorage.removeItem(STORAGE_KEYS.SESSION);
          return null;
        });
    },

    updateProfile(payload) {
      return apiFetch('/api/auth/me', { method: 'PATCH', body: JSON.stringify(payload) }).then((user) => {
        const session = readJSON(sessionStorage, STORAGE_KEYS.SESSION, null);
        if (session) writeJSON(sessionStorage, STORAGE_KEYS.SESSION, { token: session.token, user });
        return user;
      });
    },

    changePassword(currentPassword, newPassword) {
      return apiFetch('/api/auth/change-password', {
        method: 'POST', body: JSON.stringify({ currentPassword, newPassword })
      }).then((data) => {
        lastAuthToken = data.token;
        writeJSON(sessionStorage, STORAGE_KEYS.SESSION, { token: data.token, user: data.user });
        return data.user;
      });
    },

    deleteAccount(password) {
      return apiFetch('/api/auth/me', { method: 'DELETE', body: JSON.stringify({ password }) }).then(() => {
        sessionStorage.removeItem(STORAGE_KEYS.SESSION);
        return true;
      });
    },

    clearSession() {
      sessionStorage.removeItem(STORAGE_KEYS.SESSION);
      lastAuthToken = null;
      return resolveAsync(true);
    }
  };

  // ============================================================================
  // REPOSITÓRIO: Produtos
  // ============================================================================
  const ProductRepository = {
    getAll(force) {
      return apiFetch(`/api/products${force ? `?v=${Date.now()}` : ''}`);
    },
    getById(id) {
      return apiFetch(`/api/products/${id}`);
    },
    getAllAdmin() {
      return apiFetch('/api/products/admin/all');
    },
    getByIdAdmin(id) {
      return apiFetch(`/api/products/admin/${id}`);
    },
    create(payload) {
      return apiFetch('/api/products', { method: 'POST', body: JSON.stringify(payload) });
    },
    update(id, payload) {
      return apiFetch(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    },
    remove(id) {
      return apiFetch(`/api/products/${id}`, { method: 'DELETE' });
    }
  };

  // ============================================================================
  // REPOSITÓRIO: Carrinho (continua 100% local — ver nota no topo do arquivo)
  // ============================================================================
  const CartRepository = {
    get(userId) {
      return readJSON(localStorage, STORAGE_KEYS.CART_PREFIX + (userId || 'guest'), []);
    },
    save(userId, items) {
      writeJSON(localStorage, STORAGE_KEYS.CART_PREFIX + (userId || 'guest'), items);
    },
    clear(userId) {
      localStorage.removeItem(STORAGE_KEYS.CART_PREFIX + (userId || 'guest'));
    }
  };

  // ============================================================================
  // REPOSITÓRIO: Pedidos
  // ============================================================================
  const STATUS_FLOW = ['Aguardando Pagamento', 'Aguardando Confirmação', 'Pago', 'Em Produção', 'Enviado', 'Finalizado'];
  const STATUS_CANCELLED = 'Cancelado';

  const OrderRepository = {
    STATUS_FLOW,
    STATUS_CANCELLED,

    create({ items, idempotencyKey }) {
      return apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ items: items.map((item) => ({ productId: item.productId, qty: item.qty })) })
      });
    },
    getAll() {
      return apiFetch('/api/orders');
    },
    getByUser(userId) {
      return apiFetch(`/api/orders/user/${userId}`);
    },
    getById(orderId) {
      return apiFetch(`/api/orders/${orderId}`);
    },
    updateStatus(orderId, status) {
      return apiFetch(`/api/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    },
    markPaymentReported(orderId) {
      return apiFetch(`/api/orders/${orderId}/payment-reported`, { method: 'PATCH' });
    },
    markSeenByAdmin(orderId) {
      return apiFetch(`/api/orders/${orderId}/seen`, { method: 'PATCH' });
    }
  };

  // ============================================================================
  // REPOSITÓRIO: Clientes (painel admin)
  // ============================================================================
  const CustomerRepository = {
    getAll() {
      return apiFetch('/api/customers');
    }
  };

  // ============================================================================
  // REPOSITÓRIO: Conteúdo personalizável do site
  // ============================================================================
  const SITE_CONTENT_DEFAULTS = {
    theme: {
      bg: '#150A10', surface: '#211019', primary: '#FF3D82', primaryDark: '#C81760',
      accent: '#FF3B4E', accentDark: '#C4172A', text: '#F5EBEF', textMuted: '#B49AA8', dark: '#0B0509'
    },
    pix: { chave: '', nomeBeneficiario: '', cidadeBeneficiario: '' },
    hero: {
      eyebrow: 'Bem-vindo(a) à Brincar de Desejo',
      title: 'Desejo, prazer e sedução\nem um só lugar.',
      subtitle: 'Produtos selecionados com cuidado, entrega discreta e atendimento sem julgamentos. Monte seu carrinho à vontade — o login é solicitado somente para finalizar o pedido.',
      ctaText: 'Ver produtos'
    },
    carousel: [
      { image: 'img/promo-dessensibilizante.jpg', alt: 'Dessensibilizante — conforto é prioridade para iniciantes ou amadores' },
      { image: 'img/promo-bdsm.jpg', alt: 'BDSM — fetiches escondidos' },
      { image: 'img/promo-acessorios.jpg', alt: 'Acessórios para momentos especiais' }
    ],
    flashSale: {
      tag: 'Seleção Especial', title: 'Descubra os favoritos da loja',
      description: 'Produtos selecionados para tornar seus momentos ainda mais especiais.'
    },
    about: {
      image: 'img/quem-somos.jpg', eyebrow: 'Quem somos',
      title: 'Prazer, autoconhecimento e liberdade — sem tabus.',
      paragraph1: 'A Brincar de Desejo nasceu para tornar o universo da sexualidade mais leve, acessível e livre de julgamentos. Selecionamos cada produto com cuidado, pensando em conforto, qualidade e segurança para todos os corpos e desejos.',
      paragraph2: 'Da escolha à entrega, prezamos pela sua privacidade: embalagens sem identificação, atendimento humano e discrição do primeiro clique até a porta de casa.',
      bullets: ['Produtos testados e aprovados', 'Atendimento humano e sem julgamentos', 'Compromisso com a sua privacidade']
    },
    spotlight: {
      image: 'img/promo-dessensibilizante.jpg', eyebrow: 'Mais vendido da semana',
      title: 'Dessensibilizante — conforto é prioridade',
      text: 'Pensado para iniciantes ou amadores, prolonga o prazer com uma fórmula suave que não tira a sensibilidade. Aplicação simples e absorção rápida, para uma experiência mais confortável a dois.',
      buttonText: 'Ver produtos relacionados'
    },
    faq: [
      { q: 'Minha compra é realmente discreta?', a: 'Sim. Todo pedido é enviado em embalagem neutra, sem qualquer identificação da loja ou do conteúdo, tanto na caixa quanto na nota fiscal e no nome do remetente.' },
      { q: 'Preciso criar conta para ver os produtos?', a: 'Não. Você pode navegar por todo o catálogo, buscar e filtrar produtos livremente sem login. A conta só é pedida na hora de finalizar o pedido.' },
      { q: 'Quais formas de pagamento vocês aceitam?', a: 'O pagamento disponível no site é PIX. A confirmação é realizada pela equipe após a conferência do recebimento.' },
      { q: 'Como acompanho meu pedido?', a: 'Acesse Meus Pedidos para consultar o status informado pela equipe.' },
      { q: 'Posso trocar ou devolver um produto?', a: 'Sim, seguindo nossa política de trocas e devoluções. Entre em contato com a Central de Atendimento informando o número do seu pedido.' },
      { q: 'Como meus dados são utilizados?', a: 'Os dados são utilizados para manter sua conta, processar o pedido, realizar a entrega e prestar atendimento.' }
    ],
    footer: {
      about: 'Loja online de produtos eróticos com atendimento humano, embalagem discreta e entrega para todo o Brasil.',
      phone: '(11) 4810-6810', email: 'sac@brincardedesejo.com.br',
      hours1: 'Seg. a Sex. das 8h às 18h', hours2: 'Sábados das 8h às 12h'
    }
  };

  const SiteContentRepository = {
    get(force) {
      return apiFetch(`/api/site-content${force ? `?v=${Date.now()}` : ''}`);
    },
    getAdmin() {
      return apiFetch('/api/site-content/admin');
    },
    update(partial) {
      return apiFetch('/api/site-content', { method: 'PUT', body: JSON.stringify(partial) });
    },
    resetDefaults() {
      return apiFetch('/api/site-content/reset', { method: 'POST' });
    }
  };

  // ============================================================================
  // REPOSITÓRIO: Avaliações de produtos
  // ============================================================================
  const ReviewRepository = {
    getByProduct(productId) {
      return apiFetch(`/api/reviews/product/${productId}`);
    },
    create({ productId, rating, comment }) {
      return apiFetch('/api/reviews', { method: 'POST', body: JSON.stringify({ productId, rating, comment }) });
    }
  };

  // ============================================================================
  // Exposição pública (mesma interface de antes)
  // ============================================================================
  global.DataService = {
    Auth: AuthRepository,
    Products: ProductRepository,
    Cart: CartRepository,
    Orders: OrderRepository,
    Customers: CustomerRepository,
    SiteContent: SiteContentRepository,
    Reviews: ReviewRepository,
    SITE_CONTENT_DEFAULTS,
    KEYS: STORAGE_KEYS
  };
})(window);
