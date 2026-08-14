/* ============================================================================
   routes/customers.js
   ----------------------------------------------------------------------------
   GET /api/customers — lista de clientes com total gasto (admin)
   ============================================================================ */

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id, u.name, u.phone, u.email, u.city, u.state,
        COALESCE(SUM(o.total) FILTER (WHERE o.status NOT IN ('Cancelado', 'Aguardando Pagamento', 'Aguardando Confirmação')), 0) AS total_spent
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.role = 'client'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

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
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar clientes.' });
  }
});

module.exports = router;
