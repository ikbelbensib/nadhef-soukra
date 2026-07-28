/**
 * Signalements d'abus et masquage automatique.
 *
 * Le flag `is_private_property` existe parce qu'un point noir posé sur une
 * propriété identifiable peut servir au harcèlement de voisinage. Il faut donc
 * un bouton de signalement partout, et un masquage rapide.
 *
 * Mais le masquage automatique est une arme à double tranchant : sans garde-fou,
 * trois comptes jetables suffisent à effacer n'importe quel signalement
 * légitime. On n'accepte donc que des comptes distincts d'au moins 24 h.
 */

import { randomUUID } from 'node:crypto';
import { AGE_COMPTE_MIN_H, REPORTS_POUR_MASQUAGE, type CreateReportInput } from '@nadhef/shared';
import { all, one, run } from '../db/client.js';
import { conflict, notFound } from '../errors.js';
import type { UtilisateurSession } from './auth.js';

export interface ResultatSignalement {
  id: string;
  cible_masquee: boolean;
  signalements_credibles: number;
}

export async function signaler(
  input: CreateReportInput,
  auteur: { user: UtilisateurSession | null; deviceId: string | null },
): Promise<ResultatSignalement> {
  await assertCibleExiste(input.target_type, input.target_id);

  const dejaSignale = await one<{ id: string }>(
    `SELECT id FROM reports
      WHERE target_type = ? AND target_id = ? AND statut = 'ouvert'
        AND (${auteur.user ? 'reporter_id = ?' : 'reporter_device = ?'})`,
    [input.target_type, input.target_id, auteur.user?.id ?? auteur.deviceId ?? ''],
  );
  if (dejaSignale) throw conflict('ALREADY_REPORTED', 'erreurs.deja_signale');

  const id = `rpt_${randomUUID()}`;
  await run(
    `INSERT INTO reports (id, target_type, target_id, reason, details, reporter_id,
       reporter_device, statut, created_at)
     VALUES (?,?,?,?,?,?,?,'ouvert',?)`,
    [
      id,
      input.target_type,
      input.target_id,
      input.reason,
      input.details ?? null,
      auteur.user?.id ?? null,
      auteur.user ? null : auteur.deviceId,
      new Date().toISOString(),
    ],
  );

  const credibles = await compterSignalementsCredibles(input.target_type, input.target_id);
  let masquee = false;

  if (input.target_type === 'spot' && credibles >= REPORTS_POUR_MASQUAGE) {
    await run(
      `UPDATE spots SET moderation_status = 'hidden', hidden_reason = ?
        WHERE id = ? AND moderation_status <> 'hidden'`,
      ['signalements_multiples', input.target_id],
    );
    masquee = true;
  }

  return { id, cible_masquee: masquee, signalements_credibles: credibles };
}

/**
 * Ne comptent que les signalements émis par des comptes distincts, non bannis,
 * créés il y a plus de 24 h. Les signalements anonymes sont enregistrés pour la
 * file de modération mais ne déclenchent pas de masquage à eux seuls.
 */
async function compterSignalementsCredibles(
  targetType: string,
  targetId: string,
): Promise<number> {
  const rows = await all<{ reporter_id: string }>(
    `SELECT DISTINCT r.reporter_id
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
      WHERE r.target_type = ? AND r.target_id = ? AND r.statut = 'ouvert'
        AND r.reporter_id IS NOT NULL
        AND u.banned_at IS NULL
        AND u.created_at < datetime('now', ?)`,
    [targetType, targetId, `-${AGE_COMPTE_MIN_H} hours`],
  );
  return rows.length;
}

async function assertCibleExiste(type: string, id: string): Promise<void> {
  const table = type === 'spot' ? 'spots' : type === 'event' ? 'events' : 'users';
  const row = await one<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw notFound('TARGET_NOT_FOUND', 'erreurs.introuvable');
}
