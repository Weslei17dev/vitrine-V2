/* ============================================================================
   app.js
   ----------------------------------------------------------------------------
   Ponto central da aplicação (SPA sem framework): mantém o estado do
   usuário logado, controla a navegação entre telas (login, cadastro, loja,
   área do cliente, painel admin) e inicializa todos os módulos na ordem
   correta assim que o DOM estiver pronto.
   ============================================================================ */

(function (global) {
  'use strict';

  const state = {
    currentUser: null // { id, name, email, role: 'client' | 'admin', ... }
  };

  const VIEW_IDS = {
    login: 'view-login',
    register: 'view-register',
    store: 'view-store',
    catalog: 'view-catalog',
    blog: 'view-blog',
    'blog-article': 'view-blog-article',
    legal: 'view-legal',
    'product-detail': 'view-product-detail',
    'customer-orders': 'view-customer-orders',
    admin: 'view-admin'
  };

  let currentView = null;
  const VIEW_TITLES = {
    login: 'Entrar — Brincar de Desejo',
    register: 'Criar conta — Brincar de Desejo',
    store: 'Brincar de Desejo — Bem-estar íntimo com discrição',
    catalog: 'Catálogo completo — Brincar de Desejo',
    blog: 'Blog — Brincar de Desejo',
    'blog-article': 'Artigo — Brincar de Desejo',
    legal: 'Privacidade e termos — Brincar de Desejo',
    'product-detail': 'Produto — Brincar de Desejo',
    'customer-orders': 'Meus pedidos — Brincar de Desejo',
    admin: 'Painel administrativo — Brincar de Desejo'
  };

  // --------------------------------------------------------------------------
  // Cabeçalho da loja (adapta-se conforme visitante / cliente logado / admin)
  // --------------------------------------------------------------------------
  function updateHeaderUI() {
    const header = document.getElementById('site-header');
    const guestActions = document.getElementById('header-guest-actions');
    const clientActions = document.getElementById('header-client-actions');
    const adminActions = document.getElementById('header-admin-actions');
    const navLinks = document.getElementById('header-nav-links');
    const myOrdersLink = document.getElementById('nav-my-orders');
    const userNameEl = document.getElementById('header-user-name');
    const userAvatarEl = document.getElementById('header-user-avatar');
    if (!header) return;

    if (!state.currentUser) {
      // Visitante: o catálogo e o blog são livres; "Meus Pedidos" exige
      // login e permanece escondido.
      header.classList.remove('is-hidden');
      guestActions.classList.remove('is-hidden');
      clientActions.classList.add('is-hidden');
      adminActions?.classList.add('is-hidden');
      navLinks.classList.remove('is-hidden');
      if (myOrdersLink) myOrdersLink.classList.add('is-hidden');
    } else if (state.currentUser.role === 'client') {
      header.classList.remove('is-hidden');
      guestActions.classList.add('is-hidden');
      clientActions.classList.remove('is-hidden');
      adminActions?.classList.add('is-hidden');
      navLinks.classList.remove('is-hidden');
      if (myOrdersLink) myOrdersLink.classList.remove('is-hidden');
      if (userNameEl) userNameEl.textContent = state.currentUser.name.split(' ')[0];
      if (userAvatarEl) {
        const avatar = Utils.safeImageSrc(state.currentUser.avatar || '');
        userAvatarEl.innerHTML = avatar
          ? `<img src="${Utils.escapeHtml(avatar)}" alt="Foto de ${Utils.escapeHtml(state.currentUser.name)}">`
          : '<i class="fa-solid fa-user"></i>';
      }
    } else if (currentView === 'admin') {
      // Dentro do painel, a sidebar já oferece toda a navegação necessária.
      header.classList.add('is-hidden');
      guestActions.classList.add('is-hidden');
      clientActions.classList.add('is-hidden');
      adminActions?.classList.add('is-hidden');
    } else {
      // O administrador também pode navegar pela loja e voltar ao painel
      // usando um acesso próprio no cabeçalho.
      header.classList.remove('is-hidden');
      guestActions.classList.add('is-hidden');
      clientActions.classList.add('is-hidden');
      adminActions?.classList.remove('is-hidden');
      navLinks.classList.remove('is-hidden');
      if (myOrdersLink) myOrdersLink.classList.add('is-hidden');
    }
  }

  function updateNavActiveState(view) {
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.nav === view);
    });
  }

  // --------------------------------------------------------------------------
  // Roteador simples (mostra/esconde seções .view)
  // --------------------------------------------------------------------------
  function navigate(requestedView) {
    let view = requestedView;

    // Guardas de acesso:
    // - a loja e as páginas públicas podem ser acessadas também pelo admin;
    // - a área do cliente continua exclusiva para clientes.
    // - a área do cliente (pedidos) e o checkout continuam exigindo login.
    if (view === 'customer-orders') {
      if (!state.currentUser) view = 'login';
      else if (state.currentUser.role === 'admin') view = 'admin';
    }
    if (view === 'admin' && (!state.currentUser || state.currentUser.role !== 'admin')) {
      view = 'login';
    }
    if ((view === 'login' || view === 'register') && state.currentUser) {
      view = state.currentUser.role === 'admin' ? 'admin' : 'store';
    }

    // Encerra polling da tela anterior antes de trocar.
    if (currentView === 'customer-orders') global.CustomerAreaModule.stopPolling();
    if (currentView === 'admin') global.AdminPanelModule.stopPolling();

    currentView = view;
    if (view !== 'product-detail' && new URL(location.href).searchParams.has('produto')) {
      const url = new URL(location.href); url.searchParams.delete('produto'); history.replaceState(null, '', url);
    }

    Object.values(VIEW_IDS).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('view--active');
    });
    const target = document.getElementById(VIEW_IDS[view]);
    if (target) target.classList.add('view--active');

    const chatHelper = document.querySelector('.chat-helper');
    if (chatHelper) chatHelper.classList.toggle('is-hidden', view === 'admin');

    updateHeaderUI();
    updateNavActiveState(view);
    document.title = VIEW_TITLES[view] || 'Brincar de Desejo';
    window.scrollTo({ top: 0 });

    if (view === 'store') {
      global.ProductsModule.loadAndRender();
      if (global.SiteContentModule) global.SiteContentModule.render();
      if (global.BlogModule) global.BlogModule.render();
    }
    if (view === 'catalog') global.ProductsModule.loadAndRender();
    if (view === 'blog') {
      if (global.BlogModule) global.BlogModule.render();
    }
    if (view === 'legal') {
      if (global.LegalModule) global.LegalModule.render();
    }
    if (view === 'customer-orders') {
      global.CustomerAreaModule.refresh();
      global.CustomerAreaModule.startPolling();
    }
    if (view === 'admin') {
      global.AdminPanelModule.enter();
      global.AdminPanelModule.startPolling();
    }
  }

  function setCurrentUser(user) {
    state.currentUser = user;
    if (user) {
      global.CartModule.loadForCurrentUser();
      const products = global.ProductsModule.getCached();
      if (products.length) global.CartModule.reconcile(products);
    }
    else global.CartModule.loadForCurrentUser();
    updateHeaderUI();
  }

  function wireHeaderNav() {
    document.querySelectorAll('[data-nav]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(el.dataset.nav);
      })
    );
    document.getElementById('header-profile-btn')?.addEventListener('click', () => {
      navigate('customer-orders');
      requestAnimationFrame(() => {
        const panel = document.getElementById('customer-account-panel');
        if (!panel) return;
        panel.open = true;
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // --------------------------------------------------------------------------
  // Inicialização
  // --------------------------------------------------------------------------
  function setupChatHelper() {
    const helper = document.querySelector('.chat-helper');
    const toggle = document.getElementById('chat-helper-toggle');
    const panel = document.getElementById('chat-helper-panel');
    if (!helper || !toggle || !panel) return;

    function setOpen(open) {
      panel.classList.toggle('is-hidden', !open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Fechar ajuda rápida' : 'Abrir ajuda rápida');
    }

    function navigateAndScroll(targetId) {
      navigate('store');
      requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: 'start' }));
      setOpen(false);
    }

    toggle.addEventListener('click', () => setOpen(panel.classList.contains('is-hidden')));
    helper.addEventListener('click', (event) => {
      const action = event.target.closest('[data-chat-action]')?.dataset.chatAction;
      if (!action) return;
      if (action === 'close') setOpen(false);
      if (action === 'catalog') navigateAndScroll('product-grid-anchor');
      if (action === 'faq') navigateAndScroll('faq-title');
      if (action === 'privacy' && global.LegalModule) {
        setOpen(false);
        global.LegalModule.open('legal-privacy');
      }
      if (action === 'orders') {
        setOpen(false);
        navigate(state.currentUser && state.currentUser.role === 'client' ? 'customer-orders' : 'login');
      }
    });
  }

  async function boot() {
    Utils.setupModalDismiss();

    // Restaura sessão ("permanecer autenticado") antes de iniciar os módulos,
    // para que carrinho/área do cliente já carreguem os dados corretos.
    state.currentUser = await DataService.Auth.restoreSession();

    global.AuthModule.init();
    if (global.BlogModule) global.BlogModule.init();
    if (global.LegalModule) global.LegalModule.init();
    global.ProductsModule.init();
    if (global.ProductDetailModule) global.ProductDetailModule.init();
    global.CartModule.init();
    global.OrdersModule.init();
    global.CustomerAreaModule.init();
    global.AdminPanelModule.init();
    if (global.AdminPromotionsModule) global.AdminPromotionsModule.init();

    if (state.currentUser) global.CartModule.loadForCurrentUser();

    wireHeaderNav();
    setupChatHelper();
    updateHeaderUI();
    global.addEventListener('vitrine:session-expired', () => {
      if (!state.currentUser) return;
      state.currentUser = null;
      global.CartModule.loadForCurrentUser();
      updateHeaderUI();
      Utils.showToast('Sua sessão expirou. Entre novamente para continuar.', 'warning');
      navigate('login');
    });

    // Clientes e visitantes abrem a loja. O administrador continua entrando
    // direto no painel, mas agora pode alternar entre painel e vitrine.
    const productId = new URL(location.href).searchParams.get('produto');
    if (productId && /^[0-9a-f-]{36}$/i.test(productId)) {
      global.ProductsModule.loadAndRender().catch(() => {});
      global.ProductDetailModule.show(productId);
    } else navigate(state.currentUser?.role === 'admin' ? 'admin' : 'store');
  }

  global.App = { state, navigate, setCurrentUser, getCurrentView: () => currentView };

  document.addEventListener('DOMContentLoaded', boot);
})(window);
