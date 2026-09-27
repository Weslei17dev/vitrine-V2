/* ============================================================================
   productDetail.js
   ----------------------------------------------------------------------------
   Página de detalhe do produto: galeria de fotos, descrição completa,
   avaliações/comentários dos clientes e produtos relacionados no final.
   Aberta ao clicar em qualquer card de produto (grade principal, destaques
   ou relacionados) — exceto no botão "Adicionar", que continua só
   adicionando ao carrinho sem sair da tela atual.
   ============================================================================ */

(function (global) {
  'use strict';

  let currentProduct = null;
  let selectedRating = 5;
  let loadedReviews = [];
  let totalReviews = 0;
  let productRequest = 0;

  // --------------------------------------------------------------------------
  // Galeria de fotos
  // --------------------------------------------------------------------------
  function galleryImages(product) {
    const images = [];
    if (Utils.safeImageSrc(product.image)) images.push(Utils.safeImageSrc(product.image));
    if (Array.isArray(product.gallery)) images.push(...product.gallery.map(Utils.safeImageSrc).filter(Boolean));
    return [...new Set(images)];
  }

  function renderGallery(product) {
    const mainEl = document.getElementById('pd-main-image');
    const thumbsEl = document.getElementById('pd-thumbs');
    if (!mainEl || !thumbsEl) return;

    const images = galleryImages(product);

    let selected = 0;
    function setMain(index) {
      selected = (index + images.length) % images.length;
      mainEl.innerHTML = `<img src="${Utils.escapeHtml(images[selected])}" alt="${Utils.escapeHtml(product.name)} — foto ${selected + 1}">${images.length > 1 ? '<button type="button" class="product-media__arrow product-media__arrow--prev" data-detail-prev aria-label="Foto anterior">&#10094;</button><button type="button" class="product-media__arrow product-media__arrow--next" data-detail-next aria-label="Próxima foto">&#10095;</button>' + `<span class="product-media__count" aria-live="polite">${selected + 1} / ${images.length}</span>` : ''}`;
      mainEl.querySelector('[data-detail-prev]')?.addEventListener('click', () => { setMain(selected - 1); mainEl.querySelector('[data-detail-prev]').focus(); });
      mainEl.querySelector('[data-detail-next]')?.addEventListener('click', () => { setMain(selected + 1); mainEl.querySelector('[data-detail-next]').focus(); });
      thumbsEl.querySelectorAll('.pd-thumb').forEach((button, n) => { button.classList.toggle('is-active', n === selected); button.setAttribute('aria-pressed', String(n === selected)); });
    }

    if (!images.length) {
      mainEl.innerHTML = `<div class="pd-gallery__fallback" style="background:${Utils.safeColor(product.color)}22"><span>${Utils.escapeHtml(product.icon || '🛍️')}</span></div>`;
      thumbsEl.innerHTML = '';
      return;
    }

    setMain(0);

    if (images.length === 1) {
      thumbsEl.innerHTML = '';
      return;
    }

    thumbsEl.innerHTML = images
      .map((src, i) => `<button type="button" class="pd-thumb ${i === 0 ? 'is-active' : ''}" data-photo="${i}" aria-label="Mostrar foto ${i+1}" aria-pressed="${i === 0}"><img src="${Utils.escapeHtml(src)}" alt=""></button>`)
      .join('');

    thumbsEl.querySelectorAll('.pd-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        setMain(Number(btn.dataset.photo));
      });
    });
  }

  // --------------------------------------------------------------------------
  // Informações do produto
  // --------------------------------------------------------------------------
  function renderInfo(product) {
    document.getElementById('pd-category').textContent = product.category;
    document.getElementById('pd-name').textContent = product.name;
    const compareAt = Number(product.compareAtPrice || 0);
    const price = Number(product.price || 0);
    document.getElementById('pd-price').innerHTML = `${compareAt > price ? `<span class="product-price-old">${Utils.formatCurrency(compareAt)}</span>` : ''}<span>${Utils.formatCurrency(price)}</span><small> à vista no PIX</small>`;
    document.getElementById('pd-description').textContent = product.description;

    const detailsBlock = document.querySelector('.pd-details-block');
    if (product.details) {
      document.getElementById('pd-details').textContent = product.details;
      detailsBlock.classList.remove('is-hidden');
    } else {
      detailsBlock.classList.add('is-hidden');
    }

    const addBtn = document.getElementById('pd-add-btn');
    if (addBtn) {
      addBtn.dataset.id = product.id;
      addBtn.disabled = Number(product.stock) <= 0;
      addBtn.innerHTML = Number(product.stock) <= 0
        ? '<i class="fa-solid fa-ban"></i> Produto indisponível'
        : '<i class="fa-solid fa-cart-plus"></i> Adicionar ao carrinho';
    }
  }

  // --------------------------------------------------------------------------
  // Avaliações / comentários
  // --------------------------------------------------------------------------
  function starsHtml(rating, interactive) {
    const rounded = Math.round(rating);
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += `<i class="fa-solid fa-star${i <= rounded ? '' : ' pd-star--empty'}"${interactive ? ` data-value="${i}"` : ''}></i>`;
    }
    return html;
  }

  function renderReviewsSummary(summary) {
    const avg = summary.ratingAverage;
    document.getElementById('pd-rating-stars').innerHTML = starsHtml(avg, false);
    document.getElementById('pd-rating-summary').textContent = summary.total
      ? `${avg.toFixed(1)} de 5 · ${summary.total} ${summary.total === 1 ? 'avaliação' : 'avaliações'}`
      : 'Ainda sem avaliações';
  }

  function renderReviewsList(reviews) {
    const list = document.getElementById('pd-reviews-list');
    if (!list) return;
    if (!reviews.length) {
      list.innerHTML = `<p class="pd-reviews-empty">Seja o primeiro a avaliar este produto.</p>`;
      return;
    }
    list.innerHTML = reviews
      .map(
        (r) => `
      <div class="pd-review">
        <div class="pd-review__head">
          <strong>${Utils.escapeHtml(r.authorName)}${r.verifiedPurchase ? ' · Compra verificada' : ''}</strong>
          <span class="pd-review__stars">${starsHtml(r.rating, false)}</span>
        </div>
        <p class="pd-review__date">${Utils.escapeHtml(r.date)}</p>
        <p class="pd-review__comment">${Utils.escapeHtml(r.comment)}</p>
      </div>`
      )
      .join('');
    if (loadedReviews.length < totalReviews) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn--outline btn--sm'; button.id = 'pd-reviews-more';
      button.textContent = `Ver mais avaliações (${loadedReviews.length} de ${totalReviews})`;
      button.addEventListener('click', () => { button.disabled = true; loadReviews(currentProduct.id, true).finally(() => { button.disabled = false; }); });
      list.appendChild(button);
    }
  }

  function loadReviews(productId, more = false) {
    if (!more) loadedReviews = [];
    return DataService.Reviews.getByProduct(productId, {limit:3, offset:loadedReviews.length}).then((data) => {
      if (currentProduct?.id !== productId) return;
      totalReviews = data.total;
      loadedReviews = more ? loadedReviews.concat(data.reviews) : data.reviews;
      renderReviewsSummary(data);
      renderReviewsList(loadedReviews);
    }).catch((err) => Utils.showToast('Não foi possível carregar as avaliações.', 'error'));
  }

  function setSelectedRating(value) {
    selectedRating = value;
    const starsInput = document.getElementById('pd-review-stars-input');
    if (!starsInput) return;
    starsInput.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('is-active', parseInt(btn.dataset.value, 10) <= value);
    });
  }

  function handleReviewSubmit(e) {
    e.preventDefault();
    if (!currentProduct) return;

    const currentUser = global.App.state.currentUser;
    if (!currentUser || currentUser.role !== 'client') {
      Utils.showToast('Faça login como cliente para avaliar este produto.', 'warning', { title: 'Login necessário' });
      global.App.navigate('login');
      return;
    }

    const commentEl = document.getElementById('pd-review-comment');
    const comment = commentEl.value.trim();
    if (!comment) {
      Utils.showToast('Escreva um comentário antes de enviar.', 'warning');
      return;
    }

    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    DataService.Reviews.create({
      productId: currentProduct.id,
      rating: selectedRating,
      comment
    })
      .then(() => {
        Utils.showToast('Avaliação enviada para análise. Obrigado!', 'success');
        commentEl.value = '';
        setSelectedRating(5);
        loadReviews(currentProduct.id);
      })
      .catch((err) => Utils.showToast(err.message, 'error'))
      .finally(() => {
        if (submitBtn) submitBtn.disabled = false;
      });
  }

  function wireReviewForm() {
    const starsInput = document.getElementById('pd-review-stars-input');
    if (starsInput) {
      starsInput.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => setSelectedRating(parseInt(btn.dataset.value, 10)));
      });
    }

    const form = document.getElementById('form-review');
    if (form) form.addEventListener('submit', handleReviewSubmit);
  }

  // --------------------------------------------------------------------------
  // Produtos relacionados
  // --------------------------------------------------------------------------
  function relatedCardHtml(product) {
    const safeImage = Utils.safeImageSrc(product.image);
    const unavailable = Number(product.stock) <= 0;
    const compareAt = Number(product.compareAtPrice || 0);
    const price = Number(product.price || 0);
    const ratingCount = Number(product.ratingCount || 0);
    const imageHtml = safeImage
      ? `<img class="product-card__photo" src="${Utils.escapeHtml(safeImage)}" alt="${Utils.escapeHtml(product.name)}" loading="lazy">`
      : `<span style="font-size:2.6rem">${Utils.escapeHtml(product.icon || '🛍️')}</span>`;
    return `
      <article class="product-card" data-id="${product.id}">
        <div class="product-card__image" style="background:${Utils.safeColor(product.color)}22;">
          ${global.ProductMedia.render(product)}
          <span class="product-card__category">${Utils.escapeHtml(product.category)}</span>
        </div>
        <div class="product-card__body">
          <h3>${Utils.escapeHtml(product.name)}</h3>
          <p class="product-card__description">${Utils.escapeHtml(product.description)}</p>
          <div class="product-card__meta">${ratingCount ? `<span class="product-rating"><i class="fa-solid fa-star"></i> ${Number(product.ratingAverage || 0).toFixed(1)} <small>(${ratingCount})</small></span>` : '<span class="text-muted">Ainda sem avaliações</span>'}</div>
        </div>
        <div class="product-card__footer">
          <div class="product-pricing">
            ${compareAt > price ? `<span class="product-price-old">${Utils.formatCurrency(compareAt)}</span>` : ''}
            <span class="product-card__price">${Utils.formatCurrency(price)}</span>
            <span class="product-card__payment">à vista no PIX</span>
          </div>
          <button class="btn btn--primary btn--sm" data-action="add-to-cart" data-id="${product.id}" ${unavailable ? 'disabled' : ''}>
            <i class="fa-solid ${unavailable ? 'fa-ban' : 'fa-cart-plus'}"></i> ${unavailable ? 'Indisponível' : 'Adicionar'}
          </button>
        </div>
      </article>`;
  }

  function renderRelated(product) {
    const grid = document.getElementById('pd-related-grid');
    if (!grid) return;

    const cached = global.ProductsModule ? global.ProductsModule.getCached() : [];
    Promise.resolve(cached && cached.length ? cached : DataService.Products.getAll()).then((all) => {
      const active = all.filter((p) => p.id !== product.id && p.active !== false);
      const sameCategory = active.filter((p) => p.category === product.category);
      let related = sameCategory.slice(0, 4);
      if (related.length < 4) {
        const rest = active.filter((p) => !related.includes(p));
        related = related.concat(rest.slice(0, 4 - related.length));
      }

      if (!related.length) {
        grid.innerHTML = '';
        return;
      }
      grid.innerHTML = related.map(relatedCardHtml).join('');
    });
  }

  function wireRelatedClicks() {
    const grid = document.getElementById('pd-related-grid');
    if (!grid) return;
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="add-to-cart"]');
      if (btn) {
        if (global.ProductsModule) global.ProductsModule.handleAddToCart(btn.dataset.id);
        return;
      }
      const card = e.target.closest('.product-card');
      if (card) show(card.dataset.id);
    });
  }

  function wireAddButton() {
    const addBtn = document.getElementById('pd-add-btn');
    if (!addBtn) return;
    addBtn.addEventListener('click', () => {
      if (global.ProductsModule) global.ProductsModule.handleAddToCart(addBtn.dataset.id);
    });
  }

  // --------------------------------------------------------------------------
  // Exibição
  // --------------------------------------------------------------------------
  function render(productId) {
    const sequence = ++productRequest;
    DataService.Products.getById(productId)
      .then((product) => {
        if (sequence !== productRequest) return;
        currentProduct = product;
        document.title = `${product.name} — Brincar de Desejo`;
        setSelectedRating(5);
        const commentEl = document.getElementById('pd-review-comment');
        if (commentEl) commentEl.value = '';

        renderGallery(product);
        renderInfo(product);
        renderRelated(product);
        return loadReviews(product.id);
      })
      .catch(() => {
        Utils.showToast('Não foi possível carregar este produto.', 'error');
        global.App.navigate('store');
      });
  }

  function show(productId) {
    global.App.navigate('product-detail');
    render(productId);
  }

  function init() {
    wireReviewForm();
    wireRelatedClicks();
    wireAddButton();
  }

  global.ProductDetailModule = { init, show };
})(window);
