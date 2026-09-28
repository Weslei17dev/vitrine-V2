/* ============================================================================
   products.js
   ----------------------------------------------------------------------------
   Catálogo de produtos: listagem, filtro por categoria, busca por nome e
   ação de "Adicionar ao Carrinho" para visitantes e clientes.
   ============================================================================ */

(function (global) {
  'use strict';

  const state = {
    all: [],
    categories: [],
    category: 'Todos',
    search: '',
    catalogSearch: '',
    sort: 'recommended',
    inStock: false
  };
  let loadPromise = null;

  function getFiltered() {
    return state.all.filter((p) => {
      const matchesCategory = state.category === 'Todos' || p.category === state.category;
      const haystack = `${p.name} ${p.description || ''} ${p.category || ''}`.toLowerCase();
      const matchesSearch = haystack.includes(state.search.toLowerCase());
      return matchesCategory && matchesSearch && p.active !== false;
    });
  }

  function renderCategoryFilters() {
    const container = document.getElementById('category-filters');
    if (!container) return;

    const categoryNames = [...new Set([
      ...state.categories.filter((category) => category.active !== false).map((category) => category.name),
      ...state.all.filter((product) => product.active !== false).map((product) => product.category)
    ])].filter(Boolean);
    const categories = ['Todos', ...categoryNames];
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

    renderCategoryNavigation(categories.slice(1));
    renderCatalogPageFilters(categories);
    renderHeaderCategories(categoryNames);
  }

  function setCategoryMenu(open, restoreFocus = false) {
    document.getElementById('category-menu-panel').hidden = !open;
    document.getElementById('category-menu-toggle').setAttribute('aria-expanded', String(open));
    if (restoreFocus) document.getElementById('category-menu-toggle').focus();
  }

  function openCatalog(category = 'Todos', search = '') {
    state.category = category;
    state.catalogSearch = search;
    document.getElementById('catalog-page-search').value = search;
    document.getElementById('header-search').value = search;
    setCategoryMenu(false);
    renderCategoryFilters(); renderGrid(); renderCatalogPage();
    global.App.navigate('catalog');
  }

  function renderHeaderCategories(categories) {
    document.getElementById('category-menu-items').innerHTML = categories.map((category) => {
      const configured = state.categories.find((row) => row.name === category);
      const image = Utils.safeImageSrc(configured?.image);
      return `<button type="button" class="category-menu-item" data-open-catalog="${Utils.escapeHtml(category)}">${image ? `<img src="${Utils.escapeHtml(image)}" alt="">` : '<span class="category-menu-icon"><i class="fa-solid fa-layer-group" aria-hidden="true"></i></span>'}<span><strong>${Utils.escapeHtml(category)}</strong></span><span aria-hidden="true">›</span></button>`;
    }).join('') || '<p>As categorias aparecerão após o cadastro dos produtos.</p>';
    document.getElementById('header-category-links').innerHTML = categories.slice(0, 5).map((category) => `<button type="button" data-open-catalog="${Utils.escapeHtml(category)}" class="${state.category === category ? 'is-active' : ''}">${Utils.escapeHtml(category)}</button>`).join('');
  }

  const CATEGORY_ICONS = [
    ['cosm', '🧴'], ['lubr', '💧'], ['casal', '💞'], ['lingerie', '🎀'],
    ['acess', '✨'], ['massag', '🌙'], ['bdsm', '🖤'], ['higiene', '🫧']
  ];

  function categoryIcon(category, products) {
    const normalized = category.toLowerCase();
    const mapped = CATEGORY_ICONS.find(([key]) => normalized.includes(key));
    if (mapped) return mapped[1];
    const product = products.find((item) => item.category === category && item.icon);
    return product ? product.icon : '✦';
  }

  function renderCategoryNavigation(categories) {
    const root = document.getElementById('category-navigation');
    if (!root) return;
    const list = categories;
    if (!list.length) {
      root.innerHTML = '<p class="text-muted">As categorias aparecerão aqui quando houver produtos cadastrados.</p>';
      return;
    }
    root.innerHTML = list.map((category, index) => {
      const product = state.all.find((item) => item.category === category);
      const configured = state.categories.find((item) => item.name === category);
      const color = Utils.safeColor((configured && configured.color) || (product && product.color));
      const image = Utils.safeImageSrc(configured && configured.image);
      const visual = image ? `<img src="${Utils.escapeHtml(image)}" alt="" loading="lazy">` : Utils.escapeHtml(categoryIcon(category, state.all));
      return `
        <button type="button" class="category-card${state.category === category ? ' is-active' : ''}" data-category-index="${index}" style="--category-color:${color}">
          <span class="category-card__visual" aria-hidden="true">${visual}</span>
          <span>${Utils.escapeHtml(category)}</span>
        </button>`;
    }).join('');
    root.querySelectorAll('[data-category-index]').forEach((button) => {
      button.addEventListener('click', () => {
        state.category = list[parseInt(button.dataset.categoryIndex, 10)];
        state.catalogSearch = '';
        const search = document.getElementById('catalog-page-search');
        if (search) search.value = '';
        renderCategoryFilters();
        renderGrid();
        renderCatalogPage();
        global.App.navigate('catalog');
      });
    });
  }

  function ratingHtml(product) {
    const count = Number(product.ratingCount || 0);
    if (!count) return '<span class="text-muted">Ainda sem avaliações</span>';
    return `<span class="product-rating"><i class="fa-solid fa-star"></i> ${Number(product.ratingAverage || 0).toFixed(1)} <small>(${count})</small></span>`;
  }

  function pricingHtml(product, classPrefix) {
    const compareAt = Number(product.compareAtPrice || 0);
    const price = Number(product.price || 0);
    return `
      <div class="product-pricing">
        ${compareAt > price ? `<span class="product-price-old">${Utils.formatCurrency(compareAt)}</span>` : ''}
        <span class="${classPrefix}__price">${Utils.formatCurrency(price)}</span>
        <span class="${classPrefix}__payment">à vista no PIX</span>
      </div>`;
  }

  function discountBadgeHtml(product) {
    const compareAt = Number(product.compareAtPrice || 0);
    const price = Number(product.price || 0);
    if (!(compareAt > price && price > 0)) return '';
    const discount = Math.max(1, Math.round((1 - price / compareAt) * 100));
    return `<span class="product-discount-badge">-${discount}%</span>`;
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
          ${global.ProductMedia.render(product)}
          <span class="product-card__category">${Utils.escapeHtml(product.category)}</span>
          ${discountBadgeHtml(product)}
        </div>
        <div class="product-card__body">
          <h3><button type="button" class="product-title-link" data-product-open="${Utils.escapeHtml(product.id)}">${Utils.escapeHtml(product.name)}</button></h3>
          <p class="product-card__description">${Utils.escapeHtml(product.description)}</p>
          <div class="product-card__meta">${ratingHtml(product)}</div>
        </div>
        <div class="product-card__footer">
          ${pricingHtml(product, 'product-card')}
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
        <span class="featured-card__badge"><i class="fa-solid fa-star"></i> Destaque</span>
        <div class="featured-card__image" style="background:${Utils.safeColor(product.color)}22;">
          ${global.ProductMedia.render(product)}
          ${discountBadgeHtml(product)}
        </div>
        <div class="featured-card__body">
          <span class="featured-card__category">${Utils.escapeHtml(product.category)}</span>
          <h3><button type="button" class="product-title-link" data-product-open="${Utils.escapeHtml(product.id)}">${Utils.escapeHtml(product.name)}</button></h3>
          <div class="featured-card__meta">${ratingHtml(product)}</div>
          <div class="featured-card__footer">
            ${pricingHtml(product, 'featured-card')}
            <button class="btn btn--primary btn--sm" data-action="add-to-cart" data-id="${Utils.escapeHtml(product.id)}" aria-label="Adicionar ${Utils.escapeHtml(product.name)} ao carrinho" ${Number(product.stock) <= 0 ? 'disabled' : ''}>
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
    const more = document.getElementById('home-catalog-more');
    if (more) more.classList.toggle('is-hidden', list.length <= 8);

    if (!list.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-box-open"></i>
          <p>Nenhum produto encontrado com esse filtro.</p>
        </div>`;
      return;
    }

    grid.innerHTML = list.slice(0, 8).map(productCardHtml).join('');
  }

  function renderCatalogPageFilters(categories) {
    const container = document.getElementById('catalog-page-category-filters');
    if (!container) return;
    container.innerHTML = categories.map((category) => `
      <button class="chip ${category === state.category ? 'chip--active' : ''}" data-catalog-category="${Utils.escapeHtml(category)}">${Utils.escapeHtml(category)}</button>`).join('');
    container.querySelectorAll('[data-catalog-category]').forEach((button) => button.addEventListener('click', () => {
      state.category = button.dataset.catalogCategory;
      renderCategoryFilters();
      renderCatalogPage();
    }));
  }

  function renderCatalogPage() {
    const grid = document.getElementById('catalog-page-grid');
    if (!grid) return;
    const normalize = (text) => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const term = normalize(state.catalogSearch);
    const list = state.all.filter((product) => {
      const categoryMatches = state.category === 'Todos' || product.category === state.category;
      const textMatches = normalize(`${product.name} ${product.description || ''} ${product.category || ''}`).includes(term);
      return product.active !== false && categoryMatches && textMatches && (!state.inStock || Number(product.stock) > 0);
    });
    const sorts = { 'price-asc': (a,b) => a.price-b.price, 'price-desc': (a,b) => b.price-a.price, rating: (a,b) => (b.ratingAverage || 0)-(a.ratingAverage || 0), name: (a,b) => a.name.localeCompare(b.name,'pt-BR') };
    if (sorts[state.sort]) list.sort(sorts[state.sort]);
    const result = document.getElementById('catalog-page-results');
    if (result) result.textContent = `${list.length} produto${list.length === 1 ? '' : 's'}${state.category !== 'Todos' ? ' em ' + state.category : ''}${state.catalogSearch ? ' para “' + state.catalogSearch + '”' : ''}`;
    grid.innerHTML = list.length
      ? list.map(productCardHtml).join('')
      : '<div class="empty-state"><i class="fa-solid fa-box-open"></i><p>Nenhum produto encontrado. Tente outro termo ou categoria.</p><button class="btn btn--outline" type="button" id="catalog-clear-filters">Limpar filtros</button></div>';
    document.getElementById('catalog-clear-filters')?.addEventListener('click', () => { state.inStock = false; document.getElementById('catalog-in-stock').checked = false; openCatalog(); });
  }

  function handleAddToCart(productId, quantity = 1, suppliedProduct = null, selectedColor = null) {
    const user = global.App.state.currentUser;
    if (user?.role === 'admin') {
      Utils.showToast('Você está visualizando como administrador. Use uma conta de cliente para comprar.', 'info');
      return false;
    }
    const product = suppliedProduct || state.all.find((p) => p.id === productId);
    if (!product) return false;
    if (Number(product.stock) <= 0) {
      Utils.showToast('Este produto está sem estoque no momento.', 'warning');
      return false;
    }

    if (product.colors?.length && !selectedColor) {
      global.ProductDetailModule.show(product.id);
      Utils.showToast('Selecione a cor antes de adicionar o produto.', 'info');
      return false;
    }
    if (!global.CartModule.addItem(product, quantity, selectedColor)) {
      Utils.showToast('Confira o estoque e a quantidade que já está no carrinho (limite de 99 por produto e 50 produtos).', 'warning');
      return false;
    }
    Utils.showToast(`${product.name} adicionado ao carrinho.`, 'success');
    return true;
  }

  function wireSearch() {
    const searchInput = document.getElementById('product-search');
    if (!searchInput) return;
    searchInput.addEventListener('input', (e) => {
      state.search = e.target.value;
      renderGrid();
    });
    document.getElementById('catalog-page-search')?.addEventListener('input', (event) => {
      state.catalogSearch = event.target.value;
      renderCatalogPage();
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
    document.getElementById('catalog-page-grid')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="add-to-cart"]');
      if (button) {
        handleAddToCart(button.dataset.id);
        return;
      }
      const card = event.target.closest('.product-card');
      if (card && global.ProductDetailModule) global.ProductDetailModule.show(card.dataset.id);
    });
  }

  function loadAndRender(force) {
    if (force && global.ProductMedia) global.ProductMedia.clear();
    if (loadPromise && !force) return loadPromise;
    loadPromise = Promise.all([
      DataService.Products.getAll(Boolean(force)),
      DataService.Categories.getAll(Boolean(force)).catch(() => [])
    ]).then(([products, categories]) => {
      state.all = products;
      state.categories = categories;
      if (global.CartModule) global.CartModule.reconcile(products);
      renderCategoryFilters();
      renderGrid();
      renderFeatured();
      renderCatalogPage();
      return products;
    }).catch((err) => {
      loadPromise = null;
      Utils.showToast(err.message || 'Não foi possível carregar os produtos.', 'error');
      throw err;
    });
    return loadPromise;
  }

  function init() {
    const categoryMenu = document.querySelector('.category-menu');
    const mouseHover = matchMedia('(hover: hover) and (pointer: fine)');
    categoryMenu.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' && mouseHover.matches) setCategoryMenu(true);
    });
    categoryMenu.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' && mouseHover.matches) setCategoryMenu(false);
    });
    document.getElementById('category-menu-toggle').addEventListener('click', () => {
      const closed = document.getElementById('category-menu-panel').hidden;
      setCategoryMenu(mouseHover.matches ? true : closed);
    });
    document.getElementById('category-menu-close').addEventListener('click', () => setCategoryMenu(false, true));
    document.addEventListener('click', (event) => {
      const category = event.target.closest('[data-open-catalog]');
      if (category) openCatalog(category.dataset.openCatalog);
      else if (!event.target.closest('.category-menu')) setCategoryMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.getElementById('category-menu-panel').hidden) setCategoryMenu(false, true);
    });
    document.getElementById('header-search-form').addEventListener('submit', (event) => { event.preventDefault(); openCatalog('Todos', document.getElementById('header-search').value.trim()); });
    document.getElementById('catalog-sort').addEventListener('change', (event) => { state.sort = event.target.value; renderCatalogPage(); });
    document.getElementById('catalog-in-stock').addEventListener('change', (event) => { state.inStock = event.target.checked; renderCatalogPage(); });
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
    openCatalog,
    handleAddToCart
  };
})(window);
