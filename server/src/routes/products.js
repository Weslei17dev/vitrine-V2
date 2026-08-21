'use strict';

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');
const V = require('../validation');
const { recordAudit } = require('../utils/audit');

const router = express.Router();

function toPublicProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    compareAtPrice: row.compare_at_price == null ? null : Number(row.compare_at_price),
    category: row.category,
    icon: row.icon,
    color: row.color,
    stock: row.stock,
    active: row.active,
    image: row.image,
    gallery: row.gallery || [],
    details: row.details,
    ratingAverage: Number(row.rating_average || 0),
    ratingCount: Number(row.rating_count || 0),
    updatedAt: row.updated_at
  };
}

function toProductSummary(row) {
  const product = toPublicProduct(row);
  delete product.gallery;
  delete product.details;
  return product;
}

function validateProduct(body) {
  const gallery = Array.isArray(body.gallery) ? body.gallery : [];
  if (gallery.length > 6) throw new V.ValidationError('A galeria aceita no máximo 6 imagens.');
  const price = V.positiveMoney(body.price);
  const compareAtPrice = V.optionalMoney(body.compareAtPrice, 'Valor anterior');
  if (compareAtPrice != null && compareAtPrice <= price) {
    throw new V.ValidationError('O valor anterior deve ser maior que o valor atual.');
  }
  return {
    name: V.text(body.name, 'Nome', { min: 2, max: 160 }),
    description: V.text(body.description, 'Descrição', { min: 3, max: 1200 }),
    price,
    compareAtPrice,
    category: V.text(body.category || 'Geral', 'Categoria', { max: 80 }),
    icon: V.text(body.icon || '🛍️', 'Ícone', { max: 8 }),
    color: V.color(body.color || '#D99163'),
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
    `SELECT p.*,
       COALESCE(r.rating_average, 0) AS rating_average,
       COALESCE(r.rating_count, 0) AS rating_count
     FROM products p
     LEFT JOIN (
       SELECT product_id, AVG(rating)::numeric(3,2) AS rating_average, COUNT(*)::integer AS rating_count
       FROM reviews WHERE approved=true GROUP BY product_id
     ) r ON r.product_id=p.id
     WHERE p.id=$1 ${includeInactive ? '' : 'AND p.active=true'}`,
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
    const result = await pool.query(`
      SELECT p.*,
        COALESCE(r.rating_average, 0) AS rating_average,
        COALESCE(r.rating_count, 0) AS rating_count
      FROM products p
      LEFT JOIN (
        SELECT product_id, AVG(rating)::numeric(3,2) AS rating_average, COUNT(*)::integer AS rating_count
        FROM reviews WHERE approved=true GROUP BY product_id
      ) r ON r.product_id=p.id
      WHERE p.active=true
      ORDER BY p.created_at ASC
      LIMIT 500
    `);
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json(result.rows.map(toProductSummary));
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
      `INSERT INTO products (name, description, price, compare_at_price, category, icon, color, stock, active, image, gallery, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [p.name, p.description, p.price, p.compareAtPrice, p.category, p.icon, p.color, p.stock, p.active, p.image, p.gallery, p.details]
    );
    await recordAudit(pool, {
      adminId: req.user.id, action: 'product.create', entityType: 'product', entityId: result.rows[0].id,
      details: { name: p.name, price: p.price, stock: p.stock }
    });
    res.status(201).json(toPublicProduct(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = V.uuid(req.params.id, 'Produto');
    const p = validateProduct(req.body || {});
    const expectedUpdatedAt = V.timestamp(req.body && req.body.updatedAt);
    const result = await pool.query(
      `UPDATE products SET name=$1, description=$2, price=$3, compare_at_price=$4, category=$5, icon=$6, color=$7,
         stock=$8, active=$9, image=$10, gallery=$11, details=$12, updated_at=now()
       WHERE id=$13 AND date_trunc('milliseconds', updated_at)=date_trunc('milliseconds', $14::timestamptz) RETURNING *`,
      [p.name, p.description, p.price, p.compareAtPrice, p.category, p.icon, p.color, p.stock, p.active, p.image, p.gallery, p.details, id, expectedUpdatedAt]
    );
    if (!result.rows[0]) {
      const exists = await pool.query('SELECT 1 FROM products WHERE id=$1', [id]);
      if (!exists.rows[0]) return res.status(404).json({ message: 'Produto não encontrado.' });
      return res.status(409).json({ code: 'stale_product', message: 'Este produto foi alterado em outra sessão. Reabra o formulário antes de salvar novamente.' });
    }
    await recordAudit(pool, {
      adminId: req.user.id, action: 'product.update', entityType: 'product', entityId: id,
      details: { name: p.name, price: p.price, stock: p.stock, active: p.active }
    });
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
    await recordAudit(pool, {
      adminId: req.user.id, action: 'product.deactivate', entityType: 'product', entityId: id, details: {}
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
