-- ============================================================
--  Locamp — LOT 3 : facturation mensuelle + taxe de séjour
--  À exécuter dans Supabase → SQL Editor (après 03_schema_lot2.sql)
-- ============================================================

-- ============================================================
-- 1. COMPTEURS — numérotation atomique et continue (par camping + clé)
--    Garantit une séquence de factures SANS RUPTURE (obligation légale).
-- ============================================================
create table if not exists compteurs (
  camping_id uuid not null references campings(id) on delete cascade,
  cle        text not null,
  valeur     bigint not null default 0,
  primary key (camping_id, cle)
);
alter table compteurs enable row level security;
revoke all on compteurs from anon, authenticated;

create or replace function next_compteur(p_camping uuid, p_cle text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into compteurs(camping_id, cle, valeur) values (p_camping, p_cle, 1)
  on conflict (camping_id, cle) do update set valeur = compteurs.valeur + 1
  returning valeur into v;
  return v;
end $$;
revoke execute on function next_compteur(uuid, text) from anon, authenticated;

-- ============================================================
-- 2. FACTURES (immuables ; correction par AVOIR)
-- ============================================================
create table if not exists factures (
  id             uuid primary key default gen_random_uuid(),
  camping_id     uuid not null references campings(id) on delete cascade,
  resident_id    uuid references residents(id) on delete set null,
  contrat_id     uuid references contrats(id)  on delete set null,
  numero         text not null,
  periode        text,
  date_emission  date not null default current_date,
  lignes         jsonb not null default '[]'::jsonb,
  total_ht       numeric(12,2) not null default 0,
  total_tva      numeric(12,2) not null default 0,
  total_ttc      numeric(12,2) not null default 0,
  montant_regle  numeric(12,2) not null default 0,
  statut         text not null default 'emise'
                 check (statut in ('emise','reglee','partielle','en_retard','avoir','annulee')),
  avoir_de       uuid references factures(id) on delete set null,
  pdf_path       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists uq_factures_contrat_periode
  on factures(contrat_id, periode)
  where contrat_id is not null and periode is not null and statut <> 'avoir';
create unique index if not exists uq_factures_numero on factures(camping_id, numero);
create index if not exists idx_factures_camping  on factures(camping_id);
create index if not exists idx_factures_resident on factures(resident_id);
create index if not exists idx_factures_statut   on factures(camping_id, statut);
create index if not exists idx_factures_periode  on factures(camping_id, periode);

drop trigger if exists trg_factures_updated on factures;
create trigger trg_factures_updated before update on factures
  for each row execute function set_updated_at();

alter table factures enable row level security;
revoke all on factures from anon, authenticated;

-- ============================================================
-- 3. PARAMÉTRAGE (dans campings.parametres jsonb) :
--    parametres.facturation = { tva_taux_loyer, conditions_reglement, penalites, mention_tva }
--    parametres.taxe_sejour = { actif, tarif_nuit_personne, exoneration_mineurs }
--    Réglable via PUT /api/camping/parametres.
-- ============================================================

-- Vérification :
-- select table_name from information_schema.tables where table_schema='public' order by 1;
