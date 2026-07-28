/** Configuration validée au démarrage : le serveur refuse de booter mal configuré. */

import { z } from 'zod';

/**
 * Une valeur collée dans l'interface d'un hébergeur emporte très souvent un
 * saut de ligne ou une espace finale. Invisible, et fatal : un `\n` en fin
 * d'URL devient `%0A` une fois encodé, et le client libSQL rejette l'adresse
 * avec un `ERR_INVALID_URL` qui ne dit pas d'où vient le caractère.
 * On rogne donc systématiquement, plutôt que d'espérer un copier-coller propre.
 */
const texte = (): z.ZodString => z.string().trim();

/** Numéro d'exemple du compte de modération — refusé si un vrai SMS part. */
const DEFAUT_TELEPHONE_ADMIN = '+21620000000';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: texte().default('0.0.0.0'),

  /** libSQL : `file:` en local, `libsql://…` sur Turso. */
  DATABASE_URL: texte().min(1).default('file:./data/nadhef.db'),
  DATABASE_AUTH_TOKEN: texte().optional(),

  /** Pepper du HMAC des numéros de téléphone. Jamais en base, jamais commité. */
  PHONE_PEPPER: texte().min(16).default('dev-pepper-a-remplacer-en-production'),
  JWT_SECRET: texte().min(16).default('dev-jwt-secret-a-remplacer-en-production'),

  CORS_ORIGIN: texte().default('*'),

  /** Fournisseur SMS. `console` affiche le code dans les logs (développement). */
  SMS_PROVIDER: texte().default('console'),

  /**
   * Stockage des photos, sur n'importe quel service compatible S3 — Cloudflare
   * R2, Supabase Storage, Backblaze B2, MinIO. Si l'un des cinq champs manque,
   * on retombe sur le disque local.
   */
  S3_ENDPOINT: texte().url().optional(),
  S3_BUCKET: texte().optional(),
  S3_ACCESS_KEY_ID: texte().optional(),
  S3_SECRET_ACCESS_KEY: texte().optional(),
  S3_PUBLIC_BASE: texte().url().optional(),
  /**
   * R2 accepte la région fictive `auto` ; la plupart des autres services
   * vérifient qu'elle correspond à celle du bucket, et rejettent la signature
   * SigV4 sinon (`SignatureDoesNotMatch`). Supabase attend p. ex. `eu-central-1`.
   */
  S3_REGION: texte().default('auto'),

  /** Base publique du site, pour les URL partageables et les métadonnées Open Graph. */
  PUBLIC_BASE_URL: texte().url().default('http://localhost:3000'),

  /** Fond de carte Protomaps auto-hébergé (règle #1 : pas de Google Maps). */
  PMTILES_URL: texte().default('/tiles/soukra.pmtiles'),

  /** Compte modérateur créé au seed. */
  SEED_ADMIN_PSEUDO: texte().min(2).max(32).default('admin'),
  // Doit respecter le format tunisien réel (8 chiffres commençant par 2/4/5/9),
  // sinon le compte admin ne peut pas se connecter : la vérification OTP
  // applique la même validation que pour tout le monde.
  SEED_ADMIN_PHONE: texte().default(DEFAUT_TELEPHONE_ADMIN),

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

    // Le compte de modération est lié à un numéro : c'est quiconque reçoit le
    // SMS qui peut s'y connecter. Avec le fournisseur `console` le code ne
    // sort que dans les journaux du serveur, donc le numéro par défaut est
    // sans danger. Dès qu'un vrai fournisseur est branché, il donnerait les
    // pleins pouvoirs au propriétaire réel de ce numéro.
    if (value.SMS_PROVIDER !== 'console' && value.SEED_ADMIN_PHONE === DEFAUT_TELEPHONE_ADMIN) {
      console.error(
        `✗ SEED_ADMIN_PHONE est resté au numéro d'exemple (${DEFAUT_TELEPHONE_ADMIN}) alors qu'un\n` +
          `  fournisseur SMS réel est configuré : le compte administrateur serait accessible au\n` +
          '  propriétaire de ce numéro. Renseigne le tien.',
      );
      process.exit(1);
    }
  }
  return value;
}

export const env: Env = load();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
