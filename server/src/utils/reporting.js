'use strict';

const V = require('../validation');

const REPORT_TIMEZONE = 'America/Sao_Paulo';
const REPORT_STATUSES = new Set([
  'Aguardando Pagamento',
  'Aguardando Confirmação',
  'Pago',
  'Em Produção',
  'Enviado',
  'Finalizado',
  'Cancelado'
]);
const REPORT_GRANULARITIES = new Set(['day', 'week', 'month']);
const MAX_REPORT_DAYS = 3660;

function isoDateInTimezone(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseIsoDate(value, label) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new V.ValidationError(`${label} inválida.`);
  }
  const date = new Date(`${normalized}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new V.ValidationError(`${label} inválida.`);
  }
  return normalized;
}

function shiftIsoDate(value, amount) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function inclusiveDayCount(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  return Math.round((end - start) / 86400000) + 1;
}

function automaticGranularity(days) {
  if (days <= 45) return 'day';
  if (days <= 210) return 'week';
  return 'month';
}

function optionalUuid(value, label) {
  return value ? V.uuid(value, label) : null;
}

function optionalText(value, label, max) {
  return value ? V.text(value, label, { required: false, max }) : null;
}

function parseReportFilters(query = {}, now = new Date()) {
  const today = isoDateInTimezone(now);
  const endDate = parseIsoDate(query.endDate || today, 'Data final');
  const startDate = parseIsoDate(query.startDate || shiftIsoDate(endDate, -29), 'Data inicial');
  const days = inclusiveDayCount(startDate, endDate);

  if (days < 1) throw new V.ValidationError('A data inicial deve ser anterior ou igual à data final.');
  if (days > MAX_REPORT_DAYS) {
    throw new V.ValidationError(`O período máximo para um relatório é de ${MAX_REPORT_DAYS} dias.`);
  }

  const requestedGranularity = String(query.granularity || 'auto');
  const granularity = requestedGranularity === 'auto'
    ? automaticGranularity(days)
    : requestedGranularity;
  if (!REPORT_GRANULARITIES.has(granularity)) {
    throw new V.ValidationError('Agrupamento do relatório inválido.');
  }

  const status = optionalText(query.status, 'Status', 40);
  if (status && !REPORT_STATUSES.has(status)) {
    throw new V.ValidationError('Status do relatório inválido.');
  }

  const previousEndDate = shiftIsoDate(startDate, -1);
  const previousStartDate = shiftIsoDate(previousEndDate, -(days - 1));

  return {
    startDate,
    endDate,
    previousStartDate,
    previousEndDate,
    days,
    granularity,
    customerId: optionalUuid(query.customerId, 'Cliente'),
    productId: optionalUuid(query.productId, 'Produto'),
    category: optionalText(query.category, 'Categoria', 80),
    status,
    timezone: REPORT_TIMEZONE
  };
}

function percentChange(currentValue, previousValue) {
  const current = Number(currentValue) || 0;
  const previous = Number(previousValue) || 0;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

module.exports = {
  REPORT_TIMEZONE,
  REPORT_STATUSES,
  REPORT_GRANULARITIES,
  MAX_REPORT_DAYS,
  isoDateInTimezone,
  shiftIsoDate,
  inclusiveDayCount,
  automaticGranularity,
  parseReportFilters,
  percentChange
};
