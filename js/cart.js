/* ============================================================================
   cart.js
   ----------------------------------------------------------------------------
   Carrinho de compras: adicionar, alterar quantidade, remover, calcular
   subtotal/total, limpar e acionar a finalização do pedido.
   O carrinho é persistido por usuário (DataService.Cart) para sobreviver a
   um refresh de página enquanto o cliente estiver logado.
   ============================================================================ */

(function (global) {
  'use strict';

  let items = []; // [{ productId, name, price, icon, stock, qty }]

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
    if (!userId) return;
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
        qty: Math.min(qty, Number.isInteger(parsedStock) && parsedStock > 0 ? parsedStock : qty)
      };
    }).filter(Boolean);
  }

  function loadForCurrentUser() {
    const userId = currentUserId();
    if (!userId) {
      items = [];
      renderAll();
      return;
    }
    items = sanitizeStoredItems(DataService.Cart.get(userId));
    persist();
    renderAll();
  }

  function addItem(product) {
    if (!currentUserId()) return false;
    const stock = Math.max(0, Number.parseInt(product.stock, 10) || 0);
    if (stock < 1) return false;
    const existing = items.find((i) => i.productId === product.id);
    if (existing) {
      existing.stock = stock;
      if (existing.qty >= maxQuantity(existing)) return false;
      existing.qty += 1;
    } else {
      items.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        icon: product.icon,
        image: Utils.safeImageSrc(product.image || ''),
        stock,
        qty: 1
      });
    }
    persist();
    renderAll();
    return true;
  }

  function updateQty(productId, qty) {
    const item = items.find((i) => i.productId === productId);
    if (!item) return;
    const maximum = maxQuantity(item);
    if (maximum < 1) return;
    item.qty = Math.max(1, Math.min(maximum, qty));
    persist();
    renderAll();
  }

  function removeItem(productId) {
    items = items.filter((i) => i.productId !== productId);
    persist();
    renderAll();
  }

  function clear() {
    items = [];
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
      const stock = Math.max(0, Number.parseInt(product.stock, 10) || 0);
      return {
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        icon: product.icon,
        image: Utils.safeImageSrc(product.image || ''),
        stock,
        qty: stock > 0 ? Math.min(item.qty, stock, 99) : 1
      };
    }).filter(Boolean);
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
      <div class="cart-item" data-id="${Utils.escapeHtml(item.productId)}">
        <div class="cart-item__image">${visual}</div>
        <div class="cart-item__info">
          <strong>${Utils.escapeHtml(item.name)}</strong>
          <span>${Utils.formatCurrency(item.price)} / un.</span>
          ${maximum < 1 ? '<span class="cart-item__stock-warning">Indisponível no momento</span>' : ''}
        </div>
        <div class="cart-item__qty">
          <button data-action="dec" aria-label="Diminuir quantidade"><i class="fa-solid fa-minus"></i></button>
          <input type="number" min="1" max="${maximum || 1}" value="${item.qty}" data-action="set-qty" aria-label="Quantidade">
          <button data-action="inc" aria-label="Aumentar quantidade" ${item.qty >= maximum ? 'disabled' : ''}><i class="fa-solid fa-plus"></i></button>
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
    if (!list) return;

    if (!items.length) {
      list.innerHTML = '';
      if (emptyState) emptyState.classList.remove('is-hidden');
      if (footer) footer.classList.add('is-hidden');
    } else {
      if (emptyState) emptyState.classList.add('is-hidden');
      if (footer) footer.classList.remove('is-hidden');
      list.innerHTML = items.map(cartItemRowHtml).join('');
    }

    if (totalEl) totalEl.textContent = Utils.formatCurrency(getTotal());
  }

  function renderAll() {
    renderBadge();
    renderDrawer();
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
        const id = row.dataset.id;
        const item = items.find((i) => i.productId === id);
        if (!item) return;

        if (e.target.closest('[data-action="inc"]')) updateQty(id, item.qty + 1);
        if (e.target.closest('[data-action="dec"]')) updateQty(id, item.qty - 1);
        if (e.target.closest('[data-action="remove"]')) removeItem(id);
      });

      list.addEventListener('change', (e) => {
        if (e.target.matches('[data-action="set-qty"]')) {
          const row = e.target.closest('.cart-item');
          const value = parseInt(e.target.value, 10) || 1;
          updateQty(row.dataset.id, value);
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
      checkoutBtn.addEventListener('click', () => {
        if (!items.length) {
          Utils.showToast('Seu carrinho está vazio.', 'warning');
          return;
        }
        if (items.some((item) => maxQuantity(item) < 1)) {
          Utils.showToast('Remova os produtos indisponíveis antes de finalizar.', 'warning');
          return;
        }
        if (!global.App.state.currentUser) {
          Utils.closeModal('modal-cart');
          Utils.showToast('Seu carrinho foi salvo. Entre ou crie uma conta para finalizar.', 'info');
          global.App.navigate('login');
          return;
        }
        Utils.closeModal('modal-cart');
        global.OrdersModule.openCheckout(items);
      });
    }
  }

  function init() {
    wireDrawerEvents();
    loadForCurrentUser();
  }

  global.CartModule = {
    init,
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
