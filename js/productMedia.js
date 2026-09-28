(function (global) {
  'use strict';
  const galleries = new Map();
  function images(product) {
    return [...new Set([product.image, ...(Array.isArray(product.gallery) ? product.gallery : [])].map(Utils.safeImageSrc).filter(Boolean))];
  }
  function render(product) {
    const list = images(product);
    const count = Number(product.imageCount) || list.length;
    if (Array.isArray(product.gallery)) galleries.set(product.id, Promise.resolve(list));
    return `<div class="product-media" data-media-product="${Utils.escapeHtml(product.id)}" data-photo-index="0">
      ${list[0] ? `<img class="product-card__photo" src="${Utils.escapeHtml(list[0])}" alt="${Utils.escapeHtml(product.name)}" loading="lazy">` : `<span class="product-media__fallback">${Utils.escapeHtml(product.icon || '✦')}</span>`}
      ${count > 1 ? '<button class="product-media__arrow product-media__arrow--prev" type="button" data-photo-direction="-1" aria-label="Foto anterior">&#10094;</button><button class="product-media__arrow product-media__arrow--next" type="button" data-photo-direction="1" aria-label="Próxima foto">&#10095;</button>' + `<span class="product-media__count" aria-live="polite">1 / ${count}</span>` : ''}
    </div>`;
  }
  // Captura antes do clique que abre o produto: trocar a foto não navega nem adiciona ao carrinho.
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-photo-direction]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    const root = button.closest('[data-media-product]');
    if (root.dataset.loading === 'true') return;
    root.dataset.loading = 'true';
    const id = root.dataset.mediaProduct;
    try {
      if (!galleries.has(id)) galleries.set(id, DataService.Products.getById(id).then(images));
      const list = await galleries.get(id);
      if (!list.length || !root.isConnected) return;
      const index = (Number(root.dataset.photoIndex) + Number(button.dataset.photoDirection) + list.length) % list.length;
      root.dataset.photoIndex = index;
      const image = root.querySelector('img');
      if (image) image.src = list[index];
      root.querySelector('.product-media__count').textContent = `${index + 1} / ${list.length}`;
    } catch (err) { galleries.delete(id); Utils.showToast('Não foi possível carregar as fotos. Tente novamente.', 'error'); }
    finally { root.dataset.loading = 'false'; }
  }, true);
  global.ProductMedia = { render, images, clear: () => galleries.clear() };
})(window);
