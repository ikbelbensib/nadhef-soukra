/**
 * Stockage des photos. Jamais de blob en base (contrainte de stack).
 *
 * Deux implémentations derrière une interface :
 *   · disque local — défaut, zéro configuration, suffisant en développement
 *   · objet S3     — n'importe quel service compatible (R2, Supabase Storage,
 *                    Backblaze B2, MinIO), signé avec aws4fetch (~6 Ko)
 *
 * L'adressage est en « path-style » (`endpoint/bucket/clé`), le seul que tous
 * acceptent : le « virtual-host style » exigerait un sous-domaine par bucket.
 *
 * La clé d'objet est aléatoire : les URL ne doivent pas être énumérables, sinon
 * on offre la collection complète des photos à qui incrémente un compteur.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { env } from '../env.js';
import type { ImageValidee } from './images.js';

export interface Stockage {
  readonly nom: string;
  enregistrer(image: ImageValidee, prefixe: string): Promise<string>;
}

/** `spots/2026-07/ab12…cd.webp` — daté pour rester navigable, aléatoire pour ne pas être devinable. */
function construireCle(prefixe: string, extension: string): string {
  const mois = new Date().toISOString().slice(0, 7);
  return `${prefixe}/${mois}/${randomBytes(16).toString('hex')}.${extension}`;
}

const UPLOADS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data',
  'uploads',
);

class StockageDisque implements Stockage {
  readonly nom = 'disque';

  async enregistrer(image: ImageValidee, prefixe: string): Promise<string> {
    const cle = construireCle(prefixe, image.extension);
    const chemin = join(UPLOADS_DIR, cle);
    await mkdir(dirname(chemin), { recursive: true });
    await writeFile(chemin, image.octets);
    return `/uploads/${cle}`;
  }
}

class StockageS3 implements Stockage {
  readonly nom = 's3';
  private readonly client: AwsClient;

  constructor(
    private readonly endpoint: string,
    private readonly bucket: string,
    private readonly basePublique: string,
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
  ) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey, region, service: 's3' });
  }

  async enregistrer(image: ImageValidee, prefixe: string): Promise<string> {
    const cle = construireCle(prefixe, image.extension);
    const reponse = await this.client.fetch(`${this.endpoint}/${this.bucket}/${cle}`, {
      method: 'PUT',
      body: new Uint8Array(image.octets),
      headers: {
        'Content-Type': image.mime,
        'Content-Length': String(image.octets.length),
        // Clé aléatoire et contenu immuable : on peut mettre en cache longtemps.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
    if (!reponse.ok) {
      throw new Error(
        `Le stockage objet a refusé l'envoi (${reponse.status} ${await reponse.text()})`,
      );
    }
    return `${this.basePublique.replace(/\/$/, '')}/${cle}`;
  }
}

function choisir(): Stockage {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE } = env;
  if (S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_PUBLIC_BASE) {
    return new StockageS3(
      S3_ENDPOINT,
      S3_BUCKET,
      S3_PUBLIC_BASE,
      S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY,
      env.S3_REGION,
    );
  }
  return new StockageDisque();
}

export const stockage: Stockage = choisir();
export const CHEMIN_UPLOADS = UPLOADS_DIR;
