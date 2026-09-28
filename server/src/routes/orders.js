'use strict';

const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../auth-middleware');
const { orderLimiter } = require('../security');
const { SITE_CONTENT_DEFAULTS, deepMerge } = require('../site-defaults');
const V = require('../validation');
const pixPayload = require('../utils/pixPayload');
const { normalizeCode, priceOrder } = require('../utils/promotions');
const config = require('../config');
const { cancelLockedOrder, expirePendingOrders, releaseCoupon } = require('../utils/orderLifecycle');
const { recordAudit } = require('../utils/audit');

const router = express.Router();

const STATUS_FLOW = ['Aguardando Pagamento', 'Aguardando Confirmação', 'Pago', 'Em Produção', 'Enviado', 'Finalizado'];
const STATUS_CANCELLED = 'Cancelado';
const ALL_STATUSES = new Set([...STATUS_FLOW, STATUS_CANCELLED]);
const TRANSITIONS = {
  'Aguardando Pagamento': new Set(['Aguardando Confirmação', 'Pago', 'Cancelado']),
  'Aguardando Confirmação': new Set(['Aguardando Pagamento', 'Pago', 'Cancelado']),
  Pago: new Set(['Em Produção', 'Cancelado']),
  'Em Produção': new Set(['Enviado', 'Cancelado']),
  Enviado: new Set(['Finalizado']),
  Finalizado: new Set(),
  Cancelado: new Set()
};

function toPublicOrder(row) {
  return {
    id: row.id,
    number: row.number,
    userId: row.user_id,
    customerName: row.customer_name,
    shipping: {
      phone: row.shipping_phone,
      address: row.shipping_address,
      city: row.shipping_city,
      state: row.shipping_state,
      zip: row.shipping_zip
    },
    items: Array.isArray(row.items) ? row.items.map(({ unitCost, ...item }) => item) : [],
    subtotal: Number(row.subtotal) > 0 ? Number(row.subtotal) : Number(row.total),
    discountTotal: Number(row.discount_total || 0),
    automaticDiscount: Number(row.automatic_discount || 0),
    couponDiscount: Number(row.coupon_discount || 0),
    shippingDiscount: Number(row.shipping_discount || 0),
    couponCode: row.coupon_code || null,
    shippingTotal: Number(row.shipping_total || 0),
    total: Number(row.total),
    status: row.status,
    statusHistory: Array.isArray(row.status_history) ? row.status_history : [],
    pixPayload: row.pix_payload,
    seenByAdmin: row.seen_by_admin,
    paymentReportedAt: row.payment_reported_at,
    expiresAt: row.expires_at,
    cancelReason: row.cancel_reason,
    date: row.order_date,
    time: row.order_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    throw new V.ValidationError('Identificador de segurança do pedido ausente ou inválido. Atualize a página e tente novamente.');
  }
  return key;
}

function validateCartItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 50) {
    throw new V.ValidationError('O carrinho deve conter entre 1 e 50 produtos.');
  }
  const consolidated = new Map();
  const totals = new Map();
  for (const raw of rawItems) {
    const productId = V.uuid(raw && raw.productId, 'Produto');
    const qty = V.positiveInteger(raw && raw.qty, 'Quantidade', 99);
    const selectedColor = raw?.selectedColor == null || raw.selectedColor === '' ? null : V.text(raw.selectedColor, 'Cor', {max:40});
    const key = JSON.stringify([productId, selectedColor]);
    const entry = consolidated.get(key) || {productId, selectedColor, qty:0};
    entry.qty += qty;
    consolidated.set(key, entry);
    totals.set(productId, (totals.get(productId) || 0) + qty);
    if (totals.get(productId) > 99) throw new V.ValidationError('A quantidade máxima por produto é 99.');
  }
  return Array.from(consolidated.values()).sort((a, b) => a.productId.localeCompare(b.productId) || String(a.selectedColor).localeCompare(String(b.selectedColor)));
}

