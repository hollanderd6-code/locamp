-- ============================================================
-- Lot 17 — colonnes utilisées par le code mais absentes des migrations
-- ============================================================
-- Relevé en rejouant 01 → 16 sur une base vierge. En production ces
-- colonnes existent déjà : ce fichier n'y fait rien (« if not exists »).
-- Il rend seulement une installation neuve possible.
-- ============================================================

-- Droits fins par utilisateur et par camping (middleware/auth.js, requirePerm)
alter table public.user_campings add column if not exists permissions jsonb not null default '{}'::jsonb;
