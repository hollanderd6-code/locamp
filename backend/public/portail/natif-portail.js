/* ============================================================
   Portail locataire — pont avec l'app iOS native (SwiftUI, Liquid Glass)
   ============================================================
   Meme contrat que backend/public/natif.js (app Gestion), decrit dans
   ios/README.md. L'app dessine la barre d'onglets (Accueil, Factures,
   Messages, Documents), la barre de titre, le menu du compte, les
   alertes et les toasts ; le site ne garde que le contenu.

   Hors de l'app iOS, ce fichier ne fait RIEN (pas de canal « locamp »).
   Le paiement en ligne est masque par window.LOCAMP_NATIVE, que l'app
   pose avant le chargement de portail.js (regle App Store 3.1.1).
   ============================================================ */
(function () {
  const canal = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.locamp;
  if (!canal) return;
  // L'app embarque aussi ce fichier et l'injecte si le site ne l'a pas.
  if (window.LocampNatif) return;

  const VERSION_PONT = 1;
  document.documentElement.classList.add('natif', 'natif-ios');

  function envoyer(type, donnees) {
    try { canal.postMessage(Object.assign({ type }, donnees || {})); }
    catch (e) { console.warn('[natif] envoi impossible', e); }
  }

  const TITRES = { solde: 'Accueil', factures: 'Factures', messages: 'Messages', documents: 'Documents' };
  const $id = (id) => document.getElementById(id);
  const texte = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const pastille = (id) => {
    const b = $id(id);
    if (!b || b.classList.contains('hidden')) return 0;
    const n = parseInt(texte(b), 10);
    return Number.isFinite(n) ? n : 0;
  };

  function estConnecte() {
    const e = $id('espace');
    return !!(e && !e.classList.contains('hidden'));
  }

  function lireEtat() {
    const signature = document.body.classList.contains('en-signature');
    const onglet = document.body.getAttribute('data-onglet') || 'solde';
    const nom = texte($id('hello')).replace(/^Bonjour\s*/i, '');
    const titre = signature ? (texte($id('sig-titre')) || 'Signature')
      : onglet === 'solde' ? (nom ? 'Bonjour ' + nom : 'Accueil')
        : (TITRES[onglet] || 'Mon espace');
    return {
      version: VERSION_PONT,
      ecran: signature ? 'signature' : onglet,
      groupe: signature ? 'documents' : onglet,
      titre,
      retour: signature,
      onglets: [],
      ongletActif: onglet,
      actions: [],
      recherche: null,
      badges: {
        factures: 0,
        messagerie: pastille('ong-messages'),
        notifications: pastille('ong-signer'),
      },
      contexte: {
        campings: [], campingActif: null, exercices: [], exerciceActif: null,
        utilisateur: { nom, email: '', admin: false, sousTitre: texte($id('sous-titre')) },
      },
    };
  }

  let dernier = '';
  let minuterie = null;
  function publier() {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      if (!estConnecte()) return;
      const etat = lireEtat();
      const json = JSON.stringify(etat);
      if (json === dernier) return;
      dernier = json;
      envoyer('etat', { etat });
    }, 60);
  }

  let sessionPrec = null;
  function publierSession() {
    const c = estConnecte();
    if (c === sessionPrec) return;
    sessionPrec = c;
    envoyer('session', { connecte: c });
    if (c) { dernier = ''; publier(); enregistrerJeton(); }
  }

  /* ---------- Toasts et alertes natifs ---------- */
  window.toast = function (msg, err = false) {
    envoyer('toast', { message: String(msg == null ? '' : msg), erreur: !!err });
  };
  const attentes = new Map();
  let seq = 0;
  function demander(genre, donnees) {
    return new Promise((resolve) => {
      const id = 'd' + (++seq);
      attentes.set(id, resolve);
      envoyer('dialogue', Object.assign({ id, genre }, donnees));
    });
  }

  /* ---------- Push : jeton FCM natif, enregistre par la session du site ---------- */
  let jeton = null;
  let jetonEnregistre = false;
  function enregistrerJeton() {
    if (!jeton || jetonEnregistre) return;
    if (typeof RTOKEN === 'undefined' || !RTOKEN) return;
    jetonEnregistre = true;
    api('/api/portail/push/register', { method: 'POST', body: { token: jeton, platform: 'ios' } })
      .catch((e) => { jetonEnregistre = false; console.warn('[natif] push refuse :', e.message); });
  }
  const logoutPrec = window.logout || (typeof logout === 'function' ? logout : null);
  window.logout = function () {
    if (jeton && jetonEnregistre && typeof RTOKEN !== 'undefined' && RTOKEN) {
      api('/api/portail/push/register', { method: 'DELETE', body: { token: jeton } }).catch(() => {});
    }
    jetonEnregistre = false;
    return logoutPrec ? logoutPrec.apply(this, arguments) : undefined;
  };

  function quitterSignature() {
    if (document.body.classList.contains('en-signature')) $id('sig-retour')?.click();
  }

  window.LocampNatif = {
    version: VERSION_PONT,
    naviguer(hash) {
      const nom = String(hash || '').replace(/^#\/?/, '') || 'solde';
      quitterSignature();
      if (typeof window.allerOnglet === 'function' && TITRES[nom]) window.allerOnglet(nom);
      publier();
    },
    action() {},
    rechercher() {},
    changerCamping() {},
    changerExercice() {},
    notifications() { this.naviguer('#/messages'); },
    async deconnexion() {
      const ok = await demander('confirmer', {
        titre: 'Déconnexion', message: 'Se déconnecter de votre espace ?', ok: 'Se déconnecter', danger: true,
      });
      if (ok === true) window.logout();
    },
    recharger() {
      const b = $id('btn-actualiser');
      if (estConnecte() && b) b.click(); else location.reload();
    },
    retour() { quitterSignature(); },
    repondre(id, valeur) {
      const r = attentes.get(id);
      if (!r) return;
      attentes.delete(id);
      r(valeur);
    },
    jetonPush(t) {
      if (!t || t === jeton) return;
      jeton = String(t);
      jetonEnregistre = false;
      enregistrerJeton();
    },
    etat: lireEtat,
  };

  let planifie = false;
  const obs = new MutationObserver(() => {
    if (planifie) return;
    planifie = true;
    requestAnimationFrame(() => { planifie = false; publierSession(); publier(); });
  });
  obs.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['class', 'data-onglet', 'style'],
  });

  envoyer('pret', { version: VERSION_PONT });
  publierSession();
})();