function parseLimit(value, fallback, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

async function readStoreContent(database = pool) {
  const result = await database.query('SELECT content FROM site_content WHERE id=1');
  return deepMerge(SITE_CONTENT_DEFAULTS, result.rows[0] ? result.rows[0].content : {});
}

function shippingForSubtotal(content, subtotalCents) {
  const shipping = content.shipping || {};
  const flatCents = Math.max(0, Math.round(Number(shipping.flatRate || 0) * 100));
  const freeAboveCents = Math.max(0, Math.round(Number(shipping.freeAbove || 0) * 100));
  return freeAboveCents > 0 && subtotalCents >= freeAboveCents ? 0 : flatCents;
}

router.post('/quote', orderLimiter, async (req, res, next) => {
  try {
    await expirePendingOrders();
    const requestedItems = validateCartItems(req.body && req.body.items);
    const couponCode = normalizeCode(req.body && req.body.couponCode);
    const productIds = requestedItems.map((item) => item.productId);
    const productsResult = await pool.query(
      'SELECT id, name, price, category, stock, active, colors FROM products WHERE id=ANY($1::uuid[]) ORDER BY id',
      [productIds]
    );
    if (productsResult.rows.length !== new Set(productIds).size) throw new V.ValidationError('Um dos produtos não está mais disponível.');
    const content = await readStoreContent();
    const calculated = await priceOrder(pool, requestedItems, productsResult.rows, couponCode,
      (subtotal) => shippingForSubtotal(content, subtotal));
    res.json({
      items: calculated.items.map(({ unitCost, ...item }) => item),
      subtotal: calculated.subtotalCents / 100,
      grossSubtotal: calculated.grossSubtotalCents / 100,
      discountTotal: (calculated.automaticCents + calculated.couponCents) / 100,
      automaticDiscount: calculated.automaticCents / 100,
      couponDiscount: calculated.couponCents / 100,
      shippingDiscount: calculated.shippingDiscountCents / 100,
      shippingBeforeDiscount: calculated.baseShippingCents / 100,
      couponCode: calculated.coupon?.code || null,
      shippingTotal: calculated.shippingCents / 100,
      total: calculated.totalCents / 100,
      estimatedDays: Number(content.shipping && content.shipping.estimatedDays) || 7
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, orderLimiter, async (req, res, next) => {
  let client;
  const idempotencyKey = (() => {
    try { return validateIdempotencyKey(req.get('Idempotency-Key')); } catch (err) { next(err); return null; }
  })();
  if (!idempotencyKey) return;

  try {
    await expirePendingOrders();
    const requestedItems = validateCartItems(req.body && req.body.items);
    const couponCode = normalizeCode(req.body && req.body.couponCode);
    client = await pool.connect();
    await client.query('BEGIN');

    const repeated = await client.query(
      'SELECT * FROM orders WHERE user_id=$1 AND idempotency_key=$2',
      [req.user.id, idempotencyKey]
    );
    if (repeated.rows[0]) {
      await client.query('COMMIT');
      return res.json(toPublicOrder(repeated.rows[0]));
    }

    const userResult = await client.query(
      `SELECT id, name, phone, address, city, state, zip FROM users WHERE id=$1 FOR UPDATE`,
      [req.user.id]
    );
    const user = userResult.rows[0];
    if (!user || !user.phone || !user.address || !user.city || !user.state || !user.zip) {
      throw new V.ValidationError('Complete seus dados de entrega antes de finalizar o pedido.');
    }

    // O bloqueio do usuário serializa pedidos concorrentes da mesma conta,
    // impedindo que duas requisições ultrapassem juntas o limite abaixo.
    const openOrders = await client.query(
      `SELECT COUNT(*)::integer AS count FROM orders
       WHERE user_id=$1 AND status IN ('Aguardando Pagamento', 'Aguardando Confirmação')`,
      [req.user.id]
    );
    if (openOrders.rows[0].count >= config.maxOpenOrdersPerUser) {
      const error = new Error(`Você já possui ${config.maxOpenOrdersPerUser} pedidos aguardando pagamento ou confirmação.`);
      error.status = 409;
      error.code = 'open_order_limit';
      throw error;
    }

    const productIds = requestedItems.map((item) => item.productId);
    const productsResult = await client.query(
      'SELECT id, name, price, category, cost_price, stock, active, colors FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [productIds]
    );
    if (productsResult.rows.length !== new Set(productIds).size) throw new V.ValidationError('Um dos produtos não está mais disponível.');

    const content = await readStoreContent(client);
    const calculated = await priceOrder(client, requestedItems, productsResult.rows, couponCode,
      (subtotal) => shippingForSubtotal(content, subtotal), { lockCoupon: true });
    const canonicalItems = calculated.items;
    const subtotalCents = calculated.subtotalCents;
    const shippingCents = calculated.shippingCents;
    const total = calculated.totalCents / 100;
    if (req.body?.expectedTotal != null && Math.round(V.nonNegativeMoney(req.body.expectedTotal, 'Valor confirmado') * 100) !== calculated.totalCents) {
      const error = new Error('O valor do pedido mudou. Confira o novo total antes de confirmar.');
      error.status = 409;
      error.code = 'quote_changed';
      throw error;
    }
    const sequence = await client.query("SELECT nextval('order_number_seq') AS n");
    const number = String(sequence.rows[0].n).padStart(6, '0');
    const payload = pixPayload.build({
      chave: content.pix.chave,
      nome: content.pix.nomeBeneficiario,
      cidade: content.pix.cidadeBeneficiario,
      valor: total,
      txid: `PEDIDO${number}`
    });

    const now = new Date();
    const dateStr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(now);
    const timeStr = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo'
    }).format(now);
    const history = [{ status: 'Aguardando Pagamento', at: now.toISOString() }];
    const expiresAt = new Date(now.getTime() + config.orderPaymentTtlMinutes * 60 * 1000);

    const inserted = await client.query(
      `INSERT INTO orders (
         number, user_id, customer_name, shipping_phone, shipping_address, shipping_city, shipping_state, shipping_zip,
         items, subtotal, shipping_total, total, status, status_history, pix_payload, idempotency_key, order_date, order_time, expires_at,
         discount_total, automatic_discount, coupon_discount, coupon_code, shipping_discount
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Aguardando Pagamento',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        number, user.id, user.name, user.phone, user.address, user.city, user.state, user.zip,
        JSON.stringify(canonicalItems), subtotalCents / 100, shippingCents / 100, total, JSON.stringify(history), payload,
        idempotencyKey, dateStr, timeStr, expiresAt,
        (calculated.automaticCents + calculated.couponCents) / 100, calculated.automaticCents / 100,
        calculated.couponCents / 100, calculated.coupon?.code || null, calculated.shippingDiscountCents / 100
      ]
    );

    if (calculated.coupon) {
      const redeemed = await client.query('UPDATE promotions SET used_count=used_count+1 WHERE id=$1 AND (max_uses IS NULL OR used_count < max_uses) RETURNING id',[calculated.coupon.id]);
      if (!redeemed.rows[0]) throw new V.ValidationError('O cupom atingiu seu limite de uso. Revise o pedido.');
      await client.query('INSERT INTO coupon_redemptions(order_id,promotion_id,user_id) VALUES($1,$2,$3)',
        [inserted.rows[0].id, calculated.coupon.id, user.id]);
    }

    for (const item of canonicalItems) {
      const updated = await client.query(
        'UPDATE products SET stock=stock-$1, updated_at=now() WHERE id=$2 AND stock >= $1 RETURNING id',
        [item.qty, item.productId]
      );
      if (!updated.rows[0]) throw new V.ValidationError(`O estoque de ${item.name} mudou. Revise o carrinho.`);
    }

    await client.query('COMMIT');
    res.status(201).json(toPublicOrder(inserted.rows[0]));
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505' && idempotencyKey) {
      const repeated = await pool.query('SELECT * FROM orders WHERE user_id=$1 AND idempotency_key=$2', [req.user.id, idempotencyKey]);
      if (repeated.rows[0]) return res.json(toPublicOrder(repeated.rows[0]));
    }
    next(err);
  } finally {
    if (client) client.release();
  }
});

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    await expirePendingOrders();
    const limit = parseLimit(req.query.limit, 200, 500);
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const values = [];
    const where = [];
    const add = (value) => { values.push(value); return `$${values.length}`; };
    const number = String(req.query.number || '').trim().replace(/^#\s*/, '').slice(0, 64);
    const client = String(req.query.client || '').trim().slice(0, 120);
    const product = String(req.query.product || '').trim().slice(0, 160);
    const status = String(req.query.status || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const minValue = req.query.minValue === '' || req.query.minValue == null ? null : Number(req.query.minValue);
    const maxValue = req.query.maxValue === '' || req.query.maxValue == null ? null : Number(req.query.maxValue);

    if (status) {
      if (!ALL_STATUSES.has(status)) throw new V.ValidationError('Status de filtro inválido.');
      where.push(`status=${add(status)}`);
    }
    if (number) where.push(`strpos(lower(number), lower(${add(number)})) > 0`);
    if (client) where.push(`customer_name ILIKE ${add(`%${client}%`)}`);
    if (product) where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(items) item WHERE item->>'name' ILIKE ${add(`%${product}%`)})`);
    if (from) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new V.ValidationError('Data inicial inválida.');
      where.push(`created_at >= ${add(`${from}T00:00:00-03:00`)}::timestamptz`);
    }
    if (to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new V.ValidationError('Data final inválida.');
      where.push(`created_at < (${add(`${to}T00:00:00-03:00`)}::timestamptz + interval '1 day')`);
    }
    if (minValue != null) {
      if (!Number.isFinite(minValue) || minValue < 0) throw new V.ValidationError('Valor mínimo inválido.');
      where.push(`total >= ${add(minValue)}`);
    }
    if (maxValue != null) {
      if (!Number.isFinite(maxValue) || maxValue < 0) throw new V.ValidationError('Valor máximo inválido.');
      where.push(`total <= ${add(maxValue)}`);
    }
    if (minValue != null && maxValue != null && minValue > maxValue) throw new V.ValidationError('O valor mínimo não pode ser maior que o máximo.');

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    res.json(result.rows.map(toPublicOrder));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/summary', requireAdmin, async (req, res, next) => {
  try {
    await expirePendingOrders();
    const [totals, recent] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::integer AS total_orders,
          COALESCE(SUM(total) FILTER (WHERE status IN ('Pago','Em Produção','Enviado','Finalizado')), 0) AS revenue,
          COUNT(*) FILTER (WHERE status IN ('Aguardando Pagamento','Aguardando Confirmação'))::integer AS pending_orders,
          COUNT(*) FILTER (WHERE status IN ('Pago','Em Produção','Enviado','Finalizado'))::integer AS paid_orders,
          (SELECT COUNT(*)::integer FROM users WHERE role='client') AS total_customers
        FROM orders
      `),
      pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5')
    ]);
    const row = totals.rows[0];
    res.json({
      totalOrders: row.total_orders,
      revenue: Number(row.revenue),
      pendingOrders: row.pending_orders,
      paidOrders: row.paid_orders,
      totalCustomers: row.total_customers,
      recentOrders: recent.rows.map(toPublicOrder)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/user/:userId', requireAuth, async (req, res, next) => {
  try {
    await expirePendingOrders();
    const userId = V.uuid(req.params.userId, 'Usuário');
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      return res.status(403).json({ message: 'Você só pode ver os próprios pedidos.' });
    }
    const limit = parseLimit(req.query.limit, 100, 200);
    const result = await pool.query(
      'SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    res.json(result.rows.map(toPublicOrder));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    await expirePendingOrders();
    const id = V.uuid(req.params.id, 'Pedido');
    const result = await pool.query('SELECT * FROM orders WHERE id=$1', [id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ message: 'Pedido não encontrado.' });
    if (req.user.role !== 'admin' && req.user.id !== row.user_id) {
      return res.status(403).json({ message: 'Você não tem acesso a este pedido.' });
    }
    res.json(toPublicOrder(row));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/cancel', requireAuth, orderLimiter, async (req, res, next) => {
  let client;
  try {
    await expirePendingOrders();
    client = await pool.connect();
    const id = V.uuid(req.params.id, 'Pedido');
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id]);
    const row = result.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Pedido não encontrado.' });
    }
    if (req.user.role !== 'admin' && row.user_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Você não tem acesso a este pedido.' });
    }
    if (row.status === 'Cancelado') {
      await client.query('COMMIT');
      return res.json(toPublicOrder(row));
    }
    if (row.status !== 'Aguardando Pagamento') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Somente pedidos aguardando pagamento podem ser cancelados diretamente.' });
    }
    const updated = await cancelLockedOrder(client, row, 'Cancelado pelo cliente');
    await client.query('COMMIT');
    res.json(toPublicOrder(updated));
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    if (client) client.release();
  }
});

router.patch('/:id/status', requireAdmin, async (req, res, next) => {
  const id = (() => { try { return V.uuid(req.params.id, 'Pedido'); } catch (err) { next(err); return null; } })();
  if (!id) return;
  const status = String((req.body && req.body.status) || '');
  if (!ALL_STATUSES.has(status)) return res.status(400).json({ message: 'Status inválido.' });

  let client;
  try {
    await expirePendingOrders();
    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id]);
    const row = existing.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Pedido não encontrado.' });
    }
    if (row.status === 'Aguardando Pagamento' && row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      const expired = await cancelLockedOrder(client, row, 'Prazo de pagamento expirado');
      await client.query('COMMIT');
      if (status === STATUS_CANCELLED) return res.json(toPublicOrder(expired));
      return res.status(409).json({ code: 'payment_expired', message: 'O prazo deste PIX expirou e o estoque foi liberado.' });
    }
    if (row.status === status) {
      await client.query('COMMIT');
      return res.json(toPublicOrder(row));
    }
    if (!TRANSITIONS[row.status] || !TRANSITIONS[row.status].has(status)) {
      throw new V.ValidationError(`Não é permitido alterar de “${row.status}” para “${status}”.`);
    }

    let stockRestored = row.stock_restored;
    if (status === STATUS_CANCELLED && !stockRestored) {
      for (const item of Array.isArray(row.items) ? row.items : []) {
        try {
          const productId = V.uuid(item.productId, 'Produto');
          const qty = V.positiveInteger(item.qty, 'Quantidade', 99);
          await client.query('UPDATE products SET stock=stock+$1, updated_at=now() WHERE id=$2', [qty, productId]);
        } catch (_) {
          // Pedidos antigos podem não ter identificadores íntegros; não inventamos estoque nesses casos.
        }
      }
      stockRestored = true;
    }
    if (status === STATUS_CANCELLED) await releaseCoupon(client, row.id);

    const history = Array.isArray(row.status_history) ? [...row.status_history] : [];
    history.push({ status, at: new Date().toISOString() });
    const renewedExpiry = status === 'Aguardando Pagamento'
      ? new Date(Date.now() + config.orderPaymentTtlMinutes * 60 * 1000)
      : row.expires_at;
    const updated = await client.query(
      `UPDATE orders SET status=$1, status_history=$2, stock_restored=$3, cancel_reason=$4,
         expires_at=$5, payment_reported_at=CASE WHEN $1='Aguardando Pagamento' THEN NULL ELSE payment_reported_at END,
         updated_at=now() WHERE id=$6 RETURNING *`,
      [status, JSON.stringify(history), stockRestored, status === STATUS_CANCELLED ? 'Cancelado pelo administrador' : null, renewedExpiry, id]
    );
    await client.query('COMMIT');
    await recordAudit(pool, {
      adminId: req.user.id, action: 'order.status_update', entityType: 'order', entityId: id,
      details: { from: row.status, to: status, number: row.number }
    });
    res.json(toPublicOrder(updated.rows[0]));
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    if (client) client.release();
  }
});

router.patch('/:id/payment-reported', requireAuth, orderLimiter, async (req, res, next) => {
  let client;
  try {
    await expirePendingOrders();
    const id = V.uuid(req.params.id, 'Pedido');
    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id]);
    const row = existing.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Pedido não encontrado.' });
    }
    if (req.user.role !== 'admin' && req.user.id !== row.user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Você não tem acesso a este pedido.' });
    }
    if (row.status === 'Aguardando Confirmação') {
      await client.query('COMMIT');
      return res.json(toPublicOrder(row));
    }
    if (row.status !== 'Aguardando Pagamento') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Este pedido não está aguardando informação de pagamento.' });
    }
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      await cancelLockedOrder(client, row, 'Prazo de pagamento expirado');
      await client.query('COMMIT');
      return res.status(409).json({ code: 'payment_expired', message: 'O prazo deste PIX expirou e o estoque foi liberado.' });
    }
    const history = Array.isArray(row.status_history) ? [...row.status_history] : [];
    history.push({ status: 'Aguardando Confirmação', at: new Date().toISOString() });
    const updated = await client.query(
      `UPDATE orders SET status='Aguardando Confirmação', status_history=$1,
         payment_reported_at=now(), updated_at=now() WHERE id=$2 RETURNING *`,
      [JSON.stringify(history), id]
    );
    await client.query('COMMIT');
    res.json(toPublicOrder(updated.rows[0]));
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    if (client) client.release();
  }
});

router.patch('/:id/seen', requireAdmin, async (req, res, next) => {
  try {
    const id = V.uuid(req.params.id, 'Pedido');
    const updated = await pool.query('UPDATE orders SET seen_by_admin=true, updated_at=now() WHERE id=$1 RETURNING id', [id]);
    if (!updated.rows[0]) return res.status(404).json({ message: 'Pedido não encontrado.' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
