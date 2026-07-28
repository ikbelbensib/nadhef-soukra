/**
 * Reconfirmations et clôture.
 *
 * « Toujours là » remet le compteur de péremption à zéro : c'est le geste qui
 * empêche la carte de devenir un cimetière (règle #2).
 *
 * « C'est propre » ferme un spot, mais PAS sur simple majorité d'anonymes :
 * celui qui a le plus intérêt à « nettoyer » la carte est souvent le
 * propriétaire du terrain ou l'auteur du dépôt. La fermeture exige donc
 * 2 comptes authentifiés distincts d'au moins 24 h, OU une preuve photo,
 * OU une décision de modérateur.
 */

import { randomUUID } from 'node:crypto';
import {
  AGE_COMPTE_MIN_H,
  CONFIRMATIONS_POUR_APPROBATION,
  CONFIRMATIONS_POUR_FERMETURE,
  RAYON_RECONFIRMATION_M,
  deciderReconfirmation,
  haversine,
  type ConfirmationKind,
  type CreateConfirmationInput,
  type LngLat,
} from '@nadhef/shared';
import { all, count, one, run } from '../db/client.js';
import { approuverSpot } from './spots.js';
import { attribuer, derniereReconfirmationCreditee, pointsDuJour } from './points.js';
import { conflict, notFound } from '../errors.js';
import type { UtilisateurSession } from './auth.js';

export interface ResultatConfirmation {
  id: string;
  kind: ConfirmationKind;
  statut_spot: string;
  last_confirmed_at: string;
  points: number;
  /** Renseigné quand le geste ne rapporte rien, pour l'expliquer à l'utilisateur. */
  raison_sans_points?: string;
  spot_ferme: boolean;
  spot_approuve: boolean;
}

interface SpotRow {
  id: string;
  lat: number;
  lng: number;
  statut: string;
  quartier_id: string | null;
  moderation_status: string;
  last_confirmed_at: string;
}

