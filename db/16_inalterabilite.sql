-- ============================================================
-- Lot 16 — inaltérabilité garantie PAR LA BASE
-- Article 286-I-3° bis du CGI : inaltérabilité, sécurisation,
-- conservation, archivage.
-- ============================================================
-- ORDRE : 1) déployer le backend 1.0.0 ; 2) coller ce fichier dans
-- Supabase → SQL Editor et l'exécuter. Le backend 1.0.0 détecte la
-- migration tout seul (en moins de 5 minutes) et ne double aucune
-- inscription. L'ordre inverse ferait inscrire deux fois chaque
-- opération par l'ancien backend, jusqu'à son remplacement.
-- Rejouable sans risque : tout est en « if not exists » / « or replace ».
--
-- CE QUI CHANGE
--
--  1. journal_fiscal et clotures_fiscales deviennent réellement en
--     écriture seule : UPDATE, DELETE et TRUNCATE sont refusés par
--     des triggers. (La clé service_role du backend traverse le RLS :
--     seuls des triggers protègent vraiment ces tables.)
--
--  2. Une facture émise est figée en base : numéro, date, lignes et
--     montants ne bougent plus, et elle ne se supprime plus. Seul un
--     brouillon reste modifiable. Correction = avoir.
--
--  3. Un encaissement ne se supprime plus : il s'ANNULE. La ligne
--     d'origine est conservée, marquée annulée, et l'annulation entre
--     dans la chaîne comme une écriture inverse (montant négatif).
--     Pour que le reste du code n'ait rien à changer, la table devient
--     « reglements_registre » (tout, annulations comprises) et
--     « reglements » devient une vue des encaissements non annulés.
--
--  4. Le chaînage n'est plus « best-effort » côté Node : des triggers
--     inscrivent factures, avoirs, encaissements et annulations dans
--     le journal DANS LA MÊME TRANSACTION. Si l'inscription échoue,
--     l'opération est annulée : plus aucune opération hors chaîne.
--     Les paiements Stripe (webhook) sont donc chaînés eux aussi.
--
--  5. Les fonctions fiscal_append / fiscal_verifier / fiscal_cloture
--     ne sont pas touchées : elles viennent de 10b (relevé de la
--     production). Changer la formule de hachage invaliderait toute la
--     chaîne existante (cf. 00_diagnostic_chaine_fiscale.sql, cas A).
-- ============================================================

begin;

-- ── 0. Version du schéma, lue par le backend ────────────────
create or replace function public.locamp_schema_version()
returns integer language sql immutable as $$ select 16 $$;

-- ── 1. Fonctions fiscales : prérequis ────────────────────────
-- Elles sont versionnées dans 10b_fonctions_fiscales_production.sql
-- (relevé de la production). Les triggers ci-dessous les appellent :
-- sans elles, plus aucune facture ni aucun encaissement ne passerait.
do $do$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'fiscal_append') then
    raise exception 'fiscal_append absente : exécuter d''abord 10b_fonctions_fiscales_production.sql';
  end if;
end
$do$;

-- ── 2. Journal et clôtures : écriture seule ─────────────────
-- Seule exception : la clé étrangère auteur_id « on delete set null ».
-- Supprimer un compte utilisateur met auteur_id à NULL ; le refuser
-- rendrait tout départ de salarié impossible. auteur_email reste.
create or replace function public.fiscal_ecriture_seule()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.auteur_id is null and old.auteur_id is not null
     and (to_jsonb(new) - 'auteur_id') = (to_jsonb(old) - 'auteur_id') then
    return new;
  end if;
  raise exception 'Table % en écriture seule (art. 286-I-3° bis du CGI) : % refusé', tg_table_name, tg_op
    using errcode = 'P0001';
end $$;

create or replace function public.fiscal_pas_de_truncate()
returns trigger language plpgsql as $$
begin
  raise exception 'Table % en écriture seule : TRUNCATE refusé', tg_table_name using errcode = 'P0001';
end $$;

drop trigger if exists trg_jf_ecriture_seule on public.journal_fiscal;
create trigger trg_jf_ecriture_seule before update or delete on public.journal_fiscal
  for each row execute function public.fiscal_ecriture_seule();
