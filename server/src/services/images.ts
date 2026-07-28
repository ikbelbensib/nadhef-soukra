/**
 * Validation et assainissement des images.
 *
 * Deux raisons, toutes deux sérieuses :
 *
 * 1. Le type déclaré par le client ne prouve rien. On lit les octets de tête.
 *
 * 2. Les photos de smartphone embarquent des coordonnées GPS en EXIF. Quelqu'un
 *    qui photographie le tas devant chez lui publierait son adresse. On retire
 *    donc les métadonnées AVANT stockage, sans réencoder — pas de dépendance
 *    native (sharp) à installer sur l'hébergeur.
 */

import { PHOTO_TAILLE_MAX_OCTETS } from '@nadhef/shared';
import { badRequest } from '../errors.js';

export type FormatImage = 'webp' | 'jpeg' | 'png';

export interface ImageValidee {
  format: FormatImage;
  extension: string;
  mime: string;
  octets: Buffer;
}

const commencePar = (buf: Buffer, octets: number[], decalage = 0): boolean =>
  octets.every((o, i) => buf[decalage + i] === o);

/** Reconnaît le format par sa signature, pas par l'en-tête Content-Type. */
function detecterFormat(buf: Buffer): FormatImage | null {
  if (buf.length < 12) return null;
  if (commencePar(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (commencePar(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (commencePar(buf, [0x52, 0x49, 0x46, 0x46]) && commencePar(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  return null;
}

/**
 * JPEG : supprime les segments APP1 (EXIF, XMP) et APP13 (IPTC).
 * Un JPEG est une suite de segments `FF xx <taille sur 2 octets> <données>` ;
 * on recopie tout sauf ceux-là, puis le flux compressé tel quel.
 */
function nettoyerJpeg(buf: Buffer): Buffer {
  const morceaux: Buffer[] = [buf.subarray(0, 2)]; // SOI
  let i = 2;

  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) break;
    const marqueur = buf[i + 1] as number;

    // SOS : début des données compressées, on recopie le reste sans analyse.
    if (marqueur === 0xda) {
      morceaux.push(buf.subarray(i));
      return Buffer.concat(morceaux);
    }
    // Marqueurs sans charge utile.
    if (marqueur === 0xd8 || (marqueur >= 0xd0 && marqueur <= 0xd9)) {
      morceaux.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }

    const taille = buf.readUInt16BE(i + 2);
    const fin = i + 2 + taille;
    const porteurDeMetadonnees = marqueur === 0xe1 || marqueur === 0xed || marqueur === 0xee;
    if (!porteurDeMetadonnees) morceaux.push(buf.subarray(i, fin));
    i = fin;
  }
  return Buffer.concat(morceaux);
}

/**
 * WebP : retire les fragments EXIF et XMP du conteneur RIFF, puis réécrit la
 * taille annoncée en tête — sinon les décodeurs rejettent le fichier.
 */
function nettoyerWebp(buf: Buffer): Buffer {
  if (buf.length < 12) return buf;
  const morceaux: Buffer[] = [];
  let i = 12;

  while (i + 8 <= buf.length) {
    const type = buf.toString('ascii', i, i + 4);
    const taille = buf.readUInt32LE(i + 4);
    // Les fragments RIFF sont alignés sur 2 octets.
    const total = 8 + taille + (taille % 2);
    if (type !== 'EXIF' && type !== 'XMP ') {
      morceaux.push(buf.subarray(i, Math.min(i + total, buf.length)));
    }
    i += total;
  }

  const corps = Buffer.concat(morceaux);
  const entete = Buffer.alloc(12);
  buf.copy(entete, 0, 0, 12);
  entete.writeUInt32LE(corps.length + 4, 4); // « WEBP » + fragments
  return Buffer.concat([entete, corps]);
}

/**
 * PNG : ne conserve que les fragments critiques et strictement utiles.
 * eXIf, tEXt, iTXt et zTXt peuvent transporter position et commentaires.
 */
function nettoyerPng(buf: Buffer): Buffer {
  const indesirables = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);
  const morceaux: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;

  while (i + 8 <= buf.length) {
    const taille = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const total = 12 + taille; // taille + type + données + CRC
    if (!indesirables.has(type)) morceaux.push(buf.subarray(i, Math.min(i + total, buf.length)));
    if (type === 'IEND') break;
    i += total;
  }
  return Buffer.concat(morceaux);
}

const MIME: Record<FormatImage, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export function validerEtNettoyer(octets: Buffer): ImageValidee {
  if (octets.length === 0) {
    throw badRequest('EMPTY_UPLOAD', 'erreurs.image_vide');
  }
  if (octets.length > PHOTO_TAILLE_MAX_OCTETS) {
    throw badRequest('UPLOAD_TOO_LARGE', 'erreurs.image_trop_lourde', {
      max_octets: PHOTO_TAILLE_MAX_OCTETS,
      recu: octets.length,
    });
  }

  const format = detecterFormat(octets);
  if (format === null) {
    throw badRequest('UNSUPPORTED_IMAGE', 'erreurs.format_image_non_supporte');
  }

  const propre =
    format === 'jpeg'
      ? nettoyerJpeg(octets)
      : format === 'webp'
        ? nettoyerWebp(octets)
        : nettoyerPng(octets);

  return {
    format,
    extension: format === 'jpeg' ? 'jpg' : format,
    mime: MIME[format],
    octets: propre,
  };
}

/** Exposé pour les tests. */
export const _internes = { detecterFormat, nettoyerJpeg, nettoyerWebp, nettoyerPng };
