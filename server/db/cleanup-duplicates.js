'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const apply = process.argv.includes('--apply');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' }
  });
  const client = await pool.connect();
  try {
    const duplicates = await client.query(`
      WITH ranked AS (
        SELECT id, name, category, price,
          row_number() OVER (
            PARTITION BY lower(trim(name)), lower(trim(category)), price, compare_at_price,
              trim(description), trim(COALESCE(details, '')), icon, color, stock,
              COALESCE(image, ''), gallery
            ORDER BY created_at, id
          ) AS position
        FROM products
        WHERE active=true
      )
      SELECT id, name, category, price FROM ranked WHERE position > 1 ORDER BY name
    `);

    if (!duplicates.rows.length) {
      console.log('✅ Nenhum produto duplicado encontrado.');
      return;
    }
    console.table(duplicates.rows);
    if (!apply) {
      console.log(`\n${duplicates.rows.length} duplicado(s) encontrado(s). Nenhum dado foi alterado.`);
      console.log('Revise a lista e execute: npm run cleanup:duplicates -- --apply');
      return;
    }

    await client.query('BEGIN');
    const deactivated = await client.query(`
      WITH ranked AS (
        SELECT id,
          row_number() OVER (
            PARTITION BY lower(trim(name)), lower(trim(category)), price, compare_at_price,
              trim(description), trim(COALESCE(details, '')), icon, color, stock,
              COALESCE(image, ''), gallery
            ORDER BY created_at, id
          ) AS position
        FROM products
        WHERE active=true
      )
      UPDATE products p SET active=false, updated_at=now()
      FROM ranked r
      WHERE p.id=r.id AND r.position > 1
      RETURNING p.id, p.name
    `);
    await client.query('COMMIT');
    console.log(`✅ ${deactivated.rowCount} produto(s) duplicado(s) desativado(s), sem apagar avaliações ou histórico.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Falha ao verificar duplicados:', err.message);
  process.exit(1);
});
