/* ============================================================================
   migrate.js
   ----------------------------------------------------------------------------
   Cria (ou atualiza) todas as tabelas do banco a partir de db/schema.sql.
   Uso:  npm run migrate
   Pode rodar quantas vezes quiser — o schema usa "IF NOT EXISTS" em tudo.
   ============================================================================ */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('\n❌ Variável DATABASE_URL não encontrada.');
    console.error('   Copie o arquivo .env.example para .env e preencha com a connection string do Neon.\n');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' }
  });

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  console.log('▶ Conectando ao banco...');
  const client = await pool.connect();

  try {
    console.log('▶ Rodando schema.sql (criando tabelas)...');
    await client.query('BEGIN');
    await client.query(schemaSql);
    await client.query('COMMIT');
    console.log('✅ Banco de dados pronto! Todas as tabelas foram criadas.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\n❌ Falha ao rodar a migração:', err.message);
  process.exit(1);
});
