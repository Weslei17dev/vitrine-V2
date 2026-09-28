-- PostgreSQL: execute uma vez no SQL Editor do Supabase, antes de publicar a API.
-- Reexecutável; mantém produtos e pedidos existentes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('automatic','coupon')),
  code text UNIQUE,
  scope text NOT NULL CHECK (scope IN ('all','category','product')),
  category text,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','fixed')),
  value numeric(10,2) NOT NULL CHECK (value > 0),
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
CREATE INDEX IF NOT EXISTS idx_promotions_active ON public.promotions(kind,active,starts_at,ends_at);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_total numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS automatic_discount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_discount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_code text;
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  promotion_id uuid NOT NULL REFERENCES public.promotions(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_promotion ON public.coupon_redemptions(promotion_id);
-- A API usa a conexão proprietária do banco; clientes anon/authenticated não acessam estas tabelas pelo REST do Supabase.
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
COMMIT;
