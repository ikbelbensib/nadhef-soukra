/**
 * Identité.
 *
 * Deux niveaux, conformément à l'arbitrage Q2 du PLAN :
 *   · compte léger  — pseudo + identifiant d'appareil, sans téléphone.
 *                     Accumule des points immédiatement.
 *   · compte vérifié — un numéro validé par OTP a été rattaché.
 *                     Seul niveau admis au classement public et à
 *                     l'organisation d'un chantier.
 *
 * Le numéro n'est jamais stocké en clair : HMAC-SHA256 avec un pepper hors base.
 * Un sha256(numéro + sel) serait brute-forçable — l'espace des numéros
 * tunisiens tient dans 10⁸.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { UserRole } from '@nadhef/shared';
import { all, one, run } from '../db/client.js';
import { env } from '../env.js';
import { conflict, forbidden, unauthorized } from '../errors.js';

const SECRET = new TextEncoder().encode(env.JWT_SECRET);
const DUREE_JETON = '30d';

export interface UtilisateurSession {
  id: string;
  pseudo: string;
  role: UserRole;
  quartier_id: string | null;
  points: number;
  is_verified: boolean;
}

interface UserRow {
  id: string;
  pseudo: string;
  role: UserRole;
  quartier_id: string | null;
  points: number;
  phone_hash: string | null;
  banned_at: string | null;
}

export const hashTelephone = (telephone: string): string =>
  createHmac('sha256', env.PHONE_PEPPER).update(telephone.trim()).digest('hex');

export async function creerJeton(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(DUREE_JETON)
    .sign(SECRET);
}

export async function verifierJeton(jeton: string): Promise<string | null> {
  try {
    const { payload }: { payload: JWTPayload } = await jwtVerify(jeton, SECRET);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function chargerUtilisateur(id: string): Promise<UtilisateurSession | null> {
  const row = await one<UserRow>(
    `SELECT id, pseudo, role, quartier_id, points, phone_hash, banned_at
       FROM users WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  // Un compte banni est traité comme absent : aucune écriture ne doit passer.
  if (row.banned_at !== null) throw forbidden('USER_BANNED', 'erreurs.compte_suspendu');
  return {
    id: row.id,
    pseudo: row.pseudo,
    role: row.role,
    quartier_id: row.quartier_id,
    points: Number(row.points),
    is_verified: row.phone_hash !== null,
  };
}

/** Le pseudo est unique : on le normalise pour éviter les quasi-doublons. */
const normaliserPseudo = (p: string): string => p.trim().replace(/\s+/g, ' ');

export async function creerCompteLeger(input: {
  pseudo: string;
  deviceId: string;
  quartierId: string | null;
}): Promise<{ user: UtilisateurSession; jeton: string }> {
  const pseudo = normaliserPseudo(input.pseudo);

  // Un appareil déjà rattaché récupère son compte plutôt que d'en créer un
  // second : réinstaller l'app ne doit pas faire perdre ses points.
  const existant = await one<{ id: string }>('SELECT id FROM users WHERE device_id = ?', [
    input.deviceId,
  ]);
  if (existant) {
    const user = await chargerUtilisateur(existant.id);
    if (user) return { user, jeton: await creerJeton(user.id) };
  }

  const collision = await one<{ id: string }>(
    'SELECT id FROM users WHERE lower(pseudo) = lower(?)',
    [pseudo],
  );
  if (collision) throw conflict('PSEUDO_TAKEN', 'erreurs.pseudo_deja_pris');

  const id = `usr_${randomUUID()}`;
  await run(
    `INSERT INTO users (id, device_id, pseudo, quartier_id, points, role, created_at)
     VALUES (?,?,?,?,0,'citoyen',?)`,
    [id, input.deviceId, pseudo, input.quartierId, new Date().toISOString()],
  );

  const user = await chargerUtilisateur(id);
  if (!user) throw new Error('Compte créé mais introuvable');
  return { user, jeton: await creerJeton(id) };
}

/**
 * Rattache les contributions anonymes d'un appareil au compte qui vient d'être
 * créé depuis ce même appareil.
 *
 * Sans rétroactivité sur les points : le signalement anonyme ne rapporte rien
 * (règle #5), et permettre de les réclamer après coup rouvrirait exactement
 * l'incitation au spam que cette règle ferme.
 */
export async function rattacherContributionsAnonymes(
  userId: string,
  deviceId: string,
): Promise<number> {
  const spots = await all<{ id: string }>(
    `SELECT id FROM spots WHERE created_by_device = ? AND created_by IS NULL`,
    [deviceId],
  );
  if (spots.length === 0) return 0;
  await run(
    `UPDATE spots SET created_by = ? WHERE created_by_device = ? AND created_by IS NULL`,
    [userId, deviceId],
  );
  return spots.length;
}

export function assertVerifie(user: UtilisateurSession): void {
  if (!user.is_verified) {
    throw forbidden('PHONE_REQUIRED', 'erreurs.telephone_requis');
  }
}

export function assertRole(user: UtilisateurSession, roles: readonly UserRole[]): void {
  if (!roles.includes(user.role)) throw unauthorized('erreurs.droits_insuffisants');
}
