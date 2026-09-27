'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/validation');

test('normaliza e valida dados de cadastro', () => {
  assert.equal(V.normalizeEmail('  Cliente@Email.com '), 'cliente@email.com');
  assert.equal(V.phone('(43) 99999-1234'), '43999991234');
  assert.equal(V.zip('86700-000'), '86700000');
  assert.equal(V.state('pr'), 'PR');
});

test('aceita senha sem limite de caracteres, mas rejeita vazio', () => {
  assert.throws(() => V.password(''), /obrigatória/);
  assert.equal(V.password('123'), '123');
  assert.equal(V.password('x'.repeat(500)), 'x'.repeat(500));
  assert.equal(V.password('SenhaSegura123'), 'SenhaSegura123');
});

test('valida quantidades, dinheiro e imagens', () => {
  assert.equal(V.positiveInteger('2', 'Quantidade', 99), 2);
  assert.equal(V.positiveMoney('19.90'), 19.9);
  assert.equal(V.nonNegativeMoney('0'), 0);
  assert.equal(V.optionalMoney(''), null);
  assert.match(V.timestamp('2026-08-20T12:00:00Z'), /^2026-08-20T12:00:00\.000Z$/);
  assert.equal(V.imageSource('img/produto.jpg'), 'img/produto.jpg');
  assert.throws(() => V.imageSource('javascript:alert(1)'), /inválido/);
  assert.throws(() => V.positiveInteger(-1, 'Quantidade'), /inválida/);
  assert.throws(() => V.nonNegativeMoney(-1), /inválido/);
});
