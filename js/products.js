/* ============================================================================
   products.js
   ----------------------------------------------------------------------------
   Catálogo de produtos: listagem, filtro por categoria, busca por nome e
   ação de "Adicionar ao Carrinho" (bloqueada para visitantes não logados).
   ============================================================================ */

(function (global) {
  'use strict';

  const state = {
    all: [],
    category: 'Todos',
    search: ''
  };

  function getFiltered() {
    return state.all.filter((p) => {
      const matchesCategory = state.category === 'Todos' || p.category === state.category;
      const matchesSearch = p.name.toLowerCase().includes(state.search.toLowerCase());
      return matchesCategory && matchesSearch && p.active !== false;
    });
  }

  function renderCategoryFilters() {
    const container = document.getElementById('category-filters');
    if (!container) return;

    const categories = ['Todos', ...new Set(state.all.map((p) => p.category))];
    container.innerHTML = categories
      .map(
        (cat) => `
        <button class="chip ${cat === state.category ? 'chip--active' : ''}" data-category="${Utils.escapeHtml(cat)}">
          ${Utils.escapeHtml(cat)}
        </button>`
      )
      .join('');

    container.querySelectorAll('.chip').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.category = btn.dataset.category;
        renderCategoryFilters();
        renderGrid();
      })
    );
  }

  function productCardHtml(product) {
    const imageHtml = product.image
      ? `<img class="product-card__photo" src="${product.image}" alt="${Utils.escapeHtml(product.name)}">`
      : `<span style="font-size:2.6rem">${product.icon || '🛍️'}</span>`;
    return `
      <article class="product-card" data-id="${product.id}">
        <div class="product-card__image" style="background:${product.color}22;">
          ${imageHtml}
          <span class="product-card__category">${Utils.escapeHtml(product.category)}</span>
        </div>
        <div class="product-card__body">
          <h3>${Utils.escapeHtml(product.name)}</h3>
          <p>${Utils.escapeHtml(product.description)}</p>
        </div>
        <div class="product-card__footer">
          <span class="product-card__price">${Utils.formatCurrency(product.price)}</span>
          <button class="btn btn--primary btn--sm" data-action="add-to-cart" data-id="${product.id}">
            <i class="fa-solid fa-cart-plus"></i> Adicionar
          </button>
        </div>
      </article>`;
  }

  // --------------------------------------------------------------------------
  // Faixa "Produtos em Destaque" (reaproveita os mesmos dados do catálogo)
  // --------------------------------------------------------------------------
  function featuredCardHtml(product) {
    const imageHtml = product.image
      ? `<img class="product-card__photo" src="${product.image}" alt="${Utils.escapeHtml(product.name)}">`
      : `<span style="font-size:2.4rem">${product.icon || '🛍️'}</span>`;
    return `
      <article class="featured-card" data-id="${product.id}">
        <span class="featured-card__badge"><i class="fa-solid fa-fire"></i> Mais Vendido</span>
        <div class="featured-card__image" style="background:${product.color}22;">
          ${imageHtml}
        </div>
        <div class="featured-card__body">
          <span class="featured-card__category">${Utils.escapeHtml(product.category)}</span>
          <h3>${Utils.escapeHtml(product.name)}</h3>
          <div class="featured-card__footer">
            <span class="featured-card__price">${Utils.formatCurrency(product.price)}</span>
            <button class="btn btn--primary btn--sm" data-action="add-to-cart" data-id="${product.id}">
              <i class="fa-solid fa-cart-plus"></i>
            </button>
          </div>
        </div>
      </article>`;
  }

  function renderFeatured() {
    const grid = document.getElementById('featured-products-grid');
    if (!grid) return;
    const list = state.all.filter((p) => p.active !== false).slice(0, 4);
    if (!list.length) {
      grid.innerHTML = '';
      return;
    }
    grid.innerHTML = list.map(featuredCardHtml).join('');
  }

  function wireFeaturedClicks() {
    const grid = document.getElementById('featured-products-grid');
    if (!grid) return;
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="add-to-cart"]');
      if (btn) {
        handleAddToCart(btn.dataset.id);
        return;
      }
      const card = e.target.closest('.featured-card');
      if (card && global.ProductDetailModule) global.ProductDetailModule.show(card.dataset.id);
    });
  }

  function renderGrid() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    const list = getFiltered();

    if (!list.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-box-open"></i>
          <p>Nenhum produto encontrado com esse filtro.</p>
        </div>`;
      return;
    }

    grid.innerHTML = list.map(productCardHtml).join('');
  }

  function handleAddToCart(productId) {
    const currentUser = global.App.state.currentUser;
    if (!currentUser || currentUser.role !== 'client') {
      Utils.showToast('Faça login como cliente para adicionar produtos ao carrinho.', 'warning', {
        title: 'Login necessário'
      });
      global.App.navigate('login');
      return;
    }

    const product = state.all.find((p) => p.id === productId);
    if (!product) return;

    global.CartModule.addItem(product);
    Utils.showToast(`${product.name} adicionado ao carrinho.`, 'success');
  }

  function wireSearch() {
    const searchInput = document.getElementById('product-search');
    if (!searchInput) return;
    searchInput.addEventListener('input', (e) => {
      state.search = e.target.value;
      renderGrid();
    });
  }

  function wireGridClicks() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="add-to-cart"]');
      if (btn) {
        handleAddToCart(btn.dataset.id);
        return;
      }
      const card = e.target.closest('.product-card');
      if (card && global.ProductDetailModule) global.ProductDetailModule.show(card.dataset.id);
    });
  }

  function loadAndRender() {
    return DataService.Products.getAll().then((products) => {
      state.all = products;
      renderCategoryFilters();
      renderGrid();
      renderFeatured();
      return products;
    });
  }

  function init() {
    wireSearch();
    wireGridClicks();
    wireFeaturedClicks();
    loadAndRender();
  }

  function getById(productId) {
    return state.all.find((p) => p.id === productId) || null;
  }

  global.ProductsModule = {
    init,
    loadAndRender,
    getCached: () => state.all,
    getById,
    handleAddToCart
  };
})(window);
