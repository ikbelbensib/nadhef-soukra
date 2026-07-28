/**
 * Primitives géographiques pures.
 *
 * libSQL/Turso n'offre ni PostGIS ni SpatiaLite : toute la géométrie vit ici,
 * côté JS (cf. PLAN.md §8.6). Le SQL ne fait que du filtrage par bbox indexée ;
 * le raffinement exact se fait en mémoire.
 */

import type { BBox, LngLat } from './types.js';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const EARTH_RADIUS_M = 6_371_008.8;

/** Distance orthodromique en mètres. */
export function haversine(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Encode une position en geohash. Précision 8 ≈ 38 m × 19 m. */
export function geohashEncode(lng: number, lat: number, precision = 8): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bits = 0;
  let bit = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        bit = (bit << 1) + 1;
        lngMin = mid;
      } else {
        bit = bit << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bit = (bit << 1) + 1;
        latMin = mid;
      } else {
        bit = bit << 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bits === 5) {
      hash += BASE32[bit] as string;
      bits = 0;
      bit = 0;
    }
  }
  return hash;
}

export interface GeohashBounds {
  lng: number;
  lat: number;
  /** Demi-hauteur / demi-largeur de la cellule, en degrés. */
  latErr: number;
  lngErr: number;
}

export function geohashDecode(hash: string): GeohashBounds {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;

  for (const char of hash) {
    const idx = BASE32.indexOf(char);
    if (idx < 0) throw new Error(`Geohash invalide : caractère « ${char} »`);
    for (let n = 4; n >= 0; n--) {
      const bit = (idx >> n) & 1;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (bit === 1) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit === 1) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return {
    lng: (lngMin + lngMax) / 2,
    lat: (latMin + latMax) / 2,
    latErr: (latMax - latMin) / 2,
    lngErr: (lngMax - lngMin) / 2,
  };
}

/**
 * Les 8 cellules adjacentes.
 *
 * Indispensable pour la dédup à 30 m : deux points distants de 5 m peuvent
 * tomber dans deux cellules différentes si la frontière passe entre eux.
 * Interroger la seule cellule du point laisse donc passer des doublons
 * (cf. PLAN.md §5.2).
 */
export function geohashNeighbours(hash: string): string[] {
  const { lng, lat, latErr, lngErr } = geohashDecode(hash);
  const precision = hash.length;
  const out: string[] = [];
  for (const dLat of [1, 0, -1]) {
    for (const dLng of [-1, 0, 1]) {
      if (dLat === 0 && dLng === 0) continue;
      const nLat = Math.max(-90, Math.min(90, lat + dLat * latErr * 2));
      let nLng = lng + dLng * lngErr * 2;
      if (nLng > 180) nLng -= 360;
      if (nLng < -180) nLng += 360;
      out.push(geohashEncode(nLng, nLat, precision));
    }
  }
  return out;
}

/**
 * La cellule du point plus ses 8 voisines.
 *
 * ATTENTION — ne pas utiliser seul pour la dédup à 30 m. Une cellule de
 * précision 8 mesure ≈ 38 m × 19 m ; le bloc 3×3 fait donc ≈ 114 m × 57 m, mais
 * le point peut se trouver au bord de sa propre cellule. La portée GARANTIE
 * depuis le point n'est que de ~38 m en longitude et ~19 m en latitude : un
 * voisin situé à 30 m plein nord peut tomber hors du bloc.
 *
 * La dédup passe donc par `bboxAutour` + haversine (exact). Ce helper reste
 * utile pour du groupement grossier et pour les tests.
 */
export function geohashCellAndNeighbours(hash: string): string[] {
  return [hash, ...geohashNeighbours(hash)];
}

/**
 * bbox couvrant strictement un rayon en mètres autour d'un point.
 *
 * C'est la base de la dédup : un `BETWEEN` sur les colonnes indexées (lat,lng)
 * pré-filtre les candidats, puis `haversine` tranche exactement. Contrairement
 * au voisinage de geohash, la couverture est garantie dans toutes les directions.
 */
export function bboxAutour(point: LngLat, metres: number): BBox {
  const dLat = (metres / EARTH_RADIUS_M) * (180 / Math.PI);
  // Aux latitudes élevées un degré de longitude se resserre : on divise par cos.
  const dLng = dLat / Math.max(0.01, Math.cos((point[1] * Math.PI) / 180));
  return {
    minLng: point[0] - dLng,
    minLat: point[1] - dLat,
    maxLng: point[0] + dLng,
    maxLat: point[1] + dLat,
  };
}

/** Filtre exact : ne garde que les candidats réellement dans le rayon. */
export function dansRayon<T extends { lat: number; lng: number }>(
  point: LngLat,
  candidats: readonly T[],
  metres: number,
): T[] {
  return candidats.filter((c) => haversine(point, [c.lng, c.lat]) <= metres);
}

// ---------------------------------------------------------------------------
// Point dans polygone
// ---------------------------------------------------------------------------

type Ring = readonly LngLat[];
export type PolygonCoords = readonly Ring[];
export type MultiPolygonCoords = readonly PolygonCoords[];

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: PolygonCoords;
}
export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: MultiPolygonCoords;
}
export type GeoJsonAreaGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

/** Lancer de rayon sur un anneau simple. Les points du bord comptent comme dedans. */
function pointInRing(point: LngLat, ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Un polygone GeoJSON : premier anneau extérieur, suivants = trous. */
function pointInPolygonCoords(point: LngLat, coords: PolygonCoords): boolean {
  const outer = coords[0];
  if (!outer || !pointInRing(point, outer)) return false;
  for (let i = 1; i < coords.length; i++) {
    const hole = coords[i];
    if (hole && pointInRing(point, hole)) return false;
  }
  return true;
}

export function pointInGeometry(point: LngLat, geometry: GeoJsonAreaGeometry): boolean {
  if (geometry.type === 'Polygon') {
    return pointInPolygonCoords(point, geometry.coordinates);
  }
  return geometry.coordinates.some((poly) => pointInPolygonCoords(point, poly));
}

// ---------------------------------------------------------------------------
// BBox
// ---------------------------------------------------------------------------

export function geometryBBox(geometry: GeoJsonAreaGeometry): BBox {
  let minLng = 180;
  let minLat = 90;
  let maxLng = -180;
  let maxLat = -90;
  const rings: readonly Ring[] =
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, minLat, maxLng, maxLat };
}

export function bboxContains(box: BBox, point: LngLat): boolean {
  return (
    point[0] >= box.minLng &&
    point[0] <= box.maxLng &&
    point[1] >= box.minLat &&
    point[1] <= box.maxLat
  );
}

/** Élargit une bbox d'une marge en mètres — pré-filtre avant test exact. */
export function bboxExpand(box: BBox, metres: number): BBox {
  const dLat = (metres / EARTH_RADIUS_M) * (180 / Math.PI);
  const midLat = ((box.minLat + box.maxLat) / 2) * (Math.PI / 180);
  const dLng = dLat / Math.max(0.01, Math.cos(midLat));
  return {
    minLng: box.minLng - dLng,
    minLat: box.minLat - dLat,
    maxLng: box.maxLng + dLng,
    maxLat: box.maxLat + dLat,
  };
}

/** Parse une bbox de query string : "minLng,minLat,maxLng,maxLat". */
export function parseBBox(raw: string): BBox | null {
  const parts = raw.split(',').map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  if (minLng > maxLng || minLat > maxLat) return null;
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) return null;
  return { minLng, minLat, maxLng, maxLat };
}
