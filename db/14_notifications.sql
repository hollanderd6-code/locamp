-- ============================================================
--  LOT 6 — Notifications in-app (logiciel staff + portail locataire)
--  Cible : PostgreSQL / Supabase
--  À exécuter dans : Supabase → SQL Editor (après les migrations précédentes)
-- ============================================================

-- Centre de notifications. Chaque ligne cible UN destinataire :
--   - soit un utilisateur staff  (destinataire_user_id)     -> canal 'staff'
--   - soit un résident du portail (destinataire_resident_id) -> canal 'portail'
-- Un événement (paiement, message, facture…) génère 1 ligne par destinataire
-- (fan-out), ce qui donne un état « lu/non lu » propre à chaque personne.
create table if not exists notifications (
  id                       uuid primary key default gen_random_uuid(),
  camping_id               uuid not null references campings(id)    on delete cascade,
  canal                    text not null default 'staff',           -- 'staff' | 'portail'
  destinataire_user_id     uuid references utilisateurs(id)         on delete cascade,
  destinataire_resident_id uuid references residents(id)            on delete cascade,

  type                     text not null,     -- 'paiement_recu' | 'nouveau_message' | 'nouvelle_facture' | 'relance' | 'paiement_confirme' | ...
  titre                    text not null,
  corps                    text,

  -- Cible pour le lien profond / l'action directe (ex : ouvrir la facture pour encaisser)
  entite                   text,              -- 'facture' | 'reglement' | 'message' | 'resident' | 'document'
  entite_id                uuid,
  lien                     text,              -- URL/action optionnelle côté front
  donnees                  jsonb not null default '{}'::jsonb,

  lu                       boolean not null default false,
  lu_at                    timestamptz,
  created_at               timestamptz not null default now(),

  -- Garde-fou : exactement un type de destinataire selon le canal
  constraint chk_notif_destinataire check (
    (canal = 'staff'   and destinataire_user_id is not null and destinataire_resident_id is null) or
    (canal = 'portail' and destinataire_resident_id is not null and destinataire_user_id is null)
  )
);

-- Index pour les listes et le compteur de badge (poll fréquent).
create index if not exists idx_notif_user
  on notifications (destinataire_user_id, lu, created_at desc)
  where destinataire_user_id is not null;

create index if not exists idx_notif_resident
  on notifications (destinataire_resident_id, lu, created_at desc)
  where destinataire_resident_id is not null;

create index if not exists idx_notif_camping on notifications (camping_id, created_at desc);

-- Cohérent avec le reste du schéma : RLS activée, aucun accès anonyme.
-- Le backend accède via la clé service_role (qui bypasse la RLS) et filtre en code.
alter table notifications enable row level security;
