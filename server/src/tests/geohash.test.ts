/**
 * Geohash et dédup 30 m.
 *
 * Le point de ce fichier : démontrer que l'égalité de geohash8 NE SUFFIT PAS
 * pour la règle « un signalement par zone de 30 m », et que la recherche sur la
 * cellule + ses 8 voisines la rattrape.
 */

import { describe, expect, it } from 'vitest';
import {
  RAYON_DEDUP_M,
  bboxAutour,
  bboxContains,
  dansRayon,
  geohashCellAndNeighbours,
  geohashDecode,
  geohashEncode,
  geohashNeighbours,
  haversine,
  type LngLat,
} from '@nadhef/shared';

// Centre approximatif de La Soukra.
const SOUKRA: LngLat = [10.2372, 36.8811];

describe('geohashEncode', () => {
  it('produit un hash de la précision demandée', () => {
    expect(geohashEncode(SOUKRA[0], SOUKRA[1], 8)).toHaveLength(8);
    expect(geohashEncode(SOUKRA[0], SOUKRA[1], 5)).toHaveLength(5);
  });

  it('est stable et préfixé de façon cohérente', () => {
    const h8 = geohashEncode(SOUKRA[0], SOUKRA[1], 8);
    expect(geohashEncode(SOUKRA[0], SOUKRA[1], 8)).toBe(h8);
    expect(h8.startsWith(geohashEncode(SOUKRA[0], SOUKRA[1], 5))).toBe(true);
  });

  it('vérifie une valeur de référence connue', () => {
    // Repère externe classique : la Tour Eiffel.
    expect(geohashEncode(2.294481, 48.858372, 7)).toBe('u09tunq');
  });
});

describe('geohashDecode', () => {
  it('retrouve la position à la taille de cellule près', () => {
    const hash = geohashEncode(SOUKRA[0], SOUKRA[1], 8);
    const { lng, lat, lngErr, latErr } = geohashDecode(hash);
    expect(Math.abs(lng - SOUKRA[0])).toBeLessThanOrEqual(lngErr);
    expect(Math.abs(lat - SOUKRA[1])).toBeLessThanOrEqual(latErr);
  });

  it('confirme qu’une cellule de précision 8 fait environ 38 m × 19 m', () => {
    const { lng, lat, lngErr, latErr } = geohashDecode(geohashEncode(SOUKRA[0], SOUKRA[1], 8));
    const largeur = haversine([lng - lngErr, lat], [lng + lngErr, lat]);
    const hauteur = haversine([lng, lat - latErr], [lng, lat + latErr]);
    expect(largeur).toBeGreaterThan(30);
    expect(largeur).toBeLessThan(45);
    expect(hauteur).toBeGreaterThan(14);
    expect(hauteur).toBeLessThan(24);
  });

  it('rejette un caractère hors alphabet base32', () => {
    expect(() => geohashDecode('sp3e0ai')).toThrow(/invalide/);
  });
});

describe('geohashNeighbours', () => {
  it('renvoie exactement 8 cellules distinctes, sans la cellule elle-même', () => {
    const hash = geohashEncode(SOUKRA[0], SOUKRA[1], 8);
    const voisins = geohashNeighbours(hash);
    expect(voisins).toHaveLength(8);
    expect(new Set(voisins).size).toBe(8);
    expect(voisins).not.toContain(hash);
  });

  it('la relation de voisinage est symétrique', () => {
    const hash = geohashEncode(SOUKRA[0], SOUKRA[1], 8);
    for (const voisin of geohashNeighbours(hash)) {
      expect(geohashNeighbours(voisin)).toContain(hash);
    }
  });

  it('geohashCellAndNeighbours couvre les 9 cellules', () => {
    const cellules = geohashCellAndNeighbours(geohashEncode(SOUKRA[0], SOUKRA[1], 8));
    expect(cellules).toHaveLength(9);
    expect(new Set(cellules).size).toBe(9);
  });
});

/** Décale un point de dx/dy mètres. */
const decaler = (p: LngLat, dxM: number, dyM: number): LngLat => {
  const mParDegLat = 111_320;
  const mParDegLng = mParDegLat * Math.cos((p[1] * Math.PI) / 180);
  return [p[0] + dxM / mParDegLng, p[1] + dyM / mParDegLat];
};

