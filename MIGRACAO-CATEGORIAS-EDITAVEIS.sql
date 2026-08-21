BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  image      text,
  color      text NOT NULL DEFAULT '#D99163',
  active     boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_active_order
  ON public.categories(active, sort_order, name);

INSERT INTO public.categories (name, color, sort_order)
SELECT category, MIN(color), row_number() OVER (ORDER BY MIN(created_at))
FROM public.products
WHERE category IS NOT NULL AND btrim(category) <> ''
GROUP BY category
ON CONFLICT (name) DO NOTHING;

COMMIT;

SELECT id, name, image, color, active, sort_order
FROM public.categories
ORDER BY sort_order, name;
