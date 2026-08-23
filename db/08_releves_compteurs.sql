-- ============================================================
-- Lot 8 — relevés de compteurs
-- ============================================================
-- Reconstitué depuis le schéma RÉEL de la base, et non de mémoire :
-- ces tables existaient en production sans figurer dans aucun fichier
-- de db/ (les migrations sautaient de 06 à 12). Types, valeurs par
-- défaut, contraintes et index sont ceux du catalogue Postgres.
--
-- Dépend de prestations (lot 7) : un relevé refacturé pointe vers la
-- prestation créée. La colonne s'appelle index_kwh pour des raisons
-- historiques mais « type » vaut aussi 'eau' — le nom est trompeur,
-- à renommer un jour dans une migration dédiée.
-- ============================================================

create table if not exists public.releves_compteurs (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  emplacement_id uuid not null,
  date_releve date default CURRENT_DATE not null,
  index_kwh numeric(12,2) not null,
  conso_kwh numeric(12,2),
  prestation_id uuid,
  created_at timestamptz default now() not null,
  note text,
  type text default 'elec'::text not null,
  constraint releves_compteurs_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint releves_compteurs_emplacement_id_fkey FOREIGN KEY (emplacement_id) REFERENCES emplacements(id) ON DELETE CASCADE,
  constraint releves_compteurs_prestation_id_fkey FOREIGN KEY (prestation_id) REFERENCES prestations(id) ON DELETE SET NULL,
  constraint releves_compteurs_pkey PRIMARY KEY (id)
);
create index if not exists idx_releves_emplacement on public.releves_compteurs using btree (camping_id, emplacement_id, date_releve);
create index if not exists idx_releves_type on public.releves_compteurs using btree (camping_id, emplacement_id, type, date_releve desc);
