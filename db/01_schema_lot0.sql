-- ============================================================
--  Logiciel de gestion de camping résidentiel
--  LOT 0 — Socle : multi-tenant, utilisateurs, rôles, audit
--  Cible : PostgreSQL / Supabase
--  À exécuter dans : Supabase → SQL Editor
-- ============================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------- Utilitaire : maj automatique de updated_at ----------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================
-- 1. CAMPINGS  (les "tenants")
-- ============================================================
create table if not exists campings (
  id             uuid primary key default gen_random_uuid(),
  nom            text not null,
  raison_sociale text,
  siret          text,
  tva            text,
  adresse        text,
  email          text,
  telephone      text,
  parametres     jsonb not null default '{}'::jsonb,  -- barème taxe séjour, numérotation, réglages
  actif          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
drop trigger if exists trg_campings_updated on campings;
create trigger trg_campings_updated before update on campings
  for each row execute function set_updated_at();

-- ============================================================
-- 2. UTILISATEURS
-- ============================================================
create table if not exists utilisateurs (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  hash_mdp   text not null,            -- bcrypt/argon2 : HACHÉ CÔTÉ BACKEND, jamais en clair
  nom        text,
  prenom     text,
  actif      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_utilisateurs_updated on utilisateurs;
create trigger trg_utilisateurs_updated before update on utilisateurs
  for each row execute function set_updated_at();

-- ============================================================
-- 3. USER_CAMPINGS  (liaison user <-> camping + rôle par camping)
--    Un utilisateur peut être rattaché à plusieurs campings,
--    avec un rôle potentiellement différent sur chacun.
-- ============================================================
create table if not exists user_campings (
  user_id    uuid not null references utilisateurs(id) on delete cascade,
  camping_id uuid not null references campings(id)     on delete cascade,
  role       text not null check (role in ('admin','gestionnaire','comptabilite','lecture')),
  created_at timestamptz not null default now(),
  primary key (user_id, camping_id)
);
create index if not exists idx_user_campings_camping on user_campings(camping_id);
create index if not exists idx_user_campings_user    on user_campings(user_id);

-- ============================================================
-- 4. AUDIT_LOG  (append-only : qui a fait quoi, quand)
-- ============================================================
create table if not exists audit_log (
  id           uuid primary key default gen_random_uuid(),
  camping_id   uuid references campings(id)     on delete set null,
  auteur_id    uuid references utilisateurs(id) on delete set null,
  auteur_email text,                   -- dénormalisé : conservé même si l'utilisateur est supprimé
  action       text not null,          -- create | update | delete | login | export | ...
  entite       text,                   -- residents | contrats | factures | ...
  entite_id    text,
  avant        jsonb,
  apres        jsonb,
  ip           text,
  horodatage   timestamptz not null default now()
);
create index if not exists idx_audit_camping on audit_log(camping_id, horodatage desc);
create index if not exists idx_audit_entite  on audit_log(entite, entite_id);

-- Append-only STRICT : interdit toute modification/suppression,
-- y compris via service_role (qui bypasse la RLS).
create or replace function audit_log_no_change()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log est append-only : opération % interdite', tg_op;
end $$;
drop trigger if exists trg_audit_no_change on audit_log;
create trigger trg_audit_no_change before update or delete on audit_log
  for each row execute function audit_log_no_change();

-- ============================================================
-- 5. SÉCURITÉ / RLS  (défense en profondeur)
--    Le backend utilise la clé SERVICE_ROLE (bypass RLS) et applique
--    le filtrage par camping_id en code. On verrouille ici tout accès
--    direct via la clé publique (anon) ou authenticated.
-- ============================================================
alter table campings      enable row level security;
alter table utilisateurs  enable row level security;
alter table user_campings enable row level security;
alter table audit_log     enable row level security;

-- Aucune policy pour anon/authenticated + révocation des droits :
-- => accès refusé par défaut à toute requête non service_role.
revoke all on campings      from anon, authenticated;
revoke all on utilisateurs  from anon, authenticated;
revoke all on user_campings from anon, authenticated;
revoke all on audit_log     from anon, authenticated;

-- Note d'évolution : si un jour on bascule l'auth vers Supabase Auth,
-- on ajoutera des policies basées sur les claims JWT (ex. camping_id
-- dans app_metadata) pour une RLS active côté client. Non nécessaire en V1.

-- ============================================================
-- 6. AMORCE (optionnel) — premier camping
--    L'utilisateur admin est créé via l'endpoint /api/register du backend
--    (mot de passe haché côté serveur), puis rattaché ci-dessous.
-- ============================================================
-- insert into campings (nom, raison_sociale) values ('Camping des Sources', 'SAS Boostinghost');
-- -- puis, après register de l'admin :
-- insert into user_campings (user_id, camping_id, role)
-- values ('<uuid_utilisateur>', '<uuid_camping>', 'admin');

-- Vérification rapide :
-- select table_name from information_schema.tables where table_schema = 'public' order by 1;
