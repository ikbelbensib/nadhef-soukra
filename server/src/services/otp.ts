/**
 * Vérification du numéro de téléphone par code à usage unique.
 *
 * Le numéro n'est jamais stocké en clair : on ne conserve que
 * HMAC-SHA256(numéro, pepper). Le code lui-même est également haché — un dump de
 * la table ne doit pas permettre de valider un compte.
 */

import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { MAX_OTP_HEURE } from '@nadhef/shared';
import { count, one, run } from '../db/client.js';
import { env } from '../env.js';
import { badRequest, conflict, tooManyRequests, unauthorized } from '../errors.js';
import { choisirSmsProvider } from './sms/SmsProvider.js';
import { chargerUtilisateur, creerJeton, hashTelephone, type UtilisateurSession } from './auth.js';

const sms = choisirSmsProvider(env.SMS_PROVIDER);

const DUREE_CODE_MIN = 10;
const MAX_TENTATIVES = 5;

/** Numéros tunisiens : 8 chiffres, éventuellement préfixés +216. */
const MOTIF_TELEPHONE = /^(?:\+?216)?([2459]\d{7})$/;

/** Normalise en format international : deux saisies du même numéro doivent coïncider. */
export function normaliserTelephone(brut: string): string | null {
  const nettoye = brut.replace(/[\s.\-()]/g, '');
  const correspondance = MOTIF_TELEPHONE.exec(nettoye);
  return correspondance ? `+216${correspondance[1] as string}` : null;
}

const hashCode = (code: string, phoneHash: string): string =>
  createHmac('sha256', env.PHONE_PEPPER).update(`${phoneHash}:${code}`).digest('hex');

export async function demanderCode(telephoneBrut: string): Promise<{ expire_dans_s: number }> {
  const telephone = normaliserTelephone(telephoneBrut);
  if (telephone === null) {
    throw badRequest('INVALID_PHONE', 'erreurs.telephone_invalide');
  }
  const phoneHash = hashTelephone(telephone);

  const recents = await count(
    `SELECT COUNT(*) AS n FROM otp_codes
      WHERE phone_hash = ? AND created_at > datetime('now','-1 hour')`,
    [phoneHash],
  );
  if (recents >= MAX_OTP_HEURE) {
    throw tooManyRequests('OTP_RATE_LIMITED', 'erreurs.trop_de_codes', { max: MAX_OTP_HEURE });
  }

  // Les codes précédents non consommés sont invalidés : un seul code vivant.
  await run(
    `UPDATE otp_codes SET consumed_at = datetime('now')
      WHERE phone_hash = ? AND consumed_at IS NULL`,
    [phoneHash],
  );

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiration = new Date(Date.now() + DUREE_CODE_MIN * 60_000).toISOString();

  await run(
    `INSERT INTO otp_codes (id, phone_hash, code_hash, attempts, expires_at, created_at)
     VALUES (?,?,?,0,?,?)`,
    [`otp_${randomUUID()}`, phoneHash, hashCode(code, phoneHash), expiration, new Date().toISOString()],
  );

  await sms.envoyer(telephone, `Nadhef Soukra — votre code : ${code}`);
  return { expire_dans_s: DUREE_CODE_MIN * 60 };
}

interface CodeRow {
  id: string;
  code_hash: string;
  attempts: number;
}

/**
 * Vérifie le code et rattache le numéro.
 *
 * Trois cas : l'appareil a déjà un compte léger → on le VÉRIFIE sans lui faire
 * perdre ses points ; le numéro est déjà rattaché ailleurs → on connecte ce
 * compte ; sinon → refus, car créer un compte ici demanderait un pseudo.
 */
export async function verifierCode(input: {
  telephone: string;
  code: string;
  utilisateurCourant: UtilisateurSession | null;
}): Promise<{ user: UtilisateurSession; jeton: string }> {
  const telephone = normaliserTelephone(input.telephone);
  if (telephone === null) throw badRequest('INVALID_PHONE', 'erreurs.telephone_invalide');
  const phoneHash = hashTelephone(telephone);

  const actif = await one<CodeRow>(
    `SELECT id, code_hash, attempts FROM otp_codes
      WHERE phone_hash = ? AND consumed_at IS NULL AND expires_at > datetime('now')
      ORDER BY created_at DESC LIMIT 1`,
    [phoneHash],
  );
  if (!actif) throw unauthorized('erreurs.code_expire');

  if (actif.attempts >= MAX_TENTATIVES) {
    await run("UPDATE otp_codes SET consumed_at = datetime('now') WHERE id = ?", [actif.id]);
    throw tooManyRequests('OTP_TOO_MANY_ATTEMPTS', 'erreurs.trop_de_tentatives');
  }

  const attendu = Buffer.from(actif.code_hash, 'hex');
  const fourni = Buffer.from(hashCode(input.code.trim(), phoneHash), 'hex');
  // Comparaison à temps constant : sans elle, le temps de réponse fuit le code.
  const valide = attendu.length === fourni.length && timingSafeEqual(attendu, fourni);

  if (!valide) {
    await run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [actif.id]);
    throw unauthorized('erreurs.code_invalide');
  }
  await run("UPDATE otp_codes SET consumed_at = datetime('now') WHERE id = ?", [actif.id]);

  const proprietaire = await one<{ id: string }>('SELECT id FROM users WHERE phone_hash = ?', [
    phoneHash,
  ]);

  if (proprietaire) {
    if (input.utilisateurCourant && input.utilisateurCourant.id !== proprietaire.id) {
      // Le numéro appartient déjà à un autre compte : on connecte celui-là
      // plutôt que de dupliquer une identité.
      const user = await chargerUtilisateur(proprietaire.id);
      if (!user) throw unauthorized();
      return { user, jeton: await creerJeton(user.id) };
    }
    const user = await chargerUtilisateur(proprietaire.id);
    if (!user) throw unauthorized();
    return { user, jeton: await creerJeton(user.id) };
  }

  if (!input.utilisateurCourant) {
    // Pas de compte à vérifier : il faut d'abord en créer un (un pseudo suffit).
    throw conflict('ACCOUNT_REQUIRED', 'erreurs.compte_requis_avant_verification');
  }

  await run('UPDATE users SET phone_hash = ? WHERE id = ?', [
    phoneHash,
    input.utilisateurCourant.id,
  ]);
  const user = await chargerUtilisateur(input.utilisateurCourant.id);
  if (!user) throw unauthorized();
  return { user, jeton: await creerJeton(user.id) };
}