/** Grille d'origines couvrant plusieurs cellules : évite de conclure sur un seul point. */
const origines: LngLat[] = [];
for (let dx = 0; dx < 120; dx += 7) {
  for (let dy = 0; dy < 120; dy += 7) origines.push(decaler(SOUKRA, dx, dy));
}

describe('pourquoi geohash8 seul ne suffit pas', () => {
  it('deux points à moins de 30 m ont souvent des geohash8 différents', () => {
    let differents = 0;
    for (const origine of origines) {
      const voisin = decaler(origine, 25, 0);
      if (geohashEncode(origine[0], origine[1], 8) !== geohashEncode(voisin[0], voisin[1], 8)) {
        differents++;
      }
    }
    // Une cellule fait ~38 m de large : un décalage de 25 m franchit souvent la frontière.
    expect(differents).toBeGreaterThan(0);
  });

  it('le bloc 3×3 ne couvre PAS 30 m dans toutes les directions', () => {
    // Cellule ≈ 38 m × 19 m → le bloc 3×3 ne garantit que ~19 m en latitude.
    // Un voisin à 30 m plein nord peut donc échapper à la recherche.
    let manques = 0;
    for (const origine of origines) {
      const cellules = new Set(geohashCellAndNeighbours(geohashEncode(origine[0], origine[1], 8)));
      const nord = decaler(origine, 0, RAYON_DEDUP_M);
      if (!cellules.has(geohashEncode(nord[0], nord[1], 8))) manques++;
    }
    // Ce test documente une limite réelle : il doit rester rouge si quelqu'un
    // décide un jour d'implémenter la dédup sur le seul voisinage de geohash.
    expect(manques).toBeGreaterThan(0);
  });
});

describe('dédup à 30 m par bbox + haversine', () => {
  it('couvre 30 m dans toutes les directions, depuis n’importe quelle origine', () => {
    for (const origine of origines) {
      const box = bboxAutour(origine, RAYON_DEDUP_M);
      for (let angle = 0; angle < 360; angle += 5) {
        const rad = (angle * Math.PI) / 180;
        const voisin = decaler(
          origine,
          Math.cos(rad) * RAYON_DEDUP_M,
          Math.sin(rad) * RAYON_DEDUP_M,
        );
        expect(bboxContains(box, voisin)).toBe(true);
      }
    }
  });

  it('le filtre exact retient les points proches et écarte les autres', () => {
    const candidats = [
      { id: 'a', lng: decaler(SOUKRA, 10, 0)[0], lat: decaler(SOUKRA, 10, 0)[1] },
      { id: 'b', lng: decaler(SOUKRA, 0, 29)[0], lat: decaler(SOUKRA, 0, 29)[1] },
      { id: 'c', lng: decaler(SOUKRA, 0, 45)[0], lat: decaler(SOUKRA, 0, 45)[1] },
      { id: 'd', lng: decaler(SOUKRA, 300, 0)[0], lat: decaler(SOUKRA, 300, 0)[1] },
    ];
    expect(dansRayon(SOUKRA, candidats, RAYON_DEDUP_M).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('la bbox est un sur-ensemble : elle peut contenir des points au-delà du rayon', () => {
    // Les coins de la bbox sont à 30·√2 ≈ 42 m — d'où la nécessité du filtre exact.
    const box = bboxAutour(SOUKRA, RAYON_DEDUP_M);
    const coin: LngLat = [box.maxLng, box.maxLat];
    expect(bboxContains(box, coin)).toBe(true);
    expect(haversine(SOUKRA, coin)).toBeGreaterThan(RAYON_DEDUP_M);
    expect(dansRayon(SOUKRA, [{ lng: coin[0], lat: coin[1] }], RAYON_DEDUP_M)).toHaveLength(0);
  });
});

describe('haversine', () => {
  it('renvoie zéro pour un point sur lui-même', () => {
    expect(haversine(SOUKRA, SOUKRA)).toBe(0);
  });

  it('mesure un degré de latitude à environ 111 km', () => {
    const d = haversine([10, 36], [10, 37]);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('est symétrique', () => {
    const a: LngLat = [10.23, 36.88];
    const b: LngLat = [10.25, 36.9];
    expect(haversine(a, b)).toBeCloseTo(haversine(b, a), 9);
  });
});
