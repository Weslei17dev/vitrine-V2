BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar text;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS adult_confirmed_at;

COMMIT;

SELECT id, name, email, role, avatar
FROM public.users
ORDER BY created_at;
