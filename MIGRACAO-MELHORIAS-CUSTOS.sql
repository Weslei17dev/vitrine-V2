-- PostgreSQL (Supabase ou Neon). Execute se a atualização de custos ainda não foi aplicada.
-- Não altera preços, senhas, usuários ou pedidos existentes. Reexecutável.
BEGIN;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price numeric(10,2) CHECK (cost_price >= 0);
COMMIT;
-- NULL significa custo ainda não informado, não custo zero.
-- Pedidos antigos permanecem sem custo histórico: o painel informa essa lacuna.
