# Camping résidentiel — Backend (Lot 0 : socle)

API Node/Express + Supabase (PostgreSQL). Multi-tenant, authentification JWT, rôles et journal d'audit.

## Prérequis

- Node >= 20
- Un projet Supabase avec le schéma `01_schema_lot0.sql` déjà exécuté.

## Installation locale

```bash
npm install
cp .env.example .env   # puis remplir les valeurs
npm run dev            # démarre avec rechargement auto
```

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé **service_role** (secrète, backend uniquement) |
| `JWT_SECRET` | Secret de signature des jetons JWT |
| `JWT_EXPIRES` | Durée de validité du jeton (def. `30d`) |
| `BOOTSTRAP_SECRET` | Secret pour créer le tout premier administrateur |

## Déploiement Render

1. Pousser ce dossier sur GitHub.
2. Render → **New > Web Service** → connecter le repo.
3. Runtime **Node**. Build command : `npm install`. Start command : `npm start`.
4. Ajouter les variables d'environnement ci-dessus (ne PAS committer `.env`).
5. Déployer. Render fournit automatiquement `PORT`.

## Endpoints (Lot 0)

- `GET  /health` — vérification de vie
- `POST /api/auth/register` — création d'utilisateur (bootstrap ou admin)
- `POST /api/auth/login` — connexion, renvoie un JWT + campings/rôles
- `GET  /api/auth/me` — profil de l'utilisateur connecté (JWT requis)

## Séquence de test (premier admin)

1. Créer un camping (SQL Supabase) et récupérer son `id` :
   ```sql
   insert into campings (nom, raison_sociale)
   values ('Camping des Sources', 'SAS Boostinghost')
   returning id;
   ```
2. Créer l'admin (remplacer l'URL, le secret et le camping_id) :
   ```bash
   curl -X POST https://<app>.onrender.com/api/auth/register \
     -H "Content-Type: application/json" \
     -H "x-bootstrap-secret: <BOOTSTRAP_SECRET>" \
     -d '{"email":"charles@exemple.fr","password":"MotDePasseFort","nom":"Induni","prenom":"Charles","camping_id":"<uuid_camping>","role":"admin"}'
   ```
3. Se connecter :
   ```bash
   curl -X POST https://<app>.onrender.com/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"charles@exemple.fr","password":"MotDePasseFort"}'
   ```
4. Vérifier le profil avec le token renvoyé :
   ```bash
   curl https://<app>.onrender.com/api/auth/me \
     -H "Authorization: Bearer <token>"
   ```

Vérifier ensuite dans Supabase que la table `audit_log` contient bien les actions `create` et `login`.

## Lot 3 — Facturation (endpoints)

- `POST /api/factures/run-mensuel` `{ periode?: "YYYY-MM" }` — génère les factures des contrats actifs (admin/gestionnaire).
- `GET  /api/factures` — liste (filtres: resident_id, contrat_id, statut, periode).
- `POST /api/factures` — facture manuelle ponctuelle `{ resident_id, lignes[] }`.
- `POST /api/factures/:id/avoir` — émet un avoir et annule la facture d'origine.
- `GET  /api/factures/:id/pdf` — lien signé du PDF (généré à la demande).
- `GET  /api/taxe-sejour/etat?annee=2026` — total de taxe de séjour collectée par mois.
- `GET  /api/camping` · `PUT /api/camping/parametres` — infos et paramètres (barème taxe, TVA, mentions).

### Facturation automatique (Render Cron Job)

1. Ajouter la variable d'env `CRON_SECRET`.
2. Render → New → **Cron Job**, planification mensuelle (ex. `0 6 1 * *`), commande :
   ```
   curl -X POST "$RENDER_URL/api/cron/facturation-mensuelle" -H "x-cron-secret: $CRON_SECRET"
   ```
   (ou un service externe qui appelle ce endpoint chaque 1er du mois).

## Lot 4 — Encaissements, lettrage, relances

- `POST /api/reglements` — enregistre un paiement `{ mode, montant, resident_id? }` ; lettrage auto (plus anciennes factures) si `affectations` absent.
- `GET  /api/reglements` — liste (filtre resident_id).
- `PUT  /api/reglements/:id/statut-cheque` — suivi chèque (recu/remis/encaisse).
- `DELETE /api/reglements/:id` — annule un règlement (admin) et recalcule les factures.
- `POST /api/reglements/facture/:id/lien-paiement` — génère un lien Stripe Checkout.
- `POST /api/webhooks/stripe` — reçoit les paiements Stripe (règlement + lettrage auto).
- `GET  /api/relances/impayes` — factures impayées + balance âgée (0-30, 31-60, 61-90, 90+).
- `GET  /api/relances` — historique des relances.
- `POST /api/relances/run` — envoie les relances des factures en retard (e-mail Brevo).

### Automatisation (Render Cron Jobs)
- Facturation : `POST $URL/api/cron/facturation-mensuelle` (mensuel).
- Relances : `POST $URL/api/cron/relances` (hebdomadaire) — en-tête `x-cron-secret`.

### Variables d'env optionnelles
- Stripe : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_APP_URL`.
- Brevo (relances e-mail) : `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`.
Sans ces clés, le paiement en ligne et l'envoi d'e-mails sont simplement désactivés (le reste fonctionne).
