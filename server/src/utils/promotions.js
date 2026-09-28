'use strict';

const { ValidationError } = require('../validation');
const { calculateOrder } = require('./orderCalculator');

const cents = (value) => Math.round(Number(value) * 100);

function normalizeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (code && !/^[A-Z0-9_-]{3,32}$/.test(code)) throw new ValidationError('O cupom deve ter de 3 a 32 letras, números, _ ou -.');
  return code;
}

function currentlyValid(rule, now = new Date()) {
  return rule.active && (!rule.starts_at || new Date(rule.starts_at) <= now) &&
    (!rule.ends_at || new Date(rule.ends_at) > now);
}

function applies(rule, product) {
  return rule.scope === 'all' ||
    (rule.scope === 'product' && rule.product_id === product.id) ||
    (rule.scope === 'category' && String(rule.category).toLowerCase() === String(product.category).toLowerCase());
}

function amountCents(rule, eligibleCents) {
  if (rule.discount_type === 'free_shipping') return 0;
  return rule.discount_type === 'percent'
    ? Math.round(eligibleCents * Number(rule.value) / 100)
    : cents(rule.value);
}

async function activeAutomatic(database) {
  const result = await database.query("SELECT * FROM promotions WHERE kind='automatic' AND active=true AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())");
  return result.rows;
}

function priceForProduct(product, rules) {
  const originalCents = cents(product.price);
  let best = 0;
  for (const rule of rules) {
    if (rule.discount_type === 'free_shipping') continue;
    if (applies(rule, product)) best = Math.max(best, Math.min(originalCents - 1, amountCents(rule, originalCents)));
  }
  const discount = Math.max(0, best);
  return { ...product, price: (originalCents - discount) / 100,
    compare_at_price: discount ? Math.max(originalCents, cents(product.compare_at_price || 0)) / 100 : product.compare_at_price,
    automatic_discount_cents: discount };
}

async function readCoupon(database, code, { lock = false } = {}) {
  if (!code) return null;
  const result = await database.query(`SELECT * FROM promotions WHERE kind='coupon' AND code=$1 ${lock ? 'FOR UPDATE' : ''}`, [code]);
  const coupon = result.rows[0];
  if (!coupon || !currentlyValid(coupon) || (coupon.max_uses != null && coupon.used_count >= coupon.max_uses)) {
    throw new ValidationError('Este cupom não existe, expirou ou atingiu o limite de uso.');
  }
  return coupon;
}

async function priceOrder(database, requestedItems, products, couponCode, shippingForSubtotal, { lockCoupon = false } = {}) {
  const rules = await activeAutomatic(database);
  const coupon = await readCoupon(database, couponCode, { lock: lockCoupon });
  const priced = products.map((product) => priceForProduct(product, rules));
  const calculated = calculateOrder(requestedItems, priced);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const automaticCents = calculated.items.reduce((sum, item) => {
    const original = productsById.get(item.productId);
    return sum + (cents(original.price) - cents(item.price)) * item.qty;
  }, 0);
  let couponCents = 0;
  let shippingDiscountCents = 0;
  if (coupon) {
    const eligible = calculated.items.filter((item) => applies(coupon, productsById.get(item.productId)));
    const eligibleCents = eligible.reduce((sum, item) => sum + cents(item.subtotal), 0);
    if (!eligibleCents) throw new ValidationError('Este cupom não se aplica aos produtos do carrinho.');
    if (coupon.discount_type !== 'free_shipping') {
      couponCents = Math.min(eligibleCents, calculated.subtotalCents - 1, amountCents(coupon, eligibleCents));
      if (couponCents < 1) throw new ValidationError('Este cupom não pode reduzir mais o valor do carrinho.');
      let allocated = 0;
      eligible.forEach((item, index) => {
        const part = index === eligible.length - 1 ? couponCents - allocated : Math.floor(couponCents * cents(item.subtotal) / eligibleCents);
        item.couponDiscount = part / 100;
        item.subtotal = (cents(item.subtotal) - part) / 100;
        allocated += part;
      });
    }
  }
  const subtotalCents = calculated.subtotalCents - couponCents;
  const baseShippingCents = shippingForSubtotal(subtotalCents);
  if (coupon?.discount_type === 'free_shipping') shippingDiscountCents = baseShippingCents;
  const shippingCents = baseShippingCents - shippingDiscountCents;
  if (subtotalCents + shippingCents > 9999999999) throw new ValidationError('O valor total do pedido ultrapassa o limite permitido.');
  return {
    items: calculated.items, subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents,
    automaticCents, couponCents, shippingDiscountCents, baseShippingCents,
    grossSubtotalCents: calculated.subtotalCents + automaticCents, coupon
  };
}

module.exports = { normalizeCode, currentlyValid, applies, priceForProduct, activeAutomatic, priceOrder };
