/* Version du logiciel, telle qu'elle figure sur l'attestation de conformité
   fiscale et dans les archives.

   La loi rattache l'attestation à une VERSION : la version majeure (le
   premier chiffre) identifie le périmètre attesté. Tout changement touchant
   l'inaltérabilité, la sécurisation, la conservation ou l'archivage (chaîne
   fiscale, clôtures, annulations, archive) impose une nouvelle version
   majeure et de nouvelles attestations. Les autres évolutions sont des
   versions mineures. La source unique est package.json. */
const { version } = require('../package.json');

const [majeure = '0', mineure = '0', correctif = '0'] = String(version).split('.');

module.exports = {
  NOM_LOGICIEL: 'Locamp',
  VERSION: version,
  VERSION_MAJEURE: majeure,
  VERSION_MINEURE: `${majeure}.${mineure}.${correctif}`,
  // Render fournit le commit déployé : il identifie exactement le code en service.
  BUILD: (process.env.RENDER_GIT_COMMIT || '').slice(0, 12) || null,
};
