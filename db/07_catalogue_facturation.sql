-- ============================================================
-- Lot 7 — catalogue, moyens de paiement, prestations
-- ============================================================
-- Reconstitué depuis le schéma RÉEL de la base, et non de mémoire :
-- ces tables existaient en production sans figurer dans aucun fichier
-- de db/ (les migrations sautaient de 06 à 12). Types, valeurs par
-- défaut, contraintes et index sont ceux du catalogue Postgres.
--
-- Ordre imposé par les dépendances : prestations référence factures et
-- emplacements (lots 1 et 3), et sera elle-même référencée par
-- releves_compteurs (lot 8).
-- ============================================================

create table if not exists public.articles (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  designation text not null,
  prix_ht numeric(12,2) default 0 not null,
  taux_tva numeric(5,2) default 0 not null,
  unite text,
  actif boolean default true not null,
  created_at timestamptz default now() not null,
  constraint articles_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint articles_pkey PRIMARY KEY (id)
);
create index if not exists idx_articles_camping on public.articles using btree (camping_id);

-- Les modes d'encaissement du camping. « remisable » distingue ceux qui
-- partent en remise de chèques (lot 12) des paiements immédiats.
create table if not exists public.moyens_paiement (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  code text not null,
  libelle text not null,
  type text default 'autre'::text not null,
  compte_comptable text,
  remisable boolean default false not null,
  actif boolean default true not null,
  ordre integer default 0 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint moyens_paiement_type_check CHECK ((type = ANY (ARRAY['espece'::text, 'cheque'::text, 'virement'::text, 'carte'::text, 'ancv'::text, 'autre'::text]))),
  constraint moyens_paiement_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint moyens_paiement_pkey PRIMARY KEY (id)
);
create index if not exists idx_moyens_camping on public.moyens_paiement using btree (camping_id, actif);
create unique index if not exists uq_moyens_code on public.moyens_paiement using btree (camping_id, code);
alter table public.moyens_paiement enable row level security;

-- Tout ce qui se facture à un résident en dehors du loyer : séjour,
-- vente, charge refacturée, caution. facture_id passe de NULL à la
-- facture qui l'a absorbée — c'est ce lien qui empêche de facturer
-- deux fois la même prestation.
create table if not exists public.prestations (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  resident_id uuid not null,
  emplacement_id uuid,
  type text not null,
  designation text not null,
  date_debut date,
  date_fin date,
  quantite numeric(12,2) default 1 not null,
  pu_ht numeric(12,2) default 0 not null,
  taux_tva numeric(5,2) default 0 not null,
  montant_ht numeric(12,2) default 0 not null,
  montant_ttc numeric(12,2) default 0 not null,
  statut text default 'en_cours'::text not null,
  facture_id uuid,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint prestations_statut_check CHECK ((statut = ANY (ARRAY['en_cours'::text, 'facturee'::text, 'annulee'::text]))),
  constraint prestations_type_check CHECK ((type = ANY (ARRAY['sejour'::text, 'vente'::text, 'charge'::text, 'caution'::text]))),
  constraint prestations_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint prestations_emplacement_id_fkey FOREIGN KEY (emplacement_id) REFERENCES emplacements(id) ON DELETE SET NULL,
  constraint prestations_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES factures(id) ON DELETE SET NULL,
  constraint prestations_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE,
  constraint prestations_pkey PRIMARY KEY (id)
);
create index if not exists idx_prestations_camping on public.prestations using btree (camping_id);
create index if not exists idx_prestations_resident on public.prestations using btree (resident_id);
create index if not exists idx_prestations_statut on public.prestations using btree (camping_id, statut);
