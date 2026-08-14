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
      .filter((o) => o.status !== 'Cancelado')
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
    });
  }

  function startPolling() {
    stopPolling();
    pollingHandle = setInterval(() => fetchAndRender(true), 3000);
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
  }

  function refresh() {
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
