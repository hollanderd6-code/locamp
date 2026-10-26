/* ============================================================
   Locamp — pont avec l'app iOS native (SwiftUI, Liquid Glass)
   ============================================================
   L'app iOS affiche ce site dans un WKWebView, mais dessine elle-meme
   tout l'habillage : barre d'onglets, barre de titre, menus, boutons
   d'action, alertes, toasts, recherche. Ce fichier fait le lien.

   Hors de l'app iOS, il ne fait RIEN : il s'arrete a la premiere ligne
   si le canal « locamp » n'existe pas (navigateur, PWA, Capacitor).

   Site -> app  : window.webkit.messageHandlers.locamp.postMessage({ type, ... })
     etat       ecran, titre, onglets, actions, recherche, badges, contexte
     session    { connecte }
     toast      { message, erreur }
     dialogue   { id, genre: 'confirmer' | 'saisir', titre, message, ok, ... }
     superposition { ouverte }  (tiroir ou fenetre web au premier plan)

   App -> site  : window.LocampNatif.<fonction>(...)
     naviguer(hash), action(id), rechercher(texte), changerCamping(id),
     changerExercice(annee), notifications(), deconnexion(), motDePasse(), recharger(),
     retour(), repondre(idDialogue, valeur), jetonPush(jeton)

   Le contrat complet est decrit dans ios/README.md. Toute evolution d'un
   cote doit etre reportee de l'autre.
   ============================================================ */
