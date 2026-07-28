import { createApp } from './app.js';
import { env } from './env.js';
import { db, initPragmas } from './db/client.js';
import { migrate } from './db/migrate.js';
import { communeInfo, quartiers } from './services/boundary.js';
import { planifierTravauxNocturnes } from './jobs/nightly.js';

async function main(): Promise<void> {
  await initPragmas();

  // Migrer au démarrage : le conteneur doit être utilisable sans étape manuelle.
  const { head } = await migrate();

  // `seed()` s'interrompt de lui-même si des spots existent déjà : redémarrer
  // le conteneur ne duplique donc rien.
  if (env.SEED_ON_START) {
    const { seed } = await import('./db/seed.js');
    await seed();
  }

  // Indépendant du seed : sans modérateur, la file de modération et les
  // exports municipaux seraient inaccessibles, et rien ne permet de promouvoir
  // un compte après coup.
  const { assurerAdmin } = await import('./db/bootstrap.js');
  const amorcage = await assurerAdmin();
  if (amorcage === 'numero_invalide') {
    console.warn(
      `⚠ SEED_ADMIN_PHONE (${env.SEED_ADMIN_PHONE}) n'est pas un numéro tunisien valide :` +
        ' aucun modérateur ne peut être créé, la modération restera inaccessible.',
    );
  }

  // La carte ne dépend pas de ce job : la fraîcheur est calculée à la lecture.
  // Il n'aligne le statut stocké que pour les exports et les statistiques.
  const arreterJobs = planifierTravauxNocturnes();

  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(`
  Nadhef Soukra — serveur
    environnement  ${env.NODE_ENV}
    écoute         http://${env.HOST}:${env.PORT}
    base           ${env.DATABASE_URL}
    migration      ${head ?? '(aucune)'}
    commune        ${communeInfo.nom_fr} — ${quartiers.length} quartiers
    modérateur     ${amorcage}
`);
  });

  const arret = (signal: string) => () => {
    console.log(`\n${signal} reçu — arrêt.`);
    arreterJobs();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // Filet de sécurité si des connexions restent ouvertes.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', arret('SIGTERM'));
  process.on('SIGINT', arret('SIGINT'));
}

main().catch((err: Error) => {
  console.error('✗ Démarrage impossible :', err.message);
  process.exit(1);
});
