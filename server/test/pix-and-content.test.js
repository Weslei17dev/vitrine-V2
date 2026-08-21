'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pixPayload = require('../src/utils/pixPayload');
const { SITE_CONTENT_DEFAULTS, deepMerge } = require('../src/site-defaults');

test('gera payload PIX com valor calculado', () => {
  const payload = pixPayload.build({
    chave: 'financeiro@example.com',
    nome: 'Brincar de Desejo',
    cidade: 'Arapongas',
    valor: 19.9,
    txid: 'PEDIDO000001'
  });
  assert.match(payload, /^000201/);
  assert.ok(payload.includes('540519.90'));
  assert.match(payload, /6304[0-9A-F]{4}$/);
});

test('recusa PIX sem configuração', () => {
  assert.throws(() => pixPayload.build({ chave: '', nome: '', cidade: '', valor: 10 }), /não está configurada/);
  assert.throws(() => pixPayload.build({
    chave: 'SUA_CHAVE_PIX_AQUI', nome: 'Loja', cidade: 'Arapongas', valor: 10
  }), /não está configurada/);
});

test('restaura campos ausentes do conteúdo sem apagar personalizações', () => {
  const merged = deepMerge(SITE_CONTENT_DEFAULTS, { hero: { title: 'Minha loja' } });
  assert.equal(merged.hero.title, 'Minha loja');
  assert.equal(merged.hero.ctaText, SITE_CONTENT_DEFAULTS.hero.ctaText);
  assert.ok(Array.isArray(merged.faq));
  assert.equal(merged.shipping.estimatedDays, 7);
  assert.ok(merged.carousel.every((slide) => slide.title && slide.ctaText && slide.ctaTarget));
});
