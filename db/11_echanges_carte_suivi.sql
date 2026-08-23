-- ============================================================
-- Lot 11 — messagerie, notifications push, RGPD, carte, échéances
-- ============================================================
-- Reconstitué depuis le schéma RÉEL de la base, et non de mémoire :
-- ces tables existaient en production sans figurer dans aucun fichier
-- de db/ (les migrations sautaient de 06 à 12). Types, valeurs par
-- défaut, contraintes et index sont ceux du catalogue Postgres.
--
-- Le lien direct entre les deux faces du produit : « messages » porte la
-- conversation entre le gestionnaire (Locamp Gestion) et le résident
-- (Mon espace Locamp). C'est la table la plus visible des deux côtés.
-- ============================================================

create table if not exists public.messages (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  resident_id uuid not null,
  auteur text not null,
  corps text not null,
  lu boolean default false not null,
  created_at timestamptz default now() not null,
  constraint messages_auteur_check CHECK ((auteur = ANY (ARRAY['camping'::text, 'resident'::text]))),
  constraint messages_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint messages_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE,
  constraint messages_pkey PRIMARY KEY (id)
);
create index if not exists idx_messages_fil on public.messages using btree (camping_id, resident_id, created_at);
create index if not exists idx_messages_nonlus on public.messages using btree (camping_id, auteur, lu);

-- Jetons de notification. chk_push_dest impose qu'un jeton appartienne
-- soit à un membre du personnel, soit à un résident — jamais aux deux,
-- jamais à personne. Sans cette contrainte, une notification destinée à
-- un résident pourrait partir vers un téléphone du personnel.
create table if not exists public.push_tokens (
  id uuid default gen_random_uuid() not null,
  camping_id uuid,
  canal text not null,
  user_id uuid,
  resident_id uuid,
  token text not null,
  platform text,
  app text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint chk_push_dest CHECK ((((canal = 'staff'::text) AND (user_id IS NOT NULL) AND (resident_id IS NULL)) OR ((canal = 'portail'::text) AND (resident_id IS NOT NULL) AND (user_id IS NULL)))),
  constraint push_tokens_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint push_tokens_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE,
  constraint push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
  constraint push_tokens_pkey PRIMARY KEY (id),
  constraint uq_push_token UNIQUE (token)
);
create index if not exists idx_push_camping on public.push_tokens using btree (camping_id);
create index if not exists idx_push_resident on public.push_tokens using btree (resident_id) where (resident_id is not null);
create index if not exists idx_push_user on public.push_tokens using btree (user_id) where (user_id is not null);
alter table public.push_tokens enable row level security;

-- Registre des demandes RGPD. resident_id est en ON DELETE SET NULL et
-- non CASCADE : effacer un résident à sa demande ne doit pas effacer la
-- trace que la demande a été traitée — c'est justement la preuve.
create table if not exists public.demandes_rgpd (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  resident_id uuid,
  type text not null,
  origine text default 'admin'::text not null,
  statut text default 'traitee'::text not null,
  motif_refus text,
  detail jsonb,
  auteur_id uuid,
  created_at timestamptz default now() not null,
  constraint demandes_rgpd_origine_check CHECK ((origine = ANY (ARRAY['admin'::text, 'portail'::text, 'email'::text]))),
  constraint demandes_rgpd_statut_check CHECK ((statut = ANY (ARRAY['recue'::text, 'traitee'::text, 'refusee'::text]))),
  constraint demandes_rgpd_type_check CHECK ((type = ANY (ARRAY['acces'::text, 'rectification'::text, 'effacement'::text, 'portabilite'::text, 'opposition'::text, 'limitation'::text]))),
  constraint demandes_rgpd_auteur_id_fkey FOREIGN KEY (auteur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  constraint demandes_rgpd_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint demandes_rgpd_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE SET NULL,
  constraint demandes_rgpd_pkey PRIMARY KEY (id)
);
create index if not exists idx_rgpd_camping on public.demandes_rgpd using btree (camping_id, created_at desc);
alter table public.demandes_rgpd enable row level security;

-- Décor du plan interactif : allées, sanitaires, piscine, arbres. Les
-- emplacements eux-mêmes portent leurs coordonnées (lot 1) ; ici c'est
-- tout ce qui les entoure.
create table if not exists public.carte_elements (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  type text not null,
  libelle text,
  x numeric(8,2) default 0 not null,
  y numeric(8,2) default 0 not null,
  largeur numeric(8,2),
  hauteur numeric(8,2),
  x2 numeric(8,2),
  y2 numeric(8,2),
  rotation numeric(6,2) default 0 not null,
  couleur text,
  z integer default 0 not null,
  created_at timestamptz default now() not null,
  constraint carte_elements_type_check CHECK ((type = ANY (ARRAY['accueil'::text, 'sanitaires'::text, 'piscine'::text, 'restaurant'::text, 'laverie'::text, 'aire_jeux'::text, 'local'::text, 'parking'::text, 'allee'::text, 'zone'::text, 'eau'::text, 'arbre'::text, 'texte'::text, 'barriere'::text]))),
  constraint carte_elements_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint carte_elements_pkey PRIMARY KEY (id)
);
create index if not exists idx_carte_elements_camping on public.carte_elements using btree (camping_id);

-- Trace des rappels envoyés (assurance qui expire, contrat qui se termine).
-- La contrainte d'unicité est ce qui empêche d'envoyer deux fois le même
-- rappel : sans elle, un cron rejoué inonderait les résidents.
create table if not exists public.echeance_rappels (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  type text not null,
  cible_id uuid not null,
  echeance date not null,
  palier integer not null,
  canal text default 'notif+email'::text not null,
  envoye_at timestamptz default now() not null,
  constraint echeance_rappels_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint echeance_rappels_pkey PRIMARY KEY (id),
  constraint echeance_rappels_camping_id_type_cible_id_echeance_palier_key UNIQUE (camping_id, type, cible_id, echeance, palier)
);
create index if not exists idx_echeance_rappels_cx on public.echeance_rappels using btree (camping_id, type, cible_id);

-- Historique des révisions de loyer : quel taux, quelle référence (IRL,
-- ICC…), combien de loyers touchés. Une indexation ne se refait pas ;
-- cette table est ce qui permet de le prouver au résident.
create table if not exists public.loyer_indexations (
  id uuid default gen_random_uuid() not null,
  camping_id uuid not null,
  taux numeric(6,3) not null,
  reference text,
  nb_loyers integer default 0 not null,
  nb_modeles integer default 0 not null,
  details jsonb default '[]'::jsonb not null,
  auteur_id uuid,
  created_at timestamptz default now() not null,
  constraint loyer_indexations_camping_id_fkey FOREIGN KEY (camping_id) REFERENCES campings(id) ON DELETE CASCADE,
  constraint loyer_indexations_pkey PRIMARY KEY (id)
);
create index if not exists idx_loyer_indexations_cx on public.loyer_indexations using btree (camping_id, created_at desc);
