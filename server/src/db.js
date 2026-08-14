/* ============================================================================
   db.js
   ----------------------------------------------------------------------------
   Pool de conexão único, compartilhado por todas as rotas.
   ============================================================================ */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ Variável DATABASE_URL não encontrada. Configure o arquivo .env (veja .env.example).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' },
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
  query_timeout: 20000,
  application_name: 'brincar-de-desejo-api'
});

pool.on('error', (err) => console.error('Erro inesperado no pool PostgreSQL:', err));

module.exports = pool;
