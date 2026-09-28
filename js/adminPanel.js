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
  let editingProductUpdatedAt = null;
  const PAGE_SIZE = 100;
  let cachedOrders = [];
  let orderFilters = {};
  let ordersRequest = 0;
  let cachedCustomers = [];
  const listFilters = { products: {}, customers: {}, reviews: {} };
  const listRequests = { products: 0, customers: 0, reviews: 0 };
  let cachedProducts = [];
  let cachedReviews = [];
  let currentProductImage = null; // dataURL da foto enviada no formulário de produto
  let currentProductGallery = []; // dataURLs das fotos adicionais (galeria da página do produto)
  let editingCategoryId = null;
  let currentCategoryImage = null;

  // ==========================================================================
  // DASHBOARD
  // ==========================================================================
  function renderDashboard(summary) {
    const totalOrders = document.getElementById('admin-kpi-total-orders');
    const totalRevenue = document.getElementById('admin-kpi-revenue');
    const pendingOrders = document.getElementById('admin-kpi-pending');
    const paidOrders = document.getElementById('admin-kpi-paid');
    const totalCustomers = document.getElementById('admin-kpi-customers');
    if (!totalOrders) return;

    totalOrders.textContent = summary.totalOrders || 0;
    totalRevenue.textContent = Utils.formatCurrency(summary.revenue || 0);
    pendingOrders.textContent = summary.pendingOrders || 0;
    paidOrders.textContent = summary.paidOrders || 0;
    totalCustomers.textContent = summary.totalCustomers || 0;

    renderRecentOrdersWidget(summary.recentOrders || []);
  }

  function renderRecentOrdersWidget(orders) {
    const container = document.getElementById('admin-recent-orders');
    if (!container) return;

    if (!orders.length) {
      container.innerHTML = `<div class="empty-state empty-state--inline"><p>Nenhum pedido ainda.</p></div>`;
      return;
    }

    container.innerHTML = '<div class="recent-order-row recent-order-row--head"><span>Pedido</span><span>Cliente / produtos</span><span>Valor</span><span>Status</span></div>' + orders
      .map(
        (o) => `
        <div class="recent-order-row">
          <span class="recent-order-row__number">#${o.number}</span>
          <span class="recent-order-row__info">${Utils.escapeHtml(o.customerName)}<small>${Utils.escapeHtml((o.items || []).map((item) => `${item.qty}x ${item.name}`).join(', '))}</small></span>
          <span class="recent-order-row__value">${Utils.formatCurrency(o.total)}</span>
          <span class="recent-order-row__status">${Utils.statusBadgeHtml(o.status)}</span>
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
        <td><button type="button" class="order-number-link" data-action="view-order" data-id="${order.id}" aria-label="Abrir pedido ${Utils.escapeHtml(order.number)}">#${Utils.escapeHtml(order.number)}</button></td>
        <td>${Utils.escapeHtml(order.customerName)}</td>
        <td class="cell-truncate" title="${Utils.escapeHtml(itemsPreview)}">${Utils.escapeHtml(itemsPreview)}</td>
        <td>${Utils.formatCurrency(order.total)}</td>
        <td>${Utils.escapeHtml(order.date)}</td>
        <td>${Utils.escapeHtml(order.time)}</td>
        <td>${statusSelectHtml(order)}</td>
        <td>
          <button class="btn btn--outline btn--sm" data-action="view-order" data-id="${order.id}" aria-label="Ver detalhes do pedido ${Utils.escapeHtml(order.number)}">
            <i class="fa-solid fa-eye"></i>
          </button>
        </td>
      </tr>`;
  }

  function renderOrdersTable(orders) {
    const tbody = document.getElementById('admin-orders-tbody');
    if (!tbody) return;

    const summary = document.getElementById('admin-orders-filter-summary');
    if (summary) {
      const active = Object.values(orderFilters).some((value) => value !== '' && value != null);
      summary.textContent = active
        ? `${orders.length} pedido(s) encontrado(s) com os filtros aplicados.`
        : `Exibindo ${orders.length} pedido(s) mais recente(s).`;
    }

    if (!orders.length) {
      const filtered = Object.values(orderFilters).some((value) => value !== '' && value != null);
      tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">${filtered ? 'Nenhum pedido encontrado com estes filtros. Tente outro número ou limpe os filtros.' : 'Nenhum pedido realizado ainda.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = orders.map(orderRowHtml).join('');
  }

  function readOrderFilters() {
    const form = document.getElementById('admin-orders-filters');
    if (!form) return {};
    const values = Object.fromEntries(new FormData(form).entries());
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value).trim()]));
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
        <td>${product.costPrice == null ? 'Não informado' : Utils.formatCurrency(product.costPrice)}</td>
        <td>${product.profitMargin == null ? '—' : Number(product.profitMargin).toFixed(2) + '%'}</td>
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
      tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">Nenhum produto encontrado com esses filtros.</td></tr>`;
      return;
    }
    tbody.innerHTML = products.map(productRowHtml).join('');
  }

  function openProductForm(product) {
    editingProductId = product ? product.id : null;
    editingProductUpdatedAt = product ? product.updatedAt : null;
    const form = document.getElementById('form-product');
    form.reset();

    document.getElementById('product-form-title').textContent = product ? 'Editar Produto' : 'Novo Produto';

    if (product) {
      form.elements.name.value = product.name;
      form.elements.description.value = product.description;
      form.elements.salePrice.value = product.compareAtPrice || product.price;
      form.elements.promotionalPrice.value = product.compareAtPrice ? product.price : '';
      form.elements.costPrice.value = product.costPrice == null ? '' : product.costPrice;
      form.elements.category.value = product.category;
      form.elements.icon.value = product.icon || '';
      form.elements.color.value = product.color || '#D99163';
      form.elements.stock.value = product.stock ?? 0;
      form.elements.active.checked = product.active !== false;
      form.elements.details.value = product.details || '';
      currentProductImage = product.image || null;
      currentProductGallery = Array.isArray(product.gallery) ? product.gallery.slice() : [];
    } else {
      form.elements.color.value = '#D99163';
      form.elements.active.checked = true;
      currentProductImage = null;
      currentProductGallery = [];
      editingProductUpdatedAt = null;
    }
    updateProductImagePreview();
    updateProductMargin();
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
    const original = Number(form.elements.salePrice.value);
    const promotion = form.elements.promotionalPrice.value === '' ? null : Number(form.elements.promotionalPrice.value);
    if (promotion != null && (!(promotion > 0) || promotion >= original)) {
      Utils.showToast('O preço promocional deve ser maior que zero e menor que o valor original.', 'warning');
      return;
    }
    const payload = {
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim(),
      price: promotion == null ? original : promotion,
      compareAtPrice: promotion == null ? null : original,
      costPrice: form.elements.costPrice.value === '' ? null : Number(form.elements.costPrice.value),
      category: form.elements.category.value.trim() || 'Geral',
      icon: form.elements.icon.value.trim() || '🛍️',
      color: form.elements.color.value || '#D99163',
      stock: parseInt(form.elements.stock.value, 10) || 0,
      active: form.elements.active.checked,
      image: currentProductImage || null,
      gallery: currentProductGallery.filter(Boolean),
      details: form.elements.details.value.trim(),
      updatedAt: editingProductUpdatedAt
    };

    if (!payload.name || !payload.description || payload.price <= 0) {
      Utils.showToast('Preencha nome, descrição e um preço válido.', 'warning');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    const action = editingProductId
      ? DataService.Products.update(editingProductId, payload)
      : DataService.Products.create(payload);

    action.then(() => {
      Utils.closeModal('modal-product-form');
      Utils.showToast(editingProductId ? 'Produto atualizado.' : 'Produto criado.', 'success');
      editingProductId = null;
      editingProductUpdatedAt = null;
      loadProducts();
      loadCategories();
      if (global.ProductsModule) global.ProductsModule.loadAndRender(true);
    }).catch((err) => Utils.showToast(err.message, 'error'))
      .finally(() => { if (submitBtn) submitBtn.disabled = false; });
  }

  function handleDeleteProduct(productId) {
    if (!confirm('Tem certeza que deseja desativar este produto? Ele deixará de aparecer na loja.')) return;
    DataService.Products.remove(productId).then(() => {
      Utils.showToast('Produto desativado.', 'info');
      loadProducts();
      if (global.ProductsModule) global.ProductsModule.loadAndRender(true);
    }).catch((err) => Utils.showToast(err.message, 'error'));
  }

  function updateProductMargin() {
    const form = document.getElementById('form-product');
    const price = Number(form.elements.promotionalPrice.value || form.elements.salePrice.value);
    const cost = form.elements.costPrice.value;
    form.elements.profitMargin.value = cost !== '' && price > 0 ? `${((price - Number(cost)) / price * 100).toFixed(2)}%` : '';
  }

  function loadProducts(more = false) { return loadFilteredList('products', more === true); }
  function loadCustomers(more = false) { return loadFilteredList('customers', more === true); }

  function loadFilteredList(type, more = false) {
    const repositories = { products: DataService.Products, customers: DataService.Customers, reviews: DataService.Reviews };
    const cached = { products: cachedProducts, customers: cachedCustomers, reviews: cachedReviews }[type];
    const repository = repositories[type];
    const request = ++listRequests[type];
    const button = document.getElementById(`admin-${type}-load-more`);
    if (button) button.disabled = true;
    const method = type === 'customers' ? 'getAll' : 'getAllAdmin';
    return repository[method]({ ...listFilters[type], limit: PAGE_SIZE, offset: more ? cached.length : 0 }).then((rows) => {
      if (request !== listRequests[type]) return;
      const list = more ? [...cached, ...rows.filter((row) => !cached.some((old) => old.id === row.id))] : rows;
      if (type === 'products') { cachedProducts = list; renderProductsTable(list); }
      if (type === 'customers') { cachedCustomers = list; renderCustomersTable(list); }
      if (type === 'reviews') { cachedReviews = list; renderReviewsTable(list); }
      document.getElementById(`admin-${type}-filter-count`).textContent = `${list.length} registro(s) exibido(s).`;
      if (button) button.classList.toggle('is-hidden', rows.length < PAGE_SIZE);
    }).catch((err) => Utils.showToast(err.message, 'error')).finally(() => { if (button && request === listRequests[type]) button.disabled = false; });
  }

  function setupListFilters() {
    const definitions = {
      products: [ ['search','Nome ou descrição','search'], ['category','Categoria','text'], ['active','Status', [['','Todos'],['true','Ativos'],['false','Inativos']]], ['minValue','Preço mínimo','number'], ['maxValue','Preço máximo','number'], ['maxStock','Estoque até','number'] ],
      customers: [ ['search','Nome, e-mail ou telefone','search'], ['city','Cidade','search'], ['state','UF','text'], ['minValue','Total gasto mínimo','number'], ['maxValue','Total gasto máximo','number'], ['from','Cadastrado desde','date'], ['to','Cadastrado até','date'] ],
      reviews: [ ['search','Produto, nome ou comentário','search'], ['approved','Status', [['','Todos'],['false','Pendentes'],['true','Publicadas']]], ['rating','Nota', [['','Todas'],['1','1 estrela'],['2','2 estrelas'],['3','3 estrelas'],['4','4 estrelas'],['5','5 estrelas']]], ['from','Data inicial','date'], ['to','Data final','date'] ]
    };
    Object.entries(definitions).forEach(([type, fields]) => {
      const table = document.getElementById(`admin-${type}-tbody`).closest('.table-scroll');
      const form = document.createElement('form');
      form.id = `admin-${type}-filters`;
      form.className = 'admin-list-filters';
      form.innerHTML = fields.map(([name,label,kind]) => `<div class="form-field"><label for="filter-${type}-${name}">${label}</label>${Array.isArray(kind) ? `<select id="filter-${type}-${name}" name="${name}">${kind.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select>` : `<input id="filter-${type}-${name}" name="${name}" type="${kind}" ${kind === 'number' ? 'min="0" step="0.01"' : ''}>`}</div>`).join('') + '<div class="order-filters__actions"><button class="btn btn--primary btn--sm" type="submit">Filtrar</button><button class="btn btn--outline btn--sm" type="reset">Limpar</button></div>';
      table.before(form);
      const count = document.createElement('p');
      count.id = `admin-${type}-filter-count`; count.className = 'theme-hint'; count.setAttribute('aria-live','polite');
      table.before(count);
      let button = document.getElementById(`admin-${type}-load-more`);
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.id = `admin-${type}-load-more`; button.className = 'btn btn--outline btn--sm table-pagination'; button.textContent = 'Carregar mais'; table.after(button);
        button.addEventListener('click', () => loadFilteredList(type,true));
      }
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        listFilters[type] = Object.fromEntries([...new FormData(form)].map(([key,value]) => [key, key === 'state' ? value.trim().toUpperCase() : value.trim()]));
        loadFilteredList(type);
      });
      form.addEventListener('reset', () => { listFilters[type] = {}; loadFilteredList(type); });
    });
  }

  // ==========================================================================
  // CATEGORIAS EDITÁVEIS
  // ==========================================================================
  function categoryCardHtml(category) {
    const image = Utils.safeImageSrc(category.image || '');
    return `<article class="admin-category-card" data-id="${category.id}">
      <div class="admin-category-card__image" style="--category-color:${Utils.safeColor(category.color)}">${image ? `<img src="${Utils.escapeHtml(image)}" alt="">` : '<i class="fa-solid fa-layer-group"></i>'}</div>
      <div class="admin-category-card__body"><strong>${Utils.escapeHtml(category.name)}</strong><span>${category.productCount || 0} produto(s) · ordem ${category.sortOrder || 0}</span><span class="status-pill ${category.active ? 'status-pill--on' : 'status-pill--off'}">${category.active ? 'Ativa' : 'Inativa'}</span></div>
      <div class="admin-category-card__actions"><button type="button" class="btn btn--outline btn--sm" data-action="edit-category"><i class="fa-solid fa-pen"></i> Editar</button><button type="button" class="btn-icon btn-icon--danger" data-action="delete-category" aria-label="Excluir categoria"><i class="fa-solid fa-trash"></i></button></div>
    </article>`;
  }

  function renderCategories(categories) {
    const root = document.getElementById('admin-categories-grid');
    if (root) root.innerHTML = categories.length ? categories.map(categoryCardHtml).join('') : '<div class="empty-state"><p>Nenhuma categoria cadastrada.</p></div>';
    const options = document.getElementById('product-category-options');
    if (options) options.innerHTML = categories.filter((category) => category.active).map((category) => `<option value="${Utils.escapeHtml(category.name)}"></option>`).join('');
  }

  function loadCategories() {
    return DataService.Categories.getAllAdmin().then(renderCategories).catch((err) => Utils.showToast(err.message, 'error'));
  }

  function updateCategoryImagePreview() {
    const preview = document.getElementById('category-image-preview');
    const remove = document.getElementById('category-image-remove');
    if (!preview) return;
    const image = Utils.safeImageSrc(currentCategoryImage || '');
    preview.innerHTML = image ? `<img src="${Utils.escapeHtml(image)}" alt="">` : '<i class="fa-solid fa-image"></i>';
    remove?.classList.toggle('is-hidden', !image);
  }

  function openCategoryForm(category) {
    editingCategoryId = category ? category.id : null;
    currentCategoryImage = category ? category.image : null;
    const form = document.getElementById('form-category');
    form.reset();
    document.getElementById('category-form-title').textContent = category ? 'Editar categoria' : 'Nova categoria';
    if (category) {
      form.elements.name.value = category.name;
      form.elements.color.value = category.color || '#D99163';
      form.elements.sortOrder.value = category.sortOrder || 0;
      form.elements.active.checked = category.active !== false;
    }
    updateCategoryImagePreview();
    Utils.openModal('modal-category-form');
  }

  function saveCategory(event) {
    event.preventDefault();
    const form = event.target;
    const payload = { name: form.elements.name.value.trim(), color: form.elements.color.value, sortOrder: Number(form.elements.sortOrder.value) || 0, active: form.elements.active.checked, image: currentCategoryImage || null };
    const action = editingCategoryId ? DataService.Categories.update(editingCategoryId, payload) : DataService.Categories.create(payload);
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    action.then(() => {
      Utils.closeModal('modal-category-form');
      Utils.showToast(editingCategoryId ? 'Categoria atualizada.' : 'Categoria criada.', 'success');
      editingCategoryId = null;
      return Promise.all([loadCategories(), loadProducts(), global.ProductsModule.loadAndRender(true)]);
    }).catch((err) => Utils.showToast(err.message, 'error')).finally(() => { if (button) button.disabled = false; });
  }

  // ==========================================================================
  // MODERAÇÃO DE AVALIAÇÕES E AUDITORIA
  // ==========================================================================
  function renderReviewsTable(reviews) {
    const tbody = document.getElementById('admin-reviews-tbody');
    if (!tbody) return;
    if (!reviews.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Nenhuma avaliação recebida.</td></tr>';
      return;
    }
    tbody.innerHTML = reviews.map((review) => `
      <tr data-id="${review.id}">
        <td>${Utils.escapeHtml(review.productName)}</td>
        <td>${Utils.escapeHtml(review.authorName)}</td>
        <td><span class="product-rating"><i class="fa-solid fa-star"></i> ${review.rating}/5</span></td>
        <td class="cell-truncate" title="${Utils.escapeHtml(review.comment)}">${Utils.escapeHtml(review.comment)}</td>
        <td>${Utils.escapeHtml(review.date)}</td>
        <td><span class="status-pill ${review.approved ? 'status-pill--on' : 'status-pill--off'}">${review.approved ? 'Publicada' : 'Pendente'}</span></td>
        <td class="table-actions">
          ${review.approved ? '' : '<button class="btn-icon" data-action="approve-review" title="Aprovar"><i class="fa-solid fa-check"></i></button>'}
          <button class="btn-icon btn-icon--danger" data-action="delete-review" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`).join('');
  }

  function loadReviews() {
    return loadFilteredList('reviews');
  }

  function renderAuditTable(entries) {
    const tbody = document.getElementById('admin-audit-tbody');
    if (!tbody) return;
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Nenhuma alteração registrada.</td></tr>';
      return;
    }
    tbody.innerHTML = entries.map((entry) => `
      <tr>
        <td>${Utils.escapeHtml(entry.date)}</td>
        <td>${Utils.escapeHtml(entry.adminName || 'Administrador')}</td>
        <td>${Utils.escapeHtml(entry.action)}</td>
        <td>${Utils.escapeHtml(entry.entityType)}${entry.entityId ? ` · ${Utils.escapeHtml(entry.entityId)}` : ''}</td>
        <td class="cell-truncate" title="${Utils.escapeHtml(entry.details || '')}">${Utils.escapeHtml(entry.details || '—')}</td>
      </tr>`).join('');
  }

  function loadAudit() {
    return DataService.Audit.getAll().then(renderAuditTable).catch((err) => Utils.showToast(err.message, 'error'));
  }

  // ==========================================================================
  // PERSONALIZAR (banner, seleção, destaque, FAQ, frete e rodapé)
  // ==========================================================================
  let siteCarouselSlides = []; // [{ image, alt, eyebrow, title, subtitle, ctaText, ctaTarget }]
  let siteFaqItems = []; // [{ q, a }]
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
            <input type="text" placeholder="Selo pequeno" value="${Utils.escapeHtml(slide.eyebrow || '')}" data-carousel-field="eyebrow" data-carousel-index="${i}">
            <textarea rows="2" placeholder="Título do banner" data-carousel-field="title" data-carousel-index="${i}">${Utils.escapeHtml(slide.title || '')}</textarea>
            <textarea rows="2" placeholder="Frase de apoio" data-carousel-field="subtitle" data-carousel-index="${i}">${Utils.escapeHtml(slide.subtitle || '')}</textarea>
            <input type="text" placeholder="Texto do botão" value="${Utils.escapeHtml(slide.ctaText || '')}" data-carousel-field="ctaText" data-carousel-index="${i}">
            <select aria-label="Destino do botão" data-carousel-field="ctaTarget" data-carousel-index="${i}">
              <option value="catalog" ${slide.ctaTarget === 'catalog' || !slide.ctaTarget ? 'selected' : ''}>Destino: catálogo</option>
              <option value="categories" ${slide.ctaTarget === 'categories' ? 'selected' : ''}>Destino: categorias</option>
              <option value="selection" ${slide.ctaTarget === 'selection' ? 'selected' : ''}>Destino: seleção especial</option>
            </select>
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
    container.querySelectorAll('[data-carousel-field]').forEach((field) => {
      field.addEventListener('input', (e) => {
        const index = parseInt(field.dataset.carouselIndex, 10);
        siteCarouselSlides[index][field.dataset.carouselField] = e.target.value;
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
      form.elements['theme-bg'].value = content.theme.bg || '#1A1A1A';
      form.elements['theme-surface'].value = content.theme.surface || '#242424';
      form.elements['theme-primary'].value = content.theme.primary || '#B91E1F';
      form.elements['theme-primary-dark'].value = content.theme.primaryDark || '#8F1517';
      form.elements['theme-accent'].value = content.theme.accent || '#D99163';
      form.elements['theme-accent-dark'].value = content.theme.accentDark || '#A8673F';
      form.elements['theme-text'].value = content.theme.text || '#FDFCFA';
      form.elements['theme-text-muted'].value = content.theme.textMuted || '#D4C9C2';
      form.elements['theme-dark'].value = content.theme.dark || '#101010';

      form.elements['pix-chave'].value = (content.pix && content.pix.chave) || '';
      form.elements['pix-nome'].value = (content.pix && content.pix.nomeBeneficiario) || '';
      form.elements['pix-cidade'].value = (content.pix && content.pix.cidadeBeneficiario) || '';

      form.elements['shipping-flat'].value = (content.shipping && content.shipping.flatRate) || 0;
      form.elements['shipping-free-above'].value = (content.shipping && content.shipping.freeAbove) || 0;
      form.elements['shipping-days'].value = (content.shipping && content.shipping.estimatedDays) || 7;

      siteCarouselSlides = (content.carousel || []).map((s) => Object.assign({}, s));
      renderCarouselRows();

      form.elements['flash-tag'].value = content.flashSale.tag || '';
      form.elements['flash-title'].value = content.flashSale.title || '';
      form.elements['flash-description'].value = content.flashSale.description || '';

      siteSpotlightImage = content.spotlight.image || null;
      updateSingleImagePreview('sc-spotlight-image-preview', siteSpotlightImage);
      form.elements['spotlight-eyebrow'].value = content.spotlight.eyebrow || '';
      form.elements['spotlight-title'].value = content.spotlight.title || '';
      form.elements['spotlight-text'].value = content.spotlight.text || '';
      form.elements['spotlight-button'].value = content.spotlight.buttonText || '';

      siteFaqItems = (content.faq || []).map((f) => Object.assign({}, f));
      renderFaqRows();

      form.elements['footer-about'].value = content.footer.about || '';
      form.elements['footer-legal-name'].value = content.footer.legalName || '';
      form.elements['footer-document'].value = content.footer.document || '';
      form.elements['footer-address'].value = content.footer.address || '';
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
      shipping: {
        flatRate: parseFloat(form.elements['shipping-flat'].value) || 0,
        freeAbove: parseFloat(form.elements['shipping-free-above'].value) || 0,
        estimatedDays: parseInt(form.elements['shipping-days'].value, 10) || 7
      },
      carousel: siteCarouselSlides.filter((s) => s.image),
      flashSale: {
        tag: form.elements['flash-tag'].value.trim(),
        title: form.elements['flash-title'].value.trim(),
        description: form.elements['flash-description'].value.trim()
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
        legalName: form.elements['footer-legal-name'].value.trim(),
        document: form.elements['footer-document'].value.trim(),
        address: form.elements['footer-address'].value.trim(),
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
      .catch((err) => Utils.showToast(err.message || 'Não foi possível salvar. Tente novamente.', 'error'))
      .finally(() => submitBtns.forEach((btn) => (btn.disabled = false)));
  }

  function handleSiteContentReset() {
    if (!confirm('Restaurar textos, imagens, tema e frete para o padrão? A chave Pix e os dados de identificação legal serão preservados.')) return;
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
        if (siteCarouselSlides.length >= 4) {
          Utils.showToast('O banner aceita no máximo 4 slides.', 'warning');
          return;
        }
        siteCarouselSlides.push({ image: '', alt: '', eyebrow: '', title: '', subtitle: '', ctaText: 'Ver catálogo', ctaTarget: 'catalog' });
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
    const titles = {
      dashboard: 'Painel Administrativo', clientes: 'Clientes', pedidos: 'Pedidos', produtos: 'Produtos', categorias: 'Categorias',
      relatorios: 'Relatórios', custos: 'Custos e lucratividade', avaliacoes: 'Avaliações', auditoria: 'Auditoria', personalizar: 'Personalizar loja'
    };
    const title = document.getElementById('admin-topbar-title');
    if (title) title.textContent = titles[tabName] || 'Painel Administrativo';
    if (tabName === 'avaliacoes') loadReviews();
    if (tabName === 'auditoria') loadAudit();
    if (tabName === 'relatorios' && global.AdminReportsModule) global.AdminReportsModule.onAdminTabActivated();
    if (tabName === 'custos' && global.AdminCostsModule) global.AdminCostsModule.load();
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
      if (!knownOrderIds.has(order.id) && !order.seenByAdmin) {
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
    const request = ++ordersRequest;
    return Promise.all([
      DataService.Orders.getAll({ limit: PAGE_SIZE, offset: 0, ...orderFilters }),
      loadCustomers(),
      DataService.Orders.getAdminSummary()
    ]).then(
      ([orders, customers, summary]) => {
        if (request !== ordersRequest) return;
        cachedOrders = orders;
        if (!Object.values(orderFilters).some((value) => value !== '' && value != null)) checkForNewOrders(orders);
        renderDashboard(summary);
        renderCustomersTable(cachedCustomers);
        renderOrdersTable(cachedOrders);
        document.getElementById('admin-orders-load-more')?.classList.toggle('is-hidden', orders.length < PAGE_SIZE);
      }
    ).catch((err) => Utils.showToast(err.message, 'error'));
  }

  function loadOrdersOnly({ showErrors = false } = {}) {
    const request = ++ordersRequest;
    return Promise.all([DataService.Orders.getAll({ limit: PAGE_SIZE, offset: 0, ...orderFilters }), DataService.Orders.getAdminSummary()]).then(([orders, summary]) => {
      if (request !== ordersRequest) return;
      if (!Object.values(orderFilters).some((value) => value !== '' && value != null)) checkForNewOrders(orders);
      cachedOrders = orders;
      renderDashboard(summary);
      renderOrdersTable(cachedOrders);
      document.getElementById('admin-orders-load-more')?.classList.toggle('is-hidden', orders.length < PAGE_SIZE);
    }).catch((err) => { if (showErrors && request === ordersRequest) Utils.showToast(err.message, 'error'); });
  }

  function loadMoreOrders() {
    const request = ++ordersRequest;
    const button = document.getElementById('admin-orders-load-more');
    if (button) button.disabled = true;
    return DataService.Orders.getAll({ limit: PAGE_SIZE, offset: cachedOrders.length, ...orderFilters }).then((orders) => {
      if (request !== ordersRequest) return;
      const known = new Set(cachedOrders.map((order) => order.id));
      cachedOrders.push(...orders.filter((order) => !known.has(order.id)));
      renderOrdersTable(cachedOrders);
      if (button) button.classList.toggle('is-hidden', orders.length < PAGE_SIZE);
    }).catch((err) => Utils.showToast(err.message, 'error')).finally(() => { if (button) button.disabled = false; });
  }

  function loadMoreCustomers() {
    return loadCustomers(true);
  }

  function enter() {
    return Promise.all([loadAll(), loadProducts(), loadCategories(), loadSiteContentForm(), loadReviews(), loadAudit()]);
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

    const reviewsTbody = document.getElementById('admin-reviews-tbody');
    if (reviewsTbody) {
      reviewsTbody.addEventListener('click', (e) => {
        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        if (e.target.closest('[data-action="approve-review"]')) {
          DataService.Reviews.approve(row.dataset.id).then(() => {
            Utils.showToast('Avaliação aprovada e publicada.', 'success');
            loadReviews();
            loadAudit();
          }).catch((err) => Utils.showToast(err.message, 'error'));
        }
        if (e.target.closest('[data-action="delete-review"]')) {
          if (!confirm('Excluir esta avaliação definitivamente?')) return;
          DataService.Reviews.remove(row.dataset.id).then(() => {
            Utils.showToast('Avaliação excluída.', 'info');
            loadReviews();
            loadAudit();
          }).catch((err) => Utils.showToast(err.message, 'error'));
        }
      });
    }

    const newProductBtn = document.getElementById('new-product-btn');
    if (newProductBtn) newProductBtn.addEventListener('click', () => openProductForm(null));

    document.getElementById('new-category-btn')?.addEventListener('click', () => openCategoryForm(null));
    document.getElementById('form-category')?.addEventListener('submit', saveCategory);
    document.getElementById('category-image-input')?.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      Utils.compressImageFile(file, { maxWidth: 800, maxHeight: 800, quality: .82 }).then((image) => {
        currentCategoryImage = image;
        updateCategoryImagePreview();
      }).catch((err) => Utils.showToast(err.message, 'error'));
      event.target.value = '';
    });
    document.getElementById('category-image-remove')?.addEventListener('click', () => { currentCategoryImage = null; updateCategoryImagePreview(); });
    document.getElementById('admin-categories-grid')?.addEventListener('click', (event) => {
      const card = event.target.closest('[data-id]');
      if (!card) return;
      if (event.target.closest('[data-action="edit-category"]')) {
        DataService.Categories.getAllAdmin().then((categories) => openCategoryForm(categories.find((category) => category.id === card.dataset.id)));
      }
      if (event.target.closest('[data-action="delete-category"]')) {
        if (!confirm('Excluir esta categoria? Ela só poderá ser excluída se não possuir produtos.')) return;
        DataService.Categories.remove(card.dataset.id).then(() => {
          Utils.showToast('Categoria excluída.', 'info');
          return Promise.all([loadCategories(), global.ProductsModule.loadAndRender(true)]);
        }).catch((err) => Utils.showToast(err.message, 'error'));
      }
    });

    document.getElementById('admin-orders-load-more')?.addEventListener('click', loadMoreOrders);
    document.getElementById('admin-orders-filters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      orderFilters = readOrderFilters();
      loadOrdersOnly({ showErrors: true });
    });
    document.getElementById('admin-orders-clear-filters')?.addEventListener('click', () => {
      document.getElementById('admin-orders-filters')?.reset();
      orderFilters = {};
      loadOrdersOnly({ showErrors: true });
    });
    document.getElementById('admin-customers-load-more')?.addEventListener('click', loadMoreCustomers);

    const productForm = document.getElementById('form-product');
    if (productForm) productForm.addEventListener('submit', handleProductFormSubmit);
    productForm?.addEventListener('input', updateProductMargin);

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
    if (global.AdminReportsModule) global.AdminReportsModule.init();
    if (global.AdminCostsModule) global.AdminCostsModule.init();
    setupListFilters();
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
