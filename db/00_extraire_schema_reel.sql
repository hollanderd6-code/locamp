-- ============================================================
-- Locamp — extraire le schema reel des tables non versionnees
-- ============================================================
-- A COLLER DANS  Supabase → SQL Editor  ET EXECUTER.
-- Cette requete NE MODIFIE RIEN : elle lit le catalogue et
-- reconstruit le DDL des tables qui existent en base mais
-- n'apparaissent dans aucun fichier de db/.
--
-- POURQUOI CETTE ETAPE
-- Les migrations 07 a 11 n'ont jamais ete commitees : db/ passe
-- de 06 a 12. Dix-huit tables sont utilisees par le code sans
-- exister dans le depot — dont `messages`, `prestations`,
-- `documents_signature`, `moyens_paiement`, `journal_fiscal`.
-- Une installation neuve est donc impossible aujourd'hui.
--
-- Reecrire ces migrations de memoire produirait un schema
-- PROCHE mais pas identique a la production : types approximatifs,
-- contraintes oubliees, valeurs par defaut inventees. Le premier
-- environnement de test creerait alors des bugs invisibles.
-- On lit donc la verite, on ne la devine pas.
--
-- Copiez TOUT le resultat (colonne ddl) et renvoyez-le moi :
-- j'en ferai les fichiers db/07 a db/11, decoupes par domaine.
-- ============================================================

with tables_manquantes as (
  select unnest(array[
    'articles', 'carte_elements', 'cloture_soldes', 'clotures_fiscales',
    'demandes_rgpd', 'documents_signature', 'echeance_rappels',
    'efacture_connexions', 'efacture_recues', 'ereporting_lots',
    'journal_fiscal', 'loyer_indexations', 'messages', 'moyens_paiement',
    'prestations', 'push_tokens', 'releves_compteurs', 'signatures_preuves'
  ]) as nom
),

colonnes as (
  select
    c.table_name,
    string_agg(
      '  ' || quote_ident(c.column_name) || ' ' ||
      case
        when c.data_type = 'character varying' and c.character_maximum_length is not null
          then 'varchar(' || c.character_maximum_length || ')'
        when c.data_type = 'numeric' and c.numeric_precision is not null
          then 'numeric(' || c.numeric_precision || ',' || coalesce(c.numeric_scale, 0) || ')'
        when c.data_type = 'timestamp with time zone'    then 'timestamptz'
        when c.data_type = 'timestamp without time zone' then 'timestamp'
        when c.data_type = 'character'                   then 'char(' || c.character_maximum_length || ')'
        when c.data_type = 'USER-DEFINED'                then c.udt_name
        when c.data_type = 'ARRAY'                       then ltrim(c.udt_name, '_') || '[]'
        else c.data_type
      end ||
      case when c.column_default is not null
           then ' default ' || c.column_default else '' end ||
      case when c.is_nullable = 'NO' then ' not null' else '' end,
      E',\n' order by c.ordinal_position
    ) as corps
  from information_schema.columns c
  join tables_manquantes t on t.nom = c.table_name
  where c.table_schema = 'public'
  group by c.table_name
),

contraintes as (
  select
    rel.relname as table_name,
    string_agg('  constraint ' || quote_ident(con.conname) || ' ' ||
               pg_get_constraintdef(con.oid), E',\n' order by con.contype, con.conname) as defs
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  join tables_manquantes t on t.nom = rel.relname
  where ns.nspname = 'public'
  group by rel.relname
),

indexes as (
  select
    tablename as table_name,
    string_agg(indexdef || ';', E'\n' order by indexname) as defs
  from pg_indexes
  join tables_manquantes t on t.nom = pg_indexes.tablename
  where schemaname = 'public'
    -- les index de cle primaire/unique sont deja portes par les contraintes
    and indexname not in (
      select con.conname from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      where con.contype in ('p', 'u')
    )
  group by tablename
),

politiques as (
  select
    tablename as table_name,
    string_agg(
      'create policy ' || quote_ident(policyname) || ' on public.' || quote_ident(tablename) ||
      ' for ' || cmd ||
      case when roles is not null and array_length(roles, 1) > 0
           then ' to ' || array_to_string(roles, ', ') else '' end ||
      case when qual is not null      then E'\n  using (' || qual || ')' else '' end ||
      case when with_check is not null then E'\n  with check (' || with_check || ')' else '' end || ';',
      E'\n' order by policyname
    ) as defs
  from pg_policies
  join tables_manquantes t on t.nom = pg_policies.tablename
  where schemaname = 'public'
  group by tablename
),

rls as (
  select rel.relname as table_name, rel.relrowsecurity as actif
  from pg_class rel
  join pg_namespace ns on ns.oid = rel.relnamespace
  join tables_manquantes t on t.nom = rel.relname
  where ns.nspname = 'public'
)

select
  t.nom as table_manquante,
  case when col.corps is null
    then '-- ⚠ TABLE ABSENTE DE LA BASE : ' || t.nom ||
         E'\n--   Le code l''utilise, elle n''existe pas. Soit la fonctionnalite' ||
         E'\n--   n''a jamais tourne, soit elle echoue en silence.'
    else
      'create table if not exists public.' || quote_ident(t.nom) || E' (\n' ||
      col.corps ||
      coalesce(E',\n' || con.defs, '') ||
      E'\n);' ||
      coalesce(E'\n' || idx.defs, '') ||
      case when r.actif then E'\nalter table public.' || quote_ident(t.nom) ||
                             ' enable row level security;' else '' end ||
      coalesce(E'\n' || pol.defs, '')
  end as ddl
from tables_manquantes t
left join colonnes    col on col.table_name = t.nom
left join contraintes con on con.table_name = t.nom
left join indexes     idx on idx.table_name = t.nom
left join politiques  pol on pol.table_name = t.nom
left join rls         r   on r.table_name   = t.nom
order by t.nom;
