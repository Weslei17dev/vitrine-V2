/* ============================================================================
   routes/auth.js
   ----------------------------------------------------------------------------
   POST /api/auth/register  — cria uma conta de cliente
   POST /api/auth/login     — login de cliente ou administrador
   ============================================================================ */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    cpf: row.cpf,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip
  };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

router.post('/register', async (req, res) => {
  const { name, email, password, cpf, phone, address, city, state, zip } = req.body || {};

  if (!name || !email || !password || !phone || !address || !city || !state || !zip) {
    return res.status(400).json({ message: 'Preencha todos os campos obrigatórios.' });
  }
  if (String(password).length < 3) {
    return res.status(400).json({ message: 'A senha deve ter ao menos 3 caracteres.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [String(email).toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ message: 'Este e-mail já está cadastrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, cpf, phone, address, city, state, zip)
       VALUES ($1, $2, $3, 'client', $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [name, String(email).toLowerCase(), passwordHash, cpf || null, phone, address, city, state, zip]
    );

    const user = toPublicUser(result.rows[0]);
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar a conta. Tente novamente.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'Preencha e-mail e senha.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [String(email).toLowerCase()]);
    const row = result.rows[0];
    if (!row) {
      return res.status(401).json({ message: 'E-mail ou senha inválidos.' });
    }

    const matches = await bcrypt.compare(password, row.password_hash);
    if (!matches) {
      return res.status(401).json({ message: 'E-mail ou senha inválidos.' });
    }

    const user = toPublicUser(row);
    res.json({ token: signToken(user), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao entrar. Tente novamente.' });
  }
});

module.exports = router;
