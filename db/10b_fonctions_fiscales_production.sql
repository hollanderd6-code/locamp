-- ============================================================
-- Lot 10b — fonctions de la chaîne fiscale, TELLES QU'EN PRODUCTION
-- ============================================================
-- Relevées le 25 octobre 2026 par pg_get_functiondef sur la base de
-- production, et recopiées à l'identique. Ce fichier n'invente rien :
-- il rend reconstructible ce qui n'existait qu'en base.
--
-- NE PAS MODIFIER LA FORMULE DE fiscal_empreinte. Toute la chaîne
-- existante a été calculée avec elle : la changer ferait apparaître
-- chaque enregistrement comme altéré (cf. 00_diagnostic_chaine_fiscale.sql,
-- cas A). Une nouvelle formule exigerait une nouvelle version majeure du
-- logiciel, un point d'ancrage documenté et de nouvelles attestations.
--
-- Rejouable sur la production : « create or replace » d'une définition
-- identique ne change rien.
-- ============================================================

-- digest() : sur Supabase, pgcrypto est déjà installée (schéma extensions).
create extension if not exists pgcrypto;

-- Empreinte d'un enregistrement du journal. Source unique : fiscal_append
-- l'utilise pour écrire, fiscal_verifier pour contrôler.
CREATE OR REPLACE FUNCTION public.fiscal_empreinte(p_seq bigint, p_type text, p_entite text, p_entite_id uuid, p_donnees jsonb, p_montant numeric, p_ts timestamp with time zone, p_prec text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select encode(digest(
    p_seq::text || '|' ||
    p_type || '|' ||
    coalesce(p_entite, '') || '|' ||
    coalesce(p_entite_id::text, '') || '|' ||
    p_donnees::text || '|' ||
    -- Échelle FORCÉE à 2 décimales, celle de la colonne : c'est ce
    -- cast qui manquait. Sans lui, 45.5 et 45.50 donnaient deux
    -- empreintes pour un même montant.
    to_char(coalesce(p_montant, 0)::numeric(14,2), 'FM9999999999990.00') || '|' ||
    -- Horodatage en UTC et au format fixe : timestamptz::text suit le
    -- fuseau de la session, deux sessions donneraient deux empreintes.
    to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
    p_prec
  , 'sha256'), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public.fiscal_append(p_camping uuid, p_type text, p_entite text, p_entite_id uuid, p_donnees jsonb, p_montant numeric, p_auteur uuid, p_auteur_email text)
 RETURNS journal_fiscal
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_seq  bigint;
  v_prec text;
  v_hash text;
  v_row  journal_fiscal;
  v_ts   timestamptz := now();
  -- Le montant tel qu'il SERA stocké. On hache cette valeur, pas celle
  -- reçue : c'est l'écart entre les deux qui cassait la chaîne.
  v_montant numeric(14,2) := coalesce(p_montant, 0)::numeric(14,2);
begin
  -- Sérialise les écritures du camping : le chaînage ne peut pas être concurrent.
  perform pg_advisory_xact_lock(hashtext(p_camping::text));

  select seq, hash into v_seq, v_prec
  from journal_fiscal where camping_id = p_camping
  order by seq desc limit 1;

  if v_seq is null then
    v_seq := 1;
    v_prec := repeat('0', 64);        -- racine de la chaîne
  else
    v_seq := v_seq + 1;
  end if;

  v_hash := public.fiscal_empreinte(
    v_seq, p_type, p_entite, p_entite_id, p_donnees, v_montant, v_ts, v_prec);

  insert into journal_fiscal(camping_id, seq, type, entite, entite_id, donnees, montant,
                             hash_precedent, hash, auteur_id, auteur_email, horodatage)
  values (p_camping, v_seq, p_type, p_entite, p_entite_id, p_donnees, v_montant,
          v_prec, v_hash, p_auteur, p_auteur_email, v_ts)
  returning * into v_row;

  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.fiscal_verifier(p_camping uuid)
 RETURNS TABLE(seq bigint, anomalie text, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  r         journal_fiscal%rowtype;
  v_prec    text := repeat('0', 64);
  v_attendu bigint := 1;
  v_hash    text;
begin
  for r in
    select * from journal_fiscal where camping_id = p_camping order by seq
  loop
    if r.seq <> v_attendu then
      seq := r.seq; anomalie := 'sequence';
      detail := 'Numérotation rompue : ' || r.seq || ' au lieu de ' || v_attendu
             || ' (enregistrement manquant ou supprimé)';
      return next;
    end if;

    if r.hash_precedent <> v_prec then
      seq := r.seq; anomalie := 'chainage';
      detail := 'Empreinte du précédent non conforme — chaîne rompue';
      return next;
    end if;

    -- MÊME fonction que fiscal_append : c'est tout l'objet du correctif.
    v_hash := public.fiscal_empreinte(
      r.seq, r.type, r.entite, r.entite_id, r.donnees, r.montant, r.horodatage, r.hash_precedent);

    if v_hash <> r.hash then
      seq := r.seq; anomalie := 'alteration';
      detail := 'Les données ne correspondent plus à leur empreinte — enregistrement modifié';
      return next;
    end if;

    v_prec := r.hash;
    v_attendu := r.seq + 1;
  end loop;
  return;
end $function$;

-- Version de production à la date du relevé. Corrigée par 18_cloture_cumul.sql
-- (cumul par type, horodatage de l'empreinte indépendant du fuseau).
CREATE OR REPLACE FUNCTION public.fiscal_cloture(p_camping uuid, p_type text, p_periode text, p_seq_debut bigint, p_seq_fin bigint, p_nb_fact integer, p_nb_regl integer, p_ht numeric, p_tva numeric, p_ttc numeric, p_encaisse numeric, p_detail jsonb, p_auteur uuid)
 RETURNS clotures_fiscales
 LANGUAGE plpgsql
 SECURITY DEFINER
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

  select hash, cumul_perpetuel into v_prec, v_cumul
  from clotures_fiscales where camping_id = p_camping
  order by horodatage desc limit 1;

  if v_prec is null then
    v_prec := repeat('0', 64);
    v_cumul := 0;
  end if;

  -- le cumul perpétuel ne décroît jamais : total de tout le CA depuis l'origine
  v_cumul := v_cumul + coalesce(p_ttc, 0);

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
