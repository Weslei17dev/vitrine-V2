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
  const REQUEST_TIMEOUT_MS = 20000;

  class ApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code || null;
    }
  }

  // --------------------------------------------------------------------------
  // Helpers de storage do navegador (sessão temporária e carrinho local)
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    opts.signal = controller.signal;

    return fetch(API_BASE_URL + path, opts).catch((err) => {
      if (err && err.name === 'AbortError') throw new ApiError('A API demorou para responder. Tente novamente.', 0, 'timeout');
      throw new ApiError('Não foi possível conectar à API. Verifique sua internet e tente novamente.', 0, 'network_error');
    }).then((response) =>
      response.json().catch(() => ({})).then((body) => {
        if (!response.ok) {
          if (response.status === 401 && token && path !== '/api/auth/login') {
            sessionStorage.removeItem(STORAGE_KEYS.SESSION);
            global.dispatchEvent(new CustomEvent('vitrine:session-expired'));
          }
          throw new ApiError(body.message || 'Não foi possível completar a operação. Tente novamente.', response.status, body.code);
        }
        return body;
      })
    ).finally(() => clearTimeout(timeout));
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
        .catch((err) => {
          if (err.status === 401) {
            sessionStorage.removeItem(STORAGE_KEYS.SESSION);
            return null;
          }
          return session.user;
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
    getAllAdmin(options = {}) {
      return apiFetch(`/api/products/admin/all?${new URLSearchParams(options)}`);
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

    create({ items, idempotencyKey, couponCode, expectedTotal }) {
      return apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ items: items.map((item) => ({ productId: item.productId, qty: item.qty })), couponCode, expectedTotal })
      });
    },
    quote(items, couponCode = '') {
      return apiFetch('/api/orders/quote', {
        method: 'POST',
        body: JSON.stringify({ items: items.map((item) => ({ productId: item.productId, qty: item.qty })), couponCode })
      });
    },
    getAll(options = {}) {
      const params = new URLSearchParams({
        limit: String(Number(options.limit) || 100),
        offset: String(Number(options.offset) || 0)
      });
      ['number', 'from', 'to', 'client', 'status', 'product', 'minValue', 'maxValue'].forEach((key) => {
        if (options[key] !== '' && options[key] != null) params.set(key, String(options[key]));
      });
      return apiFetch(`/api/orders?${params.toString()}`);
    },
    getByUser(userId) {
      return apiFetch(`/api/orders/user/${userId}`);
    },
    getById(orderId) {
      return apiFetch(`/api/orders/${orderId}`);
    },
    getAdminSummary() {
      return apiFetch('/api/orders/admin/summary');
    },
    updateStatus(orderId, status) {
      return apiFetch(`/api/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    },
    markPaymentReported(orderId) {
      return apiFetch(`/api/orders/${orderId}/payment-reported`, { method: 'PATCH' });
    },
    cancel(orderId) {
      return apiFetch(`/api/orders/${orderId}/cancel`, { method: 'PATCH' });
    },
    markSeenByAdmin(orderId) {
      return apiFetch(`/api/orders/${orderId}/seen`, { method: 'PATCH' });
    }
  };

  const PromotionRepository = {
    getAll() { return apiFetch('/api/promotions'); },
    create(payload) { return apiFetch('/api/promotions', { method:'POST', body:JSON.stringify(payload) }); },
    update(id, payload) { return apiFetch(`/api/promotions/${id}`, { method:'PUT', body:JSON.stringify(payload) }); },
    setActive(id, active) { return apiFetch(`/api/promotions/${id}/active`, { method:'PATCH', body:JSON.stringify({active}) }); }
  };

  // ============================================================================
  // REPOSITÓRIO: Clientes (painel admin)
  // ============================================================================
  const CustomerRepository = {
    getAll(options = {}) {
      const limit = Number(options.limit) || 100;
      const offset = Number(options.offset) || 0;
      return apiFetch(`/api/customers?${new URLSearchParams({...options, limit, offset})}`);
    }
  };

  // ============================================================================
  // REPOSITÓRIO: Conteúdo personalizável do site
  // ============================================================================
  const SITE_CONTENT_DEFAULTS = {
    theme: {
      bg: '#1A1A1A', surface: '#242424', primary: '#B91E1F', primaryDark: '#8F1517',
      accent: '#D99163', accentDark: '#A8673F', text: '#FDFCFA', textMuted: '#D4C9C2', dark: '#101010'
    },
    pix: { chave: '', nomeBeneficiario: '', cidadeBeneficiario: '' },
    shipping: { flatRate: 0, freeAbove: 0, estimatedDays: 7 },
    hero: {
      eyebrow: 'Bem-vindo(a) à Brincar de Desejo',
      title: 'Desejo, prazer e sedução\nem um só lugar.',
      subtitle: 'Produtos selecionados com cuidado, entrega discreta e atendimento sem julgamentos. Monte seu carrinho à vontade — o login é solicitado somente para finalizar o pedido.',
      ctaText: 'Ver produtos'
    },
    carousel: [
      {
        image: 'img/promo-dessensibilizante.jpg', alt: 'Seleção de produtos voltada a conforto e cuidado',
        eyebrow: 'Conforto em primeiro lugar', title: 'Descobertas mais leves,\nno seu ritmo.',
        subtitle: 'Conheça opções selecionadas para começar com informação, cuidado e tranquilidade.', ctaText: 'Explorar catálogo', ctaTarget: 'catalog'
      },
      {
        image: 'img/promo-bdsm.jpg', alt: 'Acessórios para explorar fantasias com responsabilidade',
        eyebrow: 'Confiança e consentimento', title: 'Explore novos desejos\ncom responsabilidade.',
        subtitle: 'Informação clara, limites respeitados e produtos para diferentes experiências.', ctaText: 'Ver categorias', ctaTarget: 'categories'
      },
      {
        image: 'img/promo-acessorios.jpg', alt: 'Acessórios para diferentes momentos',
        eyebrow: 'Escolhas para cada momento', title: 'Detalhes que transformam\na experiência.',
        subtitle: 'Uma curadoria discreta para descobrir possibilidades a sós ou a dois.', ctaText: 'Conhecer seleção', ctaTarget: 'selection'
      }
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
      image: 'img/promo-dessensibilizante.jpg', eyebrow: 'Destaque da semana',
      title: 'Conforto e cuidado em primeiro lugar',
      text: 'Conheça uma seleção pensada para proporcionar experiências mais confortáveis, com informações claras para ajudar na escolha.',
      buttonText: 'Ver produtos relacionados'
    },
    faq: [
      { q: 'Minha compra é realmente discreta?', a: 'Sim. Todo pedido é enviado em embalagem neutra, sem qualquer identificação da loja ou do conteúdo, tanto na caixa quanto na nota fiscal e no nome do remetente.' },
      { q: 'Preciso criar conta para ver os produtos?', a: 'Não. Você pode navegar por todo o catálogo, buscar e filtrar produtos livremente sem login. A conta só é pedida na hora de finalizar o pedido.' },
      { q: 'Quais formas de pagamento vocês aceitam?', a: 'O pagamento disponível no site é PIX. A confirmação é realizada pela equipe após a conferência do recebimento.' },
      { q: 'Como acompanho meu pedido?', a: 'Acesse Meus Pedidos para consultar o status informado pela equipe.' },
      { q: 'Posso trocar ou devolver um produto?', a: 'A solicitação é analisada conforme o tipo de produto, a integridade do lacre e as regras aplicáveis. Use o e-mail do rodapé e informe o número do pedido.' },
      { q: 'Como meus dados são utilizados?', a: 'Os dados são utilizados para manter sua conta, processar o pedido, realizar a entrega e prestar atendimento.' }
    ],
    footer: {
      about: 'Loja online de bem-estar íntimo, com pagamento via PIX e envio discreto.',
      legalName: '', document: '', address: '',
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
    getByProduct(productId, options = {}) {
      return apiFetch(`/api/reviews/product/${productId}?${new URLSearchParams(options)}`);
    },
    create({ productId, rating, comment }) {
      return apiFetch('/api/reviews', { method: 'POST', body: JSON.stringify({ productId, rating, comment }) });
    },
    getAllAdmin(options = {}) {
      return apiFetch(`/api/reviews/admin/all?${new URLSearchParams(options)}`);
    },
    approve(reviewId) {
      return apiFetch(`/api/reviews/${reviewId}/approve`, { method: 'PATCH' });
    },
    remove(reviewId) {
      return apiFetch(`/api/reviews/${reviewId}`, { method: 'DELETE' });
    }
  };

  const CategoryRepository = {
    getAll(force) {
      return apiFetch(`/api/categories${force ? `?v=${Date.now()}` : ''}`);
    },
    getAllAdmin() {
      return apiFetch('/api/categories/admin/all');
    },
    create(payload) {
      return apiFetch('/api/categories', { method: 'POST', body: JSON.stringify(payload) });
    },
    update(id, payload) {
      return apiFetch(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    },
    remove(id) {
      return apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
    }
  };

  const AuditRepository = {
    getAll() {
      return apiFetch('/api/audit');
    }
  };

  // ============================================================================
  // REPOSITÓRIO: Relatórios gerenciais (somente administrador)
  // ============================================================================
  const ReportsRepository = {
    getCosts(filters = {}) {
      return apiFetch(`/api/reports/costs?${new URLSearchParams(filters)}`);
    },
    getFilters() {
      return apiFetch('/api/reports/filters');
    },
    get(filters = {}) {
      const query = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') query.set(key, value);
      });
      return apiFetch(`/api/reports?${query.toString()}`);
    }
  };

  // ============================================================================
  // Exposição pública (mesma interface de antes)
  // ============================================================================
  global.DataService = {
    Auth: AuthRepository,
    Products: ProductRepository,
    Categories: CategoryRepository,
    Cart: CartRepository,
    Orders: OrderRepository,
    Promotions: PromotionRepository,
    Customers: CustomerRepository,
    SiteContent: SiteContentRepository,
    Reviews: ReviewRepository,
    Audit: AuditRepository,
    Reports: ReportsRepository,
    SITE_CONTENT_DEFAULTS,
    KEYS: STORAGE_KEYS
  };
})(window);
