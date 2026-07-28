/** Lecture et création des points noirs. */

import { randomUUID } from 'node:crypto';
import type { InArgs } from '@libsql/client';
import {
  FENETRE_DEDUP_H,
  FENETRE_RECIDIVE_J,
  FRESHNESS_SQL,
  MAX_SIGNALEMENTS_JOUR,
  RAYON_DEDUP_M,
  bboxAutour,
  dansRayon,
  deciderSpotCree,
  geohashEncode,
  haversine,
  parseBBox,
  poidsHeatmap,
  type CreateSpotInput,
  type Freshness,
  type Gravite,
  type LngLat,
  type SpotsQuery,
} from '@nadhef/shared';
import { all, count, one, run } from '../db/client.js';
import { assertDansCommune, resoudreQuartier } from './boundary.js';
import { attribuer } from './points.js';
import { conflict, tooManyRequests } from '../errors.js';
import type { UtilisateurSession } from './auth.js';

interface SpotRow {
  id: string;
  lat: number;
  lng: number;
  type: string;
  gravite: number;
  statut: string;
  description: string | null;
  photo_url: string | null;
  quartier_id: string | null;
  created_at: string;
  last_confirmed_at: string;
  cleaned_at: string | null;
  is_private_property: number;
  moderation_status: string;
  freshness: Freshness;
  confirmations_count: number;
}

export interface SpotFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, unknown>;
}

/**
 * Construit la FeatureCollection consommée par MapLibre.
 * Le poids heatmap est précalculé ici : l'expression de style reste triviale
 * et le calcul de gravité n'existe qu'à un seul endroit.
 */
function toFeature(r: SpotRow): SpotFeature {
  return {
    type: 'Feature',
    id: r.id,
    geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: {
      id: r.id,
      type: r.type,
      gravite: r.gravite,
      statut: r.statut,
      freshness: r.freshness,
      poids: poidsHeatmap(r.gravite as Gravite),
      description: r.description,
      photo_url: r.photo_url,
      quartier_id: r.quartier_id,
      created_at: r.created_at,
      last_confirmed_at: r.last_confirmed_at,
      cleaned_at: r.cleaned_at,
      is_private_property: r.is_private_property === 1,
      en_attente_moderation: r.moderation_status === 'pending',
      confirmations_count: Number(r.confirmations_count),
    },
  };
}

const SELECT_SPOT = `
  SELECT s.id, s.lat, s.lng, s.type, s.gravite, s.statut, s.description,
         s.photo_url, s.quartier_id, s.created_at, s.last_confirmed_at,
         s.cleaned_at, s.is_private_property, s.moderation_status,
         ${FRESHNESS_SQL} AS freshness,
         (SELECT COUNT(*) FROM confirmations c WHERE c.spot_id = s.id) AS confirmations_count
    FROM spots s`;

/** Fiche d'un spot. Les archives restent accessibles par identifiant direct :
 *  une URL partagée ne doit pas cesser de fonctionner au bout de 90 jours. */
export async function getSpot(id: string): Promise<SpotFeature | null> {
  const rows = await all<SpotRow>(
    `${SELECT_SPOT} WHERE s.id = ? AND s.moderation_status NOT IN ('rejected','hidden')`,
    [id],
  );
  const row = rows[0];
  return row ? toFeature(row) : null;
}

