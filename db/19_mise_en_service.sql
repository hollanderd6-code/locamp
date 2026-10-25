-- ============================================================
-- Lot 19 — mise en service : remise à zéro UNIQUE des données d'essai
-- ============================================================
-- À COLLER DANS  Supabase → SQL Editor  ET EXÉCUTER. Rejouable.
-- Ce fichier ne supprime RIEN : il crée l'outil. La remise à zéro se
-- lance ensuite à la main, camping par camping (mode d'emploi en bas).
--
-- POURQUOI
-- Pendant un essai, on saisit des factures et des encaissements fictifs.
-- Depuis db/16, la base les protège comme des données fiscales réelles :
-- ils resteraient à jamais dans le journal. Avant la première opération
-- réelle, on remet donc la partie fiscale du camping à zéro, une fois.
--
-- CE QUI EST REMIS À ZÉRO (pour ce camping seulement)
--   journal fiscal, clôtures, factures et avoirs (brouillons compris),
--   encaissements (annulés compris), relances, remises de chèques,
--   soldes de clôture d'exercice, numérotation des factures (repart à 1),
--   notifications qui pointent vers des factures ou des encaissements.
--
-- CE QUI EST CONSERVÉ
--   résidents, emplacements, contrats, compteurs et relevés, documents,
--   messages, paramètres, utilisateurs, journal d'audit.
--   Les prestations rattachées à une facture d'essai redeviennent
--   « en cours » : jamais réellement facturées, elles le seront à la
--   première facture réelle. Elles sont listées dans l'aperçu : à vérifier.
--
-- GARDE-FOUS
--   · une seule fois par camping : la table mises_en_service, en écriture
--     seule, l'interdit ensuite définitivement ;
--   · appel sans confirmation = aperçu, rien n'est modifié ;
--   · inaccessible depuis l'application (exécution réservée au SQL Editor) ;
--   · la nouvelle chaîne s'ouvre sur un événement « mise_en_service » qui
--     consigne ce qui a été effacé, et quand.
--   Ne l'utiliser QUE si aucune donnée réelle n'a été saisie : effacer des
--   factures ou des encaissements réels est interdit par la loi.
-- ============================================================

begin;

create table if not exists public.mises_en_service (
  camping_id   uuid primary key references public.campings(id) on delete restrict,
  effectuee_at timestamptz not null default now(),
  par          text not null,
  bilan        jsonb not null
);
alter table public.mises_en_service enable row level security;
revoke all on public.mises_en_service from anon, authenticated;

create or replace function public.mises_en_service_figees()
returns trigger language plpgsql as $f$
begin
  raise exception 'Mise en service définitive : % refusé', tg_op using errcode = 'P0001';
end $f$;

drop trigger if exists trg_mes_ecriture_seule on public.mises_en_service;
create trigger trg_mes_ecriture_seule before update or delete on public.mises_en_service
  for each row execute function public.mises_en_service_figees();
drop trigger if exists trg_mes_truncate on public.mises_en_service;
create trigger trg_mes_truncate before truncate on public.mises_en_service
  for each statement execute function public.fiscal_pas_de_truncate();

create or replace function public.locamp_mise_en_service(p_camping uuid, p_confirmation text default null)
returns table(element text, nombre bigint)
language plpgsql set search_path = public, extensions as $$
declare
  v_nom   text;
  v_bilan jsonb;
  v_ok    constant text := 'JE CONFIRME QUE CE SONT DES DONNEES D''ESSAI';
  n_journal bigint; n_clot bigint; n_fact bigint; n_regl bigint; n_relances bigint;
  n_remises bigint; n_soldes bigint; n_prest bigint; n_notifs bigint;
begin
  select nom into v_nom from campings where id = p_camping;
  if v_nom is null then
    raise exception 'Camping % introuvable', p_camping;
  end if;
  if exists (select 1 from mises_en_service where camping_id = p_camping) then
    raise exception 'Camping « % » déjà mis en service : la remise à zéro n''est possible qu''une fois.', v_nom;
  end if;

  select count(*) into n_journal  from journal_fiscal      where camping_id = p_camping;
  select count(*) into n_clot     from clotures_fiscales   where camping_id = p_camping;
  select count(*) into n_fact     from factures            where camping_id = p_camping;
  select count(*) into n_regl     from reglements_registre where camping_id = p_camping;
  select count(*) into n_relances from relances            where camping_id = p_camping;
  select count(*) into n_remises  from remises_banque      where camping_id = p_camping;
  select count(*) into n_soldes   from cloture_soldes      where camping_id = p_camping;
  select count(*) into n_prest    from prestations
    where camping_id = p_camping and facture_id is not null;
  select count(*) into n_notifs   from notifications
    where camping_id = p_camping and entite in ('facture', 'reglement');

  v_bilan := jsonb_build_object(
    'camping', v_nom, 'journal_fiscal', n_journal, 'clotures', n_clot, 'factures', n_fact,
    'encaissements', n_regl, 'relances', n_relances, 'remises_cheques', n_remises,
    'soldes_exercice', n_soldes, 'prestations_remises_en_cours', n_prest, 'notifications', n_notifs);

  -- ── aperçu : rien n'est modifié ──
  if p_confirmation is distinct from v_ok then
    element := '*** APERÇU — rien n''a été modifié ***'; nombre := null; return next;
    element := 'camping : ' || v_nom;                    nombre := null; return next;
    element := 'enregistrements du journal fiscal';      nombre := n_journal; return next;
    element := 'clôtures';                               nombre := n_clot; return next;
    element := 'factures et avoirs (brouillons compris)';nombre := n_fact; return next;
    element := 'encaissements (annulés compris)';        nombre := n_regl; return next;
    element := 'relances';                               nombre := n_relances; return next;
    element := 'remises de chèques';                     nombre := n_remises; return next;
    element := 'soldes de clôture d''exercice';          nombre := n_soldes; return next;
    element := 'notifications facture/encaissement';     nombre := n_notifs; return next;
    element := 'prestations qui redeviendront « en cours » (à vérifier)'; nombre := n_prest; return next;
    for element in
      select '   · ' || coalesce(r.prenom || ' ', '') || coalesce(r.nom, '?') || ' — '
             || p.designation || ' — ' || coalesce(p.montant_ttc::text, '?') || ' €'
      from prestations p left join residents r on r.id = p.resident_id
      where p.camping_id = p_camping and p.facture_id is not null
      order by r.nom
    loop
      nombre := null; return next;
    end loop;
    element := 'Pour exécuter : relancer avec la phrase de confirmation exacte'; nombre := null; return next;
    return;
  end if;

  -- ── exécution ──
  -- Les protections de db/16 sont levées le temps de cette transaction
  -- seulement. ALTER TABLE verrouille les tables : aucune autre écriture
  -- ne peut se glisser pendant l'opération, et tout est annulé en bloc
  -- à la moindre erreur.
  alter table journal_fiscal      disable trigger trg_jf_ecriture_seule;
  alter table clotures_fiscales   disable trigger trg_clot_ecriture_seule;
  alter table factures            disable trigger trg_factures_figees;
  alter table reglements_registre disable trigger trg_reglements_figes;

  update prestations set statut = 'en_cours', facture_id = null
    where camping_id = p_camping and facture_id is not null;
  delete from notifications
    where camping_id = p_camping and entite in ('facture', 'reglement');
  delete from relances            where camping_id = p_camping;
  delete from reglements_registre where camping_id = p_camping;
  delete from remises_banque      where camping_id = p_camping;
  delete from factures            where camping_id = p_camping;
  delete from cloture_soldes      where camping_id = p_camping;
  delete from clotures_fiscales   where camping_id = p_camping;
  delete from journal_fiscal      where camping_id = p_camping;
  delete from compteurs           where camping_id = p_camping and cle like 'facture:%';

  alter table journal_fiscal      enable trigger trg_jf_ecriture_seule;
  alter table clotures_fiscales   enable trigger trg_clot_ecriture_seule;
  alter table factures            enable trigger trg_factures_figees;
  alter table reglements_registre enable trigger trg_reglements_figes;

  insert into mises_en_service (camping_id, par, bilan)
    values (p_camping, current_user, v_bilan);

  -- la nouvelle chaîne s'ouvre sur la trace de cette remise à zéro
  perform fiscal_append(p_camping, 'mise_en_service', 'mises_en_service', p_camping,
    v_bilan || jsonb_build_object('motif', 'remise à zéro des données d''essai avant mise en service'),
    0, null, current_user);

  element := 'Mise en service effectuée — camping ' || v_nom; nombre := null; return next;
  element := 'journal fiscal effacé';   nombre := n_journal; return next;
  element := 'factures effacées';       nombre := n_fact; return next;
  element := 'encaissements effacés';   nombre := n_regl; return next;
  element := 'prochaine facture : F-' || extract(year from now())::int || '-00001'; nombre := null; return next;
end $$;

-- Réservée au SQL Editor : l'application ne doit jamais pouvoir l'appeler.
revoke all on function public.locamp_mise_en_service(uuid, text) from public, anon, authenticated, service_role;

commit;

-- ============================================================
-- MODE D'EMPLOI
-- ============================================================
-- 1. Trouver l'identifiant du camping :
--      select id, nom from campings;
--
-- 2. APERÇU (ne modifie rien) — remplacer l'identifiant :
--      select * from locamp_mise_en_service('00000000-0000-0000-0000-000000000000');
--
-- 3. Si l'aperçu correspond bien à des données d'essai, EXÉCUTER :
--      select * from locamp_mise_en_service('00000000-0000-0000-0000-000000000000',
--        'JE CONFIRME QUE CE SONT DES DONNEES D''ESSAI');
--
-- 4. Vérifier : l'écran Conformité fiscale affiche « Intègre », 1 enregistrement.
-- ============================================================
