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
    avatar: row.avatar || ''
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
    zip: V.zip(body.zip),
    avatar: V.imageSource(body.avatar || '', 'Foto do perfil')
  };
}

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const profile = validateProfile(req.body || {});
    const email = V.normalizeEmail(req.body && req.body.email);
    const userPassword = V.password(req.body && req.body.password);
    const passwordHash = await bcrypt.hash(userPassword, 12);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, phone, address, city, state, zip)
       VALUES ($1, $2, $3, 'client', $4, $5, $6, $7, $8)
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

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!result.rows[0]) return res.status(401).json({ message: 'Sessão inválida.' });
    res.json(toPublicUser(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const profile = validateProfile(req.body || {});
    const result = await pool.query(
      `UPDATE users SET name=$1, phone=$2, address=$3, city=$4, state=$5, zip=$6, avatar=$7, updated_at=now()
       WHERE id=$8 RETURNING *`,
      [profile.name, profile.phone, profile.address, profile.city, profile.state, profile.zip, profile.avatar, req.user.id]
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

module.exports = router;
