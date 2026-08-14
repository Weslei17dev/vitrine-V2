'use strict';

const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../auth-middleware');
const { reviewLimiter } = require('../security');
const V = require('../validation');

const router = express.Router();

function toPublicReview(row) {
  return {
    id: row.id,
    productId: row.product_id,
    authorName: row.author_name,
    rating: row.rating,
    comment: row.comment,
    verifiedPurchase: row.verified_purchase,
    date: new Date(row.created_at).toLocaleDateString('pt-BR'),
    createdAt: row.created_at
  };
}

router.get('/product/:productId', async (req, res, next) => {
  try {
    const productId = V.uuid(req.params.productId, 'Produto');
    const result = await pool.query(
      'SELECT * FROM reviews WHERE product_id=$1 AND approved=true ORDER BY created_at DESC LIMIT 200',
      [productId]
    );
    res.json(result.rows.map(toPublicReview));
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, reviewLimiter, async (req, res, next) => {
  try {
    if (req.user.role !== 'client') return res.status(403).json({ message: 'Apenas clientes podem avaliar produtos.' });
    const productId = V.uuid(req.body && req.body.productId, 'Produto');
    const rating = V.positiveInteger(req.body && req.body.rating, 'Nota', 5);
    const comment = V.text(req.body && req.body.comment, 'Comentário', { min: 3, max: 1000 });

    const product = await pool.query('SELECT id FROM products WHERE id=$1 AND active=true', [productId]);
    if (!product.rows[0]) return res.status(404).json({ message: 'Produto não encontrado.' });

    const purchase = await pool.query(
      `SELECT 1
       FROM orders o, jsonb_array_elements(o.items) item
       WHERE o.user_id=$1
         AND o.status IN ('Pago','Em Produção','Enviado','Finalizado')
         AND item->>'productId'=$2
       LIMIT 1`,
      [req.user.id, productId]
    );
    if (!purchase.rows[0]) {
      return res.status(403).json({ message: 'A avaliação é liberada após a confirmação da compra deste produto.' });
    }

    const result = await pool.query(
      `INSERT INTO reviews (product_id, user_id, author_name, rating, comment, verified_purchase, approved)
       VALUES ($1,$2,$3,$4,$5,true,true)
       ON CONFLICT (user_id, product_id) WHERE user_id IS NOT NULL
       DO UPDATE SET author_name=EXCLUDED.author_name, rating=EXCLUDED.rating, comment=EXCLUDED.comment,
         verified_purchase=true, approved=true, updated_at=now()
       RETURNING *`,
      [productId, req.user.id, req.user.name, rating, comment]
    );
    res.status(201).json(toPublicReview(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = V.uuid(req.params.id, 'Avaliação');
    const deleted = await pool.query('DELETE FROM reviews WHERE id=$1 RETURNING id', [id]);
    if (!deleted.rows[0]) return res.status(404).json({ message: 'Avaliação não encontrada.' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
