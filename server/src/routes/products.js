'use strict';

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');
const V = require('../validation');

const router = express.Router();

function toPublicProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    category: row.category,
    icon: row.icon,
    color: row.color,
    stock: row.stock,
    active: row.active,
    image: row.image,
    gallery: row.gallery || [],
    details: row.details
  };
}

function validateProduct(body) {
  const gallery = Array.isArray(body.gallery) ? body.gallery : [];
  if (gallery.length > 6) throw new V.ValidationError('A galeria aceita no máximo 6 imagens.');
  return {
    name: V.text(body.name, 'Nome', { min: 2, max: 160 }),
    description: V.text(body.description, 'Descrição', { min: 3, max: 1200 }),
    price: V.positiveMoney(body.price),
    category: V.text(body.category || 'Geral', 'Categoria', { max: 80 }),
    icon: V.text(body.icon || '🛍️', 'Ícone', { max: 8 }),
    color: V.color(body.color || '#FF3D82'),
    stock: V.nonNegativeInteger(body.stock == null ? 0 : body.stock, 'Estoque'),
    active: body.active !== false,
    image: V.imageSource(body.image, 'Imagem principal'),
    gallery: gallery.map((source, index) => V.imageSource(source, `Imagem ${index + 1} da galeria`)).filter(Boolean),
    details: V.text(body.details, 'Informações adicionais', { required: false, max: 3000 }) || null
  };
}

async function findProduct(id, includeInactive) {
  const productId = V.uuid(id, 'Produto');
  const result = await pool.query(
    `SELECT * FROM products WHERE id=$1 ${includeInactive ? '' : 'AND active=true'}`,
    [productId]
  );
  return result.rows[0];
}

router.get('/admin/all', requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(result.rows.map(toPublicProduct));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/:id', requireAdmin, async (req, res, next) => {
  try {
    const row = await findProduct(req.params.id, true);
    if (!row) return res.status(404).json({ message: 'Produto não encontrado.' });
    res.json(toPublicProduct(row));
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE active=true ORDER BY created_at ASC LIMIT 500');
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json(result.rows.map(toPublicProduct));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await findProduct(req.params.id, false);
    if (!row) return res.status(404).json({ message: 'Produto não encontrado.' });
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json(toPublicProduct(row));
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const p = validateProduct(req.body || {});
    const result = await pool.query(
      `INSERT INTO products (name, description, price, category, icon, color, stock, active, image, gallery, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [p.name, p.description, p.price, p.category, p.icon, p.color, p.stock, p.active, p.image, p.gallery, p.details]
    );
    res.status(201).json(toPublicProduct(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = V.uuid(req.params.id, 'Produto');
    const p = validateProduct(req.body || {});
    const result = await pool.query(
      `UPDATE products SET name=$1, description=$2, price=$3, category=$4, icon=$5, color=$6,
         stock=$7, active=$8, image=$9, gallery=$10, details=$11, updated_at=now()
       WHERE id=$12 RETURNING *`,
      [p.name, p.description, p.price, p.category, p.icon, p.color, p.stock, p.active, p.image, p.gallery, p.details, id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Produto não encontrado.' });
    res.json(toPublicProduct(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = V.uuid(req.params.id, 'Produto');
    const result = await pool.query('UPDATE products SET active=false, updated_at=now() WHERE id=$1 RETURNING id', [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Produto não encontrado.' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
