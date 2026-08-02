-- ============================================================================
-- schema.sql
-- ----------------------------------------------------------------------------
-- Schema completo do banco da loja "Brincar de Desejo".
-- Rode com: npm run migrate  (ou: npm run setup, que já roda migrate + seed)
-- Pode ser executado várias vezes sem erro (tudo usa IF NOT EXISTS).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- Usuários (clientes + administrador)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'admin')),
  cpf           text,
  phone         text,
  address       text,
  city          text,
  state         text,
  zip           text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Produtos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  price       numeric(10, 2) NOT NULL DEFAULT 0,
  category    text NOT NULL DEFAULT 'Geral',
  icon        text NOT NULL DEFAULT '🛍️',
  color       text NOT NULL DEFAULT '#FF3D82',
  stock       integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  image       text,
  gallery     jsonb NOT NULL DEFAULT '[]'::jsonb,
  details     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Sequência usada para gerar o número de pedido (ex: 000123).
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

-- ----------------------------------------------------------------------------
-- Pedidos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         text NOT NULL UNIQUE,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_name  text NOT NULL,
  items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  total          numeric(10, 2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'Aguardando Pagamento',
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  pix_payload    text,
  seen_by_admin  boolean NOT NULL DEFAULT false,
  order_date     text,
  order_time     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

-- ----------------------------------------------------------------------------
-- Avaliações de produtos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  author_name  text NOT NULL,
  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id);

-- ----------------------------------------------------------------------------
-- Conteúdo personalizável do site (banners, textos, tema, FAQ, PIX etc.)
-- Guardado como um único registro JSON — é a mesma estrutura que a aba
-- "Personalizar" do painel admin já editava no localStorage.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_content (
  id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  content    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
