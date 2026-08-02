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
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

module.exports = pool;
