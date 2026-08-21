/* ============================================================================
   adminReports.js
   ----------------------------------------------------------------------------
   Relatórios gerenciais do painel administrativo. Os números são agregados
   pela API; este módulo cuida dos filtros, das quatro visões e dos gráficos.
   ============================================================================ */

(function (global) {
  'use strict';

  const STATUS_COLORS = {
    'Aguardando Pagamento': '#F5A623',
    'Aguardando Confirmação': '#4C8DFF',
    Pago: '#2ECC8F',
    'Em Produção': '#D99163',
    Enviado: '#8B6CE7',
    Finalizado: '#3FAE78',
    Cancelado: '#FF5470'
  };
  const FALLBACK_COLORS = ['#B91E1F', '#D99163', '#2ECC8F', '#4C8DFF', '#8B6CE7', '#F5A623', '#FF5470'];
  const VIEW_NAMES = { overview: 'Visão geral', products: 'Produtos', customers: 'Clientes', orders: 'Pedidos' };
  const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const compactCurrencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1
  });
  const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const decimalFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  let initialized = false;
  let filtersLoaded = false;
  let hasLoadedReport = false;
  let activeView = 'overview';
  let reportData = null;
  let filterOptions = { customers: [], products: [], categories: [], firstOrderDate: null };
  let requestSequence = 0;

  function element(id) {
    return document.getElementById(id);
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function escape(value) {
    return Utils.escapeHtml(value == null ? '' : String(value));
  }

  function formatCurrency(value) {
    return currencyFormatter.format(number(value));
  }

  function formatCompactCurrency(value) {
    return compactCurrencyFormatter.format(number(value));
  }

  function formatInteger(value) {
    return integerFormatter.format(Math.round(number(value)));
  }

  function formatDecimal(value) {
    return decimalFormatter.format(number(value));
  }

  function isoDateInStoreTimezone(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(value);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function shiftIsoDate(value, amount) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function startOfMonth(value) {
    return `${value.slice(0, 8)}01`;
  }

  function dateLabel(value, options = {}) {
    if (!value) return '—';
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
    return new Intl.DateTimeFormat('pt-BR', options).format(date);
  }

  function dateTimeLabel(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'
    }).format(new Date(value));
  }

  function periodLabel(value, granularity) {
    const options = granularity === 'month'
      ? { month: 'short', year: '2-digit' }
      : granularity === 'week'
        ? { day: '2-digit', month: 'short' }
        : { day: '2-digit', month: '2-digit' };
    return dateLabel(value, options).replace('.', '');
  }

  function emptyChart(title = 'Sem dados neste período', detail = 'Altere os filtros ou escolha um período maior.') {
    return `<div class="report-chart-empty"><div><i class="fa-solid fa-chart-column"></i><strong>${escape(title)}</strong><span>${escape(detail)}</span></div></div>`;
  }

  function resolveChartColors() {
    const styles = getComputedStyle(document.documentElement);
    const values = [
      styles.getPropertyValue('--color-primary').trim(),
      styles.getPropertyValue('--color-accent').trim(),
      styles.getPropertyValue('--color-success').trim(),
      styles.getPropertyValue('--color-info').trim(),
      '#8B6CE7',
      styles.getPropertyValue('--color-warning').trim(),
      styles.getPropertyValue('--color-danger').trim()
    ];
    return values.map((color, index) => color || FALLBACK_COLORS[index]);
  }

  function setLoading(isLoading) {
    element('reports-loading')?.classList.toggle('is-hidden', !isLoading);
    element('reports-content')?.classList.toggle('is-hidden', isLoading || !reportData);
    const apply = element('reports-apply-btn');
    const refresh = element('reports-refresh-btn');
    if (apply) apply.disabled = isLoading;
    if (refresh) refresh.disabled = isLoading;
  }

  function showError(message) {
    const error = element('reports-error');
    if (!error) return;
    error.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escape(message)}`;
    error.classList.remove('is-hidden');
  }

  function clearError() {
    element('reports-error')?.classList.add('is-hidden');
  }

  function populateSelect(id, rows, placeholder, labelBuilder) {
    const select = element(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${escape(placeholder)}</option>` + rows.map((row) => {
      const value = typeof row === 'string' ? row : row.id;
      const label = labelBuilder ? labelBuilder(row) : row;
      return `<option value="${escape(value)}">${escape(label)}</option>`;
    }).join('');
    if (Array.from(select.options).some((option) => option.value === current)) select.value = current;
  }

  function loadFilterOptions() {
    if (filtersLoaded) return Promise.resolve(filterOptions);
    return DataService.Reports.getFilters().then((data) => {
      filterOptions = data || filterOptions;
      populateSelect('report-customer-filter', filterOptions.customers || [], 'Todos os clientes', (row) => row.name);
      populateSelect('report-product-filter', filterOptions.products || [], 'Todos os produtos', (row) => `${row.name}${row.active === false ? ' (inativo)' : ''}`);
      populateSelect('report-category-filter', filterOptions.categories || [], 'Todas as categorias');
      filtersLoaded = true;
      return filterOptions;
    });
  }

  function applyPreset(preset) {
    const today = isoDateInStoreTimezone();
    let startDate = shiftIsoDate(today, -29);
    let endDate = today;
    if (preset === 'today') startDate = today;
    if (preset === '7d') startDate = shiftIsoDate(today, -6);
    if (preset === 'thisMonth') startDate = startOfMonth(today);
    if (preset === 'lastMonth') {
      endDate = shiftIsoDate(startOfMonth(today), -1);
      startDate = startOfMonth(endDate);
    }
    if (preset === '90d') startDate = shiftIsoDate(today, -89);
    if (preset === 'thisYear') startDate = `${today.slice(0, 4)}-01-01`;
    if (preset === 'all') startDate = filterOptions.firstOrderDate || `${today.slice(0, 4)}-01-01`;
    if (preset === 'custom') return;
    const startInput = element('report-start-date');
    const endInput = element('report-end-date');
    if (startInput) startInput.value = startDate;
    if (endInput) endInput.value = endDate;
  }

  function selectedLabel(selectId) {
    const select = element(selectId);
    return select && select.selectedOptions[0] ? select.selectedOptions[0].textContent.trim() : '';
  }

  function currentFilters() {
    return {
      startDate: element('report-start-date')?.value || '',
      endDate: element('report-end-date')?.value || '',
      customerId: element('report-customer-filter')?.value || '',
      productId: element('report-product-filter')?.value || '',
      category: element('report-category-filter')?.value || '',
      status: element('report-status-filter')?.value || '',
      granularity: element('report-granularity-filter')?.value || 'auto'
    };
  }

  function renderActiveFilters(data) {
    const container = element('reports-active-filters');
    if (!container || !data.meta) return;
    const chips = [
      ['Período', `${dateLabel(data.meta.startDate)} a ${dateLabel(data.meta.endDate)}`]
    ];
    if (data.meta.appliedFilters.customerId) chips.push(['Cliente', selectedLabel('report-customer-filter')]);
    if (data.meta.appliedFilters.productId) chips.push(['Produto', selectedLabel('report-product-filter')]);
    if (data.meta.appliedFilters.category) chips.push(['Categoria', data.meta.appliedFilters.category]);
    if (data.meta.appliedFilters.status) chips.push(['Status', data.meta.appliedFilters.status]);
    const grouping = { day: 'dia', week: 'semana', month: 'mês' }[data.meta.granularity] || data.meta.granularity;
    chips.push(['Agrupado por', grouping]);
    container.innerHTML = chips.map(([label, value]) => `<span class="reports-filter-chip">${escape(label)}: <strong>${escape(value)}</strong></span>`).join('');
    const updated = element('reports-updated-at');
    if (updated) updated.textContent = `Atualizado em ${dateTimeLabel(data.meta.generatedAt)}`;
  }

  function changeMarkup(change) {
    if (change === undefined) return '';
    if (change === null) return '<span class="report-kpi__change is-positive"><i class="fa-solid fa-sparkles"></i> novo</span>';
    const numeric = number(change);
    const state = numeric > 0 ? 'is-positive' : numeric < 0 ? 'is-negative' : 'is-neutral';
    const icon = numeric > 0 ? 'fa-arrow-trend-up' : numeric < 0 ? 'fa-arrow-trend-down' : 'fa-minus';
    return `<span class="report-kpi__change ${state}"><i class="fa-solid ${icon}"></i> ${formatDecimal(Math.abs(numeric))}%</span>`;
  }

  function renderKpis(containerId, specs) {
    const container = element(containerId);
    if (!container) return;
    container.innerHTML = specs.map((item) => `
      <article class="report-kpi" style="--kpi-tone:${item.tone || 'var(--color-accent)'}">
        <div class="report-kpi__top">
          <span class="report-kpi__icon"><i class="fa-solid ${item.icon}"></i></span>
          ${changeMarkup(item.change)}
        </div>
        <strong class="report-kpi__value">${escape(item.value)}</strong>
        <span class="report-kpi__label">${escape(item.label)}</span>
        ${item.hint ? `<span class="report-kpi__hint">${escape(item.hint)}</span>` : ''}
      </article>`).join('');
  }

  function renderLineChart(containerId, rows, dataKey, options = {}) {
    const container = element(containerId);
    if (!container) return;
    if (!rows.length || !rows.some((row) => number(row[dataKey]) > 0)) {
      container.innerHTML = emptyChart();
      return;
    }
    const width = 900;
    const height = 300;
    const pad = { top: 18, right: 18, bottom: 42, left: 72 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const maxValue = Math.max(...rows.map((row) => number(row[dataKey])), 1);
    const roundedMax = maxValue * 1.12;
    const x = (index) => pad.left + (rows.length === 1 ? plotWidth / 2 : index * plotWidth / (rows.length - 1));
    const y = (value) => pad.top + plotHeight - (number(value) / roundedMax) * plotHeight;
    const points = rows.map((row, index) => `${x(index).toFixed(1)},${y(row[dataKey]).toFixed(1)}`);
    const linePath = `M ${points.join(' L ')}`;
    const areaPath = `${linePath} L ${x(rows.length - 1).toFixed(1)},${(pad.top + plotHeight).toFixed(1)} L ${x(0).toFixed(1)},${(pad.top + plotHeight).toFixed(1)} Z`;
    const formatter = options.format || formatInteger;
    const ticks = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const value = roundedMax * (1 - ratio);
      const position = pad.top + plotHeight * ratio;
      return `<line class="report-svg__grid" x1="${pad.left}" x2="${width - pad.right}" y1="${position}" y2="${position}"></line>
        <text class="report-svg__axis-label" x="${pad.left - 10}" y="${position + 4}" text-anchor="end">${escape(formatter(value))}</text>`;
    }).join('');
    const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
    const labels = rows.map((row, index) => {
      if (index % labelEvery !== 0 && index !== rows.length - 1) return '';
      return `<text class="report-svg__axis-label" x="${x(index)}" y="${height - 13}" text-anchor="middle">${escape(periodLabel(row.period, reportData.meta.granularity))}</text>`;
    }).join('');
    const pointEvery = rows.length <= 32 ? 1 : labelEvery;
    const dots = rows.map((row, index) => {
      if (index % pointEvery !== 0 && index !== rows.length - 1) return '';
      return `<circle class="report-svg__point" cx="${x(index)}" cy="${y(row[dataKey])}" r="4"><title>${escape(`${periodLabel(row.period, reportData.meta.granularity)}: ${formatter(row[dataKey])}`)}</title></circle>`;
    }).join('');
    const gradientId = `${containerId}-gradient`;
    const total = rows.reduce((sum, row) => sum + number(row[dataKey]), 0);
    container.innerHTML = `
      <svg class="report-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(`${options.title || 'Linha do tempo'}. Total no período: ${formatter(total)}.`)}">
        <defs><linearGradient id="${escape(gradientId)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--color-accent)" stop-opacity=".38"></stop><stop offset="100%" stop-color="var(--color-accent)" stop-opacity=".02"></stop></linearGradient></defs>
        ${ticks}
        <path class="report-svg__area" fill="url(#${escape(gradientId)})" d="${areaPath}"></path>
        <path class="report-svg__line" d="${linePath}"></path>
        ${dots}${labels}
      </svg>`;
  }

  function renderColumnChart(containerId, rows, dataKey, options = {}) {
    const container = element(containerId);
    if (!container) return;
    if (!rows.length || !rows.some((row) => number(row[dataKey]) > 0)) {
      container.innerHTML = emptyChart();
      return;
    }
    const width = 720;
    const height = 270;
    const pad = { top: 18, right: 14, bottom: 45, left: 58 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const maxValue = Math.max(...rows.map((row) => number(row[dataKey])), 1) * 1.12;
    const band = plotWidth / rows.length;
    const barWidth = Math.max(4, Math.min(48, band * .62));
    const formatter = options.format || formatInteger;
    const ticks = Array.from({ length: 4 }, (_, index) => {
      const ratio = index / 3;
      const value = maxValue * (1 - ratio);
      const y = pad.top + plotHeight * ratio;
      return `<line class="report-svg__grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}"></line><text class="report-svg__axis-label" x="${pad.left - 8}" y="${y + 4}" text-anchor="end">${escape(formatter(value))}</text>`;
    }).join('');
    const labelEvery = Math.max(1, Math.ceil(rows.length / 10));
    const bars = rows.map((row, index) => {
      const value = number(row[dataKey]);
      const h = value / maxValue * plotHeight;
      const x = pad.left + index * band + (band - barWidth) / 2;
      const y = pad.top + plotHeight - h;
      const rawLabel = options.labelKey ? row[options.labelKey] : periodLabel(row.period, reportData.meta.granularity);
      const label = index % labelEvery === 0 || index === rows.length - 1 ? rawLabel : '';
      return `<rect class="report-svg__bar" x="${x}" y="${y}" width="${barWidth}" height="${Math.max(0, h)}"><title>${escape(`${rawLabel}: ${formatter(value)}`)}</title></rect>
        ${label ? `<text class="report-svg__axis-label" x="${x + barWidth / 2}" y="${height - 14}" text-anchor="middle">${escape(label)}</text>` : ''}`;
    }).join('');
    container.innerHTML = `<svg class="report-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(options.title || 'Gráfico de colunas')}">${ticks}${bars}</svg>`;
  }

  function renderBars(containerId, rows, options = {}) {
    const container = element(containerId);
    if (!container) return;
    const data = rows.slice(0, options.limit || 6);
    if (!data.length || !data.some((row) => number(row[options.valueKey]) > 0)) {
      container.innerHTML = emptyChart();
      return;
    }
    const max = Math.max(...data.map((row) => number(row[options.valueKey])), 1);
    const formatter = options.format || formatInteger;
    container.innerHTML = `<div class="report-bars" role="img" aria-label="${escape(options.title || 'Ranking')}">` + data.map((row, index) => {
      const value = number(row[options.valueKey]);
      const label = options.label ? options.label(row) : row.name || row.category || row.label;
      const metaLeft = options.metaLeft ? options.metaLeft(row) : `#${index + 1}`;
      const metaRight = options.metaRight ? options.metaRight(row) : '';
      return `<div class="report-bar">
        <div class="report-bar__header"><span class="report-bar__label" title="${escape(label)}">${escape(label)}</span><strong class="report-bar__value">${escape(formatter(value))}</strong></div>
        <div class="report-bar__track"><span class="report-bar__fill" style="width:${Math.max(value > 0 ? 3 : 0, value / max * 100).toFixed(1)}%"></span></div>
        <div class="report-bar__meta"><span>${escape(metaLeft)}</span><span>${escape(metaRight)}</span></div>
      </div>`;
    }).join('') + '</div>';
  }

  function renderDonut(containerId, rows, options = {}) {
    const container = element(containerId);
    if (!container) return;
    const filtered = rows.filter((row) => number(row[options.valueKey]) > 0).slice(0, 7);
    const total = filtered.reduce((sum, row) => sum + number(row[options.valueKey]), 0);
    if (!filtered.length || total <= 0) {
      container.innerHTML = emptyChart();
      return;
    }
    const colors = resolveChartColors();
    const radius = 48;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const segments = filtered.map((row, index) => {
      const amount = number(row[options.valueKey]);
      const length = amount / total * circumference;
      const color = options.color ? options.color(row, index) : colors[index % colors.length];
      const label = options.label ? options.label(row) : row.status || row.category || row.segment;
      const result = `<circle class="report-donut__segment" cx="68" cy="68" r="${radius}" stroke="${escape(color)}" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"><title>${escape(`${label}: ${options.format ? options.format(amount) : formatInteger(amount)}`)}</title></circle>`;
      offset += length;
      return result;
    }).join('');
    const legend = filtered.map((row, index) => {
      const amount = number(row[options.valueKey]);
      const color = options.color ? options.color(row, index) : colors[index % colors.length];
      const label = options.label ? options.label(row) : row.status || row.category || row.segment;
      return `<div class="report-legend__item"><span class="report-legend__dot" style="--legend-color:${escape(color)}"></span><span class="report-legend__label" title="${escape(label)}">${escape(label)}</span><strong class="report-legend__value">${escape(options.format ? options.format(amount) : formatInteger(amount))}</strong></div>`;
    }).join('');
    const centerValue = options.centerFormat ? options.centerFormat(total) : formatInteger(total);
    container.innerHTML = `<div class="report-donut-wrap" role="img" aria-label="${escape(`${options.title || 'Distribuição'}. Total: ${centerValue}`)}"><div><svg class="report-donut" viewBox="0 0 136 136"><circle class="report-donut__base" cx="68" cy="68" r="${radius}"></circle>${segments}</svg><div class="report-donut-center"><strong>${escape(centerValue)}</strong><span>${escape(options.centerLabel || 'total')}</span></div></div><div class="report-legend">${legend}</div></div>`;
  }

  function insightHtml(items) {
    if (!items.length) return emptyChart('Ainda não há base para uma análise', 'Assim que houver pedidos no período, as leituras aparecerão aqui.');
    return items.map((item) => `<article class="report-insight report-insight--${escape(item.tone || 'info')}"><span class="report-insight__icon"><i class="fa-solid ${escape(item.icon)}"></i></span><div><strong>${escape(item.title)}</strong><p>${escape(item.text)}</p></div></article>`).join('');
  }

  function overviewInsights(data) {
    const s = data.summary;
    const items = [];
    const change = s.changes.revenue;
    if (change === null && s.revenue > 0) items.push({ tone: 'success', icon: 'fa-sparkles', title: 'Nova receita no comparativo', text: `O período faturou ${formatCurrency(s.revenue)} e o período anterior não teve receita reconhecida.` });
    else if (change > 0) items.push({ tone: 'success', icon: 'fa-arrow-trend-up', title: 'Faturamento em alta', text: `A receita cresceu ${formatDecimal(change)}% sobre o período anterior de mesma duração.` });
    else if (change < 0) items.push({ tone: 'warning', icon: 'fa-arrow-trend-down', title: 'Queda de faturamento', text: `A receita ficou ${formatDecimal(Math.abs(change))}% abaixo do período anterior; vale revisar tráfego, mix e recorrência.` });
    if (data.categories[0]) items.push({ tone: 'info', icon: 'fa-layer-group', title: 'Categoria líder', text: `${data.categories[0].category} respondeu por ${formatDecimal(data.categories[0].share)}% da receita dos itens vendidos.` });
    if (data.customers[0] && s.revenue > 0) {
      const share = number(data.customers[0].revenue) / s.revenue * 100;
      items.push({ tone: share > 35 ? 'warning' : 'info', icon: 'fa-user-check', title: 'Concentração de clientes', text: `${data.customers[0].name} representa ${formatDecimal(share)}% do faturamento filtrado.` });
    }
    if (s.cancellationRate > 10) items.push({ tone: 'danger', icon: 'fa-ban', title: 'Cancelamentos acima de 10%', text: `${formatDecimal(s.cancellationRate)}% dos pedidos do recorte foram cancelados.` });
    else items.push({ tone: 'success', icon: 'fa-circle-check', title: 'Taxa de cancelamento', text: `${formatDecimal(s.cancellationRate)}% dos pedidos foram cancelados no período.` });
    items.push({ tone: s.repeatRate >= 30 ? 'success' : 'info', icon: 'fa-rotate', title: 'Recorrência de compradores', text: `${formatDecimal(s.repeatRate)}% dos compradores fizeram dois ou mais pedidos no recorte.` });
    const critical = data.inventory.filter((row) => row.stockStatus === 'Crítico').length;
    if (critical) items.push({ tone: 'warning', icon: 'fa-boxes-stacked', title: 'Estoque pedindo atenção', text: `${critical} produto(s) ativo(s) da lista de reposição estão com estoque crítico.` });
    return items.slice(0, 6);
  }

  function productInsights(data) {
    const items = [];
    const top = data.products[0];
    if (top) items.push({ tone: 'success', icon: 'fa-trophy', title: 'Produto campeão', text: `${top.name} lidera com ${formatInteger(top.units)} unidade(s) e ${formatCurrency(top.revenue)} em receita.` });
    if (data.categories[0]) items.push({ tone: 'info', icon: 'fa-chart-pie', title: 'Força da categoria', text: `${data.categories[0].category} concentra ${formatDecimal(data.categories[0].share)}% da receita dos produtos.` });
    const critical = data.inventory.filter((row) => row.stockStatus === 'Crítico');
    if (critical.length) items.push({ tone: 'danger', icon: 'fa-triangle-exclamation', title: 'Reposição prioritária', text: `${critical.length} item(ns) estão em nível crítico; o primeiro da fila é ${critical[0].name}.` });
    const warning = data.inventory.filter((row) => row.stockStatus === 'Atenção').length;
    if (warning) items.push({ tone: 'warning', icon: 'fa-box', title: 'Estoque em observação', text: `${warning} produto(s) já atingiram a faixa de atenção considerando estoque atual e demanda do período.` });
    if (data.products.length >= 3) {
      const topThree = data.products.slice(0, 3).reduce((sum, row) => sum + number(row.revenue), 0);
      const total = Math.max(number(data.summary.productRevenue), 1);
      items.push({ tone: topThree / total > .7 ? 'warning' : 'info', icon: 'fa-ranking-star', title: 'Concentração do catálogo', text: `Os três primeiros produtos representam ${formatDecimal(topThree / total * 100)}% da receita de itens.` });
    }
    items.push({ tone: data.summary.changes.unitsSold >= 0 ? 'success' : 'warning', icon: 'fa-cubes', title: 'Ritmo de unidades', text: data.summary.changes.unitsSold === null ? 'O período anterior não teve unidades vendidas para comparação.' : `O volume variou ${formatDecimal(data.summary.changes.unitsSold)}% frente ao período anterior.` });
    return items.slice(0, 6);
  }

  function customerInsights(data) {
    const s = data.summary;
    const items = [];
    items.push({ tone: s.repeatRate >= 30 ? 'success' : 'warning', icon: 'fa-rotate', title: 'Recorrência', text: `${formatDecimal(s.repeatRate)}% dos compradores voltaram a comprar dentro do período selecionado.` });
    if (data.customers[0] && s.revenue > 0) items.push({ tone: 'info', icon: 'fa-crown', title: 'Cliente de maior valor', text: `${data.customers[0].name} gerou ${formatCurrency(data.customers[0].revenue)} em ${formatInteger(data.customers[0].orders)} pedido(s).` });
    if (data.regions[0]) items.push({ tone: 'info', icon: 'fa-location-dot', title: 'Região com mais receita', text: `${data.regions[0].city}${data.regions[0].state ? '/' + data.regions[0].state : ''} lidera com ${formatCurrency(data.regions[0].revenue)}.` });
    items.push({ tone: s.newBuyers > 0 ? 'success' : 'info', icon: 'fa-user-plus', title: 'Novos compradores', text: `${formatInteger(s.newBuyers)} cliente(s) realizaram a primeira compra no período; ${formatInteger(s.accountsCreated)} conta(s) foram criadas.` });
    const risk = data.segments.find((segment) => segment.segment === 'Em risco');
    if (risk && number(risk.customers) > 0) items.push({ tone: 'warning', icon: 'fa-user-clock', title: 'Clientes em risco', text: `${formatInteger(risk.customers)} cliente(s) do recorte estão há mais de 90 dias sem nova compra ao final do período.` });
    items.push({ tone: 'info', icon: 'fa-wallet', title: 'Valor por comprador', text: `Cada comprador gerou, em média, ${formatCurrency(s.averageCustomerValue)} no período.` });
    return items.slice(0, 6);
  }

  function orderInsights(data) {
    const s = data.summary;
    const items = [];
    const pendingShare = s.totalOrders ? s.pendingOrders / s.totalOrders * 100 : 0;
    items.push({ tone: pendingShare > 20 ? 'warning' : 'info', icon: 'fa-hourglass-half', title: 'Pedidos pendentes', text: `${formatInteger(s.pendingOrders)} pedido(s), ou ${formatDecimal(pendingShare)}% do total, ainda aguardam pagamento ou confirmação.` });
    items.push({ tone: s.cancellationRate > 10 ? 'danger' : 'success', icon: 'fa-ban', title: 'Cancelamentos', text: `A taxa de cancelamento no recorte é de ${formatDecimal(s.cancellationRate)}%.` });
    const weekday = [...data.weekdays].sort((a, b) => number(b.orders) - number(a.orders))[0];
    if (weekday && number(weekday.orders) > 0) items.push({ tone: 'info', icon: 'fa-calendar-day', title: 'Dia mais movimentado', text: `${weekday.label} concentra o maior volume, com ${formatInteger(weekday.orders)} pedido(s).` });
    const hour = [...data.hours].sort((a, b) => number(b.orders) - number(a.orders))[0];
    if (hour && number(hour.orders) > 0) items.push({ tone: 'info', icon: 'fa-clock', title: 'Horário de pico', text: `A faixa das ${String(hour.hour).padStart(2, '0')}h registrou o maior número de pedidos (${formatInteger(hour.orders)}).` });
    if (data.highValueOrders[0]) items.push({ tone: 'success', icon: 'fa-gem', title: 'Maior pedido', text: `O pedido #${data.highValueOrders[0].number} alcançou ${formatCurrency(data.highValueOrders[0].total)}.` });
    const change = s.changes.averageTicket;
    if (change !== undefined) items.push({ tone: change === null || change >= 0 ? 'success' : 'warning', icon: 'fa-receipt', title: 'Evolução do ticket', text: change === null ? 'O período anterior não teve ticket reconhecido para comparação.' : `O ticket médio variou ${formatDecimal(change)}% em relação ao período anterior.` });
    return items.slice(0, 6);
  }

  function renderInventoryTable(rows) {
    const container = element('report-inventory-table');
    if (!container) return;
    if (!rows.length) { container.innerHTML = emptyChart(); return; }
    const pillClass = { Crítico: 'critical', Atenção: 'warning', Saudável: 'healthy' };
    container.innerHTML = `<table class="report-table"><thead><tr><th>Produto</th><th>Categoria</th><th>Vendidos</th><th>Estoque</th><th>Situação</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escape(row.name)}</strong></td><td>${escape(row.category)}</td><td>${formatInteger(row.units)}</td><td>${formatInteger(row.stock)}</td><td><span class="report-stock-pill report-stock-pill--${pillClass[row.stockStatus] || 'healthy'}">${escape(row.stockStatus)}</span></td></tr>`).join('')}</tbody></table>`;
  }

  function segmentClass(segment) {
    return { VIP: 'vip', Recorrente: 'recurring', Novo: 'new', Ocasional: 'occasional', 'Em risco': 'risk' }[segment] || 'occasional';
  }

  function renderCustomerTable(rows) {
    const container = element('report-customer-table');
    if (!container) return;
    if (!rows.length) { container.innerHTML = emptyChart(); return; }
    container.innerHTML = `<table class="report-table"><thead><tr><th>Cliente</th><th>Localização</th><th>Pedidos</th><th>Unidades</th><th>Faturamento</th><th>Ticket médio</th><th>Última compra</th><th>Segmento</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escape(row.name)}</strong></td><td>${escape(`${row.city}${row.state ? '/' + row.state : ''}`)}</td><td>${formatInteger(row.orders)}</td><td>${formatInteger(row.units)}</td><td><strong>${formatCurrency(row.revenue)}</strong></td><td>${formatCurrency(row.averageTicket)}</td><td>${dateTimeLabel(row.lastOrderAt)}</td><td><span class="report-segment-pill report-segment-pill--${segmentClass(row.segment)}">${escape(row.segment)}</span></td></tr>`).join('')}</tbody></table>`;
  }

  function renderHighValueTable(rows) {
    const container = element('report-high-value-table');
    if (!container) return;
    if (!rows.length) { container.innerHTML = emptyChart(); return; }
    container.innerHTML = `<table class="report-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Status</th><th>Valor</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>#${escape(row.number)}</strong></td><td>${escape(row.customerName)}</td><td>${dateTimeLabel(row.createdAt)}</td><td>${Utils.statusBadgeHtml(row.status)}</td><td><strong>${formatCurrency(row.total)}</strong></td></tr>`).join('')}</tbody></table>`;
  }

  function renderHeatmap(rows) {
    const container = element('report-hour-heatmap');
    if (!container) return;
    const max = Math.max(...rows.map((row) => number(row.orders)), 0);
    if (!rows.length || max === 0) { container.innerHTML = emptyChart(); return; }
    container.innerHTML = rows.map((row) => {
      const level = 5 + number(row.orders) / max * 35;
      return `<div class="report-hour-cell" style="--heat-level:${level.toFixed(1)}%" title="${escape(`${formatInteger(row.orders)} pedido(s), ${formatCurrency(row.revenue)}`)}"><strong>${String(row.hour).padStart(2, '0')}h</strong><span>${formatInteger(row.orders)} ped.</span></div>`;
    }).join('');
  }

  function renderOverview(data) {
    const s = data.summary;
    renderKpis('report-overview-kpis', [
      { icon: 'fa-sack-dollar', tone: 'var(--color-success)', value: formatCurrency(s.revenue), label: 'Faturamento reconhecido', hint: 'Pedidos pagos e em andamento', change: s.changes.revenue },
      { icon: 'fa-receipt', tone: 'var(--color-primary)', value: formatInteger(s.totalOrders), label: 'Pedidos no período', hint: `${formatInteger(s.paidOrders)} com receita reconhecida`, change: s.changes.totalOrders },
      { icon: 'fa-chart-line', tone: 'var(--color-accent)', value: formatCurrency(s.averageTicket), label: 'Ticket médio', hint: 'Receita por pedido pago', change: s.changes.averageTicket },
      { icon: 'fa-cubes-stacked', tone: 'var(--color-info)', value: formatInteger(s.unitsSold), label: 'Unidades vendidas', hint: `${formatDecimal(s.averageItemsPerPaidOrder)} por pedido pago`, change: s.changes.unitsSold },
      { icon: 'fa-users', tone: '#8B6CE7', value: formatInteger(s.buyers), label: 'Clientes compradores', hint: `${formatDecimal(s.repeatRate)}% recorrentes`, change: s.changes.buyers }
    ]);
    renderLineChart('report-overview-revenue-chart', data.timeline, 'revenue', { title: 'Faturamento ao longo do tempo', format: formatCompactCurrency });
    renderDonut('report-overview-status-chart', data.statuses, { valueKey: 'orders', title: 'Pedidos por status', centerLabel: 'pedidos', color: (row) => STATUS_COLORS[row.status] || '#D99163' });
    renderBars('report-overview-category-chart', data.categories, { valueKey: 'revenue', title: 'Categorias por receita', format: formatCompactCurrency, label: (row) => row.category, metaLeft: (row) => `${formatInteger(row.units)} un.`, metaRight: (row) => `${formatDecimal(row.share)}%` });
    renderBars('report-overview-customer-chart', data.customers, { valueKey: 'revenue', title: 'Clientes por receita', format: formatCompactCurrency, label: (row) => row.name, metaLeft: (row) => `${formatInteger(row.orders)} ped.`, metaRight: (row) => row.segment });
    renderBars('report-overview-product-chart', data.products, { valueKey: 'units', title: 'Produtos por unidades', format: formatInteger, label: (row) => row.name, metaLeft: (row) => row.category, metaRight: (row) => formatCompactCurrency(row.revenue) });
    element('report-overview-insights').innerHTML = insightHtml(overviewInsights(data));
  }

  function renderProducts(data) {
    const s = data.summary;
    const top = data.products[0];
    const category = data.categories[0];
    const averageUnitPrice = s.unitsSold ? s.productRevenue / s.unitsSold : 0;
    renderKpis('report-product-kpis', [
      { icon: 'fa-cubes', tone: 'var(--color-info)', value: formatInteger(s.unitsSold), label: 'Unidades vendidas', hint: `${formatInteger(s.distinctProducts)} produtos diferentes`, change: s.changes.unitsSold },
      { icon: 'fa-money-bill-trend-up', tone: 'var(--color-success)', value: formatCurrency(s.productRevenue), label: 'Receita dos produtos', hint: 'Sem incluir frete' },
      { icon: 'fa-trophy', tone: 'var(--color-accent)', value: top ? top.name : '—', label: 'Produto mais vendido', hint: top ? `${formatInteger(top.units)} unidade(s)` : 'Sem vendas no período' },
      { icon: 'fa-layer-group', tone: '#8B6CE7', value: category ? category.category : '—', label: 'Categoria líder', hint: category ? `${formatDecimal(category.share)}% da receita` : 'Sem vendas no período' },
      { icon: 'fa-tag', tone: 'var(--color-primary)', value: formatCurrency(averageUnitPrice), label: 'Preço médio por unidade', hint: 'Receita de itens ÷ unidades' }
    ]);
    renderLineChart('report-product-timeline-chart', data.timeline, 'units', { title: 'Unidades vendidas ao longo do tempo', format: formatInteger });
    renderDonut('report-product-category-chart', data.categories, { valueKey: 'revenue', title: 'Receita por categoria', centerLabel: 'em produtos', centerFormat: formatCompactCurrency, format: formatCompactCurrency, label: (row) => row.category });
    renderBars('report-product-ranking-chart', data.products, { limit: 10, valueKey: 'revenue', title: 'Produtos por faturamento', format: formatCompactCurrency, label: (row) => row.name, metaLeft: (row) => `${formatInteger(row.units)} un.`, metaRight: (row) => `${formatInteger(row.orders)} ped.` });
    renderInventoryTable(data.inventory);
    element('report-product-analysis').innerHTML = insightHtml(productInsights(data));
  }

  function renderCustomers(data) {
    const s = data.summary;
    const top = data.customers[0];
    renderKpis('report-customer-kpis', [
      { icon: 'fa-users', tone: 'var(--color-info)', value: formatInteger(s.buyers), label: 'Clientes compradores', hint: 'Com pedido de receita reconhecida', change: s.changes.buyers },
      { icon: 'fa-user-plus', tone: 'var(--color-success)', value: formatInteger(s.newBuyers), label: 'Novos compradores', hint: `${formatInteger(s.accountsCreated)} novas contas` },
      { icon: 'fa-rotate', tone: '#8B6CE7', value: `${formatDecimal(s.repeatRate)}%`, label: 'Taxa de recorrência', hint: `${formatInteger(s.repeatBuyers)} compradores recorrentes` },
      { icon: 'fa-wallet', tone: 'var(--color-accent)', value: formatCurrency(s.averageCustomerValue), label: 'Valor médio por cliente', hint: 'Receita por comprador' },
      { icon: 'fa-crown', tone: 'var(--color-primary)', value: top ? top.name : '—', label: 'Cliente de maior valor', hint: top ? formatCurrency(top.revenue) : 'Sem compras no período' }
    ]);
    renderLineChart('report-customer-timeline-chart', data.timeline, 'buyers', { title: 'Compradores ativos ao longo do tempo', format: formatInteger });
    renderDonut('report-customer-segment-chart', data.segments, { valueKey: 'customers', title: 'Clientes por segmento', centerLabel: 'clientes', label: (row) => row.segment });
    renderBars('report-customer-ranking-chart', data.customers, { limit: 10, valueKey: 'revenue', title: 'Clientes por faturamento', format: formatCompactCurrency, label: (row) => row.name, metaLeft: (row) => `${formatInteger(row.orders)} ped.`, metaRight: (row) => `${formatInteger(row.units)} un.` });
    renderBars('report-region-chart', data.regions, { limit: 10, valueKey: 'revenue', title: 'Cidades por faturamento', format: formatCompactCurrency, label: (row) => `${row.city}${row.state ? '/' + row.state : ''}`, metaLeft: (row) => `${formatInteger(row.buyers)} clientes`, metaRight: (row) => `${formatInteger(row.orders)} ped.` });
    renderCustomerTable(data.customers);
    element('report-customer-analysis').innerHTML = insightHtml(customerInsights(data));
  }

  function renderOrders(data) {
    const s = data.summary;
    renderKpis('report-order-kpis', [
      { icon: 'fa-receipt', tone: 'var(--color-primary)', value: formatInteger(s.totalOrders), label: 'Total de pedidos', hint: `${formatCurrency(s.grossOrderValue)} em valor bruto`, change: s.changes.totalOrders },
      { icon: 'fa-circle-check', tone: 'var(--color-success)', value: formatInteger(s.paidOrders), label: 'Pedidos reconhecidos', hint: 'Pagos e em andamento', change: s.changes.paidOrders },
      { icon: 'fa-hourglass-half', tone: 'var(--color-warning)', value: formatInteger(s.pendingOrders), label: 'Pedidos pendentes', hint: 'Aguardando pagamento/confirmação' },
      { icon: 'fa-ban', tone: 'var(--color-danger)', value: `${formatDecimal(s.cancellationRate)}%`, label: 'Taxa de cancelamento', hint: `${formatInteger(s.cancelledOrders)} cancelado(s)` },
      { icon: 'fa-chart-simple', tone: 'var(--color-accent)', value: formatCurrency(s.averageTicket), label: 'Ticket médio pago', hint: `${formatDecimal(s.averageItemsPerPaidOrder)} itens por pedido`, change: s.changes.averageTicket }
    ]);
    renderColumnChart('report-order-timeline-chart', data.timeline, 'orders', { title: 'Pedidos ao longo do tempo', format: formatInteger });
    renderDonut('report-order-status-chart', data.statuses, { valueKey: 'orders', title: 'Pedidos por status', centerLabel: 'pedidos', color: (row) => STATUS_COLORS[row.status] || '#D99163' });
    renderColumnChart('report-order-value-chart', data.valueBands, 'orders', { title: 'Pedidos por faixa de valor', format: formatInteger, labelKey: 'label' });
    renderColumnChart('report-weekday-chart', data.weekdays, 'orders', { title: 'Pedidos por dia da semana', format: formatInteger, labelKey: 'label' });
    renderHeatmap(data.hours);
    renderHighValueTable(data.highValueOrders);
    element('report-order-analysis').innerHTML = insightHtml(orderInsights(data));
  }

  function renderAll(data) {
    renderActiveFilters(data);
    renderOverview(data);
    renderProducts(data);
    renderCustomers(data);
    renderOrders(data);
    element('reports-content')?.classList.remove('is-hidden');
  }

  function loadReport() {
    const sequence = ++requestSequence;
    clearError();
    setLoading(true);
    return DataService.Reports.get(currentFilters()).then((data) => {
      if (sequence !== requestSequence) return;
      reportData = data;
      hasLoadedReport = true;
      renderAll(data);
    }).catch((err) => {
      if (sequence !== requestSequence) return;
      showError(err.message || 'Não foi possível montar o relatório.');
    }).finally(() => {
      if (sequence === requestSequence) setLoading(false);
    });
  }

  function switchReportView(viewName, focusTab = false) {
    if (!VIEW_NAMES[viewName]) return;
    activeView = viewName;
    document.querySelectorAll('[data-report-tab]').forEach((button) => {
      const active = button.dataset.reportTab === viewName;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focusTab) button.focus();
    });
    document.querySelectorAll('[data-report-view]').forEach((view) => {
      const active = view.dataset.reportView === viewName;
      view.classList.toggle('is-active', active);
      view.hidden = !active;
    });
  }

  function csvCell(value) {
    let text = String(value == null ? '' : value).replace(/\r?\n/g, ' ');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportRows() {
    if (!reportData) return { headers: [], rows: [] };
    if (activeView === 'products') return {
      headers: ['Produto', 'Categoria', 'Unidades', 'Faturamento', 'Pedidos', 'Participação (%)', 'Estoque'],
      rows: reportData.products.map((row) => [row.name, row.category, row.units, row.revenue, row.orders, row.share, row.stock])
    };
    if (activeView === 'customers') return {
      headers: ['Cliente', 'Cidade', 'UF', 'Pedidos', 'Unidades', 'Faturamento', 'Ticket médio', 'Última compra', 'Segmento'],
      rows: reportData.customers.map((row) => [row.name, row.city, row.state, row.orders, row.units, row.revenue, row.averageTicket, row.lastOrderAt, row.segment])
    };
    if (activeView === 'orders') return {
      headers: ['Período', 'Pedidos', 'Faturamento', 'Unidades', 'Compradores'],
      rows: reportData.timeline.map((row) => [row.period, row.orders, row.revenue, row.units, row.buyers])
    };
    return {
      headers: ['Período', 'Faturamento', 'Pedidos', 'Unidades', 'Compradores'],
      rows: reportData.timeline.map((row) => [row.period, row.revenue, row.orders, row.units, row.buyers])
    };
  }

  function exportCsv() {
    if (!reportData) return;
    const table = exportRows();
    const lines = [table.headers, ...table.rows].map((row) => row.map(csvCell).join(';'));
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-${activeView}-${reportData.meta.startDate}-a-${reportData.meta.endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    Utils.showToast(`Relatório de ${VIEW_NAMES[activeView].toLowerCase()} exportado.`, 'success');
  }

  function wireEvents() {
    element('reports-filter-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      loadReport();
    });
    element('report-period-preset')?.addEventListener('change', (event) => applyPreset(event.target.value));
    ['report-start-date', 'report-end-date'].forEach((id) => element(id)?.addEventListener('change', () => {
      const preset = element('report-period-preset');
      if (preset) preset.value = 'custom';
    }));
    element('reports-clear-btn')?.addEventListener('click', () => {
      const form = element('reports-filter-form');
      if (form) form.reset();
      const preset = element('report-period-preset');
      if (preset) preset.value = '30d';
      applyPreset('30d');
      loadReport();
    });
    element('reports-refresh-btn')?.addEventListener('click', loadReport);
    element('reports-export-btn')?.addEventListener('click', exportCsv);
    element('reports-print-btn')?.addEventListener('click', () => global.print());

    const tabs = Array.from(document.querySelectorAll('[data-report-tab]'));
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => switchReportView(tab.dataset.reportTab));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        switchReportView(tabs[nextIndex].dataset.reportTab, true);
      });
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    wireEvents();
    applyPreset('30d');
    switchReportView('overview');
  }

  function onAdminTabActivated() {
    init();
    return loadFilterOptions().then(() => {
      if (!hasLoadedReport) return loadReport();
      return reportData;
    }).catch((err) => showError(err.message || 'Não foi possível carregar os filtros dos relatórios.'));
  }

  global.AdminReportsModule = {
    init,
    onAdminTabActivated,
    refresh: loadReport,
    switchView: switchReportView
  };
})(window);
