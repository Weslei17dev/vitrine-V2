'use strict';

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');
const V = require('../validation');
const { recordAudit } = require('../utils/audit');

const router = express.Router();

function publicCategory(row) {
  return {
    id: row.id,
    name: row.name,
    image: row.image || '',
    color: row.color,
    active: row.active,
    sortOrder: row.sort_order,
    productCount: Number(row.product_count || 0),
    updatedAt: row.updated_at
  };
}

function validateCategory(body) {
  return {
    name: V.text(body.name, 'Nome da categoria', { min: 2, max: 80 }),
    image: V.imageSource(body.image, 'Imagem da categoria'),
    color: V.color(body.color || '#D99163'),
    active: body.active !== false,
    sortOrder: V.nonNegativeInteger(body.sortOrder == null ? 0 : body.sortOrder, 'Ordem')
  };
}

async function list(includeInactive) {
  const result = await pool.query(`
    SELECT c.*, COUNT(p.id)::integer AS product_count
    FROM categories c
    LEFT JOIN products p ON lower(p.category)=lower(c.name) AND p.active=true
    ${includeInactive ? '' : 'WHERE c.active=true'}
    GROUP BY c.id ORDER BY c.sort_order, c.name
  `);
  return result.rows.map(publicCategory);
}

router.get('/', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json(await list(false));
  } catch (err) { next(err); }
});

router.get('/admin/all', requireAdmin, async (_req, res, next) => {
  try { res.json(await list(true)); } catch (err) { next(err); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const category = validateCategory(req.body || {});
    const result = await pool.query(
      `INSERT INTO categories (name,image,color,active,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [category.name, category.image, category.color, category.active, category.sortOrder]
    );
    await recordAudit(pool, { adminId: req.user.id, action: 'category.create', entityType: 'category', entityId: result.rows[0].id, details: { name: category.name } });
    res.status(201).json(publicCategory(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Já existe uma categoria com esse nome.' });
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = V.uuid(req.params.id, 'Categoria');
    const category = validateCategory(req.body || {});
    const old = await pool.query('SELECT name FROM categories WHERE id=$1', [id]);
    if (!old.rows[0]) return res.status(404).json({ message: 'Categoria não encontrada.' });
    const result = await pool.query(
      `UPDATE categories SET name=$1,image=$2,color=$3,active=$4,sort_order=$5,updated_at=now() WHERE id=$6 RETURNING *`,
      [category.name, category.image, category.color, category.active, category.sortOrder, id]
    );
    if (old.rows[0].name !== category.name) {
      await pool.query('UPDATE products SET category=$1,updated_at=now() WHERE lower(category)=lower($2)', [category.name, old.rows[0].name]);
    }
    await recordAudit(pool, { adminId: req.user.id, action: 'category.update', entityType: 'category', entityId: id, details: { name: category.name } });
    res.json(publicCategory(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Já existe uma categoria com esse nome.' });
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = V.uuid(req.params.id, 'Categoria');
    const found = await pool.query('SELECT * FROM categories WHERE id=$1', [id]);
    if (!found.rows[0]) return res.status(404).json({ message: 'Categoria não encontrada.' });
    const used = await pool.query('SELECT COUNT(*)::integer count FROM products WHERE lower(category)=lower($1)', [found.rows[0].name]);
    if (used.rows[0].count > 0) return res.status(409).json({ message: 'Mova os produtos desta categoria antes de excluí-la.' });
    await pool.query('DELETE FROM categories WHERE id=$1', [id]);
    await recordAudit(pool, { adminId: req.user.id, action: 'category.delete', entityType: 'category', entityId: id, details: { name: found.rows[0].name } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
