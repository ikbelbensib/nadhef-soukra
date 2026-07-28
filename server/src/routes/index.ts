/** Routes publiques. Règle #5 : la carte est lisible sans authentification. */

import { Router } from 'express';
import {
  BAREME,
  JOURS_AVANT_A_VERIFIER,
  JOURS_AVANT_ARCHIVE,
  NIVEAUX_GRAVITE,
  RAYON_DEDUP_M,
  SPOT_STATUTS,
  SPOT_TYPES,
  spotsQuerySchema,
  type SpotsQuery,
} from '@nadhef/shared';
import { all, count } from '../db/client.js';
import { asyncHandler } from '../middleware/error.js';
import { valid, validate } from '../middleware/validate.js';
import { communeGeometry, communeInfo, quartiers } from '../services/boundary.js';
import { getSpot, listSpots } from '../services/spots.js';
import { env } from '../env.js';
import { notFound } from '../errors.js';

export const router: Router = Router();

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [head, nbSpots] = await Promise.all([
      all<{ name: string }>('SELECT name FROM _migrations ORDER BY name DESC LIMIT 1'),
      count('SELECT COUNT(*) AS n FROM spots'),
    ]);
    res.json({
      status: 'ok',
      version: '0.1.0',
      migration_head: head[0]?.name ?? null,
      spots: nbSpots,
      commune: communeInfo.nom_fr,
      uptime_s: Math.round(process.uptime()),
    });
  }),
);

/** Tout ce dont le client a besoin pour se configurer en un appel. */
router.get('/config', (_req, res) => {
  res.json({
    commune: {
      nom_fr: communeInfo.nom_fr,
      nom_ar: communeInfo.nom_ar,
      codegeo: communeInfo.codegeo,
      osm_relation_id: communeInfo.osm_relation_id,
      bbox: communeInfo.bbox,
      centre: [
        (communeInfo.bbox.minLng + communeInfo.bbox.maxLng) / 2,
        (communeInfo.bbox.minLat + communeInfo.bbox.maxLat) / 2,
      ],
    },
    tiles: { pmtiles_url: env.PMTILES_URL },
    quartiers: quartiers.map((q) => ({
      id: q.properties.id,
      nom_fr: q.properties.nom_fr,
      nom_ar: q.properties.nom_ar,
      population_estimee: q.properties.population_estimee,
      centre: [q.properties.centre_lng, q.properties.centre_lat],
    })),
    referentiel: {
      types: SPOT_TYPES,
      statuts: SPOT_STATUTS,
      gravites: Object.values(NIVEAUX_GRAVITE),
    },
    regles: {
      jours_avant_a_verifier: JOURS_AVANT_A_VERIFIER,
      jours_avant_archive: JOURS_AVANT_ARCHIVE,
      rayon_dedup_m: RAYON_DEDUP_M,
      bareme: BAREME,
    },
  });
});

router.get('/quartiers', (_req, res) => {
  res.json({
    type: 'FeatureCollection',
    features: quartiers.map((q) => ({
      type: 'Feature',
      id: q.properties.id,
      properties: q.properties,
      geometry: q.geometry,
    })),
  });
});

/** Limite communale, pour dessiner le masque hors-commune sur la carte. */
router.get('/boundary', (_req, res) => {
  res.json({
    type: 'Feature',
    properties: { nom_fr: communeInfo.nom_fr, nom_ar: communeInfo.nom_ar },
    geometry: communeGeometry,
  });
});

router.get(
  '/spots',
  validate(spotsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await listSpots(valid<typeof spotsQuerySchema>(req, 'query') as SpotsQuery));
  }),
);

router.get(
  '/spots/:id',
  asyncHandler(async (req, res) => {
    const feature = await getSpot(req.params.id as string);
    if (!feature) throw notFound('SPOT_NOT_FOUND', 'erreurs.spot_introuvable');
    res.json(feature);
  }),
);
