/* ============================================================================
   auth-middleware.js
   ----------------------------------------------------------------------------
   requireAuth: exige um token válido (qualquer usuário logado).
   requireAdmin: exige um token válido cujo usuário seja admin.
   O token é lido do header "Authorization: Bearer <token>".
   ============================================================================ */

const jwt = require('jsonwebtoken');
const pool = require('./db');
const config = require('./config');

function readToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

async function authenticate(req) {
  const token = readToken(req);
  if (!token) {
    const error = new Error('Faça login para continuar.');
    error.status = 401;
    throw error;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: config.jwtIssuer,
      audience: config.jwtAudience
    });
    const result = await pool.query(
      'SELECT id, name, email, role, cpf, phone, address, city, state, zip, token_version FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user || Number(user.token_version || 0) !== Number(payload.ver || 0)) throw new Error('revoked');
    req.user = user;
    return user;
  } catch (err) {
    const authError = new Error('Sessão expirada. Faça login novamente.');
    authError.status = 401;
    throw authError;
  }
}

async function requireAuth(req, res, next) {
  try {
    await authenticate(req);
    next();
  } catch (err) {
    next(err);
  }
}

async function requireAdmin(req, res, next) {
  try {
    await authenticate(req);
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acesso restrito ao administrador.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, requireAdmin };
