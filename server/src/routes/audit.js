'use strict';

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');

const router = express.Router();

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 200;
    const result = await pool.query(
      `SELECT l.*, u.name AS admin_name
       FROM admin_audit_logs l
       LEFT JOIN users u ON u.id=l.admin_id
       ORDER BY l.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows.map((row) => ({
      id: String(row.id),
      adminName: row.admin_name,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: Object.keys(row.details || {}).length ? JSON.stringify(row.details) : '',
      date: new Date(row.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      createdAt: row.created_at
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