drop trigger if exists trg_jf_truncate on public.journal_fiscal;
create trigger trg_jf_truncate before truncate on public.journal_fiscal
  for each statement execute function public.fiscal_pas_de_truncate();

drop trigger if exists trg_clot_ecriture_seule on public.clotures_fiscales;
create trigger trg_clot_ecriture_seule before update or delete on public.clotures_fiscales
  for each row execute function public.fiscal_ecriture_seule();
drop trigger if exists trg_clot_truncate on public.clotures_fiscales;
create trigger trg_clot_truncate before truncate on public.clotures_fiscales
  for each statement execute function public.fiscal_pas_de_truncate();

-- ── 3. Factures émises : figées ─────────────────────────────
-- emis_par : l'auteur de l'émission, repris dans le journal fiscal.
alter table public.factures add column if not exists emis_par uuid
  references public.utilisateurs(id) on delete set null;

create or replace function public.factures_figees()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then
      raise exception 'Facture % émise : suppression refusée (une facture s''annule par un avoir)', old.numero
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.statut <> 'brouillon' then
    if new.statut = 'brouillon' then
      raise exception 'Facture % émise : retour en brouillon refusé', old.numero using errcode = 'P0001';
    end if;
    -- resident_id peut seulement passer à NULL (clé étrangère « on delete set null »).
    if new.numero is distinct from old.numero
       or new.date_emission is distinct from old.date_emission
       or new.lignes is distinct from old.lignes
       or new.total_ht is distinct from old.total_ht
       or new.total_tva is distinct from old.total_tva
       or new.total_ttc is distinct from old.total_ttc
       or new.camping_id is distinct from old.camping_id
       or new.avoir_de is distinct from old.avoir_de
       or (new.resident_id is distinct from old.resident_id and new.resident_id is not null) then
      raise exception 'Facture % émise : contenu figé (art. 286-I-3° bis du CGI) — corriger par un avoir', old.numero
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_factures_figees on public.factures;
create trigger trg_factures_figees before update or delete on public.factures
  for each row execute function public.factures_figees();

-- Inscription de la facture (ou de l'avoir) dans la chaîne, dans la transaction.
create or replace function public.factures_chainer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'brouillon' then return new; end if;
  if tg_op = 'UPDATE' and old.statut <> 'brouillon' then return new; end if;  -- déjà chaînée
  perform fiscal_append(
    p_camping      => new.camping_id,
    p_type         => case when new.statut = 'avoir' then 'avoir' else 'facture' end,
    p_entite       => 'factures',
    p_entite_id    => new.id,
    p_donnees      => jsonb_build_object(
                        'numero', new.numero, 'date_emission', new.date_emission,
                        'resident_id', new.resident_id, 'avoir_de', new.avoir_de,
                        'total_ht', new.total_ht, 'total_tva', new.total_tva, 'total_ttc', new.total_ttc,
                        'nb_lignes', jsonb_array_length(coalesce(new.lignes, '[]'::jsonb))),
    p_montant      => new.total_ttc,
    p_auteur       => new.emis_par,
    p_auteur_email => (select email from utilisateurs where id = new.emis_par));
  return new;
end $$;

drop trigger if exists trg_factures_chainer on public.factures;
create trigger trg_factures_chainer after insert or update of statut on public.factures
  for each row execute function public.factures_chainer();

-- ── 4. Encaissements : annulation au lieu de suppression ────
do $do$
begin
  -- renommage une seule fois : à la seconde exécution, « reglements » est déjà une vue
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'reglements' and c.relkind = 'r') then
    alter table public.reglements rename to reglements_registre;
  end if;
end
$do$;

alter table public.reglements_registre add column if not exists annule_at timestamptz;
alter table public.reglements_registre add column if not exists annule_le date;
alter table public.reglements_registre add column if not exists annule_par uuid
  references public.utilisateurs(id) on delete set null;
alter table public.reglements_registre add column if not exists annule_motif text;
create index if not exists idx_reglements_annule on public.reglements_registre(camping_id, annule_le)
  where annule_at is not null;

-- Vue des encaissements valides : tout le code existant lit et écrit
-- « reglements » sans rien savoir des annulations. Vue simple, donc
-- modifiable (insert/update passent à la table, triggers compris).
-- ATTENTION : « select * » est figé à la création de la vue. Après un
-- « alter table reglements_registre add column », recréer la vue.
create or replace view public.reglements with (security_invoker = true) as
  select * from public.reglements_registre where annule_at is null;
