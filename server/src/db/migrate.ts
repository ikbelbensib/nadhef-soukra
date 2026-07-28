/**
 * Runner de migrations. Applique dans l'ordre lexicographique les .sql de
 * ./migrations non encore enregistrés dans _migrations.
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, all, run, initPragmas } from './client.js';
import { estExecuteDirectement } from '../cli.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

interface MigrationRow {
  name: string;
  checksum: string;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Découpe un fichier SQL en instructions, en respectant les littéraux et les commentaires. */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] as string;
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (!inString && ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === "'") {
      // '' à l'intérieur d'un littéral est un apostrophe échappé, pas une fin de chaîne.
      if (inString && next === "'") {
        current += "''";
        i++;
        continue;
      }
      inString = !inString;
      current += ch;
      continue;
    }
    if (ch === ';' && !inString) {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export async function migrate(): Promise<{ applied: string[]; head: string | null }> {
  await initPragmas();
  await run(`CREATE TABLE IF NOT EXISTS _migrations (
    name       TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const done = await all<MigrationRow>('SELECT name, checksum FROM _migrations');
  const byName = new Map(done.map((m) => [m.name, m.checksum]));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = sha256(sql);
    const previous = byName.get(file);

    if (previous !== undefined) {
      // Une migration déjà appliquée qui change de contenu signale une divergence
      // silencieuse entre environnements — mieux vaut échouer bruyamment.
      if (previous !== checksum) {
        throw new Error(
          `Migration ${file} modifiée après application (${previous} → ${checksum}). ` +
            `Créez une nouvelle migration plutôt que d'éditer celle-ci.`,
        );
      }
      continue;
    }

    const statements = splitStatements(sql);
    // batch() est transactionnel : un fichier s'applique en entier ou pas du tout.
    await db.batch(
      [
        ...statements,
        `INSERT INTO _migrations (name, checksum, applied_at)
         VALUES ('${file}', '${checksum}', '${new Date().toISOString()}')`,
      ],
      'write',
    );
    applied.push(file);
    console.log(`  ✓ ${file} (${statements.length} instruction(s))`);
  }

  return { applied, head: files[files.length - 1] ?? null };
}

/** Point d'entrée CLI : `npm run migrate -w server`. */
if (estExecuteDirectement(import.meta.url)) {
  console.log('→ Migrations…');
  migrate()
    .then(({ applied, head }) => {
      console.log(
        applied.length > 0
          ? `✓ ${applied.length} migration(s) appliquée(s). Tête : ${head}`
          : `✓ Base à jour. Tête : ${head}`,
      );
      process.exit(0);
    })
    .catch((err: Error) => {
      console.error('✗ Migration échouée :', err.message);
      process.exit(1);
    });
}
