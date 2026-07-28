/** Configuration validée au démarrage : le serveur refuse de booter mal configuré. */

import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),

  /** libSQL : `file:` en local, `libsql://…` sur Turso. */
  DATABASE_URL: z.string().min(1).default('file:./data/nadhef.db'),
  DATABASE_AUTH_TOKEN: z.string().optional(),

  /** Pepper du HMAC des numéros de téléphone. Jamais en base, jamais commité. */
  PHONE_PEPPER: z.string().min(16).default('dev-pepper-a-remplacer-en-production'),
  JWT_SECRET: z.string().min(16).default('dev-jwt-secret-a-remplacer-en-production'),

  CORS_ORIGIN: z.string().default('*'),

  /** Fournisseur SMS. `console` affiche le code dans les logs (développement). */
  SMS_PROVIDER: z.string().default('console'),

  /** Stockage des photos. Si l'un manque, on retombe sur le disque local. */
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_BASE: z.string().url().optional(),

  /** Base publique du site, pour les URL partageables et les métadonnées Open Graph. */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  /** Fond de carte Protomaps auto-hébergé (règle #1 : pas de Google Maps). */
  PMTILES_URL: z.string().default('/tiles/soukra.pmtiles'),

  /** Compte modérateur créé au seed. */
  SEED_ADMIN_PSEUDO: z.string().min(2).max(32).default('admin'),
  // Doit respecter le format tunisien réel (8 chiffres commençant par 2/4/5/9),
  // sinon le compte admin ne peut pas se connecter : la vérification OTP
  // applique la même validation que pour tout le monde.
  SEED_ADMIN_PHONE: z.string().default('+21620000000'),

  /**
   * Injecte le jeu de démonstration au démarrage si la base est vide.
   * Activé en conteneur pour que `docker compose up` donne une carte peuplée ;
   * à laisser à false sur une vraie instance, où les données sont réelles.
   */
  SEED_ON_START: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('✗ Configuration invalide :');
    for (const issue of parsed.error.issues) {
      console.error(`   ${issue.path.join('.')} — ${issue.message}`);
    }
    process.exit(1);
  }
  const value = parsed.data;

  // Les valeurs par défaut sont commodes en développement et dangereuses en production.
  if (value.NODE_ENV === 'production') {
    const defauts: string[] = [];
    if (value.PHONE_PEPPER.startsWith('dev-')) defauts.push('PHONE_PEPPER');
    if (value.JWT_SECRET.startsWith('dev-')) defauts.push('JWT_SECRET');
    if (defauts.length > 0) {
      console.error(
        `✗ Secrets laissés à leur valeur de développement en production : ${defauts.join(', ')}`,
      );
      process.exit(1);
    }
  }
  return value;
}

export const env: Env = load();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
