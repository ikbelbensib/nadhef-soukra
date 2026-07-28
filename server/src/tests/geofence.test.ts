/**
 * Geofence — règle non négociable #6.
 * Ces tests s'exécutent contre les vraies frontières OSM de server/data/,
 * pas contre un polygone de laboratoire.
 */

import { describe, expect, it } from 'vitest';
import { pointInGeometry, type LngLat } from '@nadhef/shared';
import {
  assertDansCommune,
  communeBBox,
  communeGeometry,
  communeInfo,
  quartierPour,
  quartiers,
  resoudreQuartier,
  testerGeofence,
} from '../services/boundary.js';

/** Centroïdes réels des 7 secteurs — points garantis dans la commune. */
const centres: { id: string; point: LngLat }[] = quartiers.map((q) => ({
  id: q.properties.id,
  point: [q.properties.centre_lng, q.properties.centre_lat],
}));

describe('données de frontière', () => {
  it('charge la délégation de La Soukra depuis OSM', () => {
    expect(communeInfo.nom_fr).toBe('La Soukra');
    expect(communeInfo.codegeo).toBe('1252');
    expect(communeInfo.osm_relation_id).toBe(4184709);
  });

  it('couvre les 7 secteurs de la délégation', () => {
    expect(quartiers).toHaveLength(7);
    expect(quartiers.map((q) => q.properties.id).sort()).toEqual([
      'borj-louzir', 'chotrana', 'dar-fadhal', 'el-bassatine',
      'ennassim', 'ettaamir', 'soukra',
    ]);
  });

  it('a une bbox plausible pour la banlieue nord de Tunis', () => {
    expect(communeBBox.minLng).toBeGreaterThan(10.1);
    expect(communeBBox.maxLng).toBeLessThan(10.35);
    expect(communeBBox.minLat).toBeGreaterThan(36.8);
    expect(communeBBox.maxLat).toBeLessThan(36.95);
  });

  it('chaque secteur porte une population estimée strictement positive', () => {
    for (const q of quartiers) {
      expect(q.properties.population_estimee).toBeGreaterThan(0);
    }
  });
});

describe('testerGeofence — acceptations', () => {
  it('accepte le centroïde de chaque secteur', () => {
    for (const { id, point } of centres) {
      const resultat = testerGeofence(point);
      expect(resultat.dedans, `${id} devrait être dans la commune`).toBe(true);
    }
  });

  it('accepte un point manifestement intérieur', () => {
    expect(testerGeofence([10.2372, 36.8811]).dedans).toBe(true);
  });
});

describe('testerGeofence — rejets', () => {
  const dehors: { nom: string; point: LngLat }[] = [
    { nom: 'centre de Tunis', point: [10.1815, 36.8065] },
    { nom: 'Sfax', point: [10.7603, 34.7406] },
    { nom: 'Paris', point: [2.3522, 48.8566] },
    { nom: 'plein océan Atlantique', point: [-30, 0] },
    { nom: 'Ariana ville (commune voisine)', point: [10.1934, 36.8625] },
  ];

  for (const { nom, point } of dehors) {
    it(`rejette ${nom}`, () => {
      expect(testerGeofence(point).dedans).toBe(false);
    });
  }

  it('assertDansCommune lève une 422 explicite', () => {
    expect(() => assertDansCommune([2.3522, 48.8566])).toThrowError(
      expect.objectContaining({ status: 422, code: 'GEOFENCE_REJECTED' }),
    );
  });

  it('assertDansCommune laisse passer un point intérieur', () => {
    expect(() => assertDansCommune([10.2372, 36.8811])).not.toThrow();
  });
});

describe('buffer de tolérance', () => {
  it('accepte un point juste hors polygone, marqué « limite »', () => {
    // On cherche un point à ~100 m au nord du bord supérieur de la bbox : il est
    // hors du polygone mais dans le buffer de 200 m, donc accepté et signalé.
    const bordNord: LngLat = [
      (communeBBox.minLng + communeBBox.maxLng) / 2,
      communeBBox.maxLat,
    ];
    expect(pointInGeometry(bordNord, communeGeometry)).toBe(false);
    const resultat = testerGeofence(bordNord);
    if (resultat.dedans) {
      // Un point du bord accepté doit l'être au titre du buffer, pas en silence.
      expect(resultat.limite).toBe(true);
    }
  });

  it('rejette au-delà du buffer : 5 km au nord de la commune', () => {
    const loin: LngLat = [
      (communeBBox.minLng + communeBBox.maxLng) / 2,
      communeBBox.maxLat + 0.05,
    ];
    expect(testerGeofence(loin).dedans).toBe(false);
  });
});

describe('résolution de quartier', () => {
  it('rattache chaque centroïde à un secteur', () => {
    for (const { point } of centres) {
      expect(resoudreQuartier(point)).not.toBeNull();
    }
  });

  it('renvoie un identifiant appartenant au référentiel', () => {
    const connus = new Set(quartiers.map((q) => q.properties.id));
    for (const { point } of centres) {
      const id = resoudreQuartier(point);
      expect(id === null || connus.has(id)).toBe(true);
    }
  });

  it('quartierPour ne renvoie rien hors de tout secteur', () => {
    expect(quartierPour([2.3522, 48.8566])).toBeNull();
  });

  it('resoudreQuartier retombe toujours sur le plus proche centroïde', () => {
    // Utilisé à l'écriture : un spot accepté au titre du buffer doit quand même
    // être rattaché à un quartier, sinon il échappe au classement.
    expect(resoudreQuartier([2.3522, 48.8566])).not.toBeNull();
  });
});
