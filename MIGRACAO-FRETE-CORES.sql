-- Execute no SQL Editor do Supabase após MIGRACAO-DESCONTOS-E-CUPONS.sql.
-- Reexecutável. Não altera pedidos existentes nem substitui cores já cadastradas.
BEGIN;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS colors jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_discount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.promotions DROP CONSTRAINT IF EXISTS promotions_discount_type_check;
ALTER TABLE public.promotions DROP CONSTRAINT IF EXISTS promotions_value_check;
ALTER TABLE public.promotions DROP CONSTRAINT IF EXISTS promotions_shipping_type;
ALTER TABLE public.promotions ADD CONSTRAINT promotions_shipping_type
  CHECK (discount_type IN ('percent','fixed','free_shipping') AND
    ((discount_type='free_shipping' AND value=0 AND kind='coupon') OR
     (discount_type<>'free_shipping' AND value>0)));
-- Instala uma tarifa ilustrativa apenas se o frete ainda está sem configuração.
UPDATE public.site_content
SET content=jsonb_set(content, '{shipping}',
  COALESCE(content->'shipping','{}'::jsonb) ||
  '{"flatRate":14.9,"freeAbove":199}'::jsonb, true)
WHERE id=1 AND COALESCE((content->'shipping'->>'flatRate')::numeric,0)=0
  AND COALESCE((content->'shipping'->>'freeAbove')::numeric,0)=0;
COMMIT;
