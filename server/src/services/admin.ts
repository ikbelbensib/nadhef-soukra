/**
 * Modération et administration.
 *
 * Toute décision est tracée dans `audit_log`. Un modérateur qui masque un
 * signalement gênant, un admin qui bannit un opposant : ces gestes doivent
 * rester lisibles après coup. Sur un outil qui touche à la propriété et au
 * voisinage, la traçabilité protège autant les habitants que l'équipe.
 */

import { randomUUID } from 'node:crypto';
import { all, count, one, run } from '../db/client.js';
import { approuverSpot } from './spots.js';
import { viderCacheStats } from './stats.js';
import { conflict, notFound } from '../errors.js';
import type { UtilisateurSession } from './auth.js';

export async function tracer(input: {
  acteur: UtilisateurSession;
  action: string;
  cibleType: string;
  cibleId: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await run(
    `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, payload, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      `aud_${randomUUID()}`,
      input.acteur.id,
      input.action,
      input.cibleType,
      input.cibleId,
      input.details ? JSON.stringify(input.details) : null,
      new Date().toISOString(),
    ],
  );
}

// ---------------------------------------------------------------------------
// File de modération
// ---------------------------------------------------------------------------

export interface EntreeFile {
  spot: {
    id: string;
    type: string;
    gravite: number;
    statut: string;
    description: string | null;
    photo_url: string | null;
    lat: number;
    lng: number;
    quartier_id: string | null;
    is_private_property: boolean;
    moderation_status: string;
    hidden_reason: string | null;
    created_at: string;
    auteur: string | null;
  };
  confirmations: number;
  signalements: { reason: string; details: string | null; created_at: string }[];
}

export async function fileModeration(limite = 100): Promise<{
  en_attente: EntreeFile[];
  masques: EntreeFile[];
  signalements_ouverts: number;
}> {
  const charger = async (statuts: string[]): Promise<EntreeFile[]> => {
    const rows = await all<EntreeFile['spot'] & { auteur: string | null }>(
      `SELECT s.id, s.type, s.gravite, s.statut, s.description, s.photo_url, s.lat, s.lng,
              s.quartier_id, s.is_private_property, s.moderation_status, s.hidden_reason,
              s.created_at, u.pseudo AS auteur
         FROM spots s
         LEFT JOIN users u ON u.id = s.created_by
        WHERE s.moderation_status IN (${statuts.map(() => '?').join(',')})
        ORDER BY s.created_at DESC
        LIMIT ?`,
      [...statuts, limite],
    );

    return Promise.all(
      rows.map(async (r) => ({
        spot: { ...r, is_private_property: Number(r.is_private_property) === 1 },
        confirmations: await count('SELECT COUNT(*) AS n FROM confirmations WHERE spot_id = ?', [
          r.id,
        ]),
        signalements: await all<{ reason: string; details: string | null; created_at: string }>(
          `SELECT reason, details, created_at FROM reports
            WHERE target_type = 'spot' AND target_id = ? AND statut = 'ouvert'
            ORDER BY created_at DESC`,
          [r.id],
        ),
      })),
    );
  };

  const [en_attente, masques, signalements_ouverts] = await Promise.all([
    charger(['pending']),
    charger(['hidden']),
    count("SELECT COUNT(*) AS n FROM reports WHERE statut = 'ouvert'"),
  ]);

  return { en_attente, masques, signalements_ouverts };
}

export type DecisionModeration = 'approved' | 'rejected' | 'hidden';

export async function modererSpot(
  spotId: string,
  decision: DecisionModeration,
  raison: string | undefined,
  acteur: UtilisateurSession,
): Promise<{ id: string; moderation_status: string; statut: string }> {
  const spot = await one<{ id: string; moderation_status: string; statut: string }>(
    'SELECT id, moderation_status, statut FROM spots WHERE id = ?',
    [spotId],
  );
  if (!spot) throw notFound('SPOT_NOT_FOUND', 'erreurs.spot_introuvable');

  if (decision === 'approved') {
    // Passe par le service métier : c'est lui qui crédite les points de l'auteur.
    await approuverSpot(spotId);
  } else if (decision === 'rejected') {
    await run(
      "UPDATE spots SET moderation_status = 'rejected', statut = 'rejete', hidden_reason = ? WHERE id = ?",
      [raison ?? null, spotId],
    );
  } else {
    await run("UPDATE spots SET moderation_status = 'hidden', hidden_reason = ? WHERE id = ?", [
      raison ?? 'decision_moderateur',
      spotId,
    ]);
  }

  // Les signalements portant sur ce spot sont clos par la même décision.
  await run(
    `UPDATE reports SET statut = 'traite', handled_by = ?
      WHERE target_type = 'spot' AND target_id = ? AND statut = 'ouvert'`,
    [acteur.id, spotId],
  );

  await tracer({
    acteur,
    action: `moderation.${decision}`,
    cibleType: 'spot',
    cibleId: spotId,
    ...(raison !== undefined ? { details: { raison } } : {}),
  });
  viderCacheStats();

  const apres = await one<{ moderation_status: string; statut: string }>(
    'SELECT moderation_status, statut FROM spots WHERE id = ?',
    [spotId],
  );
  return {
    id: spotId,
    moderation_status: apres?.moderation_status ?? decision,
    statut: apres?.statut ?? spot.statut,
  };
}

export async function resoudreSignalement(
  reportId: string,
  decision: 'traite' | 'rejete',
  acteur: UtilisateurSession,
): Promise<void> {
  const report = await one<{ id: string }>("SELECT id FROM reports WHERE id = ? AND statut = 'ouvert'", [
    reportId,
  ]);
  if (!report) throw notFound('REPORT_NOT_FOUND', 'erreurs.introuvable');

  await run('UPDATE reports SET statut = ?, handled_by = ? WHERE id = ?', [
    decision,
    acteur.id,
    reportId,
  ]);
  await tracer({ acteur, action: `report.${decision}`, cibleType: 'report', cibleId: reportId });
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

export async function bannir(
  userId: string,
  raison: string,
  acteur: UtilisateurSession,
): Promise<void> {
  const cible = await one<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = ?', [
    userId,
  ]);
  if (!cible) throw notFound('USER_NOT_FOUND', 'erreurs.introuvable');
  if (cible.id === acteur.id) {
    throw conflict('CANNOT_BAN_SELF', 'erreurs.pas_soi_meme');
  }
  // Un modérateur ne peut pas bannir un pair ni un admin : seul un admin le peut.
  if (cible.role !== 'citoyen' && acteur.role !== 'admin') {
    throw conflict('CANNOT_BAN_STAFF', 'erreurs.droits_insuffisants');
  }

  await run('UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?', [
    new Date().toISOString(),
    raison,
    userId,
  ]);
  await tracer({ acteur, action: 'user.ban', cibleType: 'user', cibleId: userId, details: { raison } });
}

export async function reintegrer(userId: string, acteur: UtilisateurSession): Promise<void> {
  await run('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?', [userId]);
  await tracer({ acteur, action: 'user.unban', cibleType: 'user', cibleId: userId });
}

export async function journal(limite = 200): Promise<
  {
    id: string;
    acteur: string | null;
    action: string;
    target_type: string;
    target_id: string;
    payload: string | null;
    created_at: string;
  }[]
> {
  return all(
    `SELECT a.id, u.pseudo AS acteur, a.action, a.target_type, a.target_id, a.payload, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC LIMIT ?`,
    [limite],
  );
}
