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
  avatar        text,
  token_version integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users DROP COLUMN IF EXISTS adult_confirmed_at;
-- O CPF não é necessário no fluxo atual e deixa de ser retido.
UPDATE users SET cpf = NULL WHERE cpf IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

-- ----------------------------------------------------------------------------
-- Produtos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  price       numeric(10, 2) NOT NULL DEFAULT 0,
  compare_at_price numeric(10, 2),
  category    text NOT NULL DEFAULT 'Geral',
  icon        text NOT NULL DEFAULT '🛍️',
  color       text NOT NULL DEFAULT '#D99163',
  stock       integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  image       text,
  gallery     jsonb NOT NULL DEFAULT '[]'::jsonb,
  colors      jsonb NOT NULL DEFAULT '[]'::jsonb,
  details     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE products ADD COLUMN IF NOT EXISTS colors jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price numeric(10, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price numeric(10, 2) CHECK (cost_price >= 0);
DO $$
BEGIN
  ALTER TABLE products ADD CONSTRAINT products_price_positive CHECK (price > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE products ADD CONSTRAINT products_stock_nonnegative CHECK (stock >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE products ADD CONSTRAINT products_compare_price_valid
    CHECK (compare_at_price IS NULL OR compare_at_price > price) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_products_active_category ON products(active, category);

-- Categorias editáveis exibidas na vitrine.
CREATE TABLE IF NOT EXISTS categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  image      text,
  color      text NOT NULL DEFAULT '#D99163',
  active     boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_categories_active_order ON categories(active, sort_order, name);
INSERT INTO categories (name, color, sort_order)
SELECT category, MIN(color), row_number() OVER (ORDER BY MIN(created_at))
FROM products WHERE category IS NOT NULL AND btrim(category) <> '' GROUP BY category
ON CONFLICT (name) DO NOTHING;

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
  shipping_phone text,
  shipping_address text,
  shipping_city  text,
  shipping_state text,
  shipping_zip   text,
  items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal       numeric(10, 2) NOT NULL DEFAULT 0,
  shipping_total numeric(10, 2) NOT NULL DEFAULT 0,
  total          numeric(10, 2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'Aguardando Pagamento',
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  pix_payload    text,
  seen_by_admin  boolean NOT NULL DEFAULT false,
  idempotency_key text,
  payment_reported_at timestamptz,
  stock_restored boolean NOT NULL DEFAULT false,
  expires_at     timestamptz,
  cancel_reason  text,
  order_date     text,
  order_time     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_city text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_state text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_zip text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal numeric(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_total numeric(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reported_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_restored boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason text;
DO $$
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_money_nonnegative
    CHECK (subtotal >= 0 AND shipping_total >= 0 AND total >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_status_valid CHECK (status IN (
    'Aguardando Pagamento', 'Aguardando Confirmação', 'Pago',
    'Em Produção', 'Enviado', 'Finalizado', 'Cancelado'
  )) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
UPDATE orders SET expires_at = created_at + interval '30 minutes'
WHERE status='Aguardando Pagamento' AND expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_reporting ON orders(created_at DESC, status, user_id);
CREATE INDEX IF NOT EXISTS idx_orders_items_gin ON orders USING gin(items jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_orders_payment_expiry ON orders(expires_at)
  WHERE status = 'Aguardando Pagamento' AND stock_restored = false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_idempotency
  ON orders(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Descontos automáticos e cupons (mesma estrutura da migração independente).
CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('automatic','coupon')),
  code text UNIQUE,
  scope text NOT NULL CHECK (scope IN ('all','category','product')),
  category text,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','fixed','free_shipping')),
  value numeric(10,2) NOT NULL CHECK ((discount_type='free_shipping' AND value=0) OR (discount_type<>'free_shipping' AND value>0)),
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotions_code_kind CHECK ((kind='coupon' AND code IS NOT NULL) OR (kind='automatic' AND code IS NULL)),
  CONSTRAINT promotions_scope_target CHECK ((scope='all' AND category IS NULL AND product_id IS NULL) OR (scope='category' AND category IS NOT NULL AND product_id IS NULL) OR (scope='product' AND product_id IS NOT NULL AND category IS NULL)),
  CONSTRAINT promotions_value_percent CHECK (discount_type <> 'percent' OR value <= 100),
  CONSTRAINT promotions_usage_limit CHECK (max_uses IS NULL OR used_count <= max_uses),
  CONSTRAINT promotions_dates CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(kind,active,starts_at,ends_at);
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_discount_type_check;
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_value_check;
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_shipping_type;
ALTER TABLE promotions ADD CONSTRAINT promotions_shipping_type CHECK (
  discount_type IN ('percent','fixed','free_shipping') AND
  ((discount_type='free_shipping' AND value=0 AND kind='coupon') OR
   (discount_type<>'free_shipping' AND value>0))
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_total numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS automatic_discount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_discount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_discount numeric(10,2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_promotion ON coupon_redemptions(promotion_id);
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;

SELECT setval(
  'order_number_seq',
  GREATEST(
    (SELECT last_value FROM order_number_seq),
    COALESCE((SELECT MAX(number::bigint) FROM orders WHERE number ~ '^[0-9]+$'), 1)
  ),
  (SELECT is_called FROM order_number_seq)
    OR EXISTS (SELECT 1 FROM orders WHERE number ~ '^[0-9]+$')
);

-- ----------------------------------------------------------------------------
-- Avaliações de produtos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name  text NOT NULL,
  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      text NOT NULL DEFAULT '',
  verified_purchase boolean NOT NULL DEFAULT false,
  approved     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS verified_purchase boolean NOT NULL DEFAULT false;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT true;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE reviews ALTER COLUMN approved SET DEFAULT false;
-- Nenhuma identificação pessoal antiga permanece visível no catálogo.
UPDATE reviews SET author_name = CASE
  WHEN verified_purchase = true OR user_id IS NOT NULL THEN 'Cliente verificado'
  ELSE 'Cliente'
END;

CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_one_per_user_product
  ON reviews(user_id, product_id) WHERE user_id IS NOT NULL;

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

-- ----------------------------------------------------------------------------
-- Auditoria administrativa
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id          bigserial PRIMARY KEY,
  admin_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs(created_at DESC);
