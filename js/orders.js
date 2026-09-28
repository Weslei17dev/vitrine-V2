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

  let pendingCheckout = { items: [], total: 0, idempotencyKey: null, couponCode: '', requestId: 0 };
  let currentOrder = null;

  // --------------------------------------------------------------------------
  // Passo 1: revisão/confirmação dos dados antes de gerar o pedido
  // --------------------------------------------------------------------------
  function renderCheckoutReview(items, quote) {
    const user = global.App.state.currentUser;
    const container = document.getElementById('checkout-review');
    if (!container) return;

    const itemsHtml = items
      .map(
        (i) => `
        <tr>
          <td>${Utils.escapeHtml(i.name)}</td>
          <td>${i.qty}x</td>
          <td>${Utils.formatCurrency(i.subtotal ?? i.price * i.qty)}</td>
        </tr>`
      )
      .join('');

    container.innerHTML = `
      <h3><i class="fa-solid fa-user"></i> Dados para entrega</h3>
      <form id="checkout-address-form" class="checkout-summary-box">
        <p><strong>${Utils.escapeHtml(user.name)}</strong></p>
        <p>${Utils.escapeHtml(user.email)}</p>
        <p class="theme-hint">Informe ou atualize o endereço. Ele será salvo no seu perfil ao confirmar o pedido.</p>
        <div class="form-grid">
          <div class="form-field form-field--span2"><label for="checkout-address">Endereço completo</label><input id="checkout-address" name="address" autocomplete="street-address" required minlength="5" value="${Utils.escapeHtml(user.address || '')}" placeholder="Rua, número, complemento e bairro"></div>
          <div class="form-field"><label for="checkout-city">Cidade</label><input id="checkout-city" name="city" autocomplete="address-level2" required minlength="2" value="${Utils.escapeHtml(user.city || '')}"></div>
          <div class="form-field"><label for="checkout-state">UF</label><input id="checkout-state" name="state" autocomplete="address-level1" required maxlength="2" minlength="2" value="${Utils.escapeHtml(user.state || '')}"></div>
          <div class="form-field"><label for="checkout-zip">CEP</label><input id="checkout-zip" name="zip" autocomplete="postal-code" required inputmode="numeric" value="${Utils.escapeHtml(user.zip || '')}"></div>
          <div class="form-field"><label for="checkout-phone">Telefone</label><input id="checkout-phone" name="phone" autocomplete="tel" required value="${Utils.escapeHtml(user.phone || '')}"></div>
        </div>
      </form>

      <h3><i class="fa-solid fa-bag-shopping"></i> Itens do pedido</h3>
      <table class="simple-table">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Subtotal</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <form id="checkout-coupon-form" class="checkout-coupon-form">
        <label for="checkout-coupon-code">Cupom de desconto</label>
        <div><input id="checkout-coupon-code" type="text" autocomplete="off" maxlength="32" placeholder="Digite seu cupom" value="${Utils.escapeHtml(quote.couponCode || '')}"><button class="btn btn--outline btn--sm" type="submit">Aplicar</button>${quote.couponCode ? '<button id="checkout-remove-coupon" class="btn btn--ghost btn--sm" type="button">Remover</button>' : ''}</div>
      </form>

      <div class="checkout-costs">
        ${quote.discountTotal > 0 ? `<div><span>Valor antes dos descontos</span><strong>${Utils.formatCurrency(quote.grossSubtotal)}</strong></div>` : ''}
        ${quote.automaticDiscount > 0 ? `<div class="checkout-discount"><span>Desconto nos produtos</span><strong>− ${Utils.formatCurrency(quote.automaticDiscount)}</strong></div>` : ''}
        ${quote.couponDiscount > 0 ? `<div class="checkout-discount"><span>Cupom ${Utils.escapeHtml(quote.couponCode)}</span><strong>− ${Utils.formatCurrency(quote.couponDiscount)}</strong></div>` : ''}
        <div><span>Subtotal</span><strong>${Utils.formatCurrency(quote.subtotal)}</strong></div>
        <div><span>Frete${quote.estimatedDays ? ` · estimativa de ${quote.estimatedDays} dias úteis` : ''}</span><strong>${quote.shippingTotal > 0 ? Utils.formatCurrency(quote.shippingTotal) : 'Grátis'}</strong></div>
      </div>
      <div class="checkout-total-row"><span>Total do pedido</span><strong>${Utils.formatCurrency(quote.total)}</strong></div>

      <p class="checkout-confirm-hint">
        <i class="fa-solid fa-circle-info"></i>
        Confira seus dados de entrega antes de confirmar. Ao confirmar, um código PIX será gerado para pagamento.
      </p>`;
    document.getElementById('checkout-address-form').addEventListener('submit', (event) => { event.preventDefault(); confirmCheckout(); });
    document.getElementById('checkout-coupon-form').addEventListener('submit', (event) => {
      event.preventDefault();
      requestQuote(document.getElementById('checkout-coupon-code').value.trim());
    });
    document.getElementById('checkout-remove-coupon')?.addEventListener('click', () => requestQuote(''));
  }

  function requestQuote(couponCode) {
    const requestId = ++pendingCheckout.requestId;
    const review = document.getElementById('checkout-review');
    const addressForm = document.getElementById('checkout-address-form');
    const address = addressForm ? Object.fromEntries(new FormData(addressForm)) : null;
    const confirmButton = document.getElementById('confirm-order-btn');
    confirmButton.disabled = true;
    return DataService.Orders.quote(pendingCheckout.items, couponCode).then((quote) => {
      if (requestId !== pendingCheckout.requestId) return;
      pendingCheckout.items = quote.items;
      pendingCheckout.couponCode = quote.couponCode || '';
      pendingCheckout.total = quote.total;
      renderCheckoutReview(quote.items, quote);
      if (address) {
        for (const [name, value] of Object.entries(address)) {
          const input = document.getElementById('checkout-address-form').elements[name];
          if (input) input.value = value;
        }
      }
      confirmButton.disabled = false;
    }).catch((err) => {
      if (requestId !== pendingCheckout.requestId) return;
      if (!address) Utils.closeModal('modal-checkout');
      else confirmButton.disabled = false;
      Utils.showToast(err.message, 'error');
    });
  }

  function openCheckout(items) {
    const idempotencyKey = global.crypto && global.crypto.randomUUID
      ? global.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    pendingCheckout = { items, total: 0, idempotencyKey, couponCode:'', requestId:0 };
    const confirmButton = document.getElementById('confirm-order-btn');
    if (confirmButton) confirmButton.disabled = true;
    document.getElementById('checkout-step-review').classList.remove('is-hidden');
    document.getElementById('checkout-step-payment').classList.add('is-hidden');
    const review = document.getElementById('checkout-review');
    if (review) review.innerHTML = '<div class="empty-state empty-state--inline"><i class="fa-solid fa-spinner fa-spin"></i><p>Conferindo estoque e frete...</p></div>';
    Utils.openModal('modal-checkout');
    requestQuote('');
  }

  // --------------------------------------------------------------------------
  // Passo 2: geração do pedido + exibição do QR Code PIX
  // --------------------------------------------------------------------------
  function renderPixQrCode(order) {
    const holder = document.getElementById('pix-qrcode-holder');
    if (!holder) return;
    holder.innerHTML = '';

    // Usa a lib QRCode.js (carregada via CDN no index.html) para gerar um
    // QR Code PIX estático gerado pelo servidor. A confirmação do recebimento
    // continua manual até a integração futura com um provedor de pagamentos.
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

  async function confirmCheckout() {
    const confirmBtn = document.getElementById('confirm-order-btn');
    if (confirmBtn?.disabled) return;
    const addressForm = document.getElementById('checkout-address-form');
    if (!addressForm || !addressForm.reportValidity()) return;
    if (confirmBtn) confirmBtn.disabled = true;
    try {
      const current = global.App.state.currentUser;
      const profile = await DataService.Auth.updateProfile({ ...current, ...Object.fromEntries(new FormData(addressForm)) });
      global.App.setCurrentUser(profile);
    } catch (err) {
      if (confirmBtn) confirmBtn.disabled = false;
      Utils.showToast(err.message, 'error');
      return;
    }

    const orderItems = pendingCheckout.items.map((i) => ({
      productId: i.productId,
      name: i.name,
      price: i.price,
      qty: i.qty
    }));

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando pedido...';

    DataService.Orders.create({
      items: orderItems,
      idempotencyKey: pendingCheckout.idempotencyKey,
      couponCode: pendingCheckout.couponCode,
      expectedTotal: pendingCheckout.total
    })
      .then((order) => {
        currentOrder = order;
        global.CartModule.clear();

        document.getElementById('checkout-step-review').classList.add('is-hidden');
        document.getElementById('checkout-step-payment').classList.remove('is-hidden');
        document.getElementById('payment-order-number').textContent = `#${order.number}`;
        document.getElementById('payment-order-total').textContent = Utils.formatCurrency(order.total);
        const pixCode = document.getElementById('pix-copy-code');
        if (pixCode) pixCode.value = order.pixPayload || '';
        const statusEl = document.querySelector('.pix-payment__status');
        if (statusEl && order.expiresAt) {
          const deadline = new Date(order.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
          statusEl.innerHTML = `<i class="fa-solid fa-clock"></i> Pague até ${Utils.escapeHtml(deadline)}`;
        }
        renderPixQrCode(order);
      })
      .catch(async (err) => {
        Utils.showToast(err.message, 'error');
        if (err.code === 'quote_changed') await requestQuote(pendingCheckout.couponCode);
      })
      .finally(() => {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirmar Pedido';
      });
  }

  function handleCopyPixCode() {
    if (!currentOrder || !currentOrder.pixPayload) return;
    const btn = document.getElementById('pix-copy-btn');
    const restoreLabel = '<i class="fa-solid fa-copy"></i> Copiar código Pix';

    const codeField = document.getElementById('pix-copy-code');
    const copyPromise = navigator.clipboard && global.isSecureContext
      ? navigator.clipboard.writeText(currentOrder.pixPayload)
      : new Promise((resolve, reject) => {
          if (!codeField) return reject(new Error('Campo indisponível'));
          codeField.focus();
          codeField.select();
          try { document.execCommand('copy') ? resolve() : reject(new Error('Cópia bloqueada')); } catch (err) { reject(err); }
        });

    copyPromise
      .then(() => {
        Utils.showToast('Código Pix copiado! Cole no app do seu banco.', 'success');
        if (btn) {
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Copiado!';
          setTimeout(() => { btn.innerHTML = restoreLabel; }, 2000);
        }
      })
      .catch(() => {
        if (codeField) { codeField.focus(); codeField.select(); }
        Utils.showToast('Selecione o código exibido e copie manualmente.', 'warning');
      });
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
          <span>Este pedido foi cancelado.${order.cancelReason ? ` Motivo: ${Utils.escapeHtml(order.cancelReason)}.` : ''}</span>
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
          <td>${Utils.formatCurrency(i.subtotal ?? i.price * i.qty)}</td>
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
      ${order.shipping && order.shipping.address ? `
        <div class="checkout-summary-box">
          <p><strong>Entrega:</strong> ${Utils.escapeHtml(order.shipping.address || '')}</p>
          <p>${Utils.escapeHtml(order.shipping.city || '')}/${Utils.escapeHtml(order.shipping.state || '')} · CEP ${Utils.escapeHtml(order.shipping.zip || '')}</p>
          <p>Telefone: ${Utils.escapeHtml(order.shipping.phone || '')}</p>
        </div>` : ''}

      ${buildStatusTimelineHtml(order)}

      ${order.status === 'Aguardando Pagamento' && global.App.state.currentUser?.role === 'client' ? `<button type="button" class="btn btn--outline btn--sm" data-action="cancel-order-detail" data-id="${order.id}"><i class="fa-solid fa-ban"></i> Cancelar pedido</button>` : ''}

      <h4>Itens</h4>
      <table class="simple-table">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Unitário</th><th>Subtotal</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div class="checkout-total-row">
        <span>Valor dos produtos</span><strong>${Utils.formatCurrency(order.subtotal + order.discountTotal)}</strong>
      </div>
      ${order.discountTotal > 0 ? `<div class="checkout-total-row"><span>Desconto aplicado${order.couponCode ? ` · ${Utils.escapeHtml(order.couponCode)}` : ''}</span><strong>− ${Utils.formatCurrency(order.discountTotal)}</strong></div>` : ''}
      <div class="checkout-total-row">
        <span>Frete</span><strong>${order.shippingTotal > 0 ? Utils.formatCurrency(order.shippingTotal) : 'Grátis'}</strong>
      </div>
      <div class="checkout-total-row">
        <span>Total do pedido</span><strong>${Utils.formatCurrency(order.total)}</strong>
      </div>`;
  }

  function showOrderDetail(orderId) {
    DataService.Orders.getById(orderId).then((order) => {
      document.getElementById('order-detail-content').innerHTML = buildOrderDetailHtml(order);
      const cancelBtn = document.querySelector('[data-action="cancel-order-detail"]');
      if (cancelBtn) cancelBtn.addEventListener('click', () => {
        if (!confirm('Cancelar este pedido e liberar os itens reservados?')) return;
        cancelBtn.disabled = true;
        DataService.Orders.cancel(order.id).then(() => {
          Utils.closeModal('modal-order-detail');
          Utils.showToast('Pedido cancelado e estoque liberado.', 'info');
          global.CustomerAreaModule?.refresh();
        }).catch((err) => {
          cancelBtn.disabled = false;
          Utils.showToast(err.message, 'error');
        });
      });
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
