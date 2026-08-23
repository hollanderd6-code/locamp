-- ============================================================
-- Lot 15 — facturation électronique (Factur-X, e-reporting)
-- ============================================================
-- Reconstitué depuis le schéma RÉEL de la base, et non de mémoire :
-- ces tables existaient en production sans figurer dans aucun fichier
-- de db/ (les migrations sautaient de 06 à 12). Types, valeurs par
-- défaut, contraintes et index sont ceux du catalogue Postgres.
--
-- Numéroté 15 et non 07-11 : ces tables sont postérieures aux lots 12 à
-- 14 déjà présents. Les renuméroter casserait l'ordre d'exécution des
-- installations existantes.
--
-- config_chiffre : les identifiants de la plateforme agréée, chiffrés.
-- Jamais en clair, jamais dans config_public.
-- ============================================================

create table if not exists public.efacture_connexions (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  pa_code text not null,
  statut text default 'deconnecte'::text not null,
  adresse_routage text,
  config_public jsonb default '{}'::jsonb not null,
  config_chiffre text,
  message text,
  connecte_at timestamptz,
  updated_at timestamptz default now() not null,
  constraint efacture_connexions_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint efacture_connexions_pkey PRIMARY KEY (id),
  constraint efacture_connexions_camping_id_key UNIQUE (camping_id)
);

-- Factures fournisseurs reçues via la plateforme. La contrainte
-- d'unicité sur doc_externe_id rend la synchronisation rejouable : une
-- facture déjà reçue n'est pas dupliquée.
create table if not exists public.efacture_recues (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  pa_code text not null,
  doc_externe_id text not null,
  emetteur_nom text,
  emetteur_siren text,
  numero text,
  date_facture date,
  total_ht numeric(12,2),
  total_tva numeric(12,2),
  total_ttc numeric(12,2),
  devise text default 'EUR'::text not null,
  format text,
  statut text default 'recue'::text not null,
  motif text,
  statut_maj_at timestamptz default now() not null,
  payload jsonb default '{}'::jsonb not null,
  recue_at timestamptz default now() not null,
  created_at timestamptz default now() not null,
  constraint efacture_recues_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint efacture_recues_pkey PRIMARY KEY (id),
  constraint efacture_recues_camping_id_doc_externe_id_key UNIQUE (camping_id, doc_externe_id)
);
create index if not exists idx_efacture_recues_cx on public.efacture_recues using btree (camping_id, statut, date_facture desc);

-- Lots d'e-reporting : les données de transaction à transmettre à
-- l'administration pour les opérations hors facturation électronique.
create table if not exists public.ereporting_lots (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  periode text not null,
  type text default 'transaction'::text not null,
  donnees jsonb default '{}'::jsonb not null,
  nb_operations integer default 0 not null,
  total_ht numeric(12,2) default 0 not null,
  total_tva numeric(12,2) default 0 not null,
  total_ttc numeric(12,2) default 0 not null,
  statut text default 'brouillon'::text not null,
  pa_code text,
  doc_externe_id text,
  message text,
  transmis_at timestamptz,
  created_at timestamptz default now() not null,
  constraint ereporting_lots_statut_check CHECK ((statut = ANY (ARRAY['brouillon'::text, 'transmis'::text, 'erreur'::text]))),
  constraint ereporting_lots_type_check CHECK ((type = ANY (ARRAY['transaction'::text, 'encaissement'::text]))),
  constraint ereporting_lots_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint ereporting_lots_pkey PRIMARY KEY (id),
  constraint uq_erep_periode UNIQUE (camping_id, periode, type)
);
create index if not exists idx_erep_camping on public.ereporting_lots using btree (camping_id, periode desc);
alter table public.ereporting_lots enable row level security;
