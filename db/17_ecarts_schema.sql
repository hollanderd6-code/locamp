-- ============================================================
-- Lot 17 — colonnes utilisées par le code mais absentes des migrations
-- ============================================================
-- Relevé en rejouant 01 → 16 sur une base vierge. En production ces
-- colonnes existent déjà : ce fichier n'y fait rien (« if not exists »).
-- Il rend seulement une installation neuve possible.
-- ============================================================

-- Droits fins par utilisateur et par camping (middleware/auth.js, requirePerm)
alter table public.user_campings add column if not exists permissions jsonb not null default '{}'::jsonb;

-- Remises de cheques : le moyen remis (cheque, ANCV...) — routes/remises.js
alter table public.remises_banque add column if not exists moyen_code text;

-- Client entreprise sur la fiche resident (formulaire resident, Factur-X, PDF de facture)
alter table public.residents add column if not exists raison_sociale text;
alter table public.residents add column if not exists siret text;
alter table public.residents add column if not exists tva_intra text;
alter table public.residents add column if not exists adresse_cp text;
alter table public.residents add column if not exists adresse_ville text;
