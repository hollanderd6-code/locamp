-- ============================================================
--  Locamp — LOT 2 : contrats et signature électronique
--  À exécuter dans Supabase → SQL Editor (après 02_schema_lot1.sql)
-- ============================================================

-- ============================================================
-- 1. MODÈLES DE CONTRAT
--    'clauses' peut contenir des variables : {{nom}}, {{prenom}},
--    {{emplacement}}, {{secteur}}, {{montant}}, {{date_debut}}, {{date_fin}}, {{camping}}
-- ============================================================
create table if not exists contrat_modeles (
  id                  uuid primary key default gen_random_uuid(),
  camping_id          uuid not null references campings(id) on delete cascade,
  nom                 text not null,
  type                text default 'location',
  clauses             text,
  reglement_interieur text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_contrat_modeles_camping on contrat_modeles(camping_id);
drop trigger if exists trg_contrat_modeles_updated on contrat_modeles;
create trigger trg_contrat_modeles_updated before update on contrat_modeles
  for each row execute function set_updated_at();

-- ============================================================
-- 2. CONTRATS
-- ============================================================
create table if not exists contrats (
  id                     uuid primary key default gen_random_uuid(),
  camping_id             uuid not null references campings(id) on delete cascade,
  resident_id            uuid references residents(id)    on delete set null,
  emplacement_id         uuid references emplacements(id) on delete set null,
  modele_id              uuid references contrat_modeles(id) on delete set null,
  numero                 text,                             -- ex. C-2026-0001
  date_debut             date,
  date_fin               date,                             -- null = durée indéterminée
  montant_mensuel        numeric(10,2) default 0,
  statut                 text not null default 'brouillon'
                         check (statut in ('brouillon','emis','signe','actif','resilie','echu')),
  clauses                text,                             -- snapshot des clauses fusionnées
  reglement_interieur_ver text,
  pdf_path               text,                             -- PDF non signé (dans bucket 'documents', préfixe contrats/)
  pdf_signe_path         text,                             -- PDF signé et scellé
  hash_document          text,                             -- SHA-256 du PDF non signé
  signature_meta         jsonb,                            -- { signataire_nom, consentement, horodatage, ip, hash_signe }
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_contrats_camping  on contrats(camping_id);
create index if not exists idx_contrats_resident on contrats(resident_id);
create index if not exists idx_contrats_statut   on contrats(camping_id, statut);
drop trigger if exists trg_contrats_updated on contrats;
create trigger trg_contrats_updated before update on contrats
  for each row execute function set_updated_at();

-- Lien documents.contrat_id -> contrats (ajouté maintenant que la table existe)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'documents_contrat_id_fkey'
  ) then
    alter table documents
      add constraint documents_contrat_id_fkey
      foreign key (contrat_id) references contrats(id) on delete set null;
  end if;
end $$;

-- ============================================================
-- 3. RLS
-- ============================================================
alter table contrat_modeles enable row level security;
alter table contrats        enable row level security;
revoke all on contrat_modeles from anon, authenticated;
revoke all on contrats        from anon, authenticated;

-- Vérification :
-- select table_name from information_schema.tables where table_schema='public' order by 1;
