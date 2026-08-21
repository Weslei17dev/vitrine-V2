/* Autenticação, sessão e manutenção da conta do cliente. */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth-middleware');
const { authLimiter } = require('../security');
const V = require('../validation');
const { expirePendingOrders } = require('../utils/orderLifecycle');

const router = express.Router();
const dummyPasswordHash = bcrypt.hash('comparacao-de-tempo-sem-usuario-2026', 12);

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    adultConfirmed: Boolean(row.adult_confirmed_at)
  };
}

function signToken(user) {
  return jwt.sign(
    { ver: Number(user.token_version || 0) },
    config.jwtSecret,
    {
      algorithm: 'HS256',
      subject: user.id,
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      expiresIn: config.jwtExpiresIn
    }
  );
}

function validateProfile(body) {
  return {
    name: V.text(body.name, 'Nome', { min: 3, max: 120 }),
    phone: V.phone(body.phone),
    address: V.text(body.address, 'Endereço', { min: 5, max: 250 }),
    city: V.text(body.city, 'Cidade', { min: 2, max: 100 }),
    state: V.state(body.state),
    zip: V.zip(body.zip)
  };
}

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const profile = validateProfile(req.body || {});
    if (req.body.adultConfirmed !== true) {
      throw new V.ValidationError('Confirme que você possui 18 anos ou mais.');
    }
    const email = V.normalizeEmail(req.body && req.body.email);
    const userPassword = V.password(req.body && req.body.password);
    const passwordHash = await bcrypt.hash(userPassword, 12);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, phone, address, city, state, zip, adult_confirmed_at)
       VALUES ($1, $2, $3, 'client', $4, $5, $6, $7, $8, now())
       RETURNING *`,
      [profile.name, email, passwordHash, profile.phone, profile.address, profile.city, profile.state, profile.zip]
    );

    const row = result.rows[0];
    res.status(201).json({ token: signToken(row), user: toPublicUser(row) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Este e-mail já está cadastrado.' });
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = V.normalizeEmail(req.body && req.body.email);
    const suppliedPassword = String((req.body && req.body.password) || '');
    if (!suppliedPassword || suppliedPassword.length > 128) {
      return res.status(401).json({ message: 'E-mail ou senha inválidos.' });
    }

    const result = await pool.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const row = result.rows[0];
    const matches = await bcrypt.compare(suppliedPassword, row ? row.password_hash : await dummyPasswordHash);
    if (!row || !matches) return res.status(401).json({ message: 'E-mail ou senha inválidos.' });

    res.json({ token: signToken(row), user: toPublicUser(row) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => res.json(toPublicUser(req.user)));

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const profile = validateProfile(req.body || {});
    const result = await pool.query(
      `UPDATE users SET name=$1, phone=$2, address=$3, city=$4, state=$5, zip=$6, updated_at=now()
       WHERE id=$7 RETURNING *`,
      [profile.name, profile.phone, profile.address, profile.city, profile.state, profile.zip, req.user.id]
    );
    res.json(toPublicUser(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', requireAuth, authLimiter, async (req, res, next) => {
  try {
    const currentPassword = String((req.body && req.body.currentPassword) || '');
    const newPassword = V.password(req.body && req.body.newPassword, 'Nova senha');
    const found = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const matches = found.rows[0] && await bcrypt.compare(currentPassword, found.rows[0].password_hash);
    if (!matches) return res.status(400).json({ message: 'Senha atual incorreta.' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await pool.query(
      `UPDATE users SET password_hash=$1, token_version=token_version+1, updated_at=now()
       WHERE id=$2 RETURNING *`,
      [passwordHash, req.user.id]
    );
    const row = updated.rows[0];
    res.json({ token: signToken(row), user: toPublicUser(row) });
  } catch (err) {
    next(err);
  }
});

router.delete('/me', requireAuth, authLimiter, async (req, res, next) => {
  let client;
  try {
    if (req.user.role === 'admin') return res.status(403).json({ message: 'Contas administrativas não podem ser excluídas por esta rota.' });
    await expirePendingOrders();
    const suppliedPassword = String((req.body && req.body.password) || '');
    client = await pool.connect();
    await client.query('BEGIN');
    const found = await client.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
    const matches = found.rows[0] && await bcrypt.compare(suppliedPassword, found.rows[0].password_hash);
    if (!matches) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Senha incorreta.' });
    }

    const activeOrders = await client.query(
      `SELECT COUNT(*)::integer AS count FROM orders
       WHERE user_id=$1 AND status NOT IN ('Finalizado', 'Cancelado')`,
      [req.user.id]
    );
    if (activeOrders.rows[0].count > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'active_orders',
        message: 'Finalize ou cancele os pedidos em andamento antes de excluir a conta.'
      });
    }

    await client.query('DELETE FROM reviews WHERE user_id=$1', [req.user.id]);
    await client.query(
      `UPDATE orders SET user_id=NULL, customer_name='Cliente excluído',
         shipping_phone=NULL, shipping_address=NULL, shipping_city=NULL, shipping_state=NULL, shipping_zip=NULL,
         idempotency_key=NULL, updated_at=now()
       WHERE user_id=$1`,
      [req.user.id]
    );
    await client.query('DELETE FROM users WHERE id=$1', [req.user.id]);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
