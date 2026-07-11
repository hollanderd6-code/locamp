-- ============================================================
--  Locamp — Remises en banque (bordereaux de chèques)
--  À exécuter dans Supabase → SQL Editor
-- ============================================================

create table if not exists remises_banque (
  id          uuid primary key default gen_random_uuid(),
  camping_id  uuid not null references campings(id) on delete cascade,
  numero      text not null,
  banque      text,
  date_remise date not null default current_date,
  statut      text not null default 'remise' check (statut in ('remise','encaissee')),
  date_encaissement date,
  auteur_id   uuid references utilisateurs(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists uq_remises_numero on remises_banque(camping_id, numero);
create index if not exists idx_remises_camping on remises_banque(camping_id, date_remise desc);
drop trigger if exists trg_remises_updated on remises_banque;
create trigger trg_remises_updated before update on remises_banque
  for each row execute function set_updated_at();

-- lien règlement -> remise
alter table reglements add column if not exists remise_id uuid references remises_banque(id) on delete set null;
create index if not exists idx_reglements_remise on reglements(remise_id);

alter table remises_banque enable row level security;
revoke all on remises_banque from anon, authenticated;
