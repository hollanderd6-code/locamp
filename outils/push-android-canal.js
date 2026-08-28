#!/usr/bin/env node
/* ============================================================
   outils/push-android-canal.js
   Push Android : ne plus viser un canal de notification inexistant
   ============================================================
   Cible : backend/lib/push.js

   ── LE BUG ──────────────────────────────────────────────────────
   L'envoi FCM demandait un canal de notification nomme « locamp » :

       android: { priority: 'high',
                  notification: { sound: 'default', channelId: 'locamp' } }

   Or ce canal n'est cree NULLE PART — ni par l'app (aucun appel a
   createChannel), ni par le manifeste (aucun meta-data
   default_notification_channel_id). Depuis Android 8 (API 26), une
   notification adressee a un canal qui n'existe pas est jetee
   SILENCIEUSEMENT par le systeme : FCM repond « succes », le compteur
   res.successCount s'incremente, et le telephone n'affiche rien.

   iOS ignore purement et simplement channelId : d'ou le symptome
   « recu sur iOS, rien sur Android ».

   ── LE CORRECTIF ────────────────────────────────────────────────
   On retire channelId. Sans lui, FCM depose la notification sur le
   canal par defaut de l'application, qui existe toujours (le SDK
   Firebase en cree un de repli). Le son reste demande.

   C'est le correctif minimal : il agit sans reconstruire les apps
   mobiles — un simple redemarrage du serveur suffit. Si vous voulez
   plus tard un canal nomme (pour que le resident puisse regler le son
   des messages separement des rappels de paiement), il faudra le creer
   cote app avec createChannel({ id: 'locamp', ... }) AVANT de le viser
   ici, et republier les apps.

   Usage :
     node outils/push-android-canal.js --essai
     node outils/push-android-canal.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'lib', 'push.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('backend/lib/push.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

const ANCIEN = "      android: { priority: 'high', notification: { sound: 'default', channelId: 'locamp' } },";
const NOUVEAU = "      // Pas de channelId : un canal inexistant fait jeter la notification\n"
  + "      // silencieusement par Android 8+. Le canal par defaut existe toujours.\n"
  + "      android: { priority: 'high', notification: { sound: 'default' } },";

if (src.indexOf("channelId: 'locamp'") === -1) {
  console.log('\n  Le canal « locamp » n\'est plus vise — rien a faire.\n');
  process.exit(0);
}

const n = src.split(ANCIEN).length - 1;
if (n !== 1) echec(`${n} occurrence(s) de la ligne android FCM au lieu d'une. push.js a change.`);

src = src.split(ANCIEN).join(NOUVEAU);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

/* Le commentaire ajoute nomme channelId : on verifie la disparition de
   l'ENVOI vers le canal, pas du mot. */
if (src.indexOf("channelId:") !== -1) echec('Un envoi vers un canal nomme subsiste.');
if (src.indexOf("sound: 'default'") === -1) echec('Le son a ete perdu.');
for (const g of ['sendEachForMulticast', 'pushResident', 'pushStaff', 'purgerTokens']) {
  if (src.indexOf(g) === -1) echec(`Verification : ${g} est absent du resultat.`);
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('channelId:') !== -1) echec('Le canal subsiste apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  push.js : channelId « locamp » retire — Android utilise son canal par defaut.');
console.log('  Aucun rebuild des apps mobiles necessaire.');
console.log('  Redemarrez le serveur, puis renvoyez un message de test.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
