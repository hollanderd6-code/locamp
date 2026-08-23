-- ============================================================
-- Lot 10 — journal fiscal, clôtures, exercices
-- ============================================================
-- Reconstitué depuis le schéma RÉEL de la base, et non de mémoire :
-- ces tables existaient en production sans figurer dans aucun fichier
-- de db/ (les migrations sautaient de 06 à 12). Types, valeurs par
-- défaut, contraintes et index sont ceux du catalogue Postgres.
--
-- Chaîne d'inaltérabilité exigée par l'article 286-I-3° bis du CGI :
-- chaque écriture porte le hash de la précédente. Modifier une ligne
-- casse la chaîne, et verifierChaine() le détecte.
--
-- Noter le ON DELETE RESTRICT sur camping_id, là où toutes les autres
-- tables sont en CASCADE : supprimer un camping ne doit PAS effacer son
-- journal fiscal. C'est volontaire et il faut le laisser ainsi.
-- ============================================================

create table if not exists public.journal_fiscal (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  seq bigint not null,
  type text not null,
  entite text,
  entite_id uuid,
  donnees jsonb not null,
  montant numeric(14,2),
  hash_precedent text not null,
  hash text not null,
  auteur_id uuid,
  auteur_email text,
  horodatage timestamptz default now() not null,
  constraint journal_fiscal_auteur_id_fkey FOREIGN KEY (auteur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  constraint journal_fiscal_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE RESTRICT,
  constraint journal_fiscal_pkey PRIMARY KEY (id)
);
create index if not exists idx_jf_camping on public.journal_fiscal using btree (camping_id, seq desc);
create index if not exists idx_jf_entite on public.journal_fiscal using btree (entite, entite_id);
create unique index if not exists uq_jf_hash on public.journal_fiscal using btree (camping_id, hash);
create unique index if not exists uq_jf_seq on public.journal_fiscal using btree (camping_id, seq);
alter table public.journal_fiscal enable row level security;

-- Arrêtés de période. uq_clot garantit qu'une période n'est clôturée
-- qu'une fois : c'est ce qui rend cloturerVeille() rejouable sans risque.
create table if not exists public.clotures_fiscales (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  type text not null,
  periode text not null,
  seq_debut bigint,
  seq_fin bigint,
  nb_factures integer default 0 not null,
  nb_reglements integer default 0 not null,
  total_ht numeric(14,2) default 0 not null,
  total_tva numeric(14,2) default 0 not null,
  total_ttc numeric(14,2) default 0 not null,
  total_encaisse numeric(14,2) default 0 not null,
  cumul_perpetuel numeric(16,2) default 0 not null,
  detail jsonb,
  hash_precedent text not null,
  hash text not null,
  auteur_id uuid,
  horodatage timestamptz default now() not null,
  constraint clotures_fiscales_type_check CHECK ((type = ANY (ARRAY['journaliere'::text, 'mensuelle'::text, 'annuelle'::text]))),
  constraint clotures_fiscales_auteur_id_fkey FOREIGN KEY (auteur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  constraint clotures_fiscales_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE RESTRICT,
  constraint clotures_fiscales_pkey PRIMARY KEY (id)
);
create index if not exists idx_clot_camping on public.clotures_fiscales using btree (camping_id, horodatage desc);
create unique index if not exists uq_clot on public.clotures_fiscales using btree (camping_id, type, periode);
alter table public.clotures_fiscales enable row level security;

-- Solde de chaque résident au jour de la clôture d'exercice : c'est
-- l'à-nouveau de l'exercice suivant, figé pour ne plus bouger.
create table if not exists public.cloture_soldes (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  exercice integer not null,
  resident_id uuid not null,
  resident_nom text,
  compte_comptable text,
  solde numeric(12,2) not null,
  scellee_at timestamptz default now() not null,
  constraint cloture_soldes_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint cloture_soldes_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE,
  constraint cloture_soldes_pkey PRIMARY KEY (id),
  constraint cloture_soldes_camping_id_exercice_resident_id_key UNIQUE (camping_id, exercice, resident_id)
);
create index if not exists idx_cloture_soldes_cx on public.cloture_soldes using btree (camping_id, exercice);
