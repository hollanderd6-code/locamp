-- Lot 5 — Envoi automatique des factures par e-mail
-- Suivi de l'envoi au résident (idempotence : évite les doublons au re-run).

alter table factures add column if not exists email_envoye_at timestamptz;
