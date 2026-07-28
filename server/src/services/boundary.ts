/**
 * Geofence (règle non négociable #6) et résolution des quartiers.
 *
 * Les polygones sont chargés une fois au démarrage et gardés en mémoire :
 * libSQL n'a pas de spatial, et les tester en JS coûte quelques microsecondes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BUFFER_GEOFENCE_M,
  bboxContains,
  bboxExpand,
  geometryBBox,
  pointInGeometry,
  type BBox,
  type GeoJsonAreaGeometry,
  type LngLat,
} from '@nadhef/shared';
import { unprocessable } from '../errors.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

interface BoundaryFeature {
  properties: {
    osm_relation_id: number;
    codegeo: string;
    nom_fr: string;
    nom_ar: string;
  };
  geometry: GeoJsonAreaGeometry;
}

interface QuartierFeature {
  properties: {
    id: string;
    osm_relation_id: number;
    codegeo: string;
    nom_fr: string;
    nom_ar: string;
    population_estimee: number;
    centre_lat: number;
    centre_lng: number;
  };
  geometry: GeoJsonAreaGeometry;
}

const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T;

const boundaryFeature = readJson<BoundaryFeature>('soukra-boundary.geojson');
const quartiersCollection = readJson<{ features: QuartierFeature[] }>('quartiers.geojson');

export const communeGeometry: GeoJsonAreaGeometry = boundaryFeature.geometry;
export const communeBBox: BBox = geometryBBox(communeGeometry);
/** bbox élargie du buffer de tolérance — pré-filtre bon marché avant le test exact. */
const communeBBoxBufferee: BBox = bboxExpand(communeBBox, BUFFER_GEOFENCE_M);

export const communeInfo = {
  nom_fr: boundaryFeature.properties.nom_fr,
  nom_ar: boundaryFeature.properties.nom_ar,
  codegeo: boundaryFeature.properties.codegeo,
  osm_relation_id: boundaryFeature.properties.osm_relation_id,
  bbox: communeBBox,
} as const;

export const quartiers = quartiersCollection.features;

export type ResultatGeofence =
  | { dedans: true; limite: boolean }
  | { dedans: false; limite: false };

/**
 * Un point est-il dans la commune ?
 *
 * Le buffer de 200 m est délibéré : un dépôt sauvage sur la route qui borde la
 * limite communale est un vrai problème, et un rejet sec à quelques mètres près
 * fait abandonner l'utilisateur qui est dans la rue. Ces points sont acceptés
 * mais marqués `limite`.
 */
export function testerGeofence(point: LngLat): ResultatGeofence {
  if (pointInGeometry(point, communeGeometry)) return { dedans: true, limite: false };
  if (!bboxContains(communeBBoxBufferee, point)) return { dedans: false, limite: false };
  // Dans la bbox bufferée mais hors polygone : on mesure la distance réelle au
  // polygone via un échantillonnage de ses sommets.
  return distanceAuPolygone(point) <= BUFFER_GEOFENCE_M
    ? { dedans: true, limite: true }
    : { dedans: false, limite: false };
}

/** Distance approchée au polygone : minimum aux sommets de l'anneau extérieur. */
function distanceAuPolygone(point: LngLat): number {
  const rings =
    communeGeometry.type === 'Polygon'
      ? communeGeometry.coordinates
      : communeGeometry.coordinates.flat();
  let min = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    for (const sommet of ring) {
      const d = haversineLocal(point, sommet);
      if (d < min) min = d;
    }
  }
  return min;
}

/** Approximation plane, suffisante à l'échelle de quelques centaines de mètres. */
function haversineLocal(a: LngLat, b: LngLat): number {
  const mParDegLat = 111_320;
  const mParDegLng = mParDegLat * Math.cos((a[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * mParDegLng;
  const dy = (b[1] - a[1]) * mParDegLat;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Lève une 422 explicite si l'écriture est hors commune. */
export function assertDansCommune(point: LngLat): { limite: boolean } {
  const resultat = testerGeofence(point);
  if (!resultat.dedans) {
    throw unprocessable('GEOFENCE_REJECTED', 'erreurs.hors_commune', {
      commune: communeInfo.nom_fr,
      bbox: communeBBox,
    });
  }
  return { limite: resultat.limite };
}

/** Quartier contenant le point, ou null (point dans le buffer hors secteurs). */
export function quartierPour(point: LngLat): string | null {
  for (const feature of quartiers) {
    if (pointInGeometry(point, feature.geometry)) return feature.properties.id;
  }
  return null;
}

/** Quartier le plus proche par centroïde — repli quand aucun secteur ne contient le point. */
export function quartierLePlusProche(point: LngLat): string | null {
  let best: { id: string; d: number } | null = null;
  for (const f of quartiers) {
    const d = haversineLocal(point, [f.properties.centre_lng, f.properties.centre_lat]);
    if (!best || d < best.d) best = { id: f.properties.id, d };
  }
  return best?.id ?? null;
}

/** Résolution utilisée à l'écriture : contenance stricte, sinon plus proche centroïde. */
export function resoudreQuartier(point: LngLat): string | null {
  return quartierPour(point) ?? quartierLePlusProche(point);
}
