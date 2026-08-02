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

  let items = []; // [{ productId, name, price, icon, qty }]

  function currentUserId() {
    const user = global.App.state.currentUser;
    return user ? user.id : null;
  }

  function persist() {
    const userId = currentUserId();
    if (userId) DataService.Cart.save(userId, items);
  }

  function loadForCurrentUser() {
    const userId = currentUserId();
    items = userId ? DataService.Cart.get(userId) : [];
    renderAll();
  }

  function addItem(product) {
    const existing = items.find((i) => i.productId === product.id);
    if (existing) {
      existing.qty += 1;
    } else {
      items.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        icon: product.icon,
        qty: 1
      });
    }
    persist();
    renderAll();
  }

  function updateQty(productId, qty) {
    const item = items.find((i) => i.productId === productId);
    if (!item) return;
    item.qty = Math.max(1, Math.min(99, qty));
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
    return `
      <div class="cart-item" data-id="${item.productId}">
        <div class="cart-item__icon">${item.icon || '🛍️'}</div>
        <div class="cart-item__info">
          <strong>${Utils.escapeHtml(item.name)}</strong>
          <span>${Utils.formatCurrency(item.price)} / un.</span>
        </div>
        <div class="cart-item__qty">
          <button data-action="dec" aria-label="Diminuir quantidade"><i class="fa-solid fa-minus"></i></button>
          <input type="number" min="1" max="99" value="${item.qty}" data-action="set-qty" aria-label="Quantidade">
          <button data-action="inc" aria-label="Aumentar quantidade"><i class="fa-solid fa-plus"></i></button>
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
        Utils.closeModal('modal-cart');
        global.OrdersModule.openCheckout(items, getTotal());
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
    loadForCurrentUser,
    renderAll
  };
})(window);