grant select, insert, update, delete on public.reglements to service_role;
grant select, insert, update on public.reglements_registre to service_role;
revoke all on public.reglements from anon, authenticated;
revoke all on public.reglements_registre from anon, authenticated;

create or replace function public.reglements_figes()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Encaissement : suppression refusée (art. 286-I-3° bis du CGI) — l''annuler'
      using errcode = 'P0001';
  end if;
  if old.annule_at is not null then
    -- seules les clés étrangères « on delete set null » peuvent encore agir
    if (to_jsonb(new) - array['resident_id', 'auteur_id', 'annule_par', 'updated_at'])
         = (to_jsonb(old) - array['resident_id', 'auteur_id', 'annule_par', 'updated_at'])
       and (new.resident_id is null or new.resident_id = old.resident_id)
       and (new.auteur_id is null or new.auteur_id = old.auteur_id)
       and (new.annule_par is null or new.annule_par = old.annule_par) then
      return new;
    end if;
    raise exception 'Encaissement déjà annulé : il ne peut plus être modifié' using errcode = 'P0001';
  end if;
  -- resident_id peut seulement passer à NULL (clé étrangère « on delete set null »).
  if new.montant is distinct from old.montant
     or new.mode is distinct from old.mode
     or new.date_reglement is distinct from old.date_reglement
     or new.reference is distinct from old.reference
     or new.camping_id is distinct from old.camping_id
     or (new.resident_id is distinct from old.resident_id and new.resident_id is not null) then
    raise exception 'Encaissement : montant, mode et date figés — l''annuler puis le ressaisir'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_reglements_figes on public.reglements_registre;
create trigger trg_reglements_figes before update or delete on public.reglements_registre
  for each row execute function public.reglements_figes();

create or replace function public.reglements_chainer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform fiscal_append(
      p_camping => new.camping_id, p_type => 'reglement',
      p_entite => 'reglements', p_entite_id => new.id,
      p_donnees => jsonb_build_object(
        'mode', new.mode, 'date_reglement', new.date_reglement,
        'resident_id', new.resident_id, 'reference', new.reference, 'montant', new.montant),
      p_montant => new.montant,
      p_auteur => new.auteur_id,
      p_auteur_email => (select email from utilisateurs where id = new.auteur_id));
  elsif old.annule_at is null and new.annule_at is not null then
    -- écriture inverse : le montant est négatif, l'original reste intact
    perform fiscal_append(
      p_camping => new.camping_id, p_type => 'annulation_reglement',
      p_entite => 'reglements', p_entite_id => new.id,
      p_donnees => jsonb_build_object(
        'mode', new.mode, 'date_reglement', new.date_reglement, 'annule_le', new.annule_le,
        'resident_id', new.resident_id, 'reference', new.reference,
        'montant', -new.montant, 'motif', new.annule_motif),
      p_montant => -new.montant,
      p_auteur => new.annule_par,
      p_auteur_email => (select email from utilisateurs where id = new.annule_par));
  end if;
  return new;
end $$;

drop trigger if exists trg_reglements_chainer on public.reglements_registre;
create trigger trg_reglements_chainer after insert or update of annule_at on public.reglements_registre
  for each row execute function public.reglements_chainer();

-- Annulation d'un encaissement : un seul appel, une seule transaction.
-- Le lettrage est vidé (l'argent n'est plus affecté à aucune facture) ;
-- les affectations d'origine restent lisibles dans le journal d'audit.
create or replace function public.reglement_annuler(
  p_camping uuid, p_id uuid, p_auteur uuid, p_motif text)
returns setof public.reglements_registre
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_motif), '') = '' then
    raise exception 'Motif d''annulation obligatoire' using errcode = 'P0001';
  end if;
  return query
    update reglements_registre set
      annule_at = now(),
      annule_le = (now() at time zone 'Europe/Paris')::date,
      annule_par = p_auteur,
      annule_motif = trim(p_motif)
    where camping_id = p_camping and id = p_id and annule_at is null
    returning *;
end $$;

commit;

-- Vérification :
--   select locamp_schema_version();                       -- 16
--   select tgname from pg_trigger where tgname like 'trg_%' and not tgisinternal;
