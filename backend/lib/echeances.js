/* ============================================================================
   Echeances : attestations d'assurance + fins de contrat.
   - lister()     : toutes les echeances a venir ou depassees (pour l'ecran).
   - runRappels() : rappels par paliers (60/30/7/0 j), notif staff + email
                    resident, journalises dans echeance_rappels (jamais 2 fois).
   ========================================================================== */

const { supabase } = require('./supabase');
const { creerNotifsStaff, creerNotifResident } = require('./notifications');

let sendEmail = null;
try { ({ sendEmail } = require('./email')); } catch (_) { /* email optionnel */ }

const PALIERS = [60, 30, 7, 0];
const J = 86400000;

const joursRestants = (dateStr) => Math.floor((new Date(dateStr + 'T00:00:00') - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')) / J);

/** Liste les echeances (horizon en jours ; les depassees sont toujours incluses). */
async function lister(campingId, horizon = 90) {
  const limite = new Date(Date.now() + horizon * J).toISOString().slice(0, 10);
  const items = [];

  // 1) Assurances des residents actifs.
  const { data: residents, error: e1 } = await supabase.from('residents')
    .select('id,nom,prenom,email,assurance_expire_le,assurance_ref')
    .eq('camping_id', campingId).eq('actif', true);
  if (e1) throw e1;
  for (const r of (residents || [])) {
    const nom = [r.prenom, r.nom].filter(Boolean).join(' ');
    if (!r.assurance_expire_le) {
      items.push({ type: 'assurance', cible_id: r.id, resident_id: r.id, resident_nom: nom,
        email: r.email || null, echeance: null, jours_restants: null, statut: 'manquante', ref: r.assurance_ref || null });
      continue;
    }
    const jr = joursRestants(r.assurance_expire_le);
    if (r.assurance_expire_le <= limite) {
      items.push({ type: 'assurance', cible_id: r.id, resident_id: r.id, resident_nom: nom,
        email: r.email || null, echeance: r.assurance_expire_le, jours_restants: jr,
        statut: jr < 0 ? 'expiree' : 'a_venir', ref: r.assurance_ref || null });
    }
  }

  // 2) Contrats avec date de fin (hors annules), non deja renouveles.
  const { data: contrats, error: e2 } = await supabase.from('contrats')
    .select('id,numero,resident_id,date_debut,date_fin,statut,montant_mensuel')
    .eq('camping_id', campingId).not('date_fin', 'is', null).neq('statut', 'annule');
  if (e2) throw e2;
  const contratsActifs = (contrats || []).filter((c) => c.date_fin <= limite);
  if (contratsActifs.length) {
    const resIds = [...new Set(contratsActifs.map((c) => c.resident_id).filter(Boolean))];
    const { data: res2 } = await supabase.from('residents')
      .select('id,nom,prenom,email,actif').in('id', resIds);
    const resMap = {}; (res2 || []).forEach((r) => { resMap[r.id] = r; });
    for (const c of contratsActifs) {
      const r = resMap[c.resident_id] || {};
      if (r.actif === false) continue;                       // parti : pas de rappel
      // Renouvele ? Un autre contrat du meme resident demarre apres cette fin.
      const renouvele = (contrats || []).some((x) => x.id !== c.id && x.resident_id === c.resident_id
        && x.statut !== 'annule' && x.date_debut && x.date_debut > c.date_fin);
      if (renouvele) continue;
      const jr = joursRestants(c.date_fin);
      items.push({ type: 'contrat', cible_id: c.id, contrat_id: c.id, contrat_numero: c.numero,
        resident_id: c.resident_id, resident_nom: [r.prenom, r.nom].filter(Boolean).join(' ') || '—',
        email: r.email || null, echeance: c.date_fin, jours_restants: jr,
        statut: jr < 0 ? 'expiree' : 'a_venir' });
    }
  }

  items.sort((a, b) => (a.echeance || '9999') < (b.echeance || '9999') ? -1 : 1);
  return items;
}

/** Palier atteint pour un nombre de jours restants (null si aucun). */
function palierPour(jr) {
  if (jr == null) return null;
  const atteints = PALIERS.filter((p) => jr <= p);   // ex. jr=25 -> paliers 60 et 30 atteints -> on prend 30
  return atteints.length ? Math.min(...atteints) : null;
}

/** Envoie les rappels dus (idempotent grace au journal). */
async function runRappels(campingId) {
  const { data: camping } = await supabase.from('campings').select('nom,raison_sociale').eq('id', campingId).maybeSingle();
  const nomCamping = (camping && (camping.nom || camping.raison_sociale)) || 'Votre camping';
  const items = (await lister(campingId, Math.max(...PALIERS))).filter((i) => i.echeance);

  let envoyes = 0;
  for (const it of items) {
    const palier = palierPour(it.jours_restants);
    if (palier == null) continue;

    // Deja envoye pour ce palier ?
    const { data: deja } = await supabase.from('echeance_rappels').select('id')
      .eq('camping_id', campingId).eq('type', it.type).eq('cible_id', it.cible_id)
      .eq('echeance', it.echeance).eq('palier', palier).maybeSingle();
    if (deja) continue;

    const quand = it.jours_restants < 0 ? `expirée depuis le ${it.echeance}` :
      (it.jours_restants === 0 ? 'expire aujourd\u2019hui' : `expire dans ${it.jours_restants} jour(s) (le ${it.echeance})`);

    if (it.type === 'assurance') {
      await creerNotifsStaff(campingId, {
        titre: 'Attestation d\u2019assurance à renouveler',
        corps: `${it.resident_nom} : attestation ${quand}.`,
        type: 'echeance', lien: `#/residents`,
      }).catch(() => {});
      if (it.resident_id) {
        await creerNotifResident(campingId, it.resident_id, {
          titre: 'Votre attestation d\u2019assurance arrive à échéance',
          corps: `Votre attestation ${quand}. Merci de transmettre la nouvelle au camping.`,
          type: 'echeance',
        }).catch(() => {});
      }
      if (sendEmail && it.email) {
        await sendEmail({
          to: it.email,
          subject: `${nomCamping} — votre attestation d\u2019assurance ${it.jours_restants < 0 ? 'a expiré' : 'arrive à échéance'}`,
          html: `<p>Bonjour ${it.resident_nom},</p>
<p>Votre attestation d\u2019assurance ${quand}.</p>
<p>Merci de nous transmettre votre nouvelle attestation (par e-mail ou via votre espace résident) afin de rester en conformité avec le règlement du camping.</p>
<p>Cordialement,<br>${nomCamping}</p>`,
        }).catch((e) => console.error('[echeances:email]', e.message));
      }
    } else {
      await creerNotifsStaff(campingId, {
        titre: 'Contrat arrivant à échéance',
        corps: `Contrat ${it.contrat_numero || ''} — ${it.resident_nom} : ${quand}. Pensez au renouvellement (envoi en signature).`,
        type: 'echeance', lien: `#/residents`,
      }).catch(() => {});
      if (sendEmail && it.email) {
        await sendEmail({
          to: it.email,
          subject: `${nomCamping} — votre contrat ${it.jours_restants < 0 ? 'a expiré' : 'arrive à échéance'}`,
          html: `<p>Bonjour ${it.resident_nom},</p>
<p>Votre contrat de location ${quand}.</p>
<p>Nous allons vous proposer son renouvellement prochainement. N\u2019hésitez pas à nous contacter pour toute question.</p>
<p>Cordialement,<br>${nomCamping}</p>`,
        }).catch((e) => console.error('[echeances:email]', e.message));
      }
    }

    await supabase.from('echeance_rappels').insert({
      camping_id: campingId, type: it.type, cible_id: it.cible_id,
      echeance: it.echeance, palier, canal: 'notif+email',
    });
    envoyes++;
  }
  return { examines: items.length, rappels_envoyes: envoyes };
}

module.exports = { lister, runRappels, PALIERS };
