#!/usr/bin/env node
/* ============================================================
   outils/messagerie-fil.js
   Messagerie : conversations a gauche, fil et reponse a droite
   ============================================================
   Cible : backend/public/app.js  (remplace vueMessagerie
           et window.ouvrirConversation)

   ── CE QUI CHANGE ───────────────────────────────────────────────
   Avant : une boite de reception qui n'en etait pas une. La liste des
   conversations s'affichait, mais cliquer une ligne QUITTAIT l'ecran
   pour ouvrir l'onglet « messages » de la fiche du resident. Repondre
   a trois personnes demandait donc trois allers-retours, et on perdait
   la liste — donc le fil de ce qui restait a traiter.

   Apres : la messagerie est une messagerie. Conversations a gauche
   (non lus en tete), fil de la conversation a droite, champ de reponse
   au bas du fil. On repond a la suite sans quitter l'ecran.

   Detail qui compte : la lecture d'un fil marque les messages comme
   lus cote serveur. Le badge de la barre laterale est donc rafraichi
   apres chaque ouverture, sinon il continuait d'annoncer des non-lus
   qui ne l'etaient plus.

   « Ecrire » depuis le tableau de bord, les impayes ou une
   notification ouvre maintenant la conversation ICI, au lieu de la
   fiche du resident : c'est le meme geste, en un ecran de moins.
   La fiche du resident reste accessible en tete du fil.

   Aucun changement backend : GET /api/messages/conversations,
   GET /api/messages?resident_id=, POST /api/messages.

   Usage :
     node outils/messagerie-fil.js --essai
     node outils/messagerie-fil.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

function NOUVEAU_CODE() {
  /* ---------- Messagerie : conversations + fil ----------
     La conversation ouverte vit ici : on revient sur le meme fil apres
     un envoi, qui passe par un rechargement du fil seul. */
  let MSG_SEL = null;
  let MSG_FILTRE = 'toutes';
  let MSG_Q = '';
  let MSG_CACHE = { conversations: [] };

  const MSG_FILTRES = [
    ['toutes', 'Toutes', () => true],
    ['nonlus', 'Non lus', (c) => c.non_lus > 0],
  ];

  const msgQuand = (d) => {
    const t = new Date(d);
    const jours = Math.floor((Date.now() - t.getTime()) / 86400000);
    if (jours < 1) return t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (jours < 7) return t.toLocaleDateString('fr-FR', { weekday: 'short' });
    return t.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  };

  function msgVisibles() {
    const f = (MSG_FILTRES.find((x) => x[0] === MSG_FILTRE) || MSG_FILTRES[0])[2];
    const q = MSG_Q.trim().toLowerCase();
    return MSG_CACHE.conversations.filter((c) => {
      if (!f(c)) return false;
      if (!q) return true;
      return `${c.resident_nom} ${c.dernier_message.corps}`.toLowerCase().includes(q);
    });
  }

  function msgLigneConv(c) {
    const sel = c.resident_id === MSG_SEL;
    const nonLu = c.non_lus > 0;
    return `
      <div data-act="ouvrirConversation" data-a1="${c.resident_id}"
           style="display:flex;align-items:center;gap:12px;padding:0 18px;height:70px;cursor:pointer;
                  border-bottom:1px solid var(--hairline);
                  background:${sel ? 'var(--sapin-pale)' : 'transparent'};
                  box-shadow:${sel ? 'inset 3px 0 0 var(--sapin)' : 'none'}">
        <div style="min-width:0;flex:1">
          <div style="font-size:14px;font-weight:${nonLu ? '700' : '600'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(c.resident_nom)}</div>
          <div style="font-size:12.5px;color:${nonLu ? '#3C4E47' : 'var(--brume)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${c.dernier_message.auteur === 'camping' ? '<span class="muted">Vous : </span>' : ''}${esc(c.dernier_message.corps)}</div>
        </div>
        <div style="flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:5px">
          <span class="muted" style="font-size:11.5px">${msgQuand(c.dernier_message.date)}</span>
          ${nonLu ? `<span style="min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--sapin);
                       color:var(--ivoire);font-size:11px;font-weight:600;display:flex;align-items:center;
                       justify-content:center">${c.non_lus}</span>` : ''}
        </div>
      </div>`;
  }

  function majListeConversations() {
    const box = $('#msg-liste');
    if (!box) return;
    const v = msgVisibles();
    box.innerHTML = v.length ? v.map(msgLigneConv).join('')
      : '<p class="muted" style="padding:18px">Aucune conversation ne correspond.</p>';
  }

  window.filtrerMessagerie = (k) => { MSG_FILTRE = k; MSG_SEL = null; vueMessagerie(); };
  window.chercherMessagerie = (v) => { MSG_Q = v; majListeConversations(); };

  /* Appelee aussi depuis le tableau de bord, les impayes et les
     notifications : elle ouvre la conversation dans la messagerie. */
  window.ouvrirConversation = (residentId) => {
    MSG_SEL = residentId;
    const dansMessagerie = (location.hash || '').indexOf('#/messagerie') === 0;
    if (dansMessagerie) { majListeConversations(); chargerFil(); }
    else location.hash = '#/messagerie';
  };

  function msgBulle(m) {
    const moi = m.auteur === 'camping';
    return `
      <div style="display:flex;justify-content:${moi ? 'flex-end' : 'flex-start'}">
        <div style="max-width:74%;padding:10px 14px;border-radius:var(--r-m, 14px);
                    background:${moi ? 'var(--sapin)' : 'var(--carte)'};
                    color:${moi ? 'var(--ivoire)' : 'inherit'};
                    border:1px solid ${moi ? 'var(--sapin)' : 'var(--hairline)'}">
          <div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap">${esc(m.corps || '')}</div>
          <div style="font-size:11px;margin-top:5px;opacity:.72;text-align:right">
            ${new Date(m.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>`;
  }

  async function chargerFil() {
    const box = $('#msg-fiche');
    if (!box) return;
    const conv = MSG_CACHE.conversations.find((c) => c.resident_id === MSG_SEL);
    if (!MSG_SEL) {
      box.innerHTML = `<p class="muted" style="padding:26px">${MSG_CACHE.conversations.length
        ? 'Choisissez une conversation.'
        : 'Aucune conversation. Les échanges apparaissent ici dès qu\'un client écrit depuis son portail, ou que vous écrivez à un résident.'}</p>`;
      return;
    }
    box.innerHTML = '<p class="muted" style="padding:26px">Chargement…</p>';
    let messages = [];
    try { ({ messages } = await api('/api/messages?resident_id=' + MSG_SEL)); }
    catch (err) { box.innerHTML = `<p class="form-error" style="margin:26px">${esc(err.message)}</p>`; return; }

    box.innerHTML = `
      <div style="height:100%;display:flex;flex-direction:column;min-height:0">
        <div style="background:var(--carte);border-bottom:1px solid var(--hairline);padding:16px 22px;
                    display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
          <div style="min-width:0">
            <div style="font-size:17px;font-weight:600">${esc(conv ? conv.resident_nom : 'Résident')}</div>
            <div class="muted" style="font-size:12.5px;margin-top:2px">${messages.length} message${messages.length > 1 ? 's' : ''}</div>
          </div>
          <button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/residents/${MSG_SEL}">Ouvrir la fiche</button>
        </div>

        <div id="msg-fil" style="flex:1;overflow:auto;padding:20px 22px;display:flex;flex-direction:column;gap:10px">
          ${messages.length ? messages.map(msgBulle).join('')
    : '<p class="muted" style="margin:0">Aucun message dans ce fil.</p>'}
        </div>

        <form id="msg-form" data-act="envoyerMessageFil" data-evt="submit" data-a1="${MSG_SEL}"
              style="border-top:1px solid var(--hairline);background:var(--carte);padding:14px 22px;
                     display:flex;gap:10px;align-items:flex-end">
          <textarea id="msg-corps" rows="2" placeholder="Écrire à ${esc(conv ? conv.resident_nom : 'ce résident')}…"
                    style="flex:1;resize:vertical;min-height:44px"></textarea>
          <button class="btn btn-primary" type="submit">Envoyer</button>
        </form>
        <div class="muted" style="padding:0 22px 12px;font-size:12px;background:var(--carte)">
          Le résident reçoit une notification et un e-mail.
        </div>
      </div>`;

    const fil = $('#msg-fil');
    if (fil) fil.scrollTop = fil.scrollHeight;
    /* La lecture du fil marque les messages lus cote serveur : le badge
       de la barre laterale doit suivre. */
    if (typeof majBadgeMessagerie === 'function') majBadgeMessagerie();
    if (conv && conv.non_lus) {
      conv.non_lus = 0;
      majListeConversations();
    }
  }

  window.envoyerMessageFil = async (residentId) => {
    const zone = $('#msg-corps');
    const corps = zone ? zone.value.trim() : '';
    if (!corps) { if (zone) zone.focus(); return; }
    const bouton = $('#msg-form') ? $('#msg-form').querySelector('button[type="submit"]') : null;
    if (bouton) { bouton.disabled = true; bouton.textContent = 'Envoi…'; }
    try {
      await api('/api/messages', { method: 'POST', body: { resident_id: residentId, corps } });
      if (zone) zone.value = '';
      /* La liste doit refleter le nouveau dernier message : on recharge
         les deux, sans quitter la conversation. */
      await vueMessagerie();
    } catch (err) {
      toast(err.message, true);
      if (bouton) { bouton.disabled = false; bouton.textContent = 'Envoyer'; }
    }
  };

  async function vueMessagerie() {
    const { conversations } = await api('/api/messages/conversations')
      .catch(() => ({ conversations: null }));

    if (conversations === null) {
      $('#main').innerHTML = `
        <div class="page-head"><div><h1>Messagerie</h1></div></div>
        <p class="form-error">Table « messages » absente — exécutez la migration db/11_echanges_carte_suivi.sql dans Supabase.</p>`;
      return;
    }

    MSG_CACHE = { conversations };
    const nonLus = conversations.reduce((s, c) => s + (c.non_lus || 0), 0);
    const avecNonLus = conversations.filter((c) => c.non_lus > 0).length;

    /* Non lus d'abord : c'est ce qui attend une reponse. A egalite, le
       message le plus recent. */
    conversations.sort((a, b) => {
      if ((b.non_lus > 0) !== (a.non_lus > 0)) return (b.non_lus > 0) ? 1 : -1;
      return String(b.dernier_message.date).localeCompare(String(a.dernier_message.date));
    });

    const visibles = msgVisibles();
    if (MSG_SEL && !conversations.some((c) => c.resident_id === MSG_SEL)) MSG_SEL = null;
    if (!MSG_SEL && visibles.length) MSG_SEL = visibles[0].resident_id;

    const compte = (k) => conversations.filter((MSG_FILTRES.find((x) => x[0] === k) || MSG_FILTRES[0])[2]).length;
    const puces = MSG_FILTRES.map(([k, l]) => {
      const on = k === MSG_FILTRE;
      return `<button data-act="filtrerMessagerie" data-a1="${k}"
        style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
               border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
               background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
               font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
    }).join('');

    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Messagerie</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${conversations.length} conversation${conversations.length > 1 ? 's' : ''}${nonLus ? ` · ${nonLus} message${nonLus > 1 ? 's' : ''} non lu${nonLus > 1 ? 's' : ''} chez ${avecNonLus} résident${avecNonLus > 1 ? 's' : ''}` : ' · tout est lu'}
        </div></div>
        <div class="toolbar">
          ${/* Le vert plein va a l'action courante. Ecrire a un resident se fait
               tous les jours ; diffuser a tout le camping quelques fois par an,
               et ne se rattrape pas. */ ''}
          <button class="btn btn-ghost" data-act="messageGroupe">Message à tous</button>
          <button class="btn btn-primary" data-act="messageRapide">Message à un résident</button>
        </div></div>

      <div class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;height:620px">
        <div style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0">
          <div style="padding:16px 18px 13px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:11px">
            <input id="msg-q" data-act="chercherMessagerie" data-evt="input" data-a1="@value"
                   placeholder="Résident, contenu du message" value="${esc(MSG_Q)}" style="width:100%">
            <div style="display:flex;gap:6px;flex-wrap:wrap">${puces}</div>
          </div>
          <div id="msg-liste" style="flex:1;overflow:auto"></div>
        </div>
        <div id="msg-fiche" style="flex:1;min-width:0;background:var(--ivoire);display:flex;flex-direction:column;min-height:0"></div>
      </div>`;

    majListeConversations();
    await chargerFil();
  }
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('window.envoyerMessageFil') !== -1) {
  console.log('\n  La messagerie est deja en fil — rien a faire.\n');
  process.exit(0);
}
for (const fn of ['messageGroupe', 'messageRapide']) {
  if (src.indexOf('window.' + fn) === -1) echec(`window.${fn} est introuvable — la barre d'actions en depend.`);
}
if (src.indexOf('async function majBadgeMessagerie') === -1) {
  echec('majBadgeMessagerie est introuvable — le badge de non-lus en depend.');
}

