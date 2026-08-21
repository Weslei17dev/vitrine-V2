/* ============================================================================
   index.js
   ----------------------------------------------------------------------------
   Ponto de entrada da API. Uso:
     npm install
     npm run setup   (cria as tabelas e os dados iniciais)
     npm start        (ou npm run dev, que reinicia sozinho a cada alteração)
   ============================================================================ */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const config = require('./config');
const pool = require('./db');
const { securityHeaders, globalLimiter } = require('./security');
const { expirePendingOrders } = require('./utils/orderLifecycle');
const { startNeonPulse } = require('./keepAlive/neonPulse');
const { startRenderPulse } = require('./keepAlive/renderPulse');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(globalLimiter);

app.use(
  cors({
    origin(origin, callback) {
      // Permite chamadas sem "Origin" (ex: Postman/curl) e as origens configuradas.
      const normalizedOrigin = origin ? origin.replace(/\/$/, '') : null;
      if (!normalizedOrigin || (!config.isProduction && config.allowedOrigins.length === 0) || config.allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }
      const error = new Error('Origem não permitida.');
      error.status = 403;
      callback(error);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    maxAge: 86400
  })
);
app.use(express.json({ limit: config.maxJsonSize, strict: true }));

app.get('/api/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok' });
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/site-content', require('./routes/siteContent'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/reports', require('./routes/reports'));

app.use((req, res) => res.status(404).json({ message: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = Number(err.status) || (err.type === 'entity.too.large' ? 413 : 500);
  const publicMessage = status < 500 ? err.message : 'Erro interno do servidor.';
  res.status(status).json({ message: publicMessage, ...(err.code ? { code: err.code } : {}) });
});

const server = app.listen(config.port, () => {
  console.log(`✅ API da Brincar de Desejo rodando na porta ${config.port}`);
});

const stopNeonPulse = startNeonPulse(pool);
const stopRenderPulse = startRenderPulse();

const expirationTimer = setInterval(() => {
  expirePendingOrders().catch((err) => console.error('[orders] Falha ao expirar reservas:', err.message));
}, 60000);
expirationTimer.unref();

async function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando conexões...`);
  clearInterval(expirationTimer);
  stopNeonPulse();
  stopRenderPulse();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
