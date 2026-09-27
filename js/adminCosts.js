(function (global) {
  'use strict';
  let requestSequence = 0;
  const money = (value) => Utils.formatCurrency(value);
  const escape = (value) => Utils.escapeHtml(String(value ?? ''));
  const percent = (value) => value == null ? '—' : `${Number(value).toFixed(2)}%`;
  function init() {
    const panel = document.createElement('section');
    panel.className = 'admin-tab-panel'; panel.dataset.tabPanel = 'custos';
    panel.innerHTML = `<div class="panel-card"><h2>Custos e lucratividade</h2>
      <p class="theme-hint">Vendas pagas, em produção, enviadas e finalizadas. Margem bruta dos produtos, sem frete, impostos ou despesas operacionais.</p>
      <form id="cost-filters" class="admin-list-filters">
        <div class="form-field"><label for="cost-from">Data inicial</label><input id="cost-from" name="startDate" type="date" required></div>
        <div class="form-field"><label for="cost-to">Data final</label><input id="cost-to" name="endDate" type="date" required></div>
        <div class="form-field"><label for="cost-category">Categoria</label><select id="cost-category" name="category"><option value="">Todas</option></select></div>
        <div class="form-field"><label for="cost-product">Produto</label><select id="cost-product" name="productId"><option value="">Todos</option></select></div>
        <button class="btn btn--primary btn--sm" type="submit">Atualizar análise</button>
      </form><p id="cost-message" class="theme-hint" role="status"></p>
      <div id="cost-kpis" class="kpi-row kpi-row--3"></div>
      <h3>Resultado por produto no período</h3><div id="cost-sales" class="table-scroll"></div>
      <h3>Estoque e custo de reposição atuais</h3><p class="theme-hint">Posição atual, incluindo produtos inativos. Não representa o estoque na data escolhida.</p><div id="cost-inventory" class="table-scroll"></div></div>`;
    document.querySelector('[data-tab-panel="clientes"]').before(panel);
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const date = Object.fromEntries(parts.map((p)=>[p.type,p.value]));
    document.getElementById('cost-to').value = `${date.year}-${date.month}-${date.day}`;
    document.getElementById('cost-from').value = `${date.year}-${date.month}-01`;
    document.getElementById('cost-filters').addEventListener('submit',(event)=>{event.preventDefault();load();});
  }
  function table(headers, rows) {
    return `<table class="data-table"><thead><tr>${headers.map((h)=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row)=>`<tr>${row.map((cell)=>`<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">Nenhum resultado para este período e filtros.</td></tr>`}</tbody></table>`;
  }
  async function load() {
    const sequence = ++requestSequence;
    const form = document.getElementById('cost-filters');
    const message = document.getElementById('cost-message');
    const button = form.querySelector('button');
    const filters = Object.fromEntries(new FormData(form));
    button.disabled = true; message.textContent = 'Calculando custos...';
    try {
      const [data, choices] = await Promise.all([DataService.Reports.getCosts(filters), DataService.Reports.getFilters()]);
      if (sequence !== requestSequence) return;
      for (const [id,list,key] of [['cost-category',choices.categories,'category'],['cost-product',choices.products,'productId']]) {
        const select = document.getElementById(id);
        select.innerHTML = '<option value="">Todos</option>' + (list || []).map((item)=>`<option value="${escape(typeof item === 'string' ? item : item.id)}">${escape(typeof item === 'string' ? item : item.name)}</option>`).join('');
        select.value = filters[key] || '';
      }
      const s = data.summary;
      message.textContent = `${s.missingUnits} unidade(s) vendida(s) sem custo histórico; ${s.productsWithoutCost} produto(s) sem custo cadastrado. Lucro e margem consideram somente vendas com custo conhecido. Pedidos antigos não são recalculados pelo custo atual.`;
      document.getElementById('cost-kpis').innerHTML = [
        ['Receita de produtos',money(s.revenue)], ['Custo vendido conhecido',money(s.cost)], ['Lucro bruto apurado', s.coveredRevenue > 0 ? money(s.profit) : '—'],
        ['Margem bruta apurada',percent(s.margin)], ['Custo conhecido em estoque',money(s.inventoryValue)], ['Cobertura do custo nas vendas',s.revenue > 0 ? percent(s.coveredRevenue/s.revenue*100) : '—']
      ].map(([label,value])=>`<div class="kpi-card"><div><span class="kpi-card__value">${value}</span><span class="kpi-card__label">${label}</span></div></div>`).join('');
      document.getElementById('cost-sales').innerHTML = table(['Produto','Unidades','Receita','Custo conhecido','Lucro apurado','Margem','Sem custo'], data.products.map((p)=>[escape(p.name),p.units,money(p.revenue),money(p.cost),p.coveredRevenue > 0 ? money(p.profit) : '—',percent(p.coveredRevenue > 0 ? p.profit/p.coveredRevenue*100 : null),p.missingUnits]));
      document.getElementById('cost-inventory').innerHTML = table(['Produto','Categoria','Estoque','Venda','Custo unitário','Margem atual','Custo em estoque'],data.inventory.map((p)=>[escape(p.name)+(p.active ? '' : ' (inativo)'),escape(p.category),p.stock,money(p.price),p.cost == null ? 'Não informado' : money(p.cost),percent(p.cost == null ? null : (p.price-p.cost)/p.price*100),p.cost == null ? '—' : money(p.stock*p.cost)]));
    } catch (err) { if (sequence === requestSequence) { message.textContent = err.message; document.getElementById('cost-kpis').innerHTML = ''; document.getElementById('cost-sales').innerHTML = ''; document.getElementById('cost-inventory').innerHTML = ''; } }
    finally { if (sequence === requestSequence) button.disabled = false; }
  }
  global.AdminCostsModule = { init, load };
})(window);
