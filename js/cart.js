/* ============================================================================
   cart.js
   ----------------------------------------------------------------------------
   Carrinho de compras: adicionar, alterar quantidade, remover, calcular
   subtotal/total, limpar e acionar a finalização do pedido.
   O carrinho é persistido para visitantes e clientes (DataService.Cart),
   com junção dos itens quando o visitante entra na conta.
   ============================================================================ */

(function (global) {
  'use strict';

  let items = []; // [{ productId, name, price, icon, stock, qty }]
  let couponCode = '';
  let quote = null;
  let quoteRequest = 0;
  const itemKey = (item) => JSON.stringify([item.productId, item.selectedColor || null]);
  const totalForProduct = (productId) => items.filter((item) => item.productId === productId).reduce((sum, item) => sum + item.qty, 0);

  function maxQuantity(item) {
    if (!item || item.stock == null || item.stock === '') return 99;
    const stock = Number(item && item.stock);
    return Number.isInteger(stock) && stock >= 0 ? Math.min(99, stock) : 99;
  }

  function currentUserId() {
    const user = global.App.state.currentUser;
    return user ? user.id : null;
  }

  function persist() {
    const userId = currentUserId();
    DataService.Cart.save(userId, items);
  }

  function sanitizeStoredItems(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 50).map((item) => {
      const productId = String((item && item.productId) || '');
      const price = Number(item && item.price);
      const qty = Math.max(1, Math.min(99, Number.parseInt(item && item.qty, 10) || 1));
      const parsedStock = Number.parseInt(item && item.stock, 10);
      if (!/^[0-9a-f-]{36}$/i.test(productId) || !Number.isFinite(price) || price <= 0) return null;
      return {
        productId,
        name: String(item.name || '').slice(0, 160),
        price,
        icon: String(item.icon || '🛍️').slice(0, 8),
        image: Utils.safeImageSrc(item.image || ''),
        stock: Number.isInteger(parsedStock) && parsedStock >= 0 ? parsedStock : null,
        selectedColor: item.selectedColor ? String(item.selectedColor).slice(0, 40) : null,
        qty: Math.min(qty, Number.isInteger(parsedStock) && parsedStock > 0 ? parsedStock : qty)
      };
    }).filter(Boolean);
  }

  function loadForCurrentUser() {
    const userId = currentUserId();
    items = sanitizeStoredItems(DataService.Cart.get(userId));
    if (userId && global.App.state.currentUser.role === 'client') {
      const guest = sanitizeStoredItems(DataService.Cart.get(null));
      guest.forEach((item) => {
        const existing = items.find((row) => itemKey(row) === itemKey(item));
        if (existing) existing.qty = Math.max(1, Math.min(maxQuantity(existing) - totalForProduct(item.productId) + existing.qty, existing.qty + item.qty));
        else if (items.length < 50) items.push(item);
      });
      DataService.Cart.clear(null);
    }
    persist();
    renderAll();
  }

  function addItem(product, quantity = 1, selectedColor = null) {
    if (global.App.state.currentUser?.role === 'admin') return false;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return false;
    const stock = Math.max(0, Number.parseInt(product.stock, 10) || 0);
    if (stock < 1) return false;
    if (Array.isArray(product.colors) && product.colors.length && !product.colors.some((entry) => entry.name === selectedColor)) return false;
    if (totalForProduct(product.id) + quantity > Math.min(99, stock)) return false;
    const existing = items.find((i) => i.productId === product.id && i.selectedColor === selectedColor);
    if (existing) {
      existing.stock = stock;
      if (existing.qty + quantity > maxQuantity(existing)) return false;
      existing.qty += quantity;
    } else {
      if (quantity > Math.min(99, stock) || items.length >= 50) return false;
      items.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        icon: product.icon,
        image: Utils.safeImageSrc(product.image || ''),
        stock,
        selectedColor,
        qty: quantity
      });
    }
    persist();
    renderAll();
    return true;
  }

  function updateQty(key, qty) {
    const item = items.find((i) => itemKey(i) === key);
    if (!item) return;
    const maximum = maxQuantity(item);
    if (maximum < 1) return;
    item.qty = Math.max(1, Math.min(maximum - totalForProduct(item.productId) + item.qty, qty));
    persist();
    renderAll();
  }

  function removeItem(key) {
    items = items.filter((i) => itemKey(i) !== key);
    persist();
    renderAll();
  }

  function clear() {
    items = [];
    couponCode = '';
    quote = null;
    persist();
    renderAll();
  }

  function getItems() {
    return items;
  }

  function getTotal() {
    return items.reduce((sum, i) => sum + i.price * i.qty, 0);
  }

  function getItemCount() {
    return items.reduce((sum, i) => sum + i.qty, 0);
  }

  function reconcile(products) {
    if (!Array.isArray(products)) return;
    const available = new Map(products.filter((product) => product && product.active !== false).map((product) => [product.id, product]));
    items = items.map((item) => {
      const product = available.get(item.productId);
      if (!product) return null;
      const choice = (product.colors || []).find((entry) => entry.name === item.selectedColor);
      if ((product.colors || []).length && !choice) return null;
      if (!(product.colors || []).length && item.selectedColor) return null;
      const stock = Math.max(0, Number.parseInt(product.stock, 10) || 0);
      return {
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        icon: product.icon,
        image: Utils.safeImageSrc(product.image || ''),
        stock,
        selectedColor: choice?.name || null,
        qty: stock > 0 ? Math.min(item.qty, stock, 99) : 1
      };
    }).filter(Boolean);
    const used = new Map();
    items = items.filter((item) => {
      const left = item.stock - (used.get(item.productId) || 0);
      if (left < 1) return false;
      item.qty = Math.min(item.qty, left);
      used.set(item.productId, (used.get(item.productId) || 0) + item.qty);
      return true;
    });
    persist();
    renderAll();
  }

  // --------------------------------------------------------------------------
  // Renderização
  // --------------------------------------------------------------------------
  function renderBadge() {
    const badge = document.getElementById('cart-count-badge');
    if (!badge) return;
    const count = getItemCount();
    badge.textContent = count;
    badge.classList.toggle('is-hidden', count === 0);
  }

  function cartItemRowHtml(item) {
    const maximum = maxQuantity(item);
    const image = Utils.safeImageSrc(item.image || '');
    const visual = image
      ? `<img src="${Utils.escapeHtml(image)}" alt="${Utils.escapeHtml(item.name)}">`
      : `<span>${Utils.escapeHtml(item.icon || '🛍️')}</span>`;
    return `
      <div class="cart-item" data-key="${Utils.escapeHtml(itemKey(item))}">
        <div class="cart-item__image">${visual}</div>
        <div class="cart-item__info">
          <strong>${Utils.escapeHtml(item.name)}</strong>
          ${item.selectedColor ? `<span>Cor: ${Utils.escapeHtml(item.selectedColor)}</span>` : ''}
          <span>${Utils.formatCurrency(item.price)} / un.</span>
          ${maximum < 1 ? '<span class="cart-item__stock-warning">Indisponível no momento</span>' : ''}
        </div>
        <div class="cart-item__qty">
          <button data-action="dec" aria-label="Diminuir quantidade"><i class="fa-solid fa-minus"></i></button>
          <input type="number" min="1" max="${maximum || 1}" value="${item.qty}" data-action="set-qty" aria-label="Quantidade">
          <button data-action="inc" aria-label="Aumentar quantidade" ${totalForProduct(item.productId) >= maximum ? 'disabled' : ''}><i class="fa-solid fa-plus"></i></button>
        </div>
        <div class="cart-item__subtotal">${Utils.formatCurrency(item.price * item.qty)}</div>
        <button class="cart-item__remove" data-action="remove" aria-label="Remover produto">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`;
  }

  function renderDrawer() {
    const list = document.getElementById('cart-items-list');
    const totalEl = document.getElementById('cart-total');
    const emptyState = document.getElementById('cart-empty-state');
    const footer = document.getElementById('cart-footer');
    const extras = document.getElementById('cart-order-extras');
    if (!list) return;

    if (!items.length) {
      list.innerHTML = '';
      if (emptyState) emptyState.classList.remove('is-hidden');
      if (footer) footer.classList.add('is-hidden');
      if (extras) extras.classList.add('is-hidden');
    } else {
      if (emptyState) emptyState.classList.add('is-hidden');
      if (footer) footer.classList.remove('is-hidden');
      if (extras) extras.classList.remove('is-hidden');
      list.innerHTML = items.map(cartItemRowHtml).join('');
    }

    if (totalEl) totalEl.textContent = quote ? Utils.formatCurrency(quote.total) : Utils.formatCurrency(getTotal());
    const costs = document.getElementById('cart-costs');
    if (costs) costs.innerHTML = quote ? `
      <div><span>Produtos</span><strong>${Utils.formatCurrency(quote.grossSubtotal)}</strong></div>
      ${quote.discountTotal ? `<div class="checkout-discount"><span>Descontos nos produtos</span><strong>− ${Utils.formatCurrency(quote.discountTotal)}</strong></div>` : ''}
      <div><span>Frete de exemplo · ${quote.estimatedDays} dias úteis</span><strong>${quote.shippingTotal ? Utils.formatCurrency(quote.shippingTotal) : 'Grátis'}</strong></div>
      ${quote.shippingDiscount ? `<div class="checkout-discount"><span>Cupom de frete grátis</span><strong>− ${Utils.formatCurrency(quote.shippingDiscount)}</strong></div>` : ''}
      <small class="theme-hint">Tarifa ilustrativa, editável pelo administrador.</small>` : items.length ? '<small class="theme-hint">Calculando frete e descontos…</small>' : '';
    document.getElementById('cart-coupon-remove')?.classList.toggle('is-hidden', !couponCode);
  }

  function renderAll() {
    quote = null;
    renderBadge();
    renderDrawer();
    refreshQuote();
  }

  function refreshQuote(attempt = couponCode) {
    const request = ++quoteRequest;
    if (!items.length) return Promise.resolve();
    return DataService.Orders.quote(items, attempt).then((result) => {
      if (request !== quoteRequest) return;
      quote = result;
      couponCode = result.couponCode || '';
      document.getElementById('cart-coupon-code').value = couponCode;
      document.getElementById('cart-coupon-message').textContent = couponCode ? `Cupom ${couponCode} aplicado.` : '';
      renderDrawer();
    }).catch((err) => {
      if (request !== quoteRequest) return;
      document.getElementById('cart-coupon-message').textContent = err.message;
      quote = null;
      renderDrawer();
    });
  }

  function checkout() {
    if (global.App.state.currentUser?.role === 'admin') {
      Utils.showToast('Use uma conta de cliente para realizar uma compra. Seu acesso administrativo será preservado.', 'info');
      return;
    }
    if (!items.length) { Utils.showToast('Seu carrinho está vazio.', 'warning'); return; }
    if (items.some((item) => maxQuantity(item) < 1)) {
      Utils.showToast('Remova os produtos indisponíveis antes de finalizar.', 'warning'); return;
    }
    Utils.closeModal('modal-cart');
    if (!global.App.state.currentUser) {
      sessionStorage.setItem('vitrine:resume-checkout', '1');
      Utils.showToast('Seu carrinho foi salvo. Entre ou crie uma conta para continuar a compra.', 'info');
      global.App.navigate('login');
      return;
    }
    global.OrdersModule.openCheckout(items.map((item) => ({ ...item })), couponCode);
  }

  function resumeCheckout() {
    if (sessionStorage.getItem('vitrine:resume-checkout') !== '1') return;
    sessionStorage.removeItem('vitrine:resume-checkout');
    if (global.App.state.currentUser?.role === 'client' && items.length) checkout();
  }

  // --------------------------------------------------------------------------
  // Eventos
  // --------------------------------------------------------------------------
  function wireDrawerEvents() {
    const list = document.getElementById('cart-items-list');
    if (list) {
      list.addEventListener('click', (e) => {
        const row = e.target.closest('.cart-item');
        if (!row) return;
        const id = row.dataset.key;
        const item = items.find((i) => itemKey(i) === id);
        if (!item) return;

        if (e.target.closest('[data-action="inc"]')) updateQty(id, item.qty + 1);
        if (e.target.closest('[data-action="dec"]')) updateQty(id, item.qty - 1);
        if (e.target.closest('[data-action="remove"]')) removeItem(id);
      });

      list.addEventListener('change', (e) => {
        if (e.target.matches('[data-action="set-qty"]')) {
          const row = e.target.closest('.cart-item');
          const value = parseInt(e.target.value, 10) || 1;
          updateQty(row.dataset.key, value);
        }
      });
    }

    const openBtn = document.getElementById('open-cart-btn');
    if (openBtn) openBtn.addEventListener('click', () => Utils.openModal('modal-cart'));

    const clearBtn = document.getElementById('clear-cart-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!items.length) return;
        clear();
        Utils.showToast('Carrinho esvaziado.', 'info');
      });
    }

    const checkoutBtn = document.getElementById('go-checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', checkout);
    }
    document.getElementById('cart-coupon-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      refreshQuote(document.getElementById('cart-coupon-code').value.trim());
    });
    document.getElementById('cart-coupon-remove')?.addEventListener('click', () => refreshQuote(''));
  }

  function init() {
    wireDrawerEvents();
    loadForCurrentUser();
  }

  global.CartModule = {
    init,
    checkout,
    resumeCheckout,
    addItem,
    updateQty,
    removeItem,
    clear,
    getItems,
    getTotal,
    getItemCount,
    reconcile,
    loadForCurrentUser,
    renderAll
  };
})(window);
