/* Parcours du site en ligne, connecte, en LECTURE SEULE : on ouvre chaque
   ecran de la gestion et du portail, on capture l'ecran, on releve les
   erreurs JavaScript, les erreurs reseau et les appels d'API en echec.
   Aucun clic sur un bouton d'action : rien n'est cree ni modifie.

   LOCAMP_URL=https://locamp.onrender.com LOCAMP_TEST_EMAIL=… LOCAMP_TEST_MDP=… \
     node backend/test-e2e/parcours.js captures-site

   Utilise par .github/workflows/site.yml. */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.LOCAMP_URL || 'https://locamp.onrender.com').replace(/\/$/, '');
const EMAIL = process.env.LOCAMP_TEST_EMAIL;
const MDP = process.env.LOCAMP_TEST_MDP;
const SORTIE = process.argv[2] || 'captures-site';
/* LOCAMP_FRONT_LOCAL=1 : les pages et scripts viennent de backend/public
   (la branche testee), l'API reste celle du serveur en ligne. Permet de
   verifier un correctif du front avant de le deployer. */
const FRONT_LOCAL = process.env.LOCAMP_FRONT_LOCAL === '1';
const PUBLIC = path.join(__dirname, '..', 'public');

async function contexte(navigateur, options) {
  const ctx = await navigateur.newContext({ ...options, serviceWorkers: 'block' });
  if (FRONT_LOCAL) {
    await ctx.route((u) => u.origin === BASE && !u.pathname.startsWith('/api/') && !u.pathname.startsWith('/.well-known/'), async (route) => {
      const u = new URL(route.request().url());
      let f = path.join(PUBLIC, decodeURIComponent(u.pathname));
      if (f.endsWith(path.sep) || f.endsWith('/')) f = path.join(f, 'index.html');
      if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        if (fs.existsSync(path.join(f, 'index.html'))) f = path.join(f, 'index.html'); else return route.continue();
      }
      return route.fulfill({ path: f });
    });
  }
  return ctx;
}

const ECRANS_GESTION = ['dashboard', 'carte', 'emplacements', 'residents', 'contrats', 'signatures', 'factures',
  'reglements', 'impayes', 'messagerie', 'compteurs', 'compta', 'parametres', 'administration'];
const ONGLETS_PORTAIL = ['solde', 'factures', 'messages', 'documents'];

const rapport = [];
let echecs = 0;

