'use strict';

const isProduction = process.env.NODE_ENV === 'production';

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function requireSecret(name, minLength) {
  const value = String(process.env[name] || '');
  if (!value) throw new Error(`Variável ${name} não configurada.`);
  if (isProduction && value.length < minLength) {
    throw new Error(`${name} deve ter pelo menos ${minLength} caracteres em produção.`);
  }
  return value;
}

const allowedOrigins = splitList(process.env.ALLOWED_ORIGINS);

if (isProduction && allowedOrigins.length === 0) {
  throw new Error('ALLOWED_ORIGINS deve ser configurada em produção.');
}

module.exports = {
  isProduction,
  allowedOrigins,
  jwtSecret: requireSecret('JWT_SECRET', 32),
  jwtIssuer: process.env.JWT_ISSUER || 'brincar-de-desejo-api',
  jwtAudience: process.env.JWT_AUDIENCE || 'brincar-de-desejo-web',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  port: Number(process.env.PORT) || 3000,
  maxJsonSize: process.env.MAX_JSON_SIZE || '3mb',
  orderPaymentTtlMinutes: Math.max(10, Math.min(1440, Number(process.env.ORDER_PAYMENT_TTL_MINUTES) || 30)),
  maxOpenOrdersPerUser: Math.max(1, Math.min(10, Number(process.env.MAX_OPEN_ORDERS_PER_USER) || 3))
};
