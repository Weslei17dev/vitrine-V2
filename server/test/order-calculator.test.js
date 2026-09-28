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
    productId: 'produto-1', name: 'Produto real', selectedColor: null, price: 29.9, qty: 2, subtotal: 59.8, unitCost: null
  });
});

test('valida cor cadastrada e soma o estoque entre cores', () => {
  const product = [{id:'p1',name:'Conjunto',price:40,stock:3,active:true,colors:[{name:'Bege',hex:'#ccbbaa'},{name:'Preto',hex:'#000000'}]}];
  const rows = [{productId:'p1',qty:2,selectedColor:'Bege'},{productId:'p1',qty:1,selectedColor:'Preto'}];
  assert.deepEqual(calculateOrder(rows,product).items.map((item) => item.selectedColor),['Bege','Preto']);
  assert.throws(() => calculateOrder([...rows,{productId:'p1',qty:1,selectedColor:'Bege'}],product),/Estoque insuficiente/);
  assert.throws(() => calculateOrder([{productId:'p1',qty:1,selectedColor:'Azul'}],product),/Selecione uma cor/);
});

test('registra o custo do banco no momento da venda sem aceitar custo do cliente', () => {
  const result = calculateOrder([{productId:'p1', qty:2, unitCost:0}], [{id:'p1', name:'Produto', price:80, cost_price:50, stock:3, active:true}]);
  assert.equal(result.items[0].unitCost, 50);
  assert.equal(result.totalCents, 16000);
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

test('inclui o frete no total sem confiar em valores enviados pelo cliente', () => {
  const result = calculateOrder(
    [{ productId: 'p1', qty: 2, price: 0.01 }],
    [{ id: 'p1', name: 'Produto', price: 10, stock: 5, active: true }],
    1590
  );
  assert.equal(result.subtotalCents, 2000);
  assert.equal(result.shippingCents, 1590);
  assert.equal(result.totalCents, 3590);
});
