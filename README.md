# Locamp

Logiciel de gestion de camping résidentiel (location longue durée).

## Structure

- `backend/` — API Node/Express + Supabase (auth JWT, multi-tenant, audit, emplacements, résidents, GED, contrats + signature/PDF).
- `db/` — migrations SQL (à exécuter dans Supabase, dans l'ordre).

## Démarrage

1. Exécuter les migrations `db/*.sql` dans Supabase, dans l'ordre.
2. Créer un bucket Storage privé nommé `documents` (Supabase → Storage).
3. Déployer `backend/` (voir `backend/README.md`).

## Avancement

- **Lot 0 — Socle** : multi-tenant, utilisateurs, rôles, RLS, journal d'audit. ✅
- **Lot 1 — Cœur métier** : emplacements, fiches résidents, carte interactive, GED. ✅
- **Lot 2 — Contrats** : modèles, génération PDF, signature simple + PDF scellé. ✅
- Lot 3 — Facturation mensuelle automatique + taxe de séjour. ⏳