export async function listSpots(query: SpotsQuery): Promise<{
  type: 'FeatureCollection';
  features: SpotFeature[];
}> {
  const where: string[] = [];
  const args: InArgs = [];

  // Les spots rejetés ou masqués ne sortent jamais de l'API publique.
  where.push("moderation_status NOT IN ('rejected','hidden')");
  where.push("statut <> 'rejete'");

  if (query.bbox) {
    const box = parseBBox(query.bbox);
    if (box) {
      where.push('lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?');
      args.push(box.minLat, box.maxLat, box.minLng, box.maxLng);
    }
  }
  if (query.type?.length) {
    where.push(`type IN (${query.type.map(() => '?').join(',')})`);
    args.push(...query.type);
  }
  if (query.gravite?.length) {
    where.push(`gravite IN (${query.gravite.map(() => '?').join(',')})`);
    args.push(...query.gravite);
  }
  if (query.statut?.length) {
    where.push(`statut IN (${query.statut.map(() => '?').join(',')})`);
    args.push(...query.statut);
  }
  if (query.quartier_id) {
    where.push('quartier_id = ?');
    args.push(query.quartier_id);
  }
  // Règle #2 : au-delà de 90 jours sans reconfirmation, le spot sort de la vue
  // par défaut. Il reste accessible via le filtre archives.
  if (!query.include_archives) {
    where.push(`julianday('now') - julianday(last_confirmed_at) <= 90`);
  }

  args.push(query.limit);

  const rows = await all<SpotRow>(
    `${SELECT_SPOT}
      WHERE ${where.join(' AND ')}
      ORDER BY s.last_confirmed_at DESC
      LIMIT ?`,
    args,
  );

  return { type: 'FeatureCollection', features: rows.map(toFeature) };
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

export interface AuteurSignalement {
  user: UtilisateurSession | null;
  deviceId: string | null;
}

export type ResultatCreation =
  | { type: 'cree'; spot: SpotFeature; points: number; recidive: boolean }
  | { type: 'doublon'; spot: SpotFeature; distance_m: number };

interface CandidatProximite {
  id: string;
  lat: number;
  lng: number;
  statut: string;
  cleaned_at: string | null;
  created_at: string;
}

/**
 * Spots actifs à moins de 30 m, signalés dans les dernières 24 h.
 *
 * La recherche passe par une bbox sur `(lat, lng)` indexés, puis par un filtre
 * haversine exact. Surtout PAS par le voisinage de geohash : une cellule de
 * précision 8 fait ≈ 38 × 19 m, et le bloc 3×3 ne garantit qu'une portée de
 * ~19 m en latitude — un doublon à 30 m plein nord y échappe (cf. PLAN.md §5.2
 * et le test qui verrouille ce constat).
 */
async function chercherDoublon(point: LngLat): Promise<{ spot: CandidatProximite; distance: number } | null> {
  const box = bboxAutour(point, RAYON_DEDUP_M);
  const candidats = await all<CandidatProximite>(
    `SELECT id, lat, lng, statut, cleaned_at, created_at
       FROM spots
      WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
        AND statut NOT IN ('nettoye','rejete')
        AND moderation_status <> 'rejected'
        AND created_at > datetime('now', ?)`,
    [box.minLat, box.maxLat, box.minLng, box.maxLng, `-${FENETRE_DEDUP_H} hours`],
  );

  const proches = dansRayon(point, candidats, RAYON_DEDUP_M);
  if (proches.length === 0) return null;

  let meilleur = proches[0] as CandidatProximite;
  let distance = haversine(point, [meilleur.lng, meilleur.lat]);
  for (const c of proches.slice(1)) {
    const d = haversine(point, [c.lng, c.lat]);
    if (d < distance) {
      meilleur = c;
      distance = d;
    }
  }
  return { spot: meilleur, distance };
}

/**
 * Un spot nettoyé, re-signalé au même endroit dans les 90 jours, est une
 * RÉCIDIVE et non un nouveau problème. C'est l'indicateur qui compte pour
 * juger si un chantier a servi à quelque chose.
 */
async function chercherRecidive(point: LngLat): Promise<CandidatProximite | null> {
  const box = bboxAutour(point, RAYON_DEDUP_M);
  const candidats = await all<CandidatProximite>(
    `SELECT id, lat, lng, statut, cleaned_at, created_at
       FROM spots
      WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
        AND statut = 'nettoye'
        AND cleaned_at IS NOT NULL
        AND cleaned_at > datetime('now', ?)
      ORDER BY cleaned_at DESC`,
    [box.minLat, box.maxLat, box.minLng, box.maxLng, `-${FENETRE_RECIDIVE_J} days`],
  );
  return dansRayon(point, candidats, RAYON_DEDUP_M)[0] ?? null;
}

/** Plafond quotidien, compté en base : il doit survivre à un redémarrage. */
async function assertQuotaJournalier(auteur: AuteurSignalement): Promise<void> {
  const [colonne, valeur] = auteur.user
    ? ['created_by', auteur.user.id]
    : ['created_by_device', auteur.deviceId];
  if (valeur === null) return;

  const n = await count(
    `SELECT COUNT(*) AS n FROM spots
      WHERE ${colonne} = ? AND created_at > datetime('now','-24 hours')`,
    [valeur],
  );
  if (n >= MAX_SIGNALEMENTS_JOUR) {
    throw tooManyRequests('DAILY_LIMIT_REACHED', 'erreurs.quota_signalements_atteint', {
      max: MAX_SIGNALEMENTS_JOUR,
    });
  }
}

export async function creerSpot(
  input: CreateSpotInput,
  auteur: AuteurSignalement,
): Promise<ResultatCreation> {
  const point: LngLat = [input.lng, input.lat];

  // Règle #6 : aucune écriture hors du polygone communal.
  assertDansCommune(point);

  // Rejouer la file hors ligne ne doit jamais dupliquer un signalement.
  if (input.idempotency_key) {
    const existant = await one<{ id: string }>('SELECT id FROM spots WHERE idempotency_key = ?', [
      input.idempotency_key,
    ]);
    if (existant) {
      const spot = await getSpot(existant.id);
      if (spot) return { type: 'cree', spot, points: 0, recidive: false };
    }
  }

  const doublon = await chercherDoublon(point);
  if (doublon) {
    // On ne rejette pas : l'utilisateur est dans la rue, un refus sec le fait
    // abandonner. L'appelant transforme ce retour en reconfirmation.
    const spot = await getSpot(doublon.spot.id);
    if (spot) {
      return { type: 'doublon', spot, distance_m: Math.round(doublon.distance) };
    }
  }

  await assertQuotaJournalier(auteur);

  const recidive = await chercherRecidive(point);
  const maintenant = new Date().toISOString();
  const id = `spt_${randomUUID()}`;
  const quartierId = resoudreQuartier(point);

  await run(
    `INSERT INTO spots (id, lat, lng, geohash8, quartier_id, type, gravite, statut,
       description, photo_url, created_by, created_by_device, created_at,
       last_confirmed_at, is_private_property, moderation_status, parent_spot_id,
       idempotency_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
    [
      id,
      input.lat,
      input.lng,
      geohashEncode(input.lng, input.lat, 8),
      quartierId,
      input.type,
      input.gravite,
      recidive ? 'recidive' : 'signale',
      input.description ?? null,
      input.photo_url ?? null,
      auteur.user?.id ?? null,
      auteur.user ? null : auteur.deviceId,
      maintenant,
      maintenant,
      input.is_private_property ? 1 : 0,
      recidive?.id ?? null,
      input.idempotency_key ?? null,
    ],
  );

  // Les points ne sont crédités qu'à l'approbation (règle #4) : créditer à la
  // création rendrait le spam rentable. Le signalement anonyme ne rapporte rien.
  const decision = deciderSpotCree({
    estAuthentifie: auteur.user !== null,
    moderationApprouvee: false,
  });
  const attribution = auteur.user
    ? await attribuer({
        userId: auteur.user.id,
        decision,
        refType: 'spot',
        refId: id,
        quartierId,
      })
    : { credite: false, points: 0 };

  const spot = await getSpot(id);
  if (!spot) throw conflict('SPOT_CREATION_FAILED', 'erreurs.interne');
  return {
    type: 'cree',
    spot,
    points: attribution.points,
    recidive: recidive !== null,
  };
}

/**
 * Approbation d'un spot : par 2 reconfirmations indépendantes ou par un
 * modérateur. C'est ici que les 5 points du signalement sont enfin crédités.
 */
export async function approuverSpot(spotId: string): Promise<void> {
  const spot = await one<{ created_by: string | null; quartier_id: string | null; moderation_status: string }>(
    'SELECT created_by, quartier_id, moderation_status FROM spots WHERE id = ?',
    [spotId],
  );
  if (!spot || spot.moderation_status === 'approved') return;

  await run("UPDATE spots SET moderation_status = 'approved' WHERE id = ?", [spotId]);

  if (spot.created_by !== null) {
    await attribuer({
      userId: spot.created_by,
      decision: deciderSpotCree({ estAuthentifie: true, moderationApprouvee: true }),
      refType: 'spot',
      refId: spotId,
      quartierId: spot.quartier_id,
    });
  }
}
