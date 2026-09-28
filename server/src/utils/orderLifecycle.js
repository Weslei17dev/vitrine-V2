'use strict';

const pool = require('../db');
const V = require('../validation');

async function restoreStock(client, order) {
  if (order.stock_restored) return true;
  for (const item of Array.isArray(order.items) ? order.items : []) {
    try {
      const productId = V.uuid(item.productId, 'Produto');
      const qty = V.positiveInteger(item.qty, 'Quantidade', 99);
      await client.query('UPDATE products SET stock=stock+$1, updated_at=now() WHERE id=$2', [qty, productId]);
    } catch (_) {
      // Pedidos legados sem identificador íntegro não geram estoque inventado.
    }
  }
  return true;
}

async function releaseCoupon(client, orderId) {
  const result = await client.query('DELETE FROM coupon_redemptions WHERE order_id=$1 RETURNING promotion_id', [orderId]);
  if (result.rows[0]) await client.query('UPDATE promotions SET used_count=GREATEST(0,used_count-1) WHERE id=$1', [result.rows[0].promotion_id]);
}

async function cancelLockedOrder(client, order, reason) {
  await restoreStock(client, order);
  await releaseCoupon(client, order.id);
  const history = Array.isArray(order.status_history) ? [...order.status_history] : [];
  history.push({ status: 'Cancelado', at: new Date().toISOString(), reason });
  const result = await client.query(
    `UPDATE orders SET status='Cancelado', status_history=$1, stock_restored=true,
       cancel_reason=$2, updated_at=now() WHERE id=$3 RETURNING *`,
    [JSON.stringify(history), reason, order.id]
  );
  return result.rows[0];
}

async function expirePendingOrders(limit = 100) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT * FROM orders
       WHERE status='Aguardando Pagamento' AND stock_restored=false
         AND expires_at IS NOT NULL AND expires_at <= now()
       ORDER BY expires_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [Math.max(1, Math.min(500, Number(limit) || 100))]
    );
    for (const order of result.rows) {
      await cancelLockedOrder(client, order, 'Prazo de pagamento expirado');
    }
    await client.query('COMMIT');
    return result.rowCount;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { restoreStock, releaseCoupon, cancelLockedOrder, expirePendingOrders };
