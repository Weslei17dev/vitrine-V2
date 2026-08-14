/* ============================================================================
   customerArea.js
   ----------------------------------------------------------------------------
   Área do cliente: histórico de pedidos, com status "em tempo real" (via
   polling leve enquanto a tela estiver aberta) e acesso ao detalhe completo
   de cada pedido.
   ============================================================================ */

(function (global) {
  'use strict';

  let pollingHandle = null;
  let lastSnapshot = '';

  function orderRowHtml(order) {
    const itemsPreview = order.items.map((i) => `${i.qty}x ${i.name}`).join(', ');
    return `
      <div class="order-card" data-id="${order.id}">
        <div class="order-card__main">
          <div class="order-card__title">
            <strong>Pedido #${order.number}</strong>
            ${Utils.statusBadgeHtml(order.status)}
          </div>
          <p class="order-card__items">${Utils.escapeHtml(itemsPreview)}</p>
          <p class="text-muted">${Utils.escapeHtml(order.date)} às ${Utils.escapeHtml(order.time)}</p>
        </div>
        <div class="order-card__side">
          <span class="order-card__total">${Utils.formatCurrency(order.total)}</span>
          <button class="btn btn--outline btn--sm" data-action="view-order" data-id="${order.id}">
            <i class="fa-solid fa-eye"></i> Detalhes
          </button>
        </div>
      </div>`;
  }

  function renderSummary(orders) {
    const totalOrders = document.getElementById('customer-summary-total-orders');
    const totalSpent = document.getElementById('customer-summary-total-spent');
    const pending = document.getElementById('customer-summary-pending');
    if (!totalOrders) return;

    const spent = orders
      .filter((o) => ['Pago', 'Em Produção', 'Enviado', 'Finalizado'].includes(o.status))
      .reduce((sum, o) => sum + o.total, 0);
    const pendingCount = orders.filter((o) =>
      ['Aguardando Pagamento', 'Aguardando Confirmação'].includes(o.status)
    ).length;

    totalOrders.textContent = orders.length;
    totalSpent.textContent = Utils.formatCurrency(spent);
    pending.textContent = pendingCount;
  }

  function render(orders) {
    const list = document.getElementById('customer-orders-list');
    if (!list) return;

    if (!orders.length) {
      list.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-receipt"></i>
          <p>Você ainda não fez nenhum pedido.</p>
          <button class="btn btn--primary btn--sm" data-action="go-store">
            <i class="fa-solid fa-store"></i> Ver produtos
          </button>
        </div>`;
      const goStoreBtn = list.querySelector('[data-action="go-store"]');
      if (goStoreBtn) goStoreBtn.addEventListener('click', () => global.App.navigate('store'));
      return;
    }

    list.innerHTML = orders.map(orderRowHtml).join('');
    renderSummary(orders);
  }

  function fetchAndRender(silent) {
    const user = global.App.state.currentUser;
    if (!user) return Promise.resolve();

    return DataService.Orders.getByUser(user.id).then((orders) => {
      const snapshot = JSON.stringify(orders.map((o) => [o.id, o.status]));
      // Evita re-render desnecessário (e "flicker") quando nada mudou.
      if (silent && snapshot === lastSnapshot) return;
      lastSnapshot = snapshot;
      render(orders);
    }).catch((err) => {
      if (!silent) Utils.showToast(err.message, 'error');
    });
  }

  function startPolling() {
    stopPolling();
    pollingHandle = setInterval(() => {
      if (!document.hidden) fetchAndRender(true);
    }, 15000);
  }

  function stopPolling() {
    if (pollingHandle) clearInterval(pollingHandle);
    pollingHandle = null;
  }

  function wireEvents() {
    const list = document.getElementById('customer-orders-list');
    if (list) {
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="view-order"]');
        if (btn) global.OrdersModule.showOrderDetail(btn.dataset.id);
      });
    }

    const profileForm = document.getElementById('form-account-profile');
    if (profileForm) {
      profileForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const form = e.target;
        const payload = Object.fromEntries(new FormData(form).entries());
        DataService.Auth.updateProfile(payload).then((user) => {
          global.App.setCurrentUser(user);
          Utils.showToast('Dados da conta atualizados.', 'success');
        }).catch((err) => Utils.showToast(err.message, 'error'));
      });
      profileForm.elements.phone.addEventListener('input', (e) => { e.target.value = Utils.maskPhone(e.target.value); });
      profileForm.elements.cpf.addEventListener('input', (e) => { e.target.value = Utils.maskCpf(e.target.value); });
      profileForm.elements.zip.addEventListener('input', (e) => { e.target.value = Utils.maskCep(e.target.value); });
    }

    const passwordForm = document.getElementById('form-account-password');
    if (passwordForm) passwordForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      DataService.Auth.changePassword(form.elements.currentPassword.value, form.elements.newPassword.value)
        .then((user) => {
          global.App.setCurrentUser(user);
          form.reset();
          Utils.showToast('Senha alterada e sessões antigas encerradas.', 'success');
        })
        .catch((err) => Utils.showToast(err.message, 'error'));
    });

    const deleteForm = document.getElementById('form-delete-account');
    if (deleteForm) deleteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!confirm('Excluir definitivamente sua conta? Esta ação não pode ser desfeita.')) return;
      const userId = global.App.state.currentUser && global.App.state.currentUser.id;
      DataService.Auth.deleteAccount(e.target.elements.password.value).then(() => {
        if (userId) DataService.Cart.clear(userId);
        global.App.setCurrentUser(null);
        Utils.showToast('Conta excluída.', 'info');
        global.App.navigate('store');
      }).catch((err) => Utils.showToast(err.message, 'error'));
    });
  }

  function populateAccountForm() {
    const user = global.App.state.currentUser;
    const form = document.getElementById('form-account-profile');
    if (!user || !form) return;
    ['name', 'cpf', 'phone', 'address', 'city', 'state', 'zip'].forEach((field) => {
      if (form.elements[field]) form.elements[field].value = user[field] || '';
    });
  }

  function refresh() {
    populateAccountForm();
    fetchAndRender(false);
  }

  function init() {
    wireEvents();
  }

  global.CustomerAreaModule = {
    init,
    refresh,
    startPolling,
    stopPolling
  };
})(window);
