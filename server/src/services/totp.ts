/**
 * Code de présence rotatif (RFC 6238, HMAC-SHA1, pas de 30 s).
 *
 * Un QR statique serait photographié et partagé dans le groupe WhatsApp du
 * quartier dans les dix minutes : cinquante points pour des gens qui ne sont pas
 * venus. Le code change donc toutes les 30 secondes, et le serveur n'accepte
 * qu'une fenêtre de part et d'autre pour tolérer les horloges décalées.
 *
 * Ce n'est pas un secret cryptographique fort — c'est une barrière contre le
 * partage opportuniste, doublée d'une vérification de la fenêtre horaire de
 * l'événement.
 */

import { createHmac } from 'node:crypto';
import { PAS_TOTP_S } from '@nadhef/shared';

const CHIFFRES = 6;
/** Tolérance de part et d'autre : horloges de téléphones mal réglées. */
const FENETRES_TOLEREES = 1;

function genererPourCompteur(secret: string, compteur: number): string {
  const tampon = Buffer.alloc(8);
  tampon.writeBigUInt64BE(BigInt(compteur));
  const empreinte = createHmac('sha1', Buffer.from(secret, 'base64url')).update(tampon).digest();

  // Troncature dynamique : l'octet de poids faible désigne l'offset de lecture.
  const offset = (empreinte[empreinte.length - 1] as number) & 0x0f;
  const binaire =
    (((empreinte[offset] as number) & 0x7f) << 24) |
    (((empreinte[offset + 1] as number) & 0xff) << 16) |
    (((empreinte[offset + 2] as number) & 0xff) << 8) |
    ((empreinte[offset + 3] as number) & 0xff);

  return String(binaire % 10 ** CHIFFRES).padStart(CHIFFRES, '0');
}

export const compteurPour = (maintenant: Date = new Date()): number =>
  Math.floor(maintenant.getTime() / 1000 / PAS_TOTP_S);

export function genererCode(secret: string, maintenant: Date = new Date()): string {
  return genererPourCompteur(secret, compteurPour(maintenant));
}

/** Secondes restantes avant rotation — l'interface affiche le compte à rebours. */
export function secondesRestantes(maintenant: Date = new Date()): number {
  return PAS_TOTP_S - Math.floor(maintenant.getTime() / 1000) % PAS_TOTP_S;
}

/** Vérifie le code sur la fenêtre courante et ses voisines immédiates. */
export function verifierCode(
  secret: string,
  code: string,
  maintenant: Date = new Date(),
): boolean {
  const propre = code.trim();
  if (!/^\d{6}$/.test(propre)) return false;
  const compteur = compteurPour(maintenant);
  for (let d = -FENETRES_TOLEREES; d <= FENETRES_TOLEREES; d++) {
    if (genererPourCompteur(secret, compteur + d) === propre) return true;
  }
  return false;
}

export const FENETRES_TOLEREES_TOTP = FENETRES_TOLEREES;
