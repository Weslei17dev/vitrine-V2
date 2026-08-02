/* ============================================================================
   auth-middleware.js
   ----------------------------------------------------------------------------
   requireAuth: exige um token válido (qualquer usuário logado).
   requireAdmin: exige um token válido cujo usuário seja admin.
   O token é lido do header "Authorization: Bearer <token>".
   ============================================================================ */

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Faça login para continuar.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, name, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Sessão expirada. Faça login novamente.' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Acesso restrito ao administrador.' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
