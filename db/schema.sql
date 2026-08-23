-- ============================================================
-- HOSTERZ — Schéma de base de données (Supabase / PostgreSQL)
-- Marketplace conciergerie courte durée — mise en relation
-- Paiement HORS plateforme au lancement.
-- IDs texte préfixés générés côté application (ex: pr_xxxx).
-- ============================================================

-- Extensions utiles pour le matching géographique
create extension if not exists cube;
create extension if not exists earthdistance;

-- ============================================================
-- 1. UTILISATEURS & RÔLES
-- ============================================================

create table users (
  id              text primary key,                    -- ex: u_xxxx (généré côté app)
  email           text unique not null,
  phone           text,
  password_hash   text not null,                        -- JWT custom comme Boostinghost
  role            text not null check (role in ('proprietaire','prestataire','conciergerie','admin')),
  email_verified  boolean not null default false,
  phone_verified  boolean not null default false,
  created_at      timestamptz not null default now()
);

-- Profil PRESTATAIRE (le particulier qui travaille)
create table prestataire_profiles (
  user_id                  text primary key references users(id) on delete cascade,
  prenom                   text not null,
  nom                      text not null,
  photo_url                text,
  date_naissance           date,                         -- âge calculé à l'affichage
  ville                    text,
  code_postal              text,
  latitude                 double precision,
  longitude                double precision,
  bio                      text,

  -- Test métier / différenciateur
  badge_niveau             text default 'non_teste'      -- non_teste / debutant / confirme
                             check (badge_niveau in ('non_teste','debutant','confirme')),
  statut                   text not null default 'en_attente'  -- en_attente (invisible) / actif / suspendu
                             check (statut in ('en_attente','actif','suspendu')),
  verifie_hosterz          boolean not null default false,     -- badge manuel au début
  dernier_test_at          timestamptz,                  -- pour la carence de 24h avant re-test

  -- Stats de fiabilité (recalculées) — l'angle "fiabilité, pas juste la note"
  note_moyenne             numeric(3,2) default 0,
  nb_missions              integer default 0,
  taux_ponctualite         numeric(5,2) default 0,
  taux_checklists_completes numeric(5,2) default 0,
  taux_acceptation         numeric(5,2) default 0,

  created_at               timestamptz not null default now()
);

-- Profil PROPRIÉTAIRE (cherche du personnel)
create table proprietaire_profiles (
  user_id              text primary key references users(id) on delete cascade,
  prenom               text not null,
  nom                  text not null,
  ville                text,
  code_postal          text,
  boostinghost_user_id text,                             -- PONT vers Boostinghost
  created_at           timestamptz not null default now()
);

-- Profil CONCIERGERIE (pro)
create table conciergerie_profiles (
  user_id          text primary key references users(id) on delete cascade,
  nom_societe      text not null,
  siret            text,
  zone_intervention text,
  ville            text,
  logo_url         text,
  created_at       timestamptz not null default now()
);

-- ============================================================
-- 2. QUESTIONNAIRE MÉTIER (le différenciateur)
-- ============================================================

create table questions (
  id            text primary key,                        -- ex: q_xxxx
  texte         text not null,
  type          text not null check (type in ('competence','engagement')),
  options       jsonb not null default '[]',             -- ex: ["Oui","Non","Je ne sais pas"]
  bonne_reponse text,                                     -- pour type=competence
  eliminatoire  boolean not null default false,           -- rater = recalé quoi qu'il arrive
  actif         boolean not null default true,
  ordre         integer not null default 0
);

create table reponses_prestataire (
  id             text primary key,                       -- ex: rp_xxxx
  prestataire_id text not null references users(id) on delete cascade,
  question_id    text not null references questions(id) on delete cascade,
  reponse_donnee text,
  correcte       boolean,                                -- null pour engagement
  created_at     timestamptz not null default now()
);

-- ============================================================
-- 3. MISSIONS & TÂCHES
-- ============================================================

create table task_types (
  code   text primary key,                               -- check_in, check_out, menage_standard...
  libelle text not null,
  actif  boolean not null default true,
  ordre  integer not null default 0
);

create table missions (
  id                        text primary key,            -- ex: m_xxxx
  proprietaire_id           text not null references users(id) on delete cascade,
  prestataire_id            text references users(id) on delete set null,  -- NULL tant que pas accepté
  task_type                 text not null references task_types(code),
  date_mission              date not null,
  heure_debut               time not null,
  adresse                   text,
  ville                     text,
  code_postal               text,
  latitude                  double precision,
  longitude                 double precision,
  description               text,
  urgent                    boolean not null default false,  -- mode "galère / dernière minute"
  statut                    text not null default 'ouverte'
                              check (statut in ('ouverte','acceptee','terminee','annulee')),
  boostinghost_reservation_id text,                      -- PONT Boostinghost
  created_at                timestamptz not null default now()
);

-- ============================================================
-- 4. DISPONIBILITÉS (cœur du matching temps réel)
-- ============================================================

create table disponibilites (
  id             text primary key,                       -- ex: d_xxxx
  prestataire_id text not null references users(id) on delete cascade,
  date           date not null,
  heure_debut    time not null,
  heure_fin      time not null,
  disponible     boolean not null default true
);

create index idx_dispo_prestataire on disponibilites(prestataire_id, date);

-- ============================================================
-- 5. NOTATIONS BIDIRECTIONNELLES
-- ============================================================

create table avis (
  id         text primary key,                           -- ex: av_xxxx
  mission_id text not null references missions(id) on delete cascade,
  auteur_id  text not null references users(id) on delete cascade,
  cible_id   text not null references users(id) on delete cascade,
  note       integer not null check (note between 1 and 5),
  commentaire text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 6. BOUTIQUE (kits d'accueil)
-- ============================================================

create table produits (
  id          text primary key,                          -- ex: prod_xxxx
  nom         text not null,
  description text,
  prix        numeric(10,2) not null,
  image_url   text,
  stock       integer not null default 0,
  actif       boolean not null default true
);

create table commandes (
  id              text primary key,                      -- ex: cmd_xxxx
  proprietaire_id text not null references users(id) on delete cascade,
  statut          text not null default 'en_attente'
                    check (statut in ('en_attente','payee','expediee','annulee')),
  total           numeric(10,2) not null default 0,
  created_at      timestamptz not null default now()
);

create table commande_items (
  id            text primary key,                        -- ex: ci_xxxx
  commande_id   text not null references commandes(id) on delete cascade,
  produit_id    text not null references produits(id),
  quantite      integer not null default 1,
  prix_unitaire numeric(10,2) not null
);

-- ============================================================
-- DONNÉES DE RÉFÉRENCE — types de tâches
-- ============================================================

insert into task_types (code, libelle, ordre) values
  ('check_in',         'Entrée des locataires (check-in)', 1),
  ('check_out',        'Sortie des locataires (check-out)', 2),
  ('menage_standard',  'Ménage standard', 3),
  ('menage_approfondi','Ménage en profondeur', 4),
  ('conciergerie',     'Conciergerie complète', 5);
