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
    const navLinks = document.getElementById('header-nav-links');
    const myOrdersLink = document.getElementById('nav-my-orders');
    const userNameEl = document.getElementById('header-user-name');
    if (!header) return;

    if (!state.currentUser) {
      // Visitante: o catálogo e o blog são livres; "Meus Pedidos" exige
      // login e permanece escondido.
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
    if (['product-detail', 'blog', 'blog-article', 'legal'].includes(view)) {
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
      global.CartModule.migrateGuestCart(user.id);
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
  }

  // --------------------------------------------------------------------------
  // Inicialização
  // --------------------------------------------------------------------------
  function setupAgeGate() {
    const gate = document.getElementById('age-gate');
    const confirmButton = document.getElementById('age-confirm-btn');
    const leaveButton = document.getElementById('age-leave-btn');
    if (!gate) return;
    if (localStorage.getItem('vitrine_age_confirmed') === 'yes') gate.classList.add('is-hidden');
    else requestAnimationFrame(() => confirmButton?.focus());
    if (confirmButton) confirmButton.addEventListener('click', () => {
      localStorage.setItem('vitrine_age_confirmed', 'yes');
      gate.classList.add('is-hidden');
    });
    if (leaveButton) leaveButton.addEventListener('click', () => {
      if (history.length > 1) history.back();
      else location.replace('about:blank');
    });
    gate.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || gate.classList.contains('is-hidden')) return;
      const buttons = [confirmButton, leaveButton].filter(Boolean);
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

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
    setupAgeGate();

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

    if (state.currentUser) global.CartModule.migrateGuestCart(state.currentUser.id);

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

    // 'store' é o destino padrão para todos: visitante e cliente ficam na
    // loja; o administrador é automaticamente redirecionado pela guarda de
    // acesso em navigate() para o painel administrativo.
    navigate('store');
  }

  global.App = { state, navigate, setCurrentUser, getCurrentView: () => currentView };

  document.addEventListener('DOMContentLoaded', boot);
})(window);
