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
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function noter(nom, page, journal, debut) {
  const fichier = path.join(SORTIE, `${nom}.png`);
  await page.screenshot({ path: fichier, fullPage: false });
  const ms = Date.now() - debut;
  const vide = await page.evaluate(() => (document.querySelector('#main, .content')?.innerText || '').trim().length < 20).catch(() => false);
  if (vide) journal.push('ecran presque vide');
  rapport.push({ ecran: nom, ms, problemes: [...journal] });
  if (journal.length) echecs++;
  console.log(`${journal.length ? '✗' : '✓'} ${nom} (${ms} ms)${journal.length ? '\n    ' + journal.join('\n    ') : ''}`);
  journal.length = 0;
}

async function gestion(navigateur, nom, options) {
  const ctx = await navigateur.newContext(options);
  const page = await ctx.newPage();
  const journal = [];
  surveiller(page, journal);
  let t = Date.now();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', MDP);
  await page.click('#login-btn');
  await page.waitForSelector('#app:not(.hidden)', { timeout: 60000 });
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
  const ctx = await navigateur.newContext(options);
  const page = await ctx.newPage();
  const journal = [];
  surveiller(page, journal);
  let t = Date.now();
  await page.goto(BASE + '/portail/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#cx-email', { state: 'visible', timeout: 60000 });
  await page.fill('#cx-email', EMAIL);
  await page.fill('#cx-mdp', MDP);
  await page.click('#btn-connexion');
  await page.waitForSelector('#espace:not(.hidden)', { timeout: 60000 });
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
  const nav = await chromium.launch();
  const etapes = [
    ['gestion-ordi', gestion, { viewport: { width: 1440, height: 900 } }],
    ['gestion-tel', gestion, devices['iPhone 15 Pro']],
    ['portail-tel', portail, devices['iPhone 15 Pro']],
    ['portail-ordi', portail, { viewport: { width: 1280, height: 860 } }],
  ];
  for (const [nom, f, opts] of etapes) {
    try { await f(nav, nom, opts); }
    catch (e) { echecs++; rapport.push({ ecran: nom, problemes: ['parcours interrompu : ' + e.message] }); console.log(`✗ ${nom} interrompu : ${e.message}`); }
  }
  await nav.close();
  fs.writeFileSync(path.join(SORTIE, 'rapport.json'), JSON.stringify(rapport, null, 2));
  console.log(`\n${rapport.length} ecrans, ${echecs} avec probleme(s).`);
  process.exit(0);
})();
