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

  // --------------------------------------------------------------------------
  // Galeria de fotos
  // --------------------------------------------------------------------------
  function galleryImages(product) {
    const images = [];
    if (product.image) images.push(product.image);
    if (Array.isArray(product.gallery)) images.push(...product.gallery.filter(Boolean));
    return images;
  }

  function renderGallery(product) {
    const mainEl = document.getElementById('pd-main-image');
    const thumbsEl = document.getElementById('pd-thumbs');
    if (!mainEl || !thumbsEl) return;

    const images = galleryImages(product);

    function setMain(src) {
      mainEl.innerHTML = `<img src="${src}" alt="${Utils.escapeHtml(product.name)}">`;
    }

    if (!images.length) {
      mainEl.innerHTML = `<div class="pd-gallery__fallback" style="background:${product.color}22"><span>${product.icon || '🛍️'}</span></div>`;
      thumbsEl.innerHTML = '';
      return;
    }

    setMain(images[0]);

    if (images.length === 1) {
      thumbsEl.innerHTML = '';
      return;
    }

    thumbsEl.innerHTML = images
      .map((src, i) => `<button class="pd-thumb ${i === 0 ? 'is-active' : ''}" data-src="${src}"><img src="${src}" alt=""></button>`)
      .join('');

    thumbsEl.querySelectorAll('.pd-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        setMain(btn.dataset.src);
        thumbsEl.querySelectorAll('.pd-thumb').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
      });
    });
  }

  // --------------------------------------------------------------------------
  // Informações do produto
  // --------------------------------------------------------------------------
  function renderInfo(product) {
    document.getElementById('pd-category').textContent = product.category;
    document.getElementById('pd-name').textContent = product.name;
    document.getElementById('pd-price').textContent = Utils.formatCurrency(product.price);
    document.getElementById('pd-description').textContent = product.description;

    const detailsBlock = document.querySelector('.pd-details-block');
    if (product.details) {
      document.getElementById('pd-details').textContent = product.details;
      detailsBlock.classList.remove('is-hidden');
    } else {
      detailsBlock.classList.add('is-hidden');
    }

    const addBtn = document.getElementById('pd-add-btn');
    if (addBtn) addBtn.dataset.id = product.id;
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

  function renderReviewsSummary(reviews) {
    const avg = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
    document.getElementById('pd-rating-stars').innerHTML = starsHtml(avg, false);
    document.getElementById('pd-rating-summary').textContent = reviews.length
      ? `${avg.toFixed(1)} de 5 · ${reviews.length} ${reviews.length === 1 ? 'avaliação' : 'avaliações'}`
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
          <strong>${Utils.escapeHtml(r.authorName)}</strong>
          <span class="pd-review__stars">${starsHtml(r.rating, false)}</span>
        </div>
        <p class="pd-review__date">${Utils.escapeHtml(r.date)}</p>
        <p class="pd-review__comment">${Utils.escapeHtml(r.comment)}</p>
      </div>`
      )
      .join('');
  }

  function loadReviews(productId) {
    return DataService.Reviews.getByProduct(productId).then((reviews) => {
      renderReviewsSummary(reviews);
      renderReviewsList(reviews);
    });
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
      authorName: currentUser.name,
      rating: selectedRating,
      comment
    })
      .then(() => {
        Utils.showToast('Avaliação enviada, obrigado!', 'success');
        commentEl.value = '';
        setSelectedRating(5);
        loadReviews(currentProduct.id);
      })
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

  function renderRelated(product) {
    const grid = document.getElementById('pd-related-grid');
    if (!grid) return;

    DataService.Products.getAll().then((all) => {
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
    DataService.Products.getById(productId)
      .then((product) => {
        currentProduct = product;
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
