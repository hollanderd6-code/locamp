-- ============================================================
--  Locamp — LOT 1 : emplacements, résidents, documents (GED)
--  À exécuter dans Supabase → SQL Editor (après 01_schema_lot0.sql)
-- ============================================================

-- ============================================================
-- 1. EMPLACEMENTS (parcelles)
--    Position sur plan image (coord_x/coord_y) ET/OU carto réelle
--    (latitude/longitude) : les deux modes sont supportés.
-- ============================================================
create table if not exists emplacements (
  id          uuid primary key default gen_random_uuid(),
  camping_id  uuid not null references campings(id) on delete cascade,
  numero      text not null,
  secteur     text,
  type        text,                                   -- mobil-home, chalet, parcelle nue, ...
  statut      text not null default 'libre'
              check (statut in ('libre','occupe','reserve','indisponible')),
  loyer_base  numeric(10,2) default 0,
  periodicite text default 'mensuel',
  coord_x     numeric,                                -- position sur plan image
  coord_y     numeric,
  latitude    double precision,                       -- position carto réelle
  longitude   double precision,
  meta        jsonb not null default '{}'::jsonb,     -- surface, compteurs, équipements
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (camping_id, numero)
);
create index if not exists idx_emplacements_camping on emplacements(camping_id);
create index if not exists idx_emplacements_statut  on emplacements(camping_id, statut);
drop trigger if exists trg_emplacements_updated on emplacements;
create trigger trg_emplacements_updated before update on emplacements
  for each row execute function set_updated_at();

-- ============================================================
-- 2. RESIDENTS (locataires longue durée)
--    emplacement_id = emplacement occupé actuellement (nullable).
--    (Sera réconcilié avec les contrats au Lot 2.)
-- ============================================================
create table if not exists residents (
  id             uuid primary key default gen_random_uuid(),
  camping_id     uuid not null references campings(id) on delete cascade,
  emplacement_id uuid references emplacements(id) on delete set null,
  civilite       text,
  nom            text not null,
  prenom         text,
  date_naissance date,
  nationalite    text,
  email          text,
  telephone      text,
  adresse        text,
  foyer          jsonb not null default '{}'::jsonb,  -- occupants, véhicules
  solde          numeric(12,2) not null default 0,    -- alimenté au Lot 3 (facturation)
  notes_internes text,
  actif          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_residents_camping     on residents(camping_id);
create index if not exists idx_residents_emplacement on residents(emplacement_id);
create index if not exists idx_residents_nom         on residents(camping_id, nom);
drop trigger if exists trg_residents_updated on residents;
create trigger trg_residents_updated before update on residents
  for each row execute function set_updated_at();

-- ============================================================
-- 3. DOCUMENTS (GED)
--    Métadonnées ici ; fichiers dans Supabase Storage (bucket 'documents', privé).
-- ============================================================
create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  camping_id     uuid not null references campings(id) on delete cascade,
  resident_id    uuid references residents(id) on delete cascade,
  emplacement_id uuid references emplacements(id) on delete set null,
  contrat_id     uuid,                                -- rempli au Lot 2
  type           text,                                -- cni, assurance, justificatif_domicile, ...
  nom_fichier    text,
  storage_path   text not null,                       -- chemin dans le bucket
  taille         bigint,
  mime           text,
  date_expiration date,
  auteur_id      uuid references utilisateurs(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_documents_camping  on documents(camping_id);
create index if not exists idx_documents_resident on documents(resident_id);
create index if not exists idx_documents_expir     on documents(camping_id, date_expiration);

-- ============================================================
-- 4. RLS : verrouillage des accès directs (backend service_role uniquement)
-- ============================================================
alter table emplacements enable row level security;
alter table residents    enable row level security;
alter table documents    enable row level security;
revoke all on emplacements from anon, authenticated;
revoke all on residents    from anon, authenticated;
revoke all on documents    from anon, authenticated;

-- ============================================================
-- 5. À FAIRE MANUELLEMENT DANS SUPABASE (une seule fois) :
--    Storage → New bucket → nom : "documents" → PRIVATE (décoché "public").
--    Le backend (service_role) gère l'upload et les liens signés temporaires.
-- ============================================================

-- Vérification :
-- select table_name from information_schema.tables where table_schema='public' order by 1;
