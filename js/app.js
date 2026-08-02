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
    'product-detail': 'view-product-detail',
    'customer-orders': 'view-customer-orders',
    admin: 'view-admin'
  };

  let currentView = null;

  // --------------------------------------------------------------------------
  // Cabeçalho da loja (adapta-se conforme visitante / cliente logado / admin)
  // --------------------------------------------------------------------------
  function updateHeaderUI() {
    const header = document.getElementById('site-header');
    const guestActions = document.getElementById('header-guest-actions');
    const clientActions = document.getElementById('header-client-actions');
    const navLinks = document.getElementById('header-nav-links');
    const myOrdersLink = document.getElementById('nav-my-orders');
    const userNameEl = document.getElementById('header-user-name');
    if (!header) return;

    if (!state.currentUser) {
      // Visitante: o catálogo é livre, então o link "Produtos" fica visível;
      // "Meus Pedidos" exige login e permanece escondido.
      header.classList.remove('is-hidden');
      guestActions.classList.remove('is-hidden');
      clientActions.classList.add('is-hidden');
      navLinks.classList.remove('is-hidden');
      if (myOrdersLink) myOrdersLink.classList.add('is-hidden');
    } else if (state.currentUser.role === 'client') {
      header.classList.remove('is-hidden');
      guestActions.classList.add('is-hidden');
      clientActions.classList.remove('is-hidden');
      navLinks.classList.remove('is-hidden');
      if (myOrdersLink) myOrdersLink.classList.remove('is-hidden');
      if (userNameEl) userNameEl.textContent = state.currentUser.name.split(' ')[0];
    } else {
      // O administrador usa um layout próprio (sidebar), então escondemos
      // o cabeçalho da loja por completo.
      header.classList.add('is-hidden');
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
    // - a loja (catálogo) é pública: visitante navega livremente, sem login;
    //   apenas o administrador é redirecionado para o próprio painel.
    // - a área do cliente (pedidos) e o checkout continuam exigindo login.
    if (view === 'store') {
      if (state.currentUser && state.currentUser.role === 'admin') view = 'admin';
    }
    if (view === 'product-detail') {
      if (state.currentUser && state.currentUser.role === 'admin') view = 'admin';
    }
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

    Object.values(VIEW_IDS).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('view--active');
    });
    const target = document.getElementById(VIEW_IDS[view]);
    if (target) target.classList.add('view--active');

    updateHeaderUI();
    updateNavActiveState(view);
    window.scrollTo({ top: 0 });

    if (view === 'store') {
      global.ProductsModule.loadAndRender();
      if (global.SiteContentModule) global.SiteContentModule.render();
    }
    if (view === 'customer-orders') {
      global.CustomerAreaModule.refresh();
      global.CustomerAreaModule.startPolling();
    }
    if (view === 'admin') {
      global.AdminPanelModule.loadAll();
      global.AdminPanelModule.startPolling();
    }
  }

  function setCurrentUser(user) {
    state.currentUser = user;
    global.CartModule.loadForCurrentUser();
    updateHeaderUI();
  }

  function wireHeaderNav() {
    document.querySelectorAll('[data-nav]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(el.dataset.nav);
      })
    );
  }

  // --------------------------------------------------------------------------
  // Inicialização
  // --------------------------------------------------------------------------
  function boot() {
    Utils.setupModalDismiss();

    // Restaura sessão ("permanecer autenticado") antes de iniciar os módulos,
    // para que carrinho/área do cliente já carreguem os dados corretos.
    state.currentUser = DataService.Auth.getSession();

    // Aplica o tema e o conteúdo personalizado desde já, independente de qual
    // tela é exibida primeiro (login, loja ou painel admin).
    if (global.SiteContentModule) global.SiteContentModule.render();

    global.AuthModule.init();
    global.ProductsModule.init();
    if (global.ProductDetailModule) global.ProductDetailModule.init();
    global.CartModule.init();
    global.OrdersModule.init();
    global.CustomerAreaModule.init();
    global.AdminPanelModule.init();

    wireHeaderNav();
    updateHeaderUI();

    // 'store' é o destino padrão para todos: visitante e cliente ficam na
    // loja; o administrador é automaticamente redirecionado pela guarda de
    // acesso em navigate() para o painel administrativo.
    navigate('store');
  }

  global.App = { state, navigate, setCurrentUser };

  document.addEventListener('DOMContentLoaded', boot);
})(window);
