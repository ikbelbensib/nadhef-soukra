#!/usr/bin/env node
/**
 * Copie les migrations SQL dans dist/.
 *
 * `tsc` ne transporte que les .ts : sans cette étape, `node dist/index.js`
 * démarre puis échoue au premier scandir des migrations. Faire la copie ici
 * plutôt que dans le Dockerfile garantit que l'exécution locale et l'image
 * conteneur partagent exactement la même arborescence.
 */
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(RACINE, 'src', 'db', 'migrations');
const CIBLE = join(RACINE, 'dist', 'db', 'migrations');

if (!existsSync(SOURCE)) {
  console.error(`✗ Migrations introuvables : ${SOURCE}`);
  process.exit(1);
}

cpSync(SOURCE, CIBLE, { recursive: true });
console.log('  ✓ migrations copiées dans dist/db/migrations');
