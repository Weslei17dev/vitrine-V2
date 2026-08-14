/* ============================================================================
   routes/reviews.js
   ----------------------------------------------------------------------------
   GET  /api/reviews/product/:productId — avaliações públicas de um produto
   POST /api/reviews                    — cria avaliação (cliente logado)
   ============================================================================ */

const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../auth-middleware');

const router = express.Router();

function toPublicReview(row) {
  return {
    id: row.id,
    productId: row.product_id,
    authorName: row.author_name,
    rating: row.rating,
    comment: row.comment,
    date: new Date(row.created_at).toLocaleDateString('pt-BR'),
    createdAt: row.created_at
  };
}

router.get('/product/:productId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM reviews WHERE product_id = $1 ORDER BY created_at DESC',
      [req.params.productId]
    );
    res.json(result.rows.map(toPublicReview));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar avaliações.' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const { productId, rating, comment } = req.body || {};
  if (!productId || !comment || !comment.trim()) {
    return res.status(400).json({ message: 'Escreva um comentário antes de enviar.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO reviews (product_id, author_name, rating, comment) VALUES ($1,$2,$3,$4) RETURNING *`,
      [productId, req.user.name, Math.min(5, Math.max(1, Math.round(rating) || 5)), comment.trim()]
    );
    res.status(201).json(toPublicReview(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao enviar avaliação.' });
  }
});

module.exports = router;
