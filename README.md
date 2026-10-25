# Locamp

Logiciel de gestion de camping résidentiel (location longue durée).

## Structure

- `backend/` — API Node/Express + Supabase, et les deux fronts web (gestion `/`, portail locataire `/portail`).
- `db/` — migrations SQL (à exécuter dans Supabase, dans l'ordre — voir `db/LISEZ-MOI.md`).
- `mobile/gestion`, `mobile/portail` — applications Capacitor (iOS/Android).
- `ios/Locamp` — apps iOS natives SwiftUI (Liquid Glass) : Gestion et Locataire, qui affichent le site dans une coquille native. Voir `ios/README.md`.
- `app/`, `twa-manifest.json` — application Android TWA (Bubblewrap).
- `outils/` — scripts de correctifs ponctuels déjà appliqués (historique).

## Démarrage

1. Exécuter les migrations `db/*.sql` dans Supabase, dans l'ordre (pour 16 : déployer d'abord le backend 1.0.0, puis l'exécuter).
2. Créer un bucket Storage privé nommé `documents` (Supabase → Storage).
3. Déployer `backend/` (voir `backend/README.md`).

## Avancement

- **Lot 0 — Socle** : multi-tenant, utilisateurs, rôles, RLS, journal d'audit. ✅
- **Lot 1 — Cœur métier** : emplacements, fiches résidents, carte interactive, GED. ✅
- **Lot 2 — Contrats** : modèles, génération PDF, signature simple + PDF scellé. ✅
- **Lot 3 — Facturation** : facturation mensuelle auto, taxe de séjour, avoirs, PDF conforme. ✅
- **Lot 4 — Encaissements** : paiements multi-modes, lettrage, Stripe, relances, balance âgée. ✅
- **Lot 5 — Comptabilité** : export FEC, écritures partie double, lettrage, tableau de bord. ✅
- **Portail locataire** : connexion par lien magique, factures, paiement en ligne, documents. ✅
- **Interface web admin** : connexion, dashboard, carte interactive, résidents, factures, règlements, impayés. ✅
- **Front portail locataire** : page /portail — lien magique, solde, paiement en ligne, documents. ✅

- **Conformité anti-fraude TVA** (art. 286-I-3° bis CGI) : journal protégé en base, encaissements annulables mais jamais supprimés, archive scellée, attestation éditeur. ✅ (v1.0.0, voir `backend/README.md`)

## Signature Android

La clé `android.keystore` n'est plus suivie par Git (`.gitignore`). Elle doit
être conservée **hors du dépôt**, sauvegardée à part (gestionnaire de mots de
passe, coffre). Si elle a disparu de votre copie après un `git pull`, la
récupérer depuis l'historique :

```bash
git show 565e434:android.keystore > android.keystore
```

Elle reste dans l'historique Git : si le dépôt a été ou peut devenir public,
la considérer comme exposée et demander une nouvelle clé d'importation dans la
Play Console (Intégrité de l'application → Réinitialiser la clé d'importation).
