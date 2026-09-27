/* ============================================================================
   routes/customers.js
   ----------------------------------------------------------------------------
   GET /api/customers — lista de clientes com total gasto (admin)
   ============================================================================ */

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');

const router = express.Router();
const { adminFilters } = require('../utils/adminFilters');

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const f = adminFilters(req.query, { search: ["name || ' ' || email || ' ' || COALESCE(phone,'')", 'search'], city: ["COALESCE(city,'')", 'search'], state: ['state'], minValue: ['total_spent','min'], maxValue: ['total_spent','max'], from:['created_at','from'], to:['created_at','to'] });
    const result = await pool.query(`
      WITH clients AS (
      SELECT
        u.id, u.name, u.phone, u.email, u.city, u.state, u.created_at,
        COALESCE(SUM(o.total) FILTER (WHERE o.status NOT IN ('Cancelado', 'Aguardando Pagamento', 'Aguardando Confirmação')), 0) AS total_spent
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.role = 'client'
      GROUP BY u.id
      ) SELECT * FROM clients ${f.where}
      ORDER BY created_at DESC, id ${f.pagination}
    `, f.params);

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
