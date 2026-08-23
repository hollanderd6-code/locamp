# Migrations — Locamp

Exécuter dans l'ordre numérique, dans Supabase → SQL Editor.

| Fichier | Contenu |
|---|---|
| `01_schema_lot0` | campings, utilisateurs, rôles, audit |
| `02_schema_lot1` | emplacements, résidents, documents |
| `03_schema_lot2` | contrats et modèles |
| `04_schema_lot3` | compteurs, factures |
| `05_schema_lot4` | règlements, relances |
| `06_email_factures` | envoi des factures par e-mail |
| **`07_catalogue_facturation`** | **articles, moyens de paiement, prestations** |
| **`08_releves_compteurs`** | **relevés électricité et eau** |
| **`09_signature_electronique`** | **documents à signer, preuves eIDAS** |
| **`10_fiscal_exercices`** | **journal fiscal, clôtures, soldes d'exercice** |
| **`11_echanges_carte_suivi`** | **messagerie, push, RGPD, carte, échéances, indexation** |
| `12_remises_banque` | remises de chèques |
| `13_comptes_clients` | comptes comptables résidents |
| `14_notifications` | notifications |
| **`15_efacture`** | **Factur-X, factures reçues, e-reporting** |

En gras : reconstitués le 23 août 2026 depuis le schéma réel de la base.

## Pourquoi ils manquaient

Le dépôt sautait de 06 à 12. Dix-huit tables — dont `messages`,
`prestations`, `documents_signature`, `moyens_paiement`, `journal_fiscal` —
existaient en production sans figurer dans aucun fichier. Une installation
neuve était donc impossible, et rien n'aurait pu être reconstruit en cas de
perte.

Le code portait la trace du contournement : dans `routes/portail.js`, un
`catch` commenté « table absente : ne pas casser le portail ».

## Comment ils ont été reconstitués

Pas de mémoire : par lecture du catalogue Postgres
(`00_extraire_schema_reel.sql`). Types, valeurs par défaut, contraintes,
index et RLS sont ceux de la base. Réécrire ces migrations à la main aurait
produit un schéma *proche* mais pas identique — et le premier environnement
de test aurait créé des bugs invisibles.

Tous les `create table` sont en `if not exists` : les rejouer sur la
production ne fait rien.

## Vérifié

- les **32 tables** appelées par le code existent dans les migrations ;
- **ordre des dépendances correct** : aucune clé étrangère ne pointe vers une
  table créée plus tard.

## Numérotation

Les tables de facturation électronique sont en **15** et non en 07-11 :
elles sont postérieures aux lots 12 à 14 déjà présents. Les renuméroter
casserait l'ordre d'exécution des installations existantes.

## À décider — RLS incohérent

Le *row level security* est actif sur 8 tables et absent sur 10, dont
**`messages`** (les échanges avec les résidents) et **`prestations`**
(les montants facturés).

Ce n'est pas une faille immédiate : le backend utilise la clé
`service_role`, qui traverse RLS de toute façon, et le front passe par
l'API Express — jamais par Supabase directement. Mais la protection ne vaut
que si elle est systématique : le jour où une clé `anon` est utilisée
quelque part, ces dix tables sont lisibles.

Aucune table n'a de *policy* : RLS activé sans policy interdit tout sauf
`service_role`. C'est une posture correcte — elle mériterait juste d'être
appliquée partout.
