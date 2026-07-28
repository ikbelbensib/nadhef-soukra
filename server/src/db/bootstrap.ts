/**
 * Amorçage du compte de modération.
 *
 * Le rôle `admin` ne s'obtenait que par `seed()`, réservé à la démonstration et
 * désactivé sur une instance réelle. Une production partait donc sans aucun
 * modérateur — et comme aucune route ne permet de promouvoir quelqu'un, la file
 * de modération, les bannissements et les exports municipaux restaient hors
 * d'atteinte définitivement.
 *
 * Cette fonction sépare les deux besoins : `SEED_ON_START` reste le jeu de
 * démonstration, tandis que l'existence d'un modérateur est garantie à chaque
 * démarrage. Elle est idempotente et ne fait rien dès qu'un admin existe, donc
 * elle ne peut pas rendre son rôle à quelqu'un qu'on aurait rétrogradé.
 */

import { randomUUID } from 'node:crypto';
import { one, run } from './client.js';
import { env } from '../env.js';
import { hashTelephone } from '../services/auth.js';
import { normaliserTelephone } from '../services/otp.js';

export type ResultatAmorcage = 'existant' | 'promu' | 'cree' | 'numero_invalide';

export async function assurerAdmin(): Promise<ResultatAmorcage> {
  // Un seul admin suffit à débloquer la chaîne : il peut nommer les autres.
  const dejaLa = await one<{ id: string }>("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (dejaLa) return 'existant';

  // Le numéro doit passer la même validation que celle de la connexion, sinon
  // le compte serait créé sans que personne ne puisse s'y connecter.
  const telephone = normaliserTelephone(env.SEED_ADMIN_PHONE);
  if (telephone === null) return 'numero_invalide';
  const empreinte = hashTelephone(telephone);

  const compte = await one<{ id: string }>('SELECT id FROM users WHERE phone_hash = ?', [empreinte]);
  if (compte) {
    await run("UPDATE users SET role = 'admin' WHERE id = ?", [compte.id]);
    return 'promu';
  }

  await run(
    `INSERT INTO users (id, phone_hash, pseudo, quartier_id, points, role, created_at)
     VALUES (?,?,?,NULL,0,'admin',?)`,
    [`usr_${randomUUID()}`, empreinte, env.SEED_ADMIN_PSEUDO, new Date().toISOString()],
  );
  return 'cree';
}
