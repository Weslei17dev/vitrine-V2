/* ============================================================================
   seed.js
   ----------------------------------------------------------------------------
   Popula o banco com o necessário pra loja funcionar assim que você subir:
   - a conta de administrador
   - o conteúdo padrão do site (banners, textos, tema, FAQ, PIX)
   - alguns produtos e avaliações de exemplo (pode apagar depois pelo painel)

   Uso:  npm run seed   (ou npm run setup, que já roda migrate + seed juntos)
   Pode rodar de novo sem duplicar nada — ele verifica o que já existe.
   ============================================================================ */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { SITE_CONTENT_DEFAULTS, deepMerge } = require('../src/site-defaults');

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const ADMIN_NAME = process.env.ADMIN_NAME || 'Administrador';

const PRODUCTS = [
  { name: 'Conjunto Renda Sedução', description: 'Lingerie em renda delicada com detalhes em fita de cetim.', price: 129.9, category: 'Lingerie', icon: '🎀', color: '#C2185B', stock: 34 },
  { name: 'Camisola Noite de Seda', description: 'Toque macio, caimento leve e alças ajustáveis.', price: 159.9, category: 'Linha Noite', icon: '🌙', color: '#8E1245', stock: 20 },
  { name: 'Óleo de Massagem Aromático', description: 'Fórmula hidratante com fragrância suave, ideal para casais.', price: 49.9, category: 'Cosméticos', icon: '🌸', color: '#FF6F91', stock: 55 },
  { name: 'Vela de Massagem Relaxante', description: 'Derrete em óleo morno para uma massagem sensorial.', price: 59.9, category: 'Linha Noite', icon: '🕯️', color: '#D4A537', stock: 26 },
  { name: 'Kit Higiene Íntima Premium', description: 'Sabonete líquido suave e loção hidratante pós-uso.', price: 69.9, category: 'Higiene', icon: '🧴', color: '#17915F', stock: 40 },
  { name: 'Fantasia Enfermeira Sedutora', description: 'Look completo com acabamento em renda, tamanho único.', price: 139.9, category: 'Fantasias', icon: '💋', color: '#D1435B', stock: 18 },
  { name: 'Perfume Corporal Afrodisíaco', description: 'Fragrância envolvente de longa duração.', price: 89.9, category: 'Cosméticos', icon: '🌺', color: '#E64F72', stock: 30 },
  { name: 'Venda de Cetim para Casais', description: 'Tecido macio que bloqueia totalmente a visão, para brincadeiras a dois.', price: 34.9, category: 'Acessórios', icon: '🎭', color: '#241220', stock: 45 },
  { name: 'Body Rendado Duas Peças', description: 'Modelagem que valoriza as curvas, com fechamento em gancho.', price: 119.9, category: 'Lingerie', icon: '💕', color: '#C2185B', stock: 22 }
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('\n❌ Variável DATABASE_URL não encontrada. Configure o arquivo .env primeiro.\n');
    process.exit(1);
  }
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('\n❌ Configure ADMIN_EMAIL e ADMIN_PASSWORD antes de executar o seed.\n');
    process.exit(1);
  }
  if (ADMIN_PASSWORD.length < 10 || !/[A-Za-zÀ-ÿ]/.test(ADMIN_PASSWORD) || !/\d/.test(ADMIN_PASSWORD)) {
    console.error('\n❌ ADMIN_PASSWORD deve ter pelo menos 10 caracteres, contendo letras e números.\n');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' }
  });

  const client = await pool.connect();

  try {
    // ------------------------------------------------------------------
    // Administrador
    // ------------------------------------------------------------------
    const existingAdmin = await client.query('SELECT id, role FROM users WHERE lower(email) = $1', [ADMIN_EMAIL]);
    if (existingAdmin.rows.length === 0) {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      await client.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
        [ADMIN_NAME, ADMIN_EMAIL, passwordHash]
      );
      console.log(`✅ Conta de administrador criada: ${ADMIN_EMAIL}`);
    } else {
      if (existingAdmin.rows[0].role !== 'admin') {
        throw new Error('ADMIN_EMAIL pertence a uma conta de cliente. Escolha outro e-mail para não promover uma conta por engano.');
      }
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      await client.query(
        `UPDATE users SET name=$1, password_hash=$2, role='admin', token_version=token_version+1, updated_at=now()
         WHERE lower(email)=$3`,
        [ADMIN_NAME, passwordHash, ADMIN_EMAIL]
      );
      console.log('✅ Conta de administrador atualizada e sessões antigas revogadas.');
    }

    // ------------------------------------------------------------------
    // Conteúdo do site
    // ------------------------------------------------------------------
    const existingContent = await client.query('SELECT id, content FROM site_content WHERE id = 1');
    if (existingContent.rows.length === 0) {
      await client.query('INSERT INTO site_content (id, content) VALUES (1, $1)', [SITE_CONTENT_DEFAULTS]);
      console.log('✅ Conteúdo padrão do site criado (banners, textos, tema, FAQ, PIX).');
    } else {
      const storedContent = existingContent.rows[0].content || {};
      const repairedContent = deepMerge(SITE_CONTENT_DEFAULTS, storedContent);
      if (storedContent.theme && storedContent.theme.primary === '#FF3D82' && storedContent.theme.bg === '#150A10') {
        repairedContent.theme = { ...SITE_CONTENT_DEFAULTS.theme };
      }
      repairedContent.carousel = (Array.isArray(storedContent.carousel) ? storedContent.carousel : [])
        .map((slide, index) => ({
          ...(SITE_CONTENT_DEFAULTS.carousel[index % SITE_CONTENT_DEFAULTS.carousel.length] || SITE_CONTENT_DEFAULTS.carousel[0]),
          ...(slide || {})
        }));
      if (!repairedContent.carousel.length) repairedContent.carousel = SITE_CONTENT_DEFAULTS.carousel;
      await client.query('UPDATE site_content SET content=$1, updated_at=now() WHERE id=1', [repairedContent]);
      console.log('✅ Conteúdo do site verificado e campos ausentes restaurados.');
    }

    // ------------------------------------------------------------------
    // Produtos de demonstração (só insere se a tabela estiver vazia)
    // ------------------------------------------------------------------
    const existingProducts = await client.query('SELECT count(*)::int AS count FROM products');
    if (existingProducts.rows[0].count === 0) {
      const insertedIds = [];
      for (const p of PRODUCTS) {
        const result = await client.query(
          `INSERT INTO products (name, description, price, category, icon, color, stock, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
          [p.name, p.description, p.price, p.category, p.icon, p.color, p.stock]
        );
        insertedIds.push(result.rows[0].id);
      }
      console.log(`✅ ${PRODUCTS.length} produtos de demonstração criados.`);

      // Algumas avaliações de exemplo nos dois primeiros produtos.
      if (insertedIds[0]) {
        await client.query(
          `INSERT INTO reviews (product_id, author_name, rating, comment, verified_purchase, approved) VALUES
           ($1, 'Cliente', 5, 'Produto excelente e embalagem discreta.', false, true),
           ($1, 'Cliente', 4, 'Gostei do produto e do atendimento.', false, true)`,
          [insertedIds[0]]
        );
      }
      if (insertedIds[1]) {
        await client.query(
          `INSERT INTO reviews (product_id, author_name, rating, comment, verified_purchase, approved) VALUES
           ($1, 'Cliente', 5, 'Superou minhas expectativas.', false, true)`,
          [insertedIds[1]]
        );
      }
      console.log('✅ Avaliações de demonstração criadas.');
    } else {
      console.log('↷ Já existem produtos cadastrados, nenhum produto de demonstração foi criado.');
    }

    console.log('\n🎉 Seed concluído.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\n❌ Falha ao rodar o seed:', err.message);
  process.exit(1);
});
