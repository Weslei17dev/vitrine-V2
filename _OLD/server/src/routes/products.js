/* ============================================================================
   routes/products.js
   ----------------------------------------------------------------------------
   GET    /api/products       — lista pública
   GET    /api/products/:id   — detalhe público
   POST   /api/products       — cria (admin)
   PUT    /api/products/:id   — edita (admin)
   DELETE /api/products/:id   — remove (admin)
   ============================================================================ */

const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../auth-middleware');

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

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY created_at ASC');
    res.json(result.rows.map(toPublicProduct));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar produtos.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Produto não encontrado.' });
    res.json(toPublicProduct(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar produto.' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const { name, description, price, category, icon, color, stock, active, image, gallery, details } = req.body || {};
  if (!name || !description || !(price > 0)) {
    return res.status(400).json({ message: 'Preencha nome, descrição e um preço válido.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO products (name, description, price, category, icon, color, stock, active, image, gallery, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        name, description, price, category || 'Geral', icon || '🛍️', color || '#FF3D82',
        stock || 0, active !== false, image || null, JSON.stringify(gallery || []), details || null
      ]
    );
    res.status(201).json(toPublicProduct(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar produto.' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const { name, description, price, category, icon, color, stock, active, image, gallery, details } = req.body || {};
  if (!name || !description || !(price > 0)) {
    return res.status(400).json({ message: 'Preencha nome, descrição e um preço válido.' });
  }

  try {
    const result = await pool.query(
      `UPDATE products SET
         name=$1, description=$2, price=$3, category=$4, icon=$5, color=$6,
         stock=$7, active=$8, image=$9, gallery=$10, details=$11
       WHERE id=$12 RETURNING *`,
      [
        name, description, price, category || 'Geral', icon || '🛍️', color || '#FF3D82',
        stock || 0, active !== false, image || null, JSON.stringify(gallery || []), details || null,
        req.params.id
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Produto não encontrado.' });
    res.json(toPublicProduct(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao editar produto.' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao remover produto.' });
  }
});

module.exports = router;
