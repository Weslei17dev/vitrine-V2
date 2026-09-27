'use strict';

const { ValidationError } = require('../validation');

function toCents(value) {
  return Math.round(Number(value) * 100);
}

function calculateOrder(requestedItems, productRows, shippingCents = 0) {
  const productsById = new Map(productRows.map((product) => [product.id, product]));
  let subtotalCents = 0;
  const items = requestedItems.map((requested) => {
    const product = productsById.get(requested.productId);
    if (!product || !product.active) throw new ValidationError('Um dos produtos não está mais disponível.');
    if (Number(product.stock) < requested.qty) {
      throw new ValidationError(`Estoque insuficiente para ${product.name}. Disponível: ${product.stock}.`);
    }
    const unitCents = toCents(product.price);
    if (!Number.isSafeInteger(unitCents) || unitCents <= 0) throw new ValidationError(`Preço inválido para ${product.name}.`);
    const lineCents = unitCents * requested.qty;
    subtotalCents += lineCents;
    return {
      productId: product.id,
      name: product.name,
      price: unitCents / 100,
      qty: requested.qty,
      subtotal: lineCents / 100,
      unitCost: product.cost_price == null ? null : toCents(product.cost_price) / 100
    };
  });
  if (!Number.isSafeInteger(shippingCents) || shippingCents < 0) throw new ValidationError('Frete inválido.');
  if (subtotalCents + shippingCents > 9999999999) {
    throw new ValidationError('O valor total do pedido ultrapassa o limite permitido.');
  }
  return {
    items,
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents
  };
}

module.exports = { calculateOrder };
