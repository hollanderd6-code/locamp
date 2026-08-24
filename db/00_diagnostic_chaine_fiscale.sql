-- ============================================================
-- Pourquoi la chaîne d'inaltérabilité est-elle rompue ?
-- ============================================================
-- À COLLER DANS  Supabase → SQL Editor  ET EXÉCUTER.
-- Cette requête NE MODIFIE RIEN : elle lit et compare.
--
-- L'écran Conformité fiscale affiche « ROMPUE » avec des anomalies
-- de type « alteration » sur les premiers enregistrements. Avant de
-- corriger quoi que ce soit, il faut savoir laquelle des trois causes
-- possibles s'applique — elles n'ont pas du tout les mêmes suites.
--
--   A. La formule de hachage a changé.
--      fiscal_append() a été modifiée après coup. Tous les
--      enregistrements écrits AVANT ce changement deviennent
--      invalides selon la nouvelle formule, alors que les données
--      n'ont jamais bougé. Signature : les anomalies sont les N
--      PREMIERS enregistrements, consécutifs, et s'arrêtent net.
--      → Ce n'est PAS une fraude. Mais la chaîne doit être reprise
--        depuis un point d'ancrage, et l'incident documenté.
--
--   B. Des données ont été modifiées en base.
--      Un UPDATE manuel, une migration de reprise. Signature : les
--      anomalies sont DISPERSÉES, sans continuité.
--      → C'est le cas que la loi vise. À documenter précisément.
--
--   C. Des enregistrements ont été supprimés.
--      Signature : des trous dans la numérotation seq.
--
-- Renvoyez-moi le résultat des cinq blocs : je saurai lequel.
-- ============================================================

-- ── 1. L'ampleur ────────────────────────────────────────────
-- Combien d'anomalies sur combien d'enregistrements. Si les deux
-- nombres sont ÉGAUX, c'est le cas A sans hésitation : une chaîne
-- entièrement invalide n'est jamais le fait d'une fraude, qui
-- toucherait quelques lignes.
select
  'ampleur' as bloc,
  (select count(*) from journal_fiscal) as enregistrements,
  (select count(*) from fiscal_verifier(
     (select id from campings order by created_at limit 1))) as anomalies;

-- ── 2. La forme : consécutives ou dispersées ? ──────────────
-- On liste les seq en anomalie. Consécutives depuis 1 → cas A.
-- Éparpillées → cas B.
select
  'anomalies' as bloc, seq, anomalie, detail
from fiscal_verifier((select id from campings order by created_at limit 1))
order by seq
limit 40;

-- ── 3. Y a-t-il un point de bascule ? ───────────────────────
-- Si les anomalies s'arrêtent à une date précise, c'est là que la
-- formule a changé. On regarde l'horodatage du dernier enregistrement
-- en anomalie et du premier qui est sain.
with anos as (
  select seq from fiscal_verifier((select id from campings order by created_at limit 1))
)
select
  'bascule' as bloc,
  (select max(j.horodatage) from journal_fiscal j where j.seq in (select seq from anos)) as derniere_anomalie,
  (select min(j.horodatage) from journal_fiscal j where j.seq not in (select seq from anos)) as premier_sain;

-- ── 4. Des enregistrements manquent-ils ? ───────────────────
-- La séquence doit être continue. Un trou signifie une suppression :
-- c'est le cas C, et il est plus grave que les deux autres.
select
  'trous' as bloc, s as seq_manquant
from generate_series(
  (select min(seq) from journal_fiscal),
  (select max(seq) from journal_fiscal)
) s
where not exists (select 1 from journal_fiscal j where j.seq = s)
limit 20;

-- ── 5. La formule actuelle ──────────────────────────────────
-- Le corps des deux fonctions. Elles doivent calculer le hash de la
-- MÊME façon : si fiscal_append concatène les champs dans un ordre et
-- fiscal_verifier dans un autre, tout est signalé en permanence.
-- C'est la vérification qui tranche définitivement entre A et B.
select
  'fonctions' as bloc,
  p.proname as fonction,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('fiscal_append', 'fiscal_verifier');
