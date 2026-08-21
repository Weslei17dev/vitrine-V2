'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseReportFilters,
  automaticGranularity,
  inclusiveDayCount,
  percentChange
} = require('../src/utils/reporting');

test('monta período padrão de 30 dias e período anterior equivalente', () => {
  const filters = parseReportFilters({}, new Date('2026-08-21T15:00:00Z'));
  assert.equal(filters.startDate, '2026-07-23');
  assert.equal(filters.endDate, '2026-08-21');
  assert.equal(filters.previousStartDate, '2026-06-23');
  assert.equal(filters.previousEndDate, '2026-07-22');
  assert.equal(filters.days, 30);
  assert.equal(filters.granularity, 'day');
});

test('valida datas, status, granularidade e intervalo máximo', () => {
  assert.throws(() => parseReportFilters({ startDate: '2026-02-30', endDate: '2026-03-01' }), /Data inicial inválida/);
  assert.throws(() => parseReportFilters({ startDate: '2026-03-02', endDate: '2026-03-01' }), /data inicial/i);
  assert.throws(() => parseReportFilters({ status: 'Inventado' }), /Status do relatório inválido/);
  assert.throws(() => parseReportFilters({ granularity: 'hour' }), /Agrupamento do relatório inválido/);
  assert.throws(() => parseReportFilters({ startDate: '2010-01-01', endDate: '2026-01-01' }), /período máximo/i);
});

test('escolhe agrupamento legível conforme o tamanho do período', () => {
  assert.equal(automaticGranularity(45), 'day');
  assert.equal(automaticGranularity(46), 'week');
  assert.equal(automaticGranularity(210), 'week');
  assert.equal(automaticGranularity(211), 'month');
  assert.equal(inclusiveDayCount('2024-02-01', '2024-02-29'), 29);
});

test('calcula variação sem transformar divisão por zero em dado enganoso', () => {
  assert.equal(percentChange(120, 100), 20);
  assert.equal(percentChange(80, 100), -20);
  assert.equal(percentChange(0, 0), 0);
  assert.equal(percentChange(10, 0), null);
});

test('aceita filtros válidos e calcula comparação com a mesma duração', () => {
  const filters = parseReportFilters({
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    granularity: 'month',
    status: 'Finalizado',
    category: 'Lingerie',
    customerId: '11111111-1111-4111-8111-111111111111',
    productId: '22222222-2222-4222-8222-222222222222'
  });
  assert.equal(filters.days, 90);
  assert.equal(filters.previousStartDate, '2025-10-03');
  assert.equal(filters.previousEndDate, '2025-12-31');
  assert.equal(filters.category, 'Lingerie');
  assert.equal(filters.status, 'Finalizado');
});
