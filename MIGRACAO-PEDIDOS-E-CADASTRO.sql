BEGIN;

-- Mantém a estrutura do perfil atualizada.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar text;

-- Remove a antiga confirmação etária do cadastro.
ALTER TABLE public.users
  DROP COLUMN IF EXISTS adult_confirmed_at;

-- Garante os campos usados no histórico e na alteração de status.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_orders_admin_filters
  ON public.orders (created_at DESC, status, total, customer_name);

CREATE INDEX IF NOT EXISTS idx_orders_items_filter
  ON public.orders USING gin (items jsonb_path_ops);

-- Atualiza o texto antigo que possa ter ficado salvo em Personalizar.
UPDATE public.site_content
SET content = jsonb_set(
  content,
  '{footer,about}',
  to_jsonb('Loja online de bem-estar íntimo, com pagamento via PIX e envio discreto.'::text),
  true
)
WHERE id = 1;

COMMIT;

SELECT number, customer_name, status, total, created_at
FROM public.orders
ORDER BY created_at DESC
LIMIT 10;