export async function confirmer(
  spotId: string,
  input: CreateConfirmationInput,
  auteur: { user: UtilisateurSession | null; deviceId: string | null },
): Promise<ResultatConfirmation> {
  const spot = await one<SpotRow>(
    `SELECT id, lat, lng, statut, quartier_id, moderation_status, last_confirmed_at
       FROM spots WHERE id = ? AND moderation_status <> 'rejected'`,
    [spotId],
  );
  if (!spot) throw notFound('SPOT_NOT_FOUND', 'erreurs.spot_introuvable');
  if (spot.statut === 'rejete') {
    throw conflict('SPOT_REJECTED', 'erreurs.spot_rejete');
  }

  // Un même auteur ne confirme pas deux fois le même spot dans la journée :
  // sans cela, un seul utilisateur peut simuler un consensus.
  const dejaAujourdhui = await count(
    `SELECT COUNT(*) AS n FROM confirmations
      WHERE spot_id = ? AND kind = ?
        AND (${auteur.user ? 'user_id = ?' : 'device_id = ?'})
        AND created_at > datetime('now','-24 hours')`,
    [spotId, input.kind, auteur.user?.id ?? auteur.deviceId ?? ''],
  );
  if (dejaAujourdhui > 0) {
    throw conflict('ALREADY_CONFIRMED', 'erreurs.deja_confirme_aujourdhui');
  }

  const maintenant = new Date().toISOString();
  const id = `cnf_${randomUUID()}`;
  const position: LngLat | null =
    input.lat !== undefined && input.lng !== undefined ? [input.lng, input.lat] : null;
  const distance = position === null ? null : haversine(position, [spot.lng, spot.lat]);

  await run(
    `INSERT INTO confirmations (id, spot_id, user_id, device_id, kind, lat, lng, photo_url, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,
      spotId,
      auteur.user?.id ?? null,
      auteur.user ? null : auteur.deviceId,
      input.kind,
      input.lat ?? null,
      input.lng ?? null,
      input.photo_url ?? null,
      maintenant,
    ],
  );

  let statut = spot.statut;
  let ferme = false;
  let approuve = false;
  let points = 0;
  let raison: string | undefined;

  if (input.kind === 'toujours_la') {
    // Le geste central de la règle #2 : la péremption repart de zéro.
    statut = spot.statut === 'a_verifier' || spot.statut === 'signale' ? 'confirme' : spot.statut;
    await run('UPDATE spots SET last_confirmed_at = ?, statut = ? WHERE id = ?', [
      maintenant,
      statut,
      spotId,
    ]);

    if (auteur.user) {
      const decision = deciderReconfirmation({
        estAuthentifie: true,
        distanceMetres: distance,
        pointsConfirmationAujourdhui: await pointsDuJour(auteur.user.id, 'spot_reconfirme'),
        derniereConfirmationSurCeSpot: await derniereReconfirmationCreditee(auteur.user.id, spotId),
      });
      const resultat = await attribuer({
        userId: auteur.user.id,
        decision,
        refType: 'confirmation',
        refId: id,
        quartierId: spot.quartier_id,
      });
      points = resultat.points;
      raison = resultat.raison;
    } else {
      raison = 'anonyme';
    }

    // Deux reconfirmations indépendantes valent validation : l'application doit
    // rester utilisable sans modérateur actif.
    if (spot.moderation_status === 'pending') {
      const independants = await compterConfirmateursIndependants(spotId, 'toujours_la');
      if (independants >= CONFIRMATIONS_POUR_APPROBATION) {
        await approuverSpot(spotId);
        approuve = true;
      }
    }
  } else {
    const avecPreuve = input.photo_url !== undefined;
    const independants = await compterConfirmateursIndependants(spotId, 'c_est_propre');
    if (avecPreuve || independants >= CONFIRMATIONS_POUR_FERMETURE) {
      await run("UPDATE spots SET statut = 'nettoye', cleaned_at = ? WHERE id = ?", [
        maintenant,
        spotId,
      ]);
      statut = 'nettoye';
      ferme = true;
    } else {
      raison = 'en_attente_second_temoin';
    }
  }

  return {
    id,
    kind: input.kind,
    statut_spot: statut,
    last_confirmed_at: input.kind === 'toujours_la' ? maintenant : spot.last_confirmed_at,
    points,
    ...(raison !== undefined ? { raison_sans_points: raison } : {}),
    spot_ferme: ferme,
    spot_approuve: approuve,
  };
}

/**
 * Confirmateurs distincts et crédibles.
 *
 * Ne comptent que les comptes AUTHENTIFIÉS d'au moins 24 h. Les gestes anonymes
 * restent affichés — ils informent — mais ne pèsent pas dans une décision :
 * deux identifiants d'appareil s'obtiennent en vidant le stockage local.
 */
async function compterConfirmateursIndependants(
  spotId: string,
  kind: ConfirmationKind,
): Promise<number> {
  const rows = await all<{ user_id: string }>(
    `SELECT DISTINCT c.user_id
       FROM confirmations c
       JOIN users u ON u.id = c.user_id
      WHERE c.spot_id = ?
        AND c.kind = ?
        AND c.user_id IS NOT NULL
        AND u.banned_at IS NULL
        AND u.created_at < datetime('now', ?)`,
    [spotId, kind, `-${AGE_COMPTE_MIN_H} hours`],
  );
  return rows.length;
}

/** Historique affiché sur la fiche d'un spot. */
export async function historique(spotId: string): Promise<
  {
    id: string;
    kind: ConfirmationKind;
    pseudo: string | null;
    anonyme: boolean;
    a_photo: boolean;
    created_at: string;
  }[]
> {
  const rows = await all<{
    id: string;
    kind: ConfirmationKind;
    pseudo: string | null;
    photo_url: string | null;
    created_at: string;
  }>(
    `SELECT c.id, c.kind, u.pseudo, c.photo_url, c.created_at
       FROM confirmations c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.spot_id = ?
      ORDER BY c.created_at DESC
      LIMIT 100`,
    [spotId],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    pseudo: r.pseudo,
    anonyme: r.pseudo === null,
    a_photo: r.photo_url !== null,
    created_at: r.created_at,
  }));
}

export const RAYON_POINTS_M = RAYON_RECONFIRMATION_M;
