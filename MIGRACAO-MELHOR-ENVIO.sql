-- Execute no SQL Editor do Supabase antes de publicar a API integrada.
-- Reexecutável: não inventa medidas para produtos ou frete para pedidos antigos.
BEGIN;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shipping_weight_kg numeric(8,3);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shipping_height_cm numeric(8,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shipping_width_cm numeric(8,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shipping_length_cm numeric(8,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_provider text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_quote_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_service_id integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_company text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_service text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_cost numeric(10,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_estimated_days integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_tracking_code text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_transport_status text;

CREATE TABLE IF NOT EXISTS public.me_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
  sender jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.me_oauth_tokens (
  id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
  environment text NOT NULL CHECK(environment IN ('sandbox','production')),
  access_cipher text NOT NULL,
  refresh_cipher text NOT NULL,
  expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.me_oauth_tokens ALTER COLUMN refresh_expires_at DROP NOT NULL;
CREATE TABLE IF NOT EXISTS public.me_oauth_states (
  state_hash text PRIMARY KEY,
  admin_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  environment text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.me_shipping_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  zip text NOT NULL,
  cart_hash text NOT NULL,
  coupon_code text,
  options jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_me_quotes_expires ON public.me_shipping_quotes(expires_at);
CREATE TABLE IF NOT EXISTS public.me_shipments (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  environment text NOT NULL,
  external_id text UNIQUE,
  actual_cost numeric(10,2),
  state text NOT NULL DEFAULT 'creating',
  fiscal jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  confirmed_by uuid REFERENCES public.users(id),
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.me_shipments ADD COLUMN IF NOT EXISTS actual_cost numeric(10,2);
ALTER TABLE public.me_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.me_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.me_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.me_shipping_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.me_shipments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.me_settings, public.me_oauth_tokens, public.me_oauth_states, public.me_shipping_quotes, public.me_shipments FROM anon, authenticated;
COMMIT;
