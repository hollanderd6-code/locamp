-- ============================================================
-- Lot 9 — signature électronique
-- ============================================================
-- Reconstitué depuis le schéma RÉEL de la base, et non de mémoire :
-- ces tables existaient en production sans figurer dans aucun fichier
-- de db/ (les migrations sautaient de 06 à 12). Types, valeurs par
-- défaut, contraintes et index sont ceux du catalogue Postgres.
--
-- documents_signature porte le document à signer ; signatures_preuves
-- garde le faisceau de preuves exigé par eIDAS — adresse IP, horodatage,
-- empreinte du document avant et après, journal des événements.
--
-- Les deux tables sont en ON DELETE CASCADE depuis campings, mais la
-- preuve ne s'efface JAMAIS depuis le document : supprimer un document
-- signé n'a pas de sens juridique, et rien dans le code ne le fait.
-- ============================================================

create table if not exists public.documents_signature (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  resident_id uuid,
  titre text not null,
  message text,
  storage_path text not null,
  storage_signe text,
  hash_original text not null,
  hash_signe text,
  nb_pages integer,
  champs jsonb default '[]'::jsonb not null,
  statut text default 'brouillon'::text not null,
  date_envoi timestamptz,
  date_signature timestamptz,
  jeton text,
  jeton_expire timestamptz,
  auteur_id uuid,
  created_at timestamptz default now() not null,
  evenements jsonb default '[]'::jsonb not null,
  otp_code text,
  otp_expire timestamptz,
  otp_tentatives integer default 0 not null,
  otp_valide_at timestamptz,
  otp_telephone text,
  contrat_id uuid,
  date_debut date,
  date_fin date,
  constraint documents_signature_statut_check CHECK ((statut = ANY (ARRAY['brouillon'::text, 'envoye'::text, 'signe'::text, 'refuse'::text, 'annule'::text]))),
  constraint documents_signature_auteur_id_fkey FOREIGN KEY (auteur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  constraint documents_signature_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint documents_signature_contrat_id_fkey FOREIGN KEY (contrat_id) REFERENCES contrats(id) ON DELETE SET NULL,
  constraint documents_signature_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE SET NULL,
  constraint documents_signature_pkey PRIMARY KEY (id),
  constraint documents_signature_jeton_key UNIQUE (jeton)
);
create index if not exists idx_docsig_camping on public.documents_signature using btree (camping_id, created_at desc);
create index if not exists idx_docsig_contrat on public.documents_signature using btree (contrat_id);
create index if not exists idx_docsig_fin on public.documents_signature using btree (camping_id, date_fin);
create index if not exists idx_docsig_resident on public.documents_signature using btree (resident_id);
alter table public.documents_signature enable row level security;

create table if not exists public.signatures_preuves (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  document_id uuid not null,
  resident_id uuid,
  signataire_nom text not null,
  signataire_email text,
  ip text not null,
  user_agent text,
  horodatage timestamptz default now() not null,
  consentement text not null,
  signature_png text,
  valeurs jsonb default '{}'::jsonb not null,
  hash_original text not null,
  hash_signe text not null,
  evenements jsonb default '[]'::jsonb not null,
  created_at timestamptz default now() not null,
  identification jsonb default '{}'::jsonb not null,
  constraint signatures_preuves_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint signatures_preuves_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents_signature(id) ON DELETE CASCADE,
  constraint signatures_preuves_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE SET NULL,
  constraint signatures_preuves_pkey PRIMARY KEY (id)
);
create index if not exists idx_preuve_doc on public.signatures_preuves using btree (document_id);
alter table public.signatures_preuves enable row level security;
