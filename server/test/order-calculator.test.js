'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrder } = require('../src/utils/orderCalculator');

test('calcula preços somente com os valores do banco', () => {
  const requested = [{ productId: 'produto-1', qty: 2, price: 0.01, name: 'Falso' }];
  const products = [{ id: 'produto-1', name: 'Produto real', price: '29.90', stock: 5, active: true }];
  const result = calculateOrder(requested, products);
  assert.equal(result.totalCents, 5980);
  assert.deepEqual(result.items[0], {
    productId: 'produto-1', name: 'Produto real', price: 29.9, qty: 2, subtotal: 59.8
  });
});

test('recusa produto inativo e estoque insuficiente', () => {
  assert.throws(() => calculateOrder(
    [{ productId: 'p1', qty: 1 }],
    [{ id: 'p1', name: 'Produto', price: 10, stock: 5, active: false }]
  ), /não está mais disponível/);
  assert.throws(() => calculateOrder(
    [{ productId: 'p1', qty: 3 }],
    [{ id: 'p1', name: 'Produto', price: 10, stock: 2, active: true }]
  ), /Estoque insuficiente/);
});