function surveiller(page, journal) {
  page.on('pageerror', (e) => journal.push(`JS : ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') journal.push(`console : ${m.text().slice(0, 300)}`); });
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/') && r.status() >= 400 && r.status() !== 401) journal.push(`API ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`);
  });
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText || '';
    if (!f.includes('ERR_ABORTED')) journal.push(`reseau : ${r.url().replace(BASE, '')} ${f}`);
  });
}

async function attendreCalme(page) {
  await page.waitForTimeout(250);                 // laisse partir les premieres requetes
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  // Les vues enchainent parfois leurs appels : on attend la fin du « Chargement… ».
  await page.waitForFunction(() => {
    const m = document.querySelector('#main, #espace .content');
    return !m || !/Chargement…/.test(m.innerText || '');
  }, null, { timeout: 25000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function noter(nom, page, journal, debut) {
  const fichier = path.join(SORTIE, `${nom}.png`);
  await page.screenshot({ path: fichier, fullPage: false });
  const ms = Date.now() - debut;
  const vide = await page.evaluate(() => (document.querySelector('#main, .content')?.innerText || '').trim().length < 20).catch(() => false);
  if (vide) journal.push('ecran presque vide');
  const charge = await page.evaluate(() => /Chargement…/.test(document.querySelector('#main, #espace .content')?.innerText || '')).catch(() => false);
  if (charge) journal.push('toujours « Chargement… » apres 25 s');
  rapport.push({ ecran: nom, ms, problemes: [...journal] });
  if (journal.length) echecs++;
  console.log(`${journal.length ? '✗' : '✓'} ${nom} (${ms} ms)${journal.length ? '\n    ' + journal.join('\n    ') : ''}`);
  journal.length = 0;
}

async function gestion(navigateur, nom, options) {
  const ctx = await contexte(navigateur, options);
  const page = await ctx.newPage();
  const journal = [];
  surveiller(page, journal);
  let t = Date.now();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', MDP);
  await page.click('#login-btn');
  await page.waitForSelector('#app:not(.hidden), #login-error:not(.hidden)', { timeout: 60000 });
  if (await page.isVisible('#login-error')) throw new Error('connexion refusee : ' + (await page.textContent('#login-error')));
  await attendreCalme(page);
  await noter(`${nom}-00-connexion`, page, journal, t);
  let i = 1;
  for (const e of ECRANS_GESTION) {
    t = Date.now();
    await page.evaluate((h) => { location.hash = h; }, '#/' + e);
    await attendreCalme(page);
    await noter(`${nom}-${String(i++).padStart(2, '0')}-${e}`, page, journal, t);
  }
  await ctx.close();
}

async function portail(navigateur, nom, options) {
  const ctx = await contexte(navigateur, options);
  const page = await ctx.newPage();
  const journal = [];
  surveiller(page, journal);
  let t = Date.now();
  await page.goto(BASE + '/portail/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#cx-email', { state: 'visible', timeout: 60000 });
  await page.fill('#cx-email', EMAIL);
  await page.fill('#cx-mdp', MDP);
  await page.click('#btn-connexion');
  await page.waitForSelector('#espace:not(.hidden), #cx-err:not(.hidden)', { timeout: 60000 });
  if (await page.isVisible('#cx-err')) throw new Error('connexion refusee : ' + (await page.textContent('#cx-err')));
  await attendreCalme(page);
  await noter(`${nom}-00-connexion`, page, journal, t);
  let i = 1;
  for (const o of ONGLETS_PORTAIL) {
    t = Date.now();
    await page.evaluate((x) => window.allerOnglet && window.allerOnglet(x), o);
    await attendreCalme(page);
    await noter(`${nom}-${i++}-${o}`, page, journal, t);
  }
  await ctx.close();
}

(async () => {
  if (!EMAIL || !MDP) { console.error('LOCAMP_TEST_EMAIL / LOCAMP_TEST_MDP absents'); process.exit(2); }
  fs.mkdirSync(SORTIE, { recursive: true });
  // Render endort le serveur : on le reveille avant de mesurer quoi que ce soit.
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch { /* encore endormi */ }
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  const nav = await chromium.launch();
  const etapes = [
    ['gestion-ordi', gestion, { viewport: { width: 1440, height: 900 } }],
    ['gestion-tel', gestion, devices['iPhone 15 Pro']],
    ['portail-tel', portail, devices['iPhone 15 Pro']],
    ['portail-ordi', portail, { viewport: { width: 1280, height: 860 } }],
  ];
  for (const [nom, f, opts] of etapes) {
    try { await f(nav, nom, opts); }
    catch (e) {
      echecs++;
      // Ce que l'ecran affichait au moment de l'echec (message d'erreur de connexion…).
      let vu = '';
      for (const p of nav.contexts().flatMap((c) => c.pages())) {
        try {
          await p.screenshot({ path: path.join(SORTIE, `${nom}-echec.png`) });
          vu = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300);
        } catch { /* page fermee */ }
      }
      rapport.push({ ecran: nom, problemes: ['parcours interrompu : ' + e.message.split('\n')[0], 'ecran : ' + vu] });
      console.log(`✗ ${nom} interrompu : ${e.message.split('\n')[0]}\n    ecran : ${vu}`);
      for (const c of nav.contexts()) await c.close().catch(() => {});
    }
  }
  await nav.close();
  fs.writeFileSync(path.join(SORTIE, 'rapport.json'), JSON.stringify(rapport, null, 2));
  console.log(`\n${rapport.length} ecrans, ${echecs} avec probleme(s).`);
  process.exit(0);
})();
