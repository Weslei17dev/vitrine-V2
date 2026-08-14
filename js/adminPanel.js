/* ============================================================================
   adminPanel.js
   ----------------------------------------------------------------------------
   Painel administrativo: dashboard com indicadores, tabela de clientes,
   tabela de pedidos (com alteração de status) e gerenciamento de produtos.
   Também cuida das notificações de novos pedidos (toast + destaque + som).
   ============================================================================ */

(function (global) {
  'use strict';

  const knownOrderIds = new Set(); // pedidos já vistos nesta sessão do painel
  const recentlyNewIds = new Set(); // usados só para o destaque visual temporário
  let pollingHandle = null;
  let bootstrapped = false; // evita notificar pedidos que já existiam ao abrir o painel
  let editingProductId = null;
  let cachedCustomers = [];
  let currentProductImage = null; // dataURL da foto enviada no formulário de produto
  let currentProductGallery = []; // dataURLs das fotos adicionais (galeria da página do produto)

  // ==========================================================================
  // DASHBOARD
  // ==========================================================================
  function renderDashboard(orders, customers) {
    const totalOrders = document.getElementById('admin-kpi-total-orders');
    const totalRevenue = document.getElementById('admin-kpi-revenue');
    const pendingOrders = document.getElementById('admin-kpi-pending');
    const paidOrders = document.getElementById('admin-kpi-paid');
    const totalCustomers = document.getElementById('admin-kpi-customers');
    if (!totalOrders) return;

    const revenue = orders
      .filter((o) => !['Cancelado', 'Aguardando Pagamento', 'Aguardando Confirmação'].includes(o.status))
      .reduce((sum, o) => sum + o.total, 0);

    const pendingCount = orders.filter((o) =>
      ['Aguardando Pagamento', 'Aguardando Confirmação'].includes(o.status)
    ).length;
    const paidCount = orders.filter((o) => o.status === 'Pago').length;

    totalOrders.textContent = orders.length;
    totalRevenue.textContent = Utils.formatCurrency(revenue);
    pendingOrders.textContent = pendingCount;
    paidOrders.textContent = paidCount;
    totalCustomers.textContent = customers.length;

    renderRecentOrdersWidget(orders.slice(0, 5));
  }

  function renderRecentOrdersWidget(orders) {
    const container = document.getElementById('admin-recent-orders');
    if (!container) return;

    if (!orders.length) {
      container.innerHTML = `<div class="empty-state empty-state--inline"><p>Nenhum pedido ainda.</p></div>`;
      return;
    }

    container.innerHTML = orders
      .map(
        (o) => `
        <div class="recent-order-row">
          <span class="recent-order-row__number">#${o.number}</span>
          <span>${Utils.escapeHtml(o.customerName)}</span>
          <span>${Utils.formatCurrency(o.total)}</span>
          ${Utils.statusBadgeHtml(o.status)}
        </div>`
      )
      .join('');
  }

  // ==========================================================================
  // CLIENTES
  // ==========================================================================
  function renderCustomersTable(customers) {
    const tbody = document.getElementById('admin-customers-tbody');
    if (!tbody) return;

    if (!customers.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Nenhum cliente cadastrado ainda.</td></tr>`;
      return;
    }

    tbody.innerHTML = customers
      .map(
        (c) => `
        <tr>
          <td>${Utils.escapeHtml(c.name)}</td>
          <td>${Utils.escapeHtml(c.phone)}</td>
          <td>${Utils.escapeHtml(c.email)}</td>
          <td>${Utils.escapeHtml(c.city)}${c.state ? '/' + Utils.escapeHtml(c.state) : ''}</td>
          <td><strong>${Utils.formatCurrency(c.totalSpent)}</strong></td>
        </tr>`
      )
      .join('');
  }

  // ==========================================================================
  // PEDIDOS
  // ==========================================================================
  const ALL_STATUSES = [...DataService.Orders.STATUS_FLOW, DataService.Orders.STATUS_CANCELLED];
  const STATUS_TRANSITIONS = {
    'Aguardando Pagamento': ['Aguardando Confirmação', 'Pago', 'Cancelado'],
    'Aguardando Confirmação': ['Aguardando Pagamento', 'Pago', 'Cancelado'],
    Pago: ['Em Produção', 'Cancelado'],
    'Em Produção': ['Enviado', 'Cancelado'],
    Enviado: ['Finalizado'],
    Finalizado: [],
    Cancelado: []
  };

  function statusSelectHtml(order) {
    const options = [order.status, ...(STATUS_TRANSITIONS[order.status] || [])]
      .filter((status, index, list) => ALL_STATUSES.includes(status) && list.indexOf(status) === index);
    return `
      <select class="status-select" data-action="change-status" data-id="${order.id}" ${options.length === 1 ? 'disabled' : ''}>
        ${options.map(
          (s) => `<option value="${Utils.escapeHtml(s)}" ${s === order.status ? 'selected' : ''}>${Utils.escapeHtml(s)}</option>`
        ).join('')}
      </select>`;
  }

  function orderRowHtml(order) {
    const itemsPreview = order.items.map((i) => `${i.qty}x ${i.name}`).join(', ');
    const isNew = recentlyNewIds.has(order.id);
    return `
      <tr data-id="${order.id}" class="${isNew ? 'row-highlight' : ''}">
        <td><strong>#${order.number}</strong></td>
        <td>${Utils.escapeHtml(order.customerName)}</td>
        <td class="cell-truncate" title="${Utils.escapeHtml(itemsPreview)}">${Utils.escapeHtml(itemsPreview)}</td>
        <td>${Utils.formatCurrency(order.total)}</td>
        <td>${Utils.escapeHtml(order.date)}</td>
        <td>${Utils.escapeHtml(order.time)}</td>
        <td>${statusSelectHtml(order)}</td>
        <td>
          <button class="btn btn--outline btn--sm" data-action="view-order" data-id="${order.id}">
            <i class="fa-solid fa-eye"></i>
          </button>
        </td>
      </tr>`;
  }

  function renderOrdersTable(orders) {
    const tbody = document.getElementById('admin-orders-tbody');
    if (!tbody) return;

    if (!orders.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Nenhum pedido realizado ainda.</td></tr>`;
      return;
    }

    tbody.innerHTML = orders.map(orderRowHtml).join('');
  }

  function handleStatusChange(orderId, newStatus) {
    DataService.Orders.updateStatus(orderId, newStatus).then(() => {
      Utils.showToast(`Status do pedido atualizado para "${newStatus}".`, 'success');
      loadAll(); // atualiza dashboard/tabelas imediatamente
    }).catch((err) => {
      Utils.showToast(err.message, 'error');
      loadOrdersOnly();
    });
  }

  // ==========================================================================
  // PRODUTOS (CRUD completo — parte do "acesso total" do administrador)
  // ==========================================================================
  function productRowHtml(product) {
    const safeImage = Utils.safeImageSrc(product.image);
    const thumb = safeImage
      ? `<img class="product-icon-badge product-icon-badge--photo" src="${Utils.escapeHtml(safeImage)}" alt="">`
      : `<span class="product-icon-badge" style="background:${Utils.safeColor(product.color)}22">${Utils.escapeHtml(product.icon)}</span>`;
    return `
      <tr data-id="${product.id}">
        <td>${thumb}</td>
        <td>${Utils.escapeHtml(product.name)}</td>
        <td>${Utils.escapeHtml(product.category)}</td>
        <td>${Utils.formatCurrency(product.price)}</td>
        <td>${product.stock ?? '-'}</td>
        <td>
          <span class="status-pill ${product.active === false ? 'status-pill--off' : 'status-pill--on'}">
            ${product.active === false ? 'Inativo' : 'Ativo'}
          </span>
        </td>
        <td class="table-actions">
          <button class="btn-icon" data-action="edit-product" data-id="${product.id}" title="Editar">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-icon btn-icon--danger" data-action="delete-product" data-id="${product.id}" title="Desativar" ${product.active === false ? 'disabled' : ''}>
            <i class="fa-solid fa-ban"></i>
          </button>
        </td>
      </tr>`;
  }

  function renderProductsTable(products) {
    const tbody = document.getElementById('admin-products-tbody');
    if (!tbody) return;

    if (!products.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Nenhum produto cadastrado.</td></tr>`;
      return;
    }
    tbody.innerHTML = products.map(productRowHtml).join('');
  }

  function openProductForm(product) {
    editingProductId = product ? product.id : null;
    const form = document.getElementById('form-product');
    form.reset();

    document.getElementById('product-form-title').textContent = product ? 'Editar Produto' : 'Novo Produto';

    if (product) {
      form.elements.name.value = product.name;
      form.elements.description.value = product.description;
      form.elements.price.value = product.price;
      form.elements.category.value = product.category;
      form.elements.icon.value = product.icon || '';
      form.elements.color.value = product.color || '#2A3B8F';
      form.elements.stock.value = product.stock ?? 0;
      form.elements.active.checked = product.active !== false;
      form.elements.details.value = product.details || '';
      currentProductImage = product.image || null;
      currentProductGallery = Array.isArray(product.gallery) ? product.gallery.slice() : [];
    } else {
      form.elements.color.value = '#2A3B8F';
      form.elements.active.checked = true;
      currentProductImage = null;
      currentProductGallery = [];
    }
    updateProductImagePreview();
    renderProductGalleryRows();

    Utils.openModal('modal-product-form');
  }

  function updateProductImagePreview() {
    const preview = document.getElementById('prod-image-preview');
    const removeBtn = document.getElementById('prod-image-remove');
    if (!preview) return;
    if (currentProductImage) {
      preview.innerHTML = `<img src="${Utils.escapeHtml(Utils.safeImageSrc(currentProductImage))}" alt="">`;
      if (removeBtn) removeBtn.classList.remove('is-hidden');
    } else {
      preview.innerHTML = '<i class="fa-solid fa-image"></i>';
      if (removeBtn) removeBtn.classList.add('is-hidden');
    }
  }

  function handleProductImageInput(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    Utils.compressImageFile(file).then((imageData) => {
      currentProductImage = imageData;
      updateProductImagePreview();
    }).catch((err) => Utils.showToast(err.message, 'error'));
    e.target.value = ''; // permite reenviar o mesmo arquivo depois, se necessário
  }

  function renderProductGalleryRows() {
    const container = document.getElementById('prod-gallery-list');
    if (!container) return;

    if (!currentProductGallery.length) {
      container.innerHTML = `<p class="repeatable-list__empty">Nenhuma foto adicional ainda.</p>`;
      return;
    }

    container.innerHTML = currentProductGallery
      .map(
        (src, i) => `
        <div class="repeatable-row repeatable-row--gallery">
          <div class="image-upload image-upload--row">
            <div class="image-upload__preview repeatable-row__preview">
              ${Utils.safeImageSrc(src) ? `<img src="${Utils.escapeHtml(Utils.safeImageSrc(src))}" alt="">` : '<i class="fa-solid fa-image"></i>'}
            </div>
            <label class="btn btn--outline btn--sm image-upload__btn">
              <i class="fa-solid fa-upload"></i> ${src ? 'Trocar' : 'Enviar'}
              <input type="file" accept="image/*" class="image-upload__input" data-gallery-image="${i}">
            </label>
          </div>
          <button type="button" class="btn-icon btn-icon--danger" data-gallery-remove="${i}" title="Remover foto">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>`
      )
      .join('');

    container.querySelectorAll('[data-gallery-image]').forEach((input) => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(input.dataset.galleryImage, 10);
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        Utils.compressImageFile(file).then((imageData) => {
          currentProductGallery[idx] = imageData;
          renderProductGalleryRows();
        }).catch((err) => Utils.showToast(err.message, 'error'));
      });
    });
    container.querySelectorAll('[data-gallery-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentProductGallery.splice(parseInt(btn.dataset.galleryRemove, 10), 1);
        renderProductGalleryRows();
      });
    });
  }

  function handleProductFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const payload = {
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim(),
      price: parseFloat(form.elements.price.value) || 0,
      category: form.elements.category.value.trim() || 'Geral',
      icon: form.elements.icon.value.trim() || '🛍️',
      color: form.elements.color.value || '#2A3B8F',
      stock: parseInt(form.elements.stock.value, 10) || 0,
      active: form.elements.active.checked,
      image: currentProductImage || null,
      gallery: currentProductGallery.filter(Boolean),
      details: form.elements.details.value.trim()
    };

    if (!payload.name || !payload.description || payload.price <= 0) {
      Utils.showToast('Preencha nome, descrição e um preço válido.', 'warning');
      return;
    }

    const action = editingProductId
      ? DataService.Products.update(editingProductId, payload)
      : DataService.Products.create(payload);

    action.then(() => {
      Utils.closeModal('modal-product-form');
      Utils.showToast(editingProductId ? 'Produto atualizado.' : 'Produto criado.', 'success');
      editingProductId = null;
      loadProducts();
      if (global.ProductsModule) global.ProductsModule.loadAndRender(true);
    }).catch((err) => Utils.showToast(err.message, 'error'));
  }

  function handleDeleteProduct(productId) {
    if (!confirm('Tem certeza que deseja desativar este produto? Ele deixará de aparecer na loja.')) return;
    DataService.Products.remove(productId).then(() => {
      Utils.showToast('Produto desativado.', 'info');
      loadProducts();
      if (global.ProductsModule) global.ProductsModule.loadAndRender(true);
    }).catch((err) => Utils.showToast(err.message, 'error'));
  }

  function loadProducts() {
    return DataService.Products.getAllAdmin().then(renderProductsTable).catch((err) => Utils.showToast(err.message, 'error'));
  }

  // ==========================================================================
  // PERSONALIZAR (banners, quem somos, destaque, FAQ, rodapé)
  // ==========================================================================
  let siteCarouselSlides = []; // [{ image, alt }]
  let siteFaqItems = []; // [{ q, a }]
  let siteAboutImage = null;
  let siteSpotlightImage = null;

  function updateSingleImagePreview(previewId, imageUrl) {
    const preview = document.getElementById(previewId);
    if (!preview) return;
    const safeImage = Utils.safeImageSrc(imageUrl);
    preview.innerHTML = safeImage ? `<img src="${Utils.escapeHtml(safeImage)}" alt="">` : '<i class="fa-solid fa-image"></i>';
  }

  function renderCarouselRows() {
    const container = document.getElementById('sc-carousel-list');
    if (!container) return;

    if (!siteCarouselSlides.length) {
      container.innerHTML = `<p class="repeatable-list__empty">Nenhum slide ainda. Clique em "Adicionar slide".</p>`;
      return;
    }

    container.innerHTML = siteCarouselSlides
      .map(
        (slide, i) => `
        <div class="repeatable-row">
          <div class="image-upload image-upload--row">
            <div class="image-upload__preview repeatable-row__preview" id="sc-carousel-preview-${i}">
              ${Utils.safeImageSrc(slide.image) ? `<img src="${Utils.escapeHtml(Utils.safeImageSrc(slide.image))}" alt="">` : '<i class="fa-solid fa-image"></i>'}
            </div>
            <label class="btn btn--outline btn--sm image-upload__btn">
              <i class="fa-solid fa-upload"></i> Imagem
              <input type="file" accept="image/*" class="image-upload__input" data-carousel-image="${i}">
            </label>
          </div>
          <div class="repeatable-row__fields">
            <input type="text" placeholder="Texto alternativo (descrição da imagem)" value="${Utils.escapeHtml(slide.alt || '')}" data-carousel-alt="${i}">
          </div>
          <button type="button" class="btn-icon btn-icon--danger" data-carousel-remove="${i}" title="Remover slide">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>`
      )
      .join('');

    container.querySelectorAll('[data-carousel-image]').forEach((input) => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(input.dataset.carouselImage, 10);
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        Utils.compressImageFile(file).then((imageData) => {
          siteCarouselSlides[idx].image = imageData;
          renderCarouselRows();
        }).catch((err) => Utils.showToast(err.message, 'error'));
      });
    });
    container.querySelectorAll('[data-carousel-alt]').forEach((input) => {
      input.addEventListener('input', (e) => {
        siteCarouselSlides[parseInt(input.dataset.carouselAlt, 10)].alt = e.target.value;
      });
    });
    container.querySelectorAll('[data-carousel-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        siteCarouselSlides.splice(parseInt(btn.dataset.carouselRemove, 10), 1);
        renderCarouselRows();
      });
    });
  }

  function renderFaqRows() {
    const container = document.getElementById('sc-faq-list');
    if (!container) return;

    if (!siteFaqItems.length) {
      container.innerHTML = `<p class="repeatable-list__empty">Nenhuma pergunta ainda. Clique em "Adicionar pergunta".</p>`;
      return;
    }

    container.innerHTML = siteFaqItems
      .map(
        (item, i) => `
        <div class="repeatable-row repeatable-row--faq">
          <div class="repeatable-row__fields">
            <input type="text" placeholder="Pergunta" value="${Utils.escapeHtml(item.q || '')}" data-faq-q="${i}">
            <textarea rows="2" placeholder="Resposta" data-faq-a="${i}">${Utils.escapeHtml(item.a || '')}</textarea>
          </div>
          <button type="button" class="btn-icon btn-icon--danger" data-faq-remove="${i}" title="Remover pergunta">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>`
      )
      .join('');

    container.querySelectorAll('[data-faq-q]').forEach((input) => {
      input.addEventListener('input', (e) => {
        siteFaqItems[parseInt(input.dataset.faqQ, 10)].q = e.target.value;
      });
    });
    container.querySelectorAll('[data-faq-a]').forEach((textarea) => {
      textarea.addEventListener('input', (e) => {
        siteFaqItems[parseInt(textarea.dataset.faqA, 10)].a = e.target.value;
      });
    });
    container.querySelectorAll('[data-faq-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        siteFaqItems.splice(parseInt(btn.dataset.faqRemove, 10), 1);
        renderFaqRows();
      });
    });
  }

  function loadSiteContentForm() {
    const form = document.getElementById('form-site-content');
    if (!form) return;

    return DataService.SiteContent.getAdmin().then((content) => {
      form.elements['theme-bg'].value = content.theme.bg || '#150A10';
      form.elements['theme-surface'].value = content.theme.surface || '#211019';
      form.elements['theme-primary'].value = content.theme.primary || '#FF3D82';
      form.elements['theme-primary-dark'].value = content.theme.primaryDark || '#C81760';
      form.elements['theme-accent'].value = content.theme.accent || '#FF3B4E';
      form.elements['theme-accent-dark'].value = content.theme.accentDark || '#C4172A';
      form.elements['theme-text'].value = content.theme.text || '#F5EBEF';
      form.elements['theme-text-muted'].value = content.theme.textMuted || '#B49AA8';
      form.elements['theme-dark'].value = content.theme.dark || '#0B0509';

      form.elements['pix-chave'].value = (content.pix && content.pix.chave) || '';
      form.elements['pix-nome'].value = (content.pix && content.pix.nomeBeneficiario) || '';
      form.elements['pix-cidade'].value = (content.pix && content.pix.cidadeBeneficiario) || '';

      form.elements['hero-eyebrow'].value = content.hero.eyebrow || '';
      form.elements['hero-title'].value = content.hero.title || '';
      form.elements['hero-subtitle'].value = content.hero.subtitle || '';
      form.elements['hero-cta'].value = content.hero.ctaText || '';

      siteCarouselSlides = (content.carousel || []).map((s) => Object.assign({}, s));
      renderCarouselRows();

      form.elements['flash-tag'].value = content.flashSale.tag || '';
      form.elements['flash-title'].value = content.flashSale.title || '';
      form.elements['flash-description'].value = content.flashSale.description || '';

      siteAboutImage = content.about.image || null;
      updateSingleImagePreview('sc-about-image-preview', siteAboutImage);
      form.elements['about-eyebrow'].value = content.about.eyebrow || '';
      form.elements['about-title'].value = content.about.title || '';
      form.elements['about-p1'].value = content.about.paragraph1 || '';
      form.elements['about-p2'].value = content.about.paragraph2 || '';
      form.elements['about-bullets'].value = (content.about.bullets || []).join('\n');

      siteSpotlightImage = content.spotlight.image || null;
      updateSingleImagePreview('sc-spotlight-image-preview', siteSpotlightImage);
      form.elements['spotlight-eyebrow'].value = content.spotlight.eyebrow || '';
      form.elements['spotlight-title'].value = content.spotlight.title || '';
      form.elements['spotlight-text'].value = content.spotlight.text || '';
      form.elements['spotlight-button'].value = content.spotlight.buttonText || '';

      siteFaqItems = (content.faq || []).map((f) => Object.assign({}, f));
      renderFaqRows();

      form.elements['footer-about'].value = content.footer.about || '';
      form.elements['footer-phone'].value = content.footer.phone || '';
      form.elements['footer-email'].value = content.footer.email || '';
      form.elements['footer-hours1'].value = content.footer.hours1 || '';
      form.elements['footer-hours2'].value = content.footer.hours2 || '';
    }).catch((err) => Utils.showToast(err.message, 'error'));
  }

  function handleSiteContentFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const submitBtns = form.querySelectorAll('button[type="submit"]');

    const partial = {
      theme: {
        bg: form.elements['theme-bg'].value,
        surface: form.elements['theme-surface'].value,
        primary: form.elements['theme-primary'].value,
        primaryDark: form.elements['theme-primary-dark'].value,
        accent: form.elements['theme-accent'].value,
        accentDark: form.elements['theme-accent-dark'].value,
        text: form.elements['theme-text'].value,
        textMuted: form.elements['theme-text-muted'].value,
        dark: form.elements['theme-dark'].value
      },
      pix: {
        chave: form.elements['pix-chave'].value.trim(),
        nomeBeneficiario: form.elements['pix-nome'].value.trim(),
        cidadeBeneficiario: form.elements['pix-cidade'].value.trim()
      },
      hero: {
        eyebrow: form.elements['hero-eyebrow'].value.trim(),
        title: form.elements['hero-title'].value,
        subtitle: form.elements['hero-subtitle'].value.trim(),
        ctaText: form.elements['hero-cta'].value.trim() || 'Ver produtos'
      },
      carousel: siteCarouselSlides.filter((s) => s.image),
      flashSale: {
        tag: form.elements['flash-tag'].value.trim(),
        title: form.elements['flash-title'].value.trim(),
        description: form.elements['flash-description'].value.trim()
      },
      about: {
        image: siteAboutImage,
        eyebrow: form.elements['about-eyebrow'].value.trim(),
        title: form.elements['about-title'].value.trim(),
        paragraph1: form.elements['about-p1'].value.trim(),
        paragraph2: form.elements['about-p2'].value.trim(),
        bullets: form.elements['about-bullets'].value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      },
      spotlight: {
        image: siteSpotlightImage,
        eyebrow: form.elements['spotlight-eyebrow'].value.trim(),
        title: form.elements['spotlight-title'].value.trim(),
        text: form.elements['spotlight-text'].value.trim(),
        buttonText: form.elements['spotlight-button'].value.trim()
      },
      faq: siteFaqItems.filter((f) => f.q && f.a),
      footer: {
        about: form.elements['footer-about'].value.trim(),
        phone: form.elements['footer-phone'].value.trim(),
        email: form.elements['footer-email'].value.trim(),
        hours1: form.elements['footer-hours1'].value.trim(),
        hours2: form.elements['footer-hours2'].value.trim()
      }
    };

    submitBtns.forEach((btn) => (btn.disabled = true));

    DataService.SiteContent.update(partial)
      .then(() => {
        Utils.showToast('Personalização salva! Já está valendo na loja.', 'success');
        if (global.SiteContentModule) global.SiteContentModule.render(true);
      })
      .catch(() => Utils.showToast('Não foi possível salvar. Tente novamente.', 'error'))
      .finally(() => submitBtns.forEach((btn) => (btn.disabled = false)));
  }

  function handleSiteContentReset() {
    if (!confirm('Restaurar todos os textos e imagens da loja para o padrão original? Isso substitui suas personalizações atuais.')) return;
    DataService.SiteContent.resetDefaults().then(() => {
      Utils.showToast('Personalização restaurada ao padrão.', 'info');
      if (global.SiteContentModule) global.SiteContentModule.render(true);
      loadSiteContentForm();
    });
  }

  function wireSiteContentForm() {
    const form = document.getElementById('form-site-content');
    if (form) form.addEventListener('submit', handleSiteContentFormSubmit);

    const resetBtn = document.getElementById('site-content-reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', handleSiteContentReset);

    const addSlideBtn = document.getElementById('sc-carousel-add');
    if (addSlideBtn) {
      addSlideBtn.addEventListener('click', () => {
        siteCarouselSlides.push({ image: '', alt: '' });
        renderCarouselRows();
      });
    }

    const addFaqBtn = document.getElementById('sc-faq-add');
    if (addFaqBtn) {
      addFaqBtn.addEventListener('click', () => {
        siteFaqItems.push({ q: '', a: '' });
        renderFaqRows();
      });
    }

    const aboutImageInput = document.getElementById('sc-about-image-input');
    if (aboutImageInput) {
      aboutImageInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        Utils.compressImageFile(file).then((imageData) => {
          siteAboutImage = imageData;
          updateSingleImagePreview('sc-about-image-preview', siteAboutImage);
        }).catch((err) => Utils.showToast(err.message, 'error'));
      });
    }

    const spotlightImageInput = document.getElementById('sc-spotlight-image-input');
    if (spotlightImageInput) {
      spotlightImageInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        Utils.compressImageFile(file).then((imageData) => {
          siteSpotlightImage = imageData;
          updateSingleImagePreview('sc-spotlight-image-preview', siteSpotlightImage);
        }).catch((err) => Utils.showToast(err.message, 'error'));
      });
    }
  }

  // ==========================================================================
  // NAVEGAÇÃO ENTRE ABAS DO PAINEL
  // ==========================================================================
  function switchTab(tabName) {
    document.querySelectorAll('.admin-tab-panel').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.tabPanel === tabName);
    });
    document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.adminTab === tabName);
    });
  }

  // ==========================================================================
  // NOTIFICAÇÕES DE NOVOS PEDIDOS
  // ==========================================================================
  function notifyNewOrder(order) {
    Utils.showToast(`${order.customerName} acabou de fazer um pedido de ${Utils.formatCurrency(order.total)}.`, 'order', {
      title: `Novo pedido #${order.number}!`,
      duration: 6000
    });
    Utils.playNotificationSound();

    const badge = document.getElementById('admin-notif-badge');
    if (badge) {
      const count = (parseInt(badge.textContent, 10) || 0) + 1;
      badge.textContent = count;
      badge.classList.remove('is-hidden');
    }

    recentlyNewIds.add(order.id);
    setTimeout(() => recentlyNewIds.delete(order.id), 8000);
  }

  function checkForNewOrders(orders) {
    if (!bootstrapped) {
      // Primeira carga: apenas memoriza os pedidos existentes, sem notificar.
      orders.forEach((o) => knownOrderIds.add(o.id));
      bootstrapped = true;
      return;
    }

    orders.forEach((order) => {
      if (!knownOrderIds.has(order.id)) {
        knownOrderIds.add(order.id);
        notifyNewOrder(order);
        DataService.Orders.markSeenByAdmin(order.id).catch(() => {});
      }
    });
  }

  // ==========================================================================
  // CARREGAMENTO GERAL
  // ==========================================================================
  function loadAll() {
    return Promise.all([DataService.Orders.getAll(), DataService.Customers.getAll()]).then(
      ([orders, customers]) => {
        cachedCustomers = customers;
        checkForNewOrders(orders);
        renderDashboard(orders, customers);
        renderCustomersTable(customers);
        renderOrdersTable(orders);
      }
    ).catch((err) => Utils.showToast(err.message, 'error'));
  }

  function loadOrdersOnly() {
    return DataService.Orders.getAll().then((orders) => {
      checkForNewOrders(orders);
      renderDashboard(orders, cachedCustomers);
      renderOrdersTable(orders);
    }).catch(() => {});
  }

  function enter() {
    return Promise.all([loadAll(), loadProducts(), loadSiteContentForm()]);
  }

  function startPolling() {
    stopPolling();
    pollingHandle = setInterval(loadOrdersOnly, 15000);
  }

  function stopPolling() {
    if (pollingHandle) clearInterval(pollingHandle);
    pollingHandle = null;
  }

  // ==========================================================================
  // EVENTOS
  // ==========================================================================
  function wireEvents() {
    document.querySelectorAll('[data-admin-tab]').forEach((btn) =>
      btn.addEventListener('click', () => switchTab(btn.dataset.adminTab))
    );

    const ordersTbody = document.getElementById('admin-orders-tbody');
    if (ordersTbody) {
      ordersTbody.addEventListener('change', (e) => {
        if (e.target.matches('[data-action="change-status"]')) {
          handleStatusChange(e.target.dataset.id, e.target.value);
        }
      });
      ordersTbody.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="view-order"]');
        if (btn) global.OrdersModule.showOrderDetail(btn.dataset.id);
      });
    }

    const productsTbody = document.getElementById('admin-products-tbody');
    if (productsTbody) {
      productsTbody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-action="edit-product"]');
        const delBtn = e.target.closest('[data-action="delete-product"]');
        if (editBtn) {
          DataService.Products.getByIdAdmin(editBtn.dataset.id).then(openProductForm).catch((err) => Utils.showToast(err.message, 'error'));
        }
        if (delBtn) {
          handleDeleteProduct(delBtn.dataset.id);
        }
      });
    }

    const newProductBtn = document.getElementById('new-product-btn');
    if (newProductBtn) newProductBtn.addEventListener('click', () => openProductForm(null));

    const productForm = document.getElementById('form-product');
    if (productForm) productForm.addEventListener('submit', handleProductFormSubmit);

    const prodImageInput = document.getElementById('prod-image-input');
    if (prodImageInput) prodImageInput.addEventListener('change', handleProductImageInput);

    const prodImageRemove = document.getElementById('prod-image-remove');
    if (prodImageRemove) {
      prodImageRemove.addEventListener('click', () => {
        currentProductImage = null;
        updateProductImagePreview();
      });
    }

    const prodGalleryAdd = document.getElementById('prod-gallery-add');
    if (prodGalleryAdd) {
      prodGalleryAdd.addEventListener('click', () => {
        currentProductGallery.push('');
        renderProductGalleryRows();
      });
    }

    const notifBell = document.getElementById('admin-notif-bell');
    if (notifBell) {
      notifBell.addEventListener('click', () => {
        const badge = document.getElementById('admin-notif-badge');
        if (badge) {
          badge.textContent = '0';
          badge.classList.add('is-hidden');
        }
        switchTab('pedidos');
      });
    }
  }

  function init() {
    wireEvents();
    wireSiteContentForm();
    switchTab('dashboard');
  }

  global.AdminPanelModule = {
    init,
    enter,
    loadAll,
    startPolling,
    stopPolling,
    notifyNewOrder
  };
})(window);