(function () {
  const canal = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.locamp;
  if (!canal) return;
  // L'app embarque aussi ce fichier et l'injecte si le site ne l'a pas
  // (site pas encore deploye) : il ne doit s'executer qu'une fois.
  if (window.LocampNatif) return;

  const VERSION_PONT = 1;
  // Plateforme posee par l'app (script de demarrage) : 'ios' ou 'android'.
  const PLATEFORME = (window.LOCAMP_NATIF && window.LOCAMP_NATIF.plateforme) || 'ios';
  document.documentElement.classList.add('natif', 'natif-' + PLATEFORME);

  function envoyer(type, donnees) {
    try { canal.postMessage(Object.assign({ type }, donnees || {})); }
    catch (e) { console.warn('[natif] envoi impossible', e); }
  }

  /* ---------- Titres des 8 entrees du menu (onglets natifs) ---------- */
  const TITRES = {
    dashboard: 'Accueil', carte: 'Carte', residents: 'Résidents', factures: 'Facturation',
    messagerie: 'Messagerie', compteurs: 'Compteurs', compta: 'Comptabilité', parametres: 'Réglages',
  };

  /* ---------- Icone SF Symbol devinee d'apres le libelle ----------
     Un bouton peut imposer la sienne : data-sf="square.and.arrow.up". */
  const SYMBOLES = [
    [/supprim|retir/i, 'trash'],
    [/encaiss|paiement|règlement|reglement/i, 'eurosign.circle'],
    [/message/i, 'bubble.left.and.bubble.right'],
    [/export|télécharg|telecharg/i, 'square.and.arrow.down'],
    [/imprim|feuille|tournée/i, 'printer'],
    [/génér|gener|facturation/i, 'doc.badge.plus'],
    [/envoy/i, 'paperplane'],
    [/relanc/i, 'bell.badge'],
    [/modifi|édit|edit/i, 'pencil'],
    [/sign/i, 'signature'],
    [/nouve|ajout|créer|creer/i, 'plus'],
  ];
  function symbole(el, titre) {
    if (el.dataset.sf) return el.dataset.sf;
    const t = SYMBOLES.find(([re]) => re.test(titre));
    return t ? t[1] : 'circle';
  }

  const texte = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const badge = (id) => {
    const b = document.getElementById(id);
    if (!b || b.classList.contains('hidden')) return 0;
    const n = parseInt(texte(b), 10);
    return Number.isFinite(n) ? n : 0;
  };

  /* ---------- Lecture de l'ecran courant ---------- */
  function lireEtat() {
    const raw = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
    const [ecran, param] = raw.split('/');
    const groupe = typeof groupeNav === 'function' ? groupeNav(ecran) : ecran;
    const main = document.getElementById('main');

    // Onglets secondaires (Plan / Emplacements, Factures / Reglements / Impayes...)
    let onglets = [];
    const groupes = typeof GROUPES_NAV !== 'undefined' ? GROUPES_NAV : {};
    if (groupes[groupe] && !(ecran === 'residents' && param)) {
      const droits = typeof MES_DROITS !== 'undefined' ? MES_DROITS : {};
      onglets = groupes[groupe]
        .filter(([, , droit]) => !droit || droits[droit])
        .map(([id, lib]) => ({ id, titre: lib, badge: id === 'impayes' ? badge('nav-imp-badge') : 0 }));
    }

    // Boutons d'en-tete -> boutons natifs. Un bouton hors en-tete peut
    // s'y ajouter avec data-natif ; un bouton d'en-tete s'en exclut avec
    // data-natif="non".
    const boutons = main ? Array.from(main.querySelectorAll(
      '.page-head > button.btn, .page-head .toolbar > button.btn, .page-head > a.btn, .page-head .toolbar > a.btn, [data-natif]:not([data-natif="non"])'
    )).filter((b) => b.dataset.natif !== 'non') : [];
    const actions = boutons.map((b, i) => {
      const id = 'a' + i;
      b.setAttribute('data-natif-action', id);
      const titre = texte(b) || b.getAttribute('title') || b.getAttribute('aria-label') || 'Action';
      return {
        id, titre,
        symbole: symbole(b, titre),
        principal: b.classList.contains('btn-primary'),
        destructif: b.classList.contains('btn-danger'),
        desactive: !!b.disabled,
      };
    });
    // Les anciens marquages qui ne sont plus publies redeviennent visibles.
    if (main) {
      main.querySelectorAll('[data-natif-action]').forEach((b) => {
        if (!boutons.includes(b)) b.removeAttribute('data-natif-action');
      });
    }

    // Champ de recherche de la liste -> barre de recherche native
    let recherche = null;
    const champ = main && main.querySelector('input.search');
    if (main) main.querySelectorAll('[data-natif-recherche]').forEach((c) => { if (c !== champ) c.removeAttribute('data-natif-recherche'); });
    if (champ) {
      champ.setAttribute('data-natif-recherche', '');
      recherche = { invite: champ.getAttribute('placeholder') || 'Rechercher', valeur: champ.value || '' };
    }

    const h1 = main && main.querySelector('.page-head h1, h1');
    const sel = (id) => document.getElementById(id);
    const opts = (s) => (s ? Array.from(s.options) : []);

    const campings = (typeof CAMPINGS !== 'undefined' ? CAMPINGS : [])
      .map((c) => ({ id: c.camping_id, nom: c.nom || 'Camping' }));
    const exSel = sel('exercice-select');
    const user = typeof USER !== 'undefined' && USER ? USER : null;
    const nom = user ? (`${user.prenom || ''} ${user.nom || ''}`.trim() || user.email || '') : '';

    return {
      version: VERSION_PONT,
      ecran, groupe,
      titre: (TITRES[groupe] && !param) ? TITRES[groupe] : (texte(h1) || TITRES[groupe] || 'Locamp'),
      retour: !!param,
      onglets,
      ongletActif: ecran,
      actions,
      recherche,
      badges: {
        factures: badge('nav-imp-badge'),
        messagerie: badge('nav-msg-badge'),
        notifications: badge('notif-badge'),
      },
      contexte: {
        campings,
        campingActif: typeof ACTIVE_CAMPING !== 'undefined' ? ACTIVE_CAMPING : null,
        nomCamping: (campings.find((c) => c.id === (typeof ACTIVE_CAMPING !== 'undefined' ? ACTIVE_CAMPING : null)) || {}).nom || null,
        exercices: opts(exSel).map((o) => ({ id: o.value, nom: texte(o) })),
        exerciceActif: exSel ? exSel.value : null,
        utilisateur: { nom, email: user ? user.email || '' : '', admin: !!(typeof MES_DROITS !== 'undefined' && MES_DROITS.admin) },
      },
    };
  }


  function lireAuth() {
    return {
      base: (typeof API !== 'undefined' && API) || location.origin,
      jeton: (typeof TOKEN !== 'undefined' && TOKEN) || null,
      camping: (typeof ACTIVE_CAMPING !== 'undefined' && ACTIVE_CAMPING) || null,
    };
  }

  /* ---------- Session pour les ecrans natifs (messagerie) ----------
     Les ecrans SwiftUI appellent l'API eux-memes, avec la session du site.
     Le jeton ne quitte pas l'appareil : il passe du site a l'app, en memoire. */
  let authPrec = '';
  function publierAuth() {
    const a = lireAuth();
    const json = JSON.stringify(a);
    if (json === authPrec) return;
    authPrec = json;
    envoyer('auth', a);
  }

  /* ---------- Publication, sans doublons ni rafale ---------- */
  let dernier = '';
  let minuterie = null;
  function publier() {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      publierAuth();
      if (!estConnecte()) return;
      const etat = lireEtat();
      const json = JSON.stringify(etat);
      if (json === dernier) return;
      dernier = json;
      envoyer('etat', { etat });
    }, 60);
  }

  /* ---------- Session ---------- */
  function estConnecte() {
    const app = document.getElementById('app');
    return !!(app && !app.classList.contains('hidden'));
  }
  let sessionPrec = null;
  function publierSession() {
    const c = estConnecte();
    if (c === sessionPrec) return;
    sessionPrec = c;
    envoyer('session', { connecte: c });
    if (c) { dernier = ''; publier(); enregistrerJeton(); }
  }

  /* ---------- Tiroir / fenetres web au premier plan ----------
     L'app masque sa barre d'onglets tant qu'un panneau web recouvre la
     page : sinon la barre flotterait par-dessus le bas du panneau. */
  function superpositionOuverte() {
    const d = document.getElementById('drawer');
    if (d && !d.classList.contains('hidden')) return true;
    const n = document.getElementById('notif-overlay');
    if (n && n.style.display === 'flex') return true;
    return !!document.querySelector('.ask-overlay, .apercu, .pal-overlay');
  }
  let superPrec = false;
  function publierSuperposition() {
    const o = superpositionOuverte();
    if (o === superPrec) return;
    superPrec = o;
    envoyer('superposition', { ouverte: o });
  }

  /* ---------- Toasts natifs ---------- */
  window.toast = function (msg, err = false) {
    envoyer('toast', { message: String(msg == null ? '' : msg), erreur: !!err });
  };

  /* ---------- Alertes natives (askConfirm / askPrompt) ----------
     askMois reste en web : un selecteur mois + annee n'a pas d'equivalent
     direct dans une alerte iOS. */
  const attentes = new Map();
  let seq = 0;
  function demander(genre, donnees) {
    return new Promise((resolve) => {
      const id = 'd' + (++seq);
      attentes.set(id, resolve);
      envoyer('dialogue', Object.assign({ id, genre }, donnees));
    });
  }
  window.askConfirm = (message, { titre = 'Confirmation', ok = 'Confirmer', danger = false } = {}) =>
    demander('confirmer', { titre, message: String(message || ''), ok, danger: !!danger })
      .then((v) => v === true);
  window.askPrompt = (message, valeur = '', { titre = '', ok = 'Valider', placeholder = '' } = {}) =>
    demander('saisir', { titre, message: String(message || ''), ok, valeur: String(valeur ?? ''), invite: placeholder })
      .then((v) => (typeof v === 'string' ? v : null));

  /* ---------- Notifications push ----------
     L'app recoit le jeton FCM (Firebase, natif) et le confie ici : c'est
     le site qui detient la session, donc lui qui l'enregistre. */
  let jeton = null;
  let jetonEnregistre = false;
  function enregistrerJeton() {
    if (!jeton || jetonEnregistre) return;
    if (typeof TOKEN === 'undefined' || !TOKEN || !ACTIVE_CAMPING) return;
    jetonEnregistre = true;
    api('/api/push/register', { method: 'POST', body: { token: jeton, platform: PLATEFORME } })
      .catch((e) => { jetonEnregistre = false; console.warn('[natif] push refuse :', e.message); });
  }
  const logoutPrec = window.logout || (typeof logout === 'function' ? logout : null);
  window.logout = function () {
    if (jeton && jetonEnregistre && typeof TOKEN !== 'undefined' && TOKEN) {
      api('/api/push/register', { method: 'DELETE', body: { token: jeton } }).catch(() => {});
    }
    jetonEnregistre = false;
    return logoutPrec ? logoutPrec.apply(this, arguments) : undefined;
  };

  /* ---------- Ce que l'app peut demander au site ---------- */
  window.LocampNatif = {
    version: VERSION_PONT,
    naviguer(hash) {
      const h = String(hash || '').startsWith('#') ? hash : '#/' + String(hash || 'dashboard');
      if (location.hash === h) { if (typeof route === 'function') route(); } else location.hash = h;
    },
    action(id) {
      const b = document.querySelector('[data-natif-action="' + String(id).replace(/"/g, '') + '"]');
      if (b && !b.disabled) b.click();
    },
    rechercher(t) {
      const c = document.querySelector('[data-natif-recherche]');
      if (!c) return;
      c.value = String(t || '');
      c.dispatchEvent(new Event('input', { bubbles: true }));
    },
    changerCamping(id) {
      if (typeof changerCamping !== 'function') return;
      if (id === '__new__') { if (typeof formNouveauCamping === 'function') formNouveauCamping(); return; }
      const s = document.getElementById('camping-select');
      if (s) { s.value = id; s.dispatchEvent(new Event('change')); }
      changerCamping(id);
    },
    changerExercice(annee) {
      const s = document.getElementById('exercice-select');
      if (!s) return;
      s.value = String(annee);
      if (typeof s.onchange === 'function') s.onchange();
      s.dispatchEvent(new Event('change'));
    },
    notifications() {
      const b = document.querySelector('.sidebar-foot button[title="Notifications"]');
      if (b) b.click();
    },
    deconnexion() {
      (window.demanderDeconnexion || window.logout)();
    },
    /* Le menu latéral (et son bouton cadenas) est masqué dans l'app. */
    motDePasse() {
      if (typeof window.ouvrirMotDePasse === 'function') window.ouvrirMotDePasse(false);
    },
    recharger() {
      if (estConnecte() && typeof route === 'function') route(); else location.reload();
    },
    retour() {
      if (history.length > 1) history.back(); else this.naviguer('#/dashboard');
    },
    repondre(id, valeur) {
      const r = attentes.get(id);
      if (!r) return;
      attentes.delete(id);
      r(valeur);
    },
    /* Un ecran natif a lu des messages : la pastille web se recalcule. */
    rafraichirBadges() {
      if (typeof majBadgeMessagerie === 'function') majBadgeMessagerie();
    },
    jetonPush(t) {
      if (!t || t === jeton) return;
      jeton = String(t);
      jetonEnregistre = false;
      enregistrerJeton();
    },
    etat: lireEtat,
  };

  /* ---------- Observation ----------
     Les vues reecrivent #main a chaque filtre : on observe plutot que de
     modifier les quarante vues. Les badges vivent hors de #main. */
  /* Un seul passage par image, quel que soit le nombre de mutations : la
     carte en edition ou une liste filtree en produisent des centaines. */
  let planifie = false;
  function tout() {
    planifie = false;
    publierSession(); publierSuperposition(); publier();
  }
  const obs = new MutationObserver(() => {
    if (planifie) return;
    planifie = true;
    requestAnimationFrame(tout);
  });
  // Ajouts et retraits d'elements (vues, tiroir, fenetres), et les seuls
  // attributs qui portent un etat : session, tiroir, badges, bouton desactive.
  obs.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['class', 'style', 'disabled'],
  });
  window.addEventListener('hashchange', publier);

  envoyer('pret', { version: VERSION_PONT });
  publierSession();
})();
