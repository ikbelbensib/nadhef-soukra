/**
 * Attribution des points.
 *
 * La décision (« ce geste mérite-t-il des points ? ») vit dans `shared/points.ts`,
 * pure et testée. Ici on ne fait qu'écrire, dans un ledger dont la contrainte
 * UNIQUE(user, action, ref) rend l'opération idempotente : un rejeu de la file
 * hors ligne, un double-clic ou une reprise après incident ne peuvent pas
 * créditer deux fois.
 *
 * `users.points` n'est jamais mis à jour à l'aveugle : il est recalculé depuis
 * le ledger, qui reste la source de vérité.
 */

import { randomUUID } from 'node:crypto';
import type { DecisionPoints, PointAction } from '@nadhef/shared';
import { db, one } from '../db/client.js';
import { evaluerBadges } from './badges.js';

export interface ResultatAttribution {
  credite: boolean;
  points: number;
  /** Absent si crédité ; sinon la raison du refus, pour l'afficher à l'utilisateur. */
  raison?: string;
  /** Badges débloqués par ce gain, à annoncer à l'utilisateur. */
  badges?: string[];
}

export async function attribuer(input: {
  userId: string;
  decision: DecisionPoints;
  refType: 'spot' | 'event' | 'confirmation';
  refId: string;
  quartierId: string | null;
}): Promise<ResultatAttribution> {
  const { decision } = input;
  if (!decision.attribue) {
    return { credite: false, points: 0, raison: decision.raison };
  }

  const deja = await one<{ id: string }>(
    `SELECT id FROM point_events
      WHERE user_id = ? AND action = ? AND ref_type = ? AND ref_id = ?`,
    [input.userId, decision.action, input.refType, input.refId],
  );
  if (deja) return { credite: false, points: 0, raison: 'deja_credite' };

  // Insertion et recalcul dans la même transaction : le total ne peut pas
  // diverger du ledger, même en cas d'interruption.
  await db.batch(
    [
      {
        sql: `INSERT INTO point_events (id, user_id, action, points, ref_type, ref_id, quartier_id, created_at)
              VALUES (?,?,?,?,?,?,?,?)`,
        args: [
          `pts_${randomUUID()}`,
          input.userId,
          decision.action,
          decision.points,
          input.refType,
          input.refId,
          input.quartierId,
          new Date().toISOString(),
        ],
      },
      {
        sql: `UPDATE users
                 SET points = (SELECT COALESCE(SUM(points), 0) FROM point_events WHERE user_id = ?)
               WHERE id = ?`,
        args: [input.userId, input.userId],
      },
    ],
    'write',
  );

  // Les badges se réévaluent après chaque gain. L'échec ne doit pas annuler
  // l'attribution des points : un badge manqué est réparable, pas un point perdu.
  let badges: string[] = [];
  try {
    badges = (await evaluerBadges(input.userId)).map((b) => b.code);
  } catch (err) {
    console.error('✗ évaluation des badges impossible', err);
  }

  return { credite: true, points: decision.points, badges };
}

/** Points gagnés aujourd'hui pour une action donnée — alimente les plafonds. */
export async function pointsDuJour(userId: string, action: PointAction): Promise<number> {
  const row = await one<{ total: number }>(
    `SELECT COALESCE(SUM(points), 0) AS total
       FROM point_events
      WHERE user_id = ? AND action = ? AND date(created_at) = date('now')`,
    [userId, action],
  );
  return Number(row?.total ?? 0);
}

/** Date de la dernière reconfirmation créditée par cet utilisateur sur ce spot. */
export async function derniereReconfirmationCreditee(
  userId: string,
  spotId: string,
): Promise<string | null> {
  const row = await one<{ created_at: string }>(
    `SELECT pe.created_at
       FROM point_events pe
       JOIN confirmations c ON c.id = pe.ref_id
      WHERE pe.user_id = ? AND pe.action = 'spot_reconfirme' AND c.spot_id = ?
      ORDER BY pe.created_at DESC
      LIMIT 1`,
    [userId, spotId],
  );
  return row?.created_at ?? null;
}
