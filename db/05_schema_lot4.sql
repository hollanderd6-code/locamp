-- ============================================================
--  Locamp — LOT 4 : encaissements, lettrage, relances
--  À exécuter dans Supabase → SQL Editor (après 04_schema_lot3.sql)
-- ============================================================

-- ============================================================
-- 1. RÈGLEMENTS (encaissements)
--    affectations = lettrage : [{ facture_id, montant }]
-- ============================================================
create table if not exists reglements (
  id                uuid primary key default gen_random_uuid(),
  camping_id        uuid not null references campings(id) on delete cascade,
  resident_id       uuid references residents(id) on delete set null,
  mode              text not null check (mode in ('espece','cheque','virement','tpe','stripe')),
  montant           numeric(12,2) not null,
  date_reglement    date not null default current_date,
  reference         text,
  statut_cheque     text check (statut_cheque in ('recu','remis','encaisse')),
  affectations      jsonb not null default '[]'::jsonb,
  stripe_session_id text,
  auteur_id         uuid references utilisateurs(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_reglements_camping  on reglements(camping_id);
create index if not exists idx_reglements_resident on reglements(resident_id);
create unique index if not exists uq_reglements_stripe on reglements(stripe_session_id) where stripe_session_id is not null;
drop trigger if exists trg_reglements_updated on reglements;
create trigger trg_reglements_updated before update on reglements
  for each row execute function set_updated_at();

-- ============================================================
-- 2. RELANCES
-- ============================================================
create table if not exists relances (
  id          uuid primary key default gen_random_uuid(),
  camping_id  uuid not null references campings(id) on delete cascade,
  facture_id  uuid references factures(id) on delete cascade,
  resident_id uuid references residents(id) on delete set null,
  niveau      int not null default 1,
  canal       text not null default 'email',
  statut      text not null default 'envoyee' check (statut in ('envoyee','en_attente','echec','resolue')),
  message     text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_relances_camping on relances(camping_id);
create index if not exists idx_relances_facture on relances(facture_id);

-- ============================================================
-- 3. RLS
-- ============================================================
alter table reglements enable row level security;
alter table relances   enable row level security;
revoke all on reglements from anon, authenticated;
revoke all on relances   from anon, authenticated;

-- Vérification :
-- select table_name from information_schema.tables where table_schema='public' order by 1;
