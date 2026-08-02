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

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'administrador@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Administrador';

const SITE_CONTENT_DEFAULTS = {
  theme: {
    bg: '#150A10',
    surface: '#211019',
    primary: '#FF3D82',
    primaryDark: '#C81760',
    accent: '#FF3B4E',
    accentDark: '#C4172A',
    text: '#F5EBEF',
    textMuted: '#B49AA8',
    dark: '#0B0509'
  },
  pix: {
    chave: 'SUA_CHAVE_PIX_AQUI',
    nomeBeneficiario: 'BRINCAR DE DESEJO',
    cidadeBeneficiario: 'SAO PAULO'
  },
  hero: {
    eyebrow: 'Bem-vindo(a) à Brincar de Desejo',
    title: 'Desejo, prazer e sedução\nem um só lugar.',
    subtitle:
      'Produtos selecionados com cuidado, entrega discreta e atendimento sem julgamentos. ' +
      'Veja o catálogo à vontade — o login só é pedido na hora de fechar o pedido.',
    ctaText: 'Ver produtos'
  },
  carousel: [
    { image: 'img/promo-dessensibilizante.jpg', alt: 'Dessensibilizante — conforto é prioridade para iniciantes ou amadores' },
    { image: 'img/promo-bdsm.jpg', alt: 'BDSM — fetiches escondidos' },
    { image: 'img/promo-acessorios.jpg', alt: 'Acessórios — fetiches escondidos, quanto mais enfeite melhor' },
    { image: 'img/promo-desconto.jpg', alt: '10% de desconto na primeira compra, cupom 10DE10' }
  ],
  flashSale: {
    tag: 'Oferta Relâmpago',
    title: 'Aproveite antes que acabe!',
    description: 'Selecionamos os itens mais desejados com condições especiais por tempo limitado.'
  },
  about: {
    image: 'img/quem-somos.jpg',
    eyebrow: 'Quem somos',
    title: 'Prazer, autoconhecimento e liberdade — sem tabus.',
    paragraph1:
      'A Brincar de Desejo nasceu para tornar o universo da sexualidade mais leve, acessível e livre ' +
      'de julgamentos. Selecionamos cada produto com cuidado, pensando em conforto, qualidade e ' +
      'segurança para todos os corpos e desejos.',
    paragraph2:
      'Da escolha à entrega, prezamos pela sua privacidade: embalagens sem identificação, atendimento ' +
      'humano e discrição do primeiro clique até a porta de casa.',
    bullets: ['Produtos testados e aprovados', 'Atendimento humano e sem julgamentos', 'Compromisso com a sua privacidade']
  },
  spotlight: {
    image: 'img/promo-dessensibilizante.jpg',
    eyebrow: 'Mais vendido da semana',
    title: 'Dessensibilizante — conforto é prioridade',
    text:
      'Pensado para iniciantes ou amadores, prolonga o prazer com uma fórmula suave que não tira a ' +
      'sensibilidade. Aplicação simples e absorção rápida, para uma experiência mais confortável a dois.',
    buttonText: 'Ver produtos relacionados'
  },
  faq: [
    { q: 'Minha compra é realmente discreta?', a: 'Sim. Todo pedido é enviado em embalagem neutra, sem qualquer identificação da loja ou do conteúdo, tanto na caixa quanto na nota fiscal e no nome do remetente.' },
    { q: 'Preciso criar conta para ver os produtos?', a: 'Não. Você pode navegar por todo o catálogo, buscar e filtrar produtos livremente sem login. A conta só é pedida na hora de finalizar o pedido.' },
    { q: 'Quais formas de pagamento vocês aceitam?', a: 'Trabalhamos com PIX via QR Code, com aprovação em poucos minutos após o pagamento.' },
    { q: 'Em quanto tempo meu pedido chega?', a: 'Após a aprovação do pagamento, o pedido é preparado e enviado rapidamente. Você acompanha cada etapa em tempo real na sua área do cliente.' },
    { q: 'Posso trocar ou devolver um produto?', a: 'Sim, seguindo nossa política de trocas e devoluções. Entre em contato com a Central de Atendimento informando o número do seu pedido.' },
    { q: 'Meus dados estão seguros?', a: 'Sim. Seus dados são usados apenas para processar o pedido e nunca são compartilhados. Todo o site utiliza conexão segura.' }
  ],
  footer: {
    about: 'Loja online de produtos eróticos com atendimento humano, embalagem discreta e entrega para todo o Brasil.',
    phone: '(11) 4810-6810',
    email: 'sac@brincardedesejo.com.br',
    hours1: 'Seg. a Sex. das 8h às 18h',
    hours2: 'Sábados das 8h às 12h'
  }
};

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

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  const client = await pool.connect();

  try {
    // ------------------------------------------------------------------
    // Administrador
    // ------------------------------------------------------------------
    const existingAdmin = await client.query('SELECT id FROM users WHERE email = $1', [ADMIN_EMAIL]);
    if (existingAdmin.rows.length === 0) {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await client.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
        [ADMIN_NAME, ADMIN_EMAIL, passwordHash]
      );
      console.log(`✅ Conta de administrador criada: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
      console.log('   ⚠️  Troque essa senha assim que possível (crie um novo admin e remova este, ou ' +
        'rode o seed de novo com ADMIN_PASSWORD diferente antes do primeiro deploy público).');
    } else {
      console.log('↷ Conta de administrador já existe, mantida como está.');
    }

    // ------------------------------------------------------------------
    // Conteúdo do site
    // ------------------------------------------------------------------
    const existingContent = await client.query('SELECT id FROM site_content WHERE id = 1');
    if (existingContent.rows.length === 0) {
      await client.query('INSERT INTO site_content (id, content) VALUES (1, $1)', [SITE_CONTENT_DEFAULTS]);
      console.log('✅ Conteúdo padrão do site criado (banners, textos, tema, FAQ, PIX).');
    } else {
      console.log('↷ Conteúdo do site já existe, mantido como está.');
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
          `INSERT INTO reviews (product_id, author_name, rating, comment) VALUES
           ($1, 'Cliente verificado', 5, 'Produto excelente, chegou super rápido e a embalagem era bem discreta como prometido.'),
           ($1, 'Cliente verificado', 4, 'Muito bom, só achei o frasco um pouco pequeno para o preço.')`,
          [insertedIds[0]]
        );
      }
      if (insertedIds[1]) {
        await client.query(
          `INSERT INTO reviews (product_id, author_name, rating, comment) VALUES
           ($1, 'Cliente verificado', 5, 'Superou minhas expectativas, recomendo muito!')`,
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
