/* ============================================================================
   routes/orders.js
   ----------------------------------------------------------------------------
   POST  /api/orders                     — cria pedido (cliente logado)
   GET   /api/orders                     — lista todos (admin)
   GET   /api/orders/user/:userId        — pedidos de um cliente (dono ou admin)
   GET   /api/orders/:id                 — detalhe de um pedido (dono ou admin)
   PATCH /api/orders/:id/status          — muda status (admin)
   PATCH /api/orders/:id/payment-reported — cliente avisa que pagou (dono)
   PATCH /api/orders/:id/seen            — marca como visto pelo admin (admin)
   ============================================================================ */

const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../auth-middleware');
const pixPayload = require('../utils/pixPayload');

const router = express.Router();

function toPublicOrder(row) {
  return {
    id: row.id,
    number: row.number,
    userId: row.user_id,
    customerName: row.customer_name,
    items: row.items,
    total: Number(row.total),
    status: row.status,
    statusHistory: row.status_history,
    pixPayload: row.pix_payload,
    seenByAdmin: row.seen_by_admin,
    date: row.order_date,
    time: row.order_time,
    createdAt: row.created_at
  };
}

router.post('/', requireAuth, async (req, res) => {
  const { items, total } = req.body || {};
  if (!Array.isArray(items) || !items.length || !(total > 0)) {
    return res.status(400).json({ message: 'Carrinho inválido.' });
  }

  const client = await pool.connect();
  try {
    const seq = await client.query('SELECT nextval(\'order_number_seq\') AS n');
    const number = String(seq.rows[0].n).padStart(6, '0');

    const siteContentResult = await client.query('SELECT content FROM site_content WHERE id = 1');
    const pixConfig = (siteContentResult.rows[0] && siteContentResult.rows[0].content.pix) || {};

    const payload = pixPayload.build({
      chave: pixConfig.chave,
      nome: pixConfig.nomeBeneficiario,
      cidade: pixConfig.cidadeBeneficiario,
      valor: total,
      txid: `PEDIDO${number}`
    });

    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR');
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const statusHistory = [{ status: 'Aguardando Pagamento', at: now.toISOString() }];

    const result = await client.query(
      `INSERT INTO orders (number, user_id, customer_name, items, total, status, status_history, pix_payload, order_date, order_time)
       VALUES ($1,$2,$3,$4,$5,'Aguardando Pagamento',$6,$7,$8,$9) RETURNING *`,
      [number, req.user.id, req.user.name, JSON.stringify(items), total, JSON.stringify(statusHistory), payload, dateStr, timeStr]
    );

    res.status(201).json(toPublicOrder(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar pedido.' });
  } finally {
    client.release();
  }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows.map(toPublicOrder));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar pedidos.' });
  }
});

router.get('/user/:userId', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== req.params.userId) {
    return res.status(403).json({ message: 'Você só pode ver os próprios pedidos.' });
  }
  try {
    const result = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [req.params.userId]);
    res.json(result.rows.map(toPublicOrder));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar pedidos.' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ message: 'Pedido não encontrado.' });
    if (req.user.role !== 'admin' && req.user.id !== row.user_id) {
      return res.status(403).json({ message: 'Você não tem acesso a este pedido.' });
    }
    res.json(toPublicOrder(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar pedido.' });
  }
});

router.patch('/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ message: 'Informe o novo status.' });

  try {
    const existing = await pool.query('SELECT status_history FROM orders WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ message: 'Pedido não encontrado.' });

    const history = existing.rows[0].status_history || [];
    history.push({ status, at: new Date().toISOString() });

    const result = await pool.query(
      'UPDATE orders SET status = $1, status_history = $2 WHERE id = $3 RETURNING *',
      [status, JSON.stringify(history), req.params.id]
    );
    res.json(toPublicOrder(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao atualizar status.' });
  }
});

router.patch('/:id/payment-reported', requireAuth, async (req, res) => {
  try {
    const existing = await pool.query('SELECT user_id, status_history FROM orders WHERE id = $1', [req.params.id]);
    const row = existing.rows[0];
    if (!row) return res.status(404).json({ message: 'Pedido não encontrado.' });
    if (req.user.role !== 'admin' && req.user.id !== row.user_id) {
      return res.status(403).json({ message: 'Você não tem acesso a este pedido.' });
    }

    const history = row.status_history || [];
    history.push({ status: 'Aguardando Confirmação', at: new Date().toISOString() });

    const result = await pool.query(
      `UPDATE orders SET status = 'Aguardando Confirmação', status_history = $1 WHERE id = $2 RETURNING *`,
      [JSON.stringify(history), req.params.id]
    );
    res.json(toPublicOrder(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao atualizar pedido.' });
  }
});

router.patch('/:id/seen', requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE orders SET seen_by_admin = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao atualizar pedido.' });
  }
});

module.exports = router;
