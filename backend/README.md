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
