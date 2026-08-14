'use strict';

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function createRateLimit({ windowMs, max, message }) {
  const hits = new Map();
  let lastCleanup = Date.now();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    if (now - lastCleanup > windowMs) {
      for (const [key, entry] of hits.entries()) {
        if (entry.resetAt <= now) hits.delete(key);
      }
      lastCleanup = now;
    }

    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }
    next();
  };
}

const globalLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 500,
  message: 'Muitas solicitações. Aguarde alguns minutos e tente novamente.'
});

const authLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  message: 'Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente.'
});

const orderLimiter = createRateLimit({
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.ORDER_RATE_LIMIT_MAX) || 20,
  message: 'Muitas tentativas de pedido. Aguarde alguns minutos.'
});

const reviewLimiter = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.REVIEW_RATE_LIMIT_MAX) || 10,
  message: 'Limite de avaliações atingido. Tente novamente mais tarde.'
});

module.exports = { securityHeaders, globalLimiter, authLimiter, orderLimiter, reviewLimiter };
