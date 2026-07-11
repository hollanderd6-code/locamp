-- ============================================================
--  Locamp — Comptes comptables clients (auxiliaires 411…)
--  À exécuter dans Supabase → SQL Editor
-- ============================================================

alter table residents add column if not exists compte_comptable text;
create unique index if not exists uq_residents_compte
  on residents(camping_id, compte_comptable) where compte_comptable is not null;

-- La racine (ex. '411') et la longueur de séquence se règlent dans
-- campings.parametres.comptabilite : { racine_client: '411', longueur_seq_client: 5 }
-- L'attribution utilise le compteur atomique next_compteur (clé 'compte_client').
