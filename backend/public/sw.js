/* ============================================================
   Locamp — service worker
   ============================================================
   POURQUOI CE FICHIER
   Sans lui, Chrome ne propose pas « Installer l'application » et
   l'empaquetage pour le Play Store est refuse : c'est le prerequis des
   deux chemins.

   ── LA REGLE QUI GOUVERNE TOUT ───────────────────────────────────
   Locamp manipule des factures, des soldes et des encaissements.
   Afficher un montant perime serait PIRE que d'afficher une erreur :
   l'utilisateur ne saurait pas qu'il regarde du passe, et pourrait
   relancer un resident qui a paye.

   Donc : rien de ce qui vient de l'API n'est mis en cache. Jamais.
   Seule la coquille — la page, la feuille de style, le script, le logo —
   est conservee, car elle ne dit rien sur l'argent de personne.

   ── LES TROIS COMPORTEMENTS ──────────────────────────────────────
   /api/…            reseau seul. Hors ligne, l'appel echoue, et
                     l'interface affiche deja ses etats d'erreur.
   navigation        reseau d'abord, coquille en secours. Hors ligne,
                     l'application s'ouvre et explique la situation
                     plutot que d'afficher le dinosaure du navigateur.
   coquille          cache d'abord, rafraichi en arriere-plan. Le
                     demarrage est immediat, la version suivante arrive
                     silencieusement.

   ── LA MISE A JOUR ───────────────────────────────────────────────
   Le piege classique d'un service worker est d'enfermer l'utilisateur
   dans une vieille version. Ici la nouvelle version prend la main des
   son installation (skipWaiting + claim), et la page se recharge une
   fois — une seule, un drapeau empeche la boucle.

   Changer CACHE_VERSION suffit a invalider tout l'ancien cache.
   ============================================================ */

const CACHE_VERSION = 'locamp-v1';

/* La coquille : ce qui doit s'ouvrir meme sans reseau. Volontairement
   court — chaque entree est un fichier qu'il faudra penser a invalider. */
const COQUILLE = [
  '/',
  '/index.html',
  '/marque.css',
  '/styles.css',
  '/app.js',
  '/logo.svg',
  '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      /* addAll echoue en bloc si UN fichier manque : on ajoute un par un
         pour qu'un renommage ne condamne pas toute l'installation. */
      .then((c) => Promise.all(COQUILLE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Hors de notre origine : on ne s'en mele pas. Les polices Google et
     l'API Supabase ont leurs propres regles. */
  if (url.origin !== self.location.origin) return;

  /* L'API : reseau seul, jamais de cache. C'est la regle centrale. */
  if (url.pathname.startsWith('/api/')) return;

  /* Une navigation : le reseau decide, la coquille sert de secours. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((r) => r || horsLigne()))
    );
    return;
  }

  /* Le reste — style, script, images : on sert le cache tout de suite et
     on rafraichit derriere. Le demarrage ne depend plus du reseau. */
  e.respondWith(
    caches.match(req).then((enCache) => {
      const frais = fetch(req).then((rep) => {
        if (rep && rep.ok) {
          const copie = rep.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copie));
        }
        return rep;
      }).catch(() => enCache);
      return enCache || frais;
    })
  );
});

/* Le dernier recours : ni reseau, ni coquille en cache. Une page sobre
   valait mieux qu'un ecran d'erreur du navigateur. */
function horsLigne() {
  return new Response(
    '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Locamp — hors ligne</title></head>' +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#F6F3EC;font-family:system-ui,sans-serif;padding:24px">' +
    '<div style="max-width:340px;text-align:center">' +
    '<div style="font-family:Georgia,serif;font-size:34px;font-weight:600;letter-spacing:.16em;' +
    'color:#0F231D;margin-bottom:14px">LOCAMP</div>' +
    '<p style="font-size:15px;line-height:1.6;color:#5D6C64;margin:0 0 20px">' +
    'Pas de connexion. Locamp travaille sur des donnees a jour : rien ne peut ' +
    's\'afficher tant que le reseau est absent.</p>' +
    '<button onclick="location.reload()" style="background:#175243;color:#fff;border:none;' +
    'border-radius:11px;padding:12px 20px;font-family:inherit;font-size:14px;font-weight:600;' +
    'cursor:pointer">Reessayer</button></div></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
