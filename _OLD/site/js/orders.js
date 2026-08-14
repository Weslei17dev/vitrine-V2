/* ============================================================================
   orders.js
   ----------------------------------------------------------------------------
   Fluxo de finalização de pedido (confirmação de dados -> geração do pedido
   -> QR Code PIX -> "já realizei o pagamento") e a renderização compartilhada
   de detalhe/linha do tempo de status, usada tanto na Área do Cliente quanto
   no Painel Administrativo.
   ============================================================================ */

(function (global) {
  'use strict';

  let pendingCheckout = { items: [], total: 0 };
  let currentOrder = null;

  // --------------------------------------------------------------------------
  // Passo 1: revisão/confirmação dos dados antes de gerar o pedido
  // --------------------------------------------------------------------------
  function renderCheckoutReview(items, total) {
    const user = global.App.state.currentUser;
    const container = document.getElementById('checkout-review');
    if (!container) return;

    const itemsHtml = items
      .map(
        (i) => `
        <tr>
          <td>${Utils.escapeHtml(i.name)}</td>
          <td>${i.qty}x</td>
          <td>${Utils.formatCurrency(i.price * i.qty)}</td>
        </tr>`
      )
      .join('');

    container.innerHTML = `
      <h3><i class="fa-solid fa-user"></i> Dados para entrega</h3>
      <div class="checkout-summary-box">
        <p><strong>${Utils.escapeHtml(user.name)}</strong></p>
        <p>${Utils.escapeHtml(user.address)} — ${Utils.escapeHtml(user.city)}/${Utils.escapeHtml(user.state)}</p>
        <p>CEP: ${Utils.escapeHtml(user.zip)} · Tel: ${Utils.escapeHtml(user.phone)}</p>
        <p>${Utils.escapeHtml(user.email)}</p>
      </div>

      <h3><i class="fa-solid fa-bag-shopping"></i> Itens do pedido</h3>
      <table class="simple-table">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Subtotal</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div class="checkout-total-row">
        <span>Total do pedido</span>
        <strong>${Utils.formatCurrency(total)}</strong>
      </div>

      <p class="checkout-confirm-hint">
        <i class="fa-solid fa-circle-info"></i>
        Confira seus dados de entrega antes de confirmar. Ao confirmar, um código PIX será gerado para pagamento.
      </p>`;
  }

  function openCheckout(items, total) {
    pendingCheckout = { items, total };
    document.getElementById('checkout-step-review').classList.remove('is-hidden');
    document.getElementById('checkout-step-payment').classList.add('is-hidden');
    renderCheckoutReview(items, total);
    Utils.openModal('modal-checkout');
  }

  // --------------------------------------------------------------------------
  // Passo 2: geração do pedido + exibição do QR Code PIX
  // --------------------------------------------------------------------------
  function renderPixQrCode(order) {
    const holder = document.getElementById('pix-qrcode-holder');
    if (!holder) return;
    holder.innerHTML = '';

    // Usa a lib QRCode.js (carregada via CDN no index.html) para gerar um
    // QR Code real a partir do payload PIX simulado.
    // TODO INTEGRAÇÃO: substituir `order.pixPayload` pelo payload retornado
    // por um provedor de pagamentos real (PSP) assim que o PIX automático
    // for implementado no backend.
    if (global.QRCode) {
      // eslint-disable-next-line no-new
      new global.QRCode(holder, {
        text: order.pixPayload,
        width: 200,
        height: 200,
        colorDark: '#1A1D29',
        colorLight: '#ffffff'
      });
    } else {
      holder.innerHTML = '<p>QR Code indisponível offline.</p>';
    }
  }

  function confirmCheckout() {
    const user = global.App.state.currentUser;
    const confirmBtn = document.getElementById('confirm-order-btn');

    const orderItems = pendingCheckout.items.map((i) => ({
      productId: i.productId,
      name: i.name,
      price: i.price,
      qty: i.qty
    }));

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando pedido...';

    DataService.Orders.create({
      userId: user.id,
      customerName: user.name,
      items: orderItems,
      total: pendingCheckout.total
    })
      .then((order) => {
        currentOrder = order;
        global.CartModule.clear();

        document.getElementById('checkout-step-review').classList.add('is-hidden');
        document.getElementById('checkout-step-payment').classList.remove('is-hidden');
        document.getElementById('payment-order-number').textContent = `#${order.number}`;
        document.getElementById('payment-order-total').textContent = Utils.formatCurrency(order.total);
        renderPixQrCode(order);

        // Notifica o painel do administrador (outra aba ou próxima renderização)
        // de que um novo pedido chegou.
        if (global.AdminPanelModule) {
          global.AdminPanelModule.notifyNewOrder(order);
        }
      })
      .catch((err) => Utils.showToast(err.message, 'error'))
      .finally(() => {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirmar Pedido';
      });
  }

  function handleCopyPixCode() {
    if (!currentOrder || !currentOrder.pixPayload) return;
    const btn = document.getElementById('pix-copy-btn');
    const restoreLabel = '<i class="fa-solid fa-copy"></i> Copiar código Pix';

    navigator.clipboard
      .writeText(currentOrder.pixPayload)
      .then(() => {
        Utils.showToast('Código Pix copiado! Cole no app do seu banco.', 'success');
        if (btn) {
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Copiado!';
          setTimeout(() => { btn.innerHTML = restoreLabel; }, 2000);
        }
      })
      .catch(() => Utils.showToast('Não foi possível copiar automaticamente. Selecione o código manualmente.', 'warning'));
  }

  function handlePaymentReported() {
    if (!currentOrder) return;
    const btn = document.getElementById('payment-done-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

    DataService.Orders.markPaymentReported(currentOrder.id)
      .then(() => {
        Utils.closeModal('modal-checkout');
        Utils.showToast(
          'Pagamento informado! Aguarde a confirmação do administrador.',
          'success',
          { title: `Pedido #${currentOrder.number}` }
        );
        currentOrder = null;
        if (global.CustomerAreaModule) global.CustomerAreaModule.refresh();
        global.App.navigate('customer-orders');
      })
      .catch((err) => Utils.showToast(err.message, 'error'))
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-money-check-dollar"></i> Já realizei o pagamento';
      });
  }

  // --------------------------------------------------------------------------
  // Linha do tempo de status (componente visual reutilizado em vários locais)
  // --------------------------------------------------------------------------
  function buildStatusTimelineHtml(order) {
    const flow = DataService.Orders.STATUS_FLOW;

    if (order.status === DataService.Orders.STATUS_CANCELLED) {
      return `
        <div class="status-timeline status-timeline--cancelled">
          <i class="fa-solid fa-ban"></i>
          <span>Este pedido foi cancelado.</span>
        </div>`;
    }

    const currentIndex = flow.indexOf(order.status);

    return `
      <ol class="status-timeline">
        ${flow
          .map((step, idx) => {
            let stateClass = 'is-pending';
            if (idx < currentIndex) stateClass = 'is-done';
            if (idx === currentIndex) stateClass = 'is-current';
            return `
              <li class="status-timeline__step ${stateClass}">
                <span class="status-timeline__dot">${idx < currentIndex ? '<i class="fa-solid fa-check"></i>' : idx + 1}</span>
                <span class="status-timeline__label">${Utils.escapeHtml(step)}</span>
              </li>`;
          })
          .join('')}
      </ol>`;
  }

  function buildOrderDetailHtml(order) {
    const itemsHtml = order.items
      .map(
        (i) => `
        <tr>
          <td>${Utils.escapeHtml(i.name)}</td>
          <td>${i.qty}x</td>
          <td>${Utils.formatCurrency(i.price)}</td>
          <td>${Utils.formatCurrency(i.price * i.qty)}</td>
        </tr>`
      )
      .join('');

    return `
      <div class="order-detail__header">
        <div>
          <h3>Pedido #${order.number}</h3>
          <p class="text-muted">${Utils.escapeHtml(order.date)} às ${Utils.escapeHtml(order.time)}</p>
        </div>
        ${Utils.statusBadgeHtml(order.status)}
      </div>

      <p><strong>Cliente:</strong> ${Utils.escapeHtml(order.customerName)}</p>

      ${buildStatusTimelineHtml(order)}

      <h4>Itens</h4>
      <table class="simple-table">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Unitário</th><th>Subtotal</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div class="checkout-total-row">
        <span>Total do pedido</span>
        <strong>${Utils.formatCurrency(order.total)}</strong>
      </div>`;
  }

  function showOrderDetail(orderId) {
    DataService.Orders.getById(orderId).then((order) => {
      document.getElementById('order-detail-content').innerHTML = buildOrderDetailHtml(order);
      Utils.openModal('modal-order-detail');
    });
  }

  // --------------------------------------------------------------------------
  // Inicialização
  // --------------------------------------------------------------------------
  function init() {
    const confirmBtn = document.getElementById('confirm-order-btn');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmCheckout);

    const paymentDoneBtn = document.getElementById('payment-done-btn');
    if (paymentDoneBtn) paymentDoneBtn.addEventListener('click', handlePaymentReported);

    const pixCopyBtn = document.getElementById('pix-copy-btn');
    if (pixCopyBtn) pixCopyBtn.addEventListener('click', handleCopyPixCode);
    // O botão "Voltar" já possui o atributo data-close-modal, tratado
    // globalmente em Utils.setupModalDismiss().
  }

  global.OrdersModule = {
    init,
    openCheckout,
    showOrderDetail,
    buildOrderDetailHtml,
    buildStatusTimelineHtml
  };
})(window);
