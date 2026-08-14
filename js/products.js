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
  let loadPromise = null;

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
    const safeImage = Utils.safeImageSrc(product.image);
    const imageHtml = safeImage
      ? `<img class="product-card__photo" src="${Utils.escapeHtml(safeImage)}" alt="${Utils.escapeHtml(product.name)}" loading="lazy">`
      : `<span style="font-size:2.6rem">${Utils.escapeHtml(product.icon || '🛍️')}</span>`;
    const unavailable = Number(product.stock) <= 0;
    return `
      <article class="product-card" data-id="${product.id}">
        <div class="product-card__image" style="background:${Utils.safeColor(product.color)}22;">
          ${imageHtml}
          <span class="product-card__category">${Utils.escapeHtml(product.category)}</span>
        </div>
        <div class="product-card__body">
          <h3>${Utils.escapeHtml(product.name)}</h3>
          <p>${Utils.escapeHtml(product.description)}</p>
        </div>
        <div class="product-card__footer">
          <span class="product-card__price">${Utils.formatCurrency(product.price)}</span>
          <button class="btn btn--primary btn--sm" data-action="add-to-cart" data-id="${Utils.escapeHtml(product.id)}" ${unavailable ? 'disabled' : ''}>
            <i class="fa-solid ${unavailable ? 'fa-ban' : 'fa-cart-plus'}"></i> ${unavailable ? 'Indisponível' : 'Adicionar'}
          </button>
        </div>
      </article>`;
  }

  // --------------------------------------------------------------------------
  // Faixa "Produtos em Destaque" (reaproveita os mesmos dados do catálogo)
  // --------------------------------------------------------------------------
  function featuredCardHtml(product) {
    const safeImage = Utils.safeImageSrc(product.image);
    const imageHtml = safeImage
      ? `<img class="product-card__photo" src="${Utils.escapeHtml(safeImage)}" alt="${Utils.escapeHtml(product.name)}" loading="lazy">`
      : `<span style="font-size:2.4rem">${Utils.escapeHtml(product.icon || '🛍️')}</span>`;
    return `
      <article class="featured-card" data-id="${product.id}">
        <span class="featured-card__badge"><i class="fa-solid fa-fire"></i> Mais Vendido</span>
        <div class="featured-card__image" style="background:${Utils.safeColor(product.color)}22;">
          ${imageHtml}
        </div>
        <div class="featured-card__body">
          <span class="featured-card__category">${Utils.escapeHtml(product.category)}</span>
          <h3>${Utils.escapeHtml(product.name)}</h3>
          <div class="featured-card__footer">
            <span class="featured-card__price">${Utils.formatCurrency(product.price)}</span>
            <button class="btn btn--primary btn--sm" data-action="add-to-cart" data-id="${Utils.escapeHtml(product.id)}" ${Number(product.stock) <= 0 ? 'disabled' : ''}>
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
    const product = state.all.find((p) => p.id === productId);
    if (!product) return;
    if (Number(product.stock) <= 0) {
      Utils.showToast('Este produto está sem estoque no momento.', 'warning');
      return;
    }

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

  function loadAndRender(force) {
    if (loadPromise && !force) return loadPromise;
    loadPromise = DataService.Products.getAll(Boolean(force)).then((products) => {
      state.all = products;
      renderCategoryFilters();
      renderGrid();
      renderFeatured();
      return products;
    }).catch((err) => {
      loadPromise = null;
      Utils.showToast(err.message || 'Não foi possível carregar os produtos.', 'error');
      throw err;
    });
    return loadPromise;
  }

  function init() {
    wireSearch();
    wireGridClicks();
    wireFeaturedClicks();
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
