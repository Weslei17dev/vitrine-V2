(function (global) {
  'use strict';
  let rules = [];

  const form = () => document.getElementById('form-promotion');
  const formatDate = (value) => value ? new Date(value).toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'}) : '';
  const localDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  };
  function updateFields() {
    const controls = form().elements;
    const coupon = controls.kind.value === 'coupon';
    const scope = controls.scope.value;
    document.querySelector('.promotion-code-field').hidden = !coupon;
    document.querySelector('.promotion-limit-field').hidden = !coupon;
    document.querySelector('.promotion-category-field').hidden = scope !== 'category';
    document.querySelector('.promotion-product-field').hidden = scope !== 'product';
    controls.code.required = coupon;
    controls.category.required = scope === 'category';
    controls.productId.required = scope === 'product';
    controls.value.max = controls.discountType.value === 'percent' ? '100' : '999999.99';
    document.getElementById('promotion-rule-hint').textContent = coupon
      ? 'O cupom vale para os itens selecionados no carrinho, após os descontos automáticos. Valor fixo é abatido uma vez do pedido.'
      : 'Desconto automático é exibido no preço da loja. Valor fixo é abatido por unidade; se houver mais de um, vale o maior por item.';
  }
  function scopeText(rule) {
    if (rule.scope === 'all') return 'Todos os produtos';
    if (rule.scope === 'category') return `Categoria: ${rule.category}`;
    const option = document.querySelector(`#promotion-product option[value="${CSS.escape(rule.productId || '')}"]`);
    return `Produto: ${option?.textContent || rule.productId || 'indisponível'}`;
  }
  function render() {
    const container = document.getElementById('admin-promotions-list');
    container.innerHTML = rules.length ? rules.map((rule) => `<article class="promotion-row" data-id="${Utils.escapeHtml(rule.id)}">
      <div><strong>${Utils.escapeHtml(rule.name)}</strong> <span class="status-pill ${rule.active ? 'status-pill--on' : 'status-pill--off'}">${rule.active ? 'Ativo' : 'Inativo'}</span>
      <p>${rule.kind === 'coupon' ? `Cupom <code>${Utils.escapeHtml(rule.code)}</code>` : 'Desconto automático'} · ${Utils.escapeHtml(scopeText(rule))} · ${rule.discountType === 'percent' ? `${rule.value}%` : Utils.formatCurrency(rule.value)}</p>
      ${rule.startsAt || rule.endsAt ? `<small>${rule.startsAt ? `Início: ${Utils.escapeHtml(formatDate(rule.startsAt))}` : 'Sem início'} · ${rule.endsAt ? `Fim: ${Utils.escapeHtml(formatDate(rule.endsAt))}` : 'Sem término'}</small>` : ''}
      ${rule.kind === 'coupon' ? `<small>Usos: ${rule.usedCount}${rule.maxUses == null ? ' (sem limite)' : ' / ' + rule.maxUses}</small>` : ''}</div>
      <div class="promotion-row__actions"><button type="button" class="btn btn--outline btn--sm" data-promotion-action="edit">Editar</button><button type="button" class="btn btn--outline btn--sm" data-promotion-action="toggle">${rule.active ? 'Desativar' : 'Ativar'}</button></div>
    </article>`).join('') : '<p>Nenhum desconto cadastrado ainda.</p>';
  }
  function reset() {
    form().reset();
    form().elements.id.value = '';
    form().elements.kind.disabled = false;
    document.getElementById('promotion-submit').textContent = 'Criar desconto';
    document.getElementById('promotion-cancel').classList.add('is-hidden');
    updateFields();
  }
  function edit(rule) {
    const fields = form().elements;
    fields.id.value = rule.id; fields.name.value = rule.name; fields.kind.value = rule.kind;
    fields.kind.disabled = true; fields.code.value = rule.code || '';
    fields.scope.value = rule.scope; fields.category.value = rule.category || '';
    fields.productId.value = rule.productId || ''; fields.discountType.value = rule.discountType;
    fields.value.value = rule.value; fields.maxUses.value = rule.maxUses ?? '';
    fields.startsAt.value = localDate(rule.startsAt); fields.endsAt.value = localDate(rule.endsAt);
    fields.active.checked = rule.active;
    document.getElementById('promotion-submit').textContent = 'Salvar alterações';
    document.getElementById('promotion-cancel').classList.remove('is-hidden');
    updateFields();
    form().scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function load() {
    const container = document.getElementById('admin-promotions-list');
    container.innerHTML = '<p>Carregando descontos…</p>';
    try {
      const [list, categories, products] = await Promise.all([
        DataService.Promotions.getAll(), DataService.Categories.getAllAdmin(),
        DataService.Products.getAllAdmin({limit:500})
      ]);
      rules = list;
      const fields = form().elements;
      const currentCategory = fields.category.value, currentProduct = fields.productId.value;
      fields.category.innerHTML = '<option value="">Selecione a categoria</option>' + categories.map((item) => `<option value="${Utils.escapeHtml(item.name)}">${Utils.escapeHtml(item.name)}</option>`).join('');
      fields.productId.innerHTML = '<option value="">Selecione o produto</option>' + products.map((item) => `<option value="${Utils.escapeHtml(item.id)}">${Utils.escapeHtml(item.name)}</option>`).join('');
      fields.category.value = currentCategory;
      fields.productId.value = currentProduct;
      render();
    } catch (err) { container.innerHTML = '<p>Não foi possível carregar os descontos.</p>'; Utils.showToast(err.message, 'error'); }
  }
  async function save(event) {
    event.preventDefault();
    const fields = form().elements, button = document.getElementById('promotion-submit');
    const payload = {
      name:fields.name.value.trim(), kind:fields.kind.value, code:fields.code.value.trim(),
      scope:fields.scope.value, category:fields.category.value, productId:fields.productId.value,
      discountType:fields.discountType.value, value:Number(fields.value.value), maxUses:fields.maxUses.value,
      startsAt:fields.startsAt.value ? new Date(fields.startsAt.value).toISOString() : null,
      endsAt:fields.endsAt.value ? new Date(fields.endsAt.value).toISOString() : null,
      active:fields.active.checked
    };
    button.disabled = true;
    try {
      if (fields.id.value) await DataService.Promotions.update(fields.id.value, payload);
      else await DataService.Promotions.create(payload);
      reset();
      await load();
      global.ProductsModule.loadAndRender(true).catch(() => {});
      Utils.showToast('Desconto salvo.', 'success');
    } catch (err) { Utils.showToast(err.message, 'error'); }
    finally { button.disabled = false; }
  }
  function init() {
    if (!form()) return;
    form().addEventListener('submit', save);
    form().addEventListener('change', updateFields);
    document.getElementById('promotion-cancel').addEventListener('click', reset);
    document.getElementById('admin-promotions-list').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-promotion-action]');
      const rule = rules.find((item) => item.id === button?.closest('[data-id]')?.dataset.id);
      if (!rule) return;
      if (button.dataset.promotionAction === 'edit') { edit(rule); return; }
      button.disabled = true;
      try {
        await DataService.Promotions.setActive(rule.id, !rule.active);
        await load();
        global.ProductsModule.loadAndRender(true).catch(() => {});
        Utils.showToast('Status do desconto atualizado.', 'success');
      } catch(err) { button.disabled = false; Utils.showToast(err.message, 'error'); }
    });
    updateFields();
  }
  global.AdminPromotionsModule = {init,load};
})(window);
