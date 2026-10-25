-- ============================================================
-- Lot 18 — clôtures : cumul perpétuel par type, search_path figé
-- ============================================================
-- À COLLER DANS  Supabase → SQL Editor  ET EXÉCUTER. Rejouable.
--
-- 1. CUMUL PERPÉTUEL PAR TYPE
--    fiscal_cloture repartait du cumul de la DERNIÈRE clôture, quel que
--    soit son type. Une clôture mensuelle venant après les journalières
--    du mois rajoutait donc au cumul un chiffre d'affaires déjà compté
--    jour par jour : le grand total perpétuel était gonflé.
--    Désormais chaque type a son cumul (journalier, mensuel, annuel),
--    qui ne compte chaque euro qu'une fois. Le chaînage des clôtures,
--    lui, reste unique (hash_precedent = dernière clôture, tous types).
--    Relevé du 25/10/2026 : seules des clôtures journalières existaient,
--    aucun cumul passé n'est faux.
--
--    La formule d'empreinte n'est PAS modifiée : mêmes champs, même
--    ordre. (Elle sérialise l'horodatage avec v_ts::text, qui dépend du
--    fuseau de la session — UTC sur Supabase. La changer créerait une
--    rupture : à ne faire qu'avec une nouvelle version majeure.)
--
-- 2. search_path FIGÉ
--    Une fonction SECURITY DEFINER sans search_path résout les noms
--    selon la session appelante : un objet homonyme placé plus tôt dans
--    le chemin serait exécuté avec les droits du propriétaire. Le
--    conseiller de sécurité Supabase le signale. On fige public +
--    extensions (où vit pgcrypto sur Supabase).
-- ============================================================

begin;

CREATE OR REPLACE FUNCTION public.fiscal_cloture(p_camping uuid, p_type text, p_periode text, p_seq_debut bigint, p_seq_fin bigint, p_nb_fact integer, p_nb_regl integer, p_ht numeric, p_tva numeric, p_ttc numeric, p_encaisse numeric, p_detail jsonb, p_auteur uuid)
 RETURNS clotures_fiscales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
declare
  v_prec  text;
  v_cumul numeric(16,2);
  v_hash  text;
  v_base  text;
  v_row   clotures_fiscales;
  v_ts    timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext(p_camping::text || ':clot'));

  -- chaînage : la dernière clôture, tous types confondus
  select hash into v_prec
  from clotures_fiscales where camping_id = p_camping
  order by horodatage desc limit 1;
  v_prec := coalesce(v_prec, repeat('0', 64));

  -- cumul : la dernière clôture DU MÊME TYPE, sinon un même euro serait
  -- compté une fois par jour, une fois par mois et une fois par an
  select cumul_perpetuel into v_cumul
  from clotures_fiscales where camping_id = p_camping and type = p_type
  order by horodatage desc limit 1;

  -- le cumul perpétuel ne décroît jamais : total de tout le CA depuis l'origine
  v_cumul := coalesce(v_cumul, 0) + coalesce(p_ttc, 0);

  v_base := p_type || '|' || p_periode || '|' || coalesce(p_ttc,0)::text || '|'
         || coalesce(p_encaisse,0)::text || '|' || v_cumul::text || '|'
         || v_ts::text || '|' || v_prec;
  v_hash := encode(digest(v_base, 'sha256'), 'hex');

  insert into clotures_fiscales(camping_id, type, periode, seq_debut, seq_fin,
    nb_factures, nb_reglements, total_ht, total_tva, total_ttc, total_encaisse,
    cumul_perpetuel, detail, hash_precedent, hash, auteur_id, horodatage)
  values (p_camping, p_type, p_periode, p_seq_debut, p_seq_fin,
    coalesce(p_nb_fact,0), coalesce(p_nb_regl,0),
    coalesce(p_ht,0), coalesce(p_tva,0), coalesce(p_ttc,0), coalesce(p_encaisse,0),
    v_cumul, p_detail, v_prec, v_hash, p_auteur, v_ts)
  returning * into v_row;

  return v_row;
end $function$;

alter function public.fiscal_empreinte(bigint, text, text, uuid, jsonb, numeric, timestamptz, text)
  set search_path = public, extensions;
alter function public.fiscal_append(uuid, text, text, uuid, jsonb, numeric, uuid, text)
  set search_path = public, extensions;
alter function public.fiscal_verifier(uuid)
  set search_path = public, extensions;

create or replace function public.locamp_schema_version()
returns integer language sql immutable as $$ select 18 $$;

commit;

-- Vérification :
--   select locamp_schema_version();   -- 18
--   select * from fiscal_verifier((select id from campings limit 1));   -- aucune ligne
