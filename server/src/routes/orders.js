'use strict';

const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../auth-middleware');
const { orderLimiter } = require('../security');
const { SITE_CONTENT_DEFAULTS, deepMerge } = require('../site-defaults');
const V = require('../validation');
const pixPayload = require('../utils/pixPayload');
const { calculateOrder } = require('../utils/orderCalculator');

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
    items: Array.isArray(row.items) ? row.items : [],
    subtotal: Number(row.subtotal) > 0 ? Number(row.subtotal) : Number(row.total),
    shippingTotal: Number(row.shipping_total || 0),
    total: Number(row.total),
    status: row.status,
    statusHistory: Array.isArray(row.status_history) ? row.status_history : [],
    pixPayload: row.pix_payload,
    seenByAdmin: row.seen_by_admin,
    paymentReportedAt: row.payment_reported_at,
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
  for (const raw of rawItems) {
    const productId = V.uuid(raw && raw.productId, 'Produto');
    const qty = V.positiveInteger(raw && raw.qty, 'Quantidade', 99);
    consolidated.set(productId, (consolidated.get(productId) || 0) + qty);
    if (consolidated.get(productId) > 99) throw new V.ValidationError('A quantidade máxima por produto é 99.');
  }
  return Array.from(consolidated, ([productId, qty]) => ({ productId, qty }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function parseLimit(value, fallback, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

router.post('/', requireAuth, orderLimiter, async (req, res, next) => {
  let client;
  const idempotencyKey = (() => {
    try { return validateIdempotencyKey(req.get('Idempotency-Key')); } catch (err) { next(err); return null; }
  })();
  if (!idempotencyKey) return;

  try {
    const requestedItems = validateCartItems(req.body && req.body.items);
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
      `SELECT id, name, phone, address, city, state, zip FROM users WHERE id=$1 FOR SHARE`,
      [req.user.id]
    );
    const user = userResult.rows[0];
    if (!user || !user.phone || !user.address || !user.city || !user.state || !user.zip) {
      throw new V.ValidationError('Complete seus dados de entrega antes de finalizar o pedido.');
    }

    const productIds = requestedItems.map((item) => item.productId);
    const productsResult = await client.query(
      'SELECT id, name, price, stock, active FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [productIds]
    );
    if (productsResult.rows.length !== productIds.length) throw new V.ValidationError('Um dos produtos não está mais disponível.');

    const calculated = calculateOrder(requestedItems, productsResult.rows, 0);
    const canonicalItems = calculated.items;
    const subtotalCents = calculated.subtotalCents;
    const shippingCents = calculated.shippingCents;
    const total = calculated.totalCents / 100;
    const contentResult = await client.query('SELECT content FROM site_content WHERE id=1');
    const content = deepMerge(SITE_CONTENT_DEFAULTS, contentResult.rows[0] ? contentResult.rows[0].content : {});

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

    const inserted = await client.query(
      `INSERT INTO orders (
         number, user_id, customer_name, shipping_phone, shipping_address, shipping_city, shipping_state, shipping_zip,
         items, subtotal, shipping_total, total, status, status_history, pix_payload, idempotency_key, order_date, order_time
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Aguardando Pagamento',$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        number, user.id, user.name, user.phone, user.address, user.city, user.state, user.zip,
        canonicalItems, subtotalCents / 100, shippingCents / 100, total, history, payload,
        idempotencyKey, dateStr, timeStr
      ]
    );

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
    const limit = parseLimit(req.query.limit, 200, 500);
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    res.json(result.rows.map(toPublicOrder));
  } catch (err) {
    next(err);
  }
});

router.get('/user/:userId', requireAuth, async (req, res, next) => {
  try {
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

router.patch('/:id/status', requireAdmin, async (req, res, next) => {
  const id = (() => { try { return V.uuid(req.params.id, 'Pedido'); } catch (err) { next(err); return null; } })();
  if (!id) return;
  const status = String((req.body && req.body.status) || '');
  if (!ALL_STATUSES.has(status)) return res.status(400).json({ message: 'Status inválido.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id]);
    const row = existing.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Pedido não encontrado.' });
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

    const history = Array.isArray(row.status_history) ? [...row.status_history] : [];
    history.push({ status, at: new Date().toISOString() });
    const updated = await client.query(
      'UPDATE orders SET status=$1, status_history=$2, stock_restored=$3, updated_at=now() WHERE id=$4 RETURNING *',
      [status, history, stockRestored, id]
    );
    await client.query('COMMIT');
    res.json(toPublicOrder(updated.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.patch('/:id/payment-reported', requireAuth, orderLimiter, async (req, res, next) => {
  try {
    const id = V.uuid(req.params.id, 'Pedido');
    const existing = await pool.query('SELECT * FROM orders WHERE id=$1', [id]);
    const row = existing.rows[0];
    if (!row) return res.status(404).json({ message: 'Pedido não encontrado.' });
    if (req.user.role !== 'admin' && req.user.id !== row.user_id) {
      return res.status(403).json({ message: 'Você não tem acesso a este pedido.' });
    }
    if (row.status === 'Aguardando Confirmação') return res.json(toPublicOrder(row));
    if (row.status !== 'Aguardando Pagamento') {
      return res.status(409).json({ message: 'Este pedido não está aguardando informação de pagamento.' });
    }
    const history = Array.isArray(row.status_history) ? [...row.status_history] : [];
    history.push({ status: 'Aguardando Confirmação', at: new Date().toISOString() });
    const updated = await pool.query(
      `UPDATE orders SET status='Aguardando Confirmação', status_history=$1,
         payment_reported_at=now(), updated_at=now() WHERE id=$2 RETURNING *`,
      [history, id]
    );
    res.json(toPublicOrder(updated.rows[0]));
  } catch (err) {
    next(err);
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
