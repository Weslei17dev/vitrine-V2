/* ============================================================================
   routes/customers.js
   ----------------------------------------------------------------------------
   GET /api/customers — lista de clientes com total gasto (admin)
   ============================================================================ */

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');

const router = express.Router();

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 200;
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const result = await pool.query(`
      SELECT
        u.id, u.name, u.phone, u.email, u.city, u.state,
        COALESCE(SUM(o.total) FILTER (WHERE o.status NOT IN ('Cancelado', 'Aguardando Pagamento', 'Aguardando Confirmação')), 0) AS total_spent
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.role = 'client'
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        city: row.city,
        state: row.state,
        totalSpent: Number(row.total_spent)
      }))
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