const DEBUT = 'async function vueMessagerie() {';
const FIN = '/* ---------- Compteurs (tournée de relevés) ---------- */';
const i = src.indexOf(DEBUT);
const j = src.indexOf(FIN);
if (i === -1) echec('vueMessagerie introuvable dans app.js.');
if (j === -1 || j < i) echec('La borne de fin (bloc Compteurs) est introuvable ou mal placee.');

const ancien = src.slice(i, j);
if (ancien.length > 4000) echec(`Le bloc a remplacer fait ${ancien.length} caracteres — trop gros, app.js a change.`);
if (ancien.indexOf('window.ouvrirConversation') === -1) echec('Le bloc repere ne contient pas ouvrirConversation.');
if (ancien.indexOf('async function vue') !== ancien.lastIndexOf('async function vue')) {
  echec('Le bloc repere contient plusieurs vues — bornes invalides.');
}
/* L'ancienne ligne de conversation ne vit que dans cette vue : sa
   disparition prouve que le bon bloc a ete remplace. */
const CONV = 'class="conv${c.non_lus ? \' unread\' : \'\'}"';
if (src.split(CONV).length - 1 !== 1) echec('L\'ancienne ligne de conversation est introuvable ou dupliquee.');

const CODE = NOUVEAU_CODE.toString()
  .replace(/^function NOUVEAU_CODE\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

src = src.slice(0, i) + CODE.replace(/\s*$/, '\n') + '\n' + src.slice(j);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['la vue Messagerie', 'async function vueMessagerie()'],
  ['l\'ouverture d\'une conversation', 'window.ouvrirConversation'],
  ['l\'envoi depuis le fil', 'window.envoyerMessageFil'],
  ['le chargement du fil', 'async function chargerFil'],
  ['le rafraichissement du badge', 'majBadgeMessagerie()'],
  ['le message a tous', 'data-act="messageGroupe"'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.indexOf(CONV) !== -1) echec('L\'ancienne liste de conversations subsiste.');
if (src.indexOf('window._openTab = \'messages\';') !== -1
  && src.indexOf('window.ouvrirConversation = (residentId) => {\n  window._openTab') !== -1) {
  echec('L\'ancienne ouvrirConversation subsiste.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('window.envoyerMessageFil') === -1) echec('L\'ajout est absent apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Messagerie : conversations a gauche, fil et champ de reponse a droite.');
console.log('  Non lus en tete, filtres comptes, recherche dans les noms et le contenu.');
console.log('  « Ecrire » (tableau de bord, impayes, notifications) ouvre le fil ici.');
console.log('  Le badge de non-lus est rafraichi apres chaque lecture.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
