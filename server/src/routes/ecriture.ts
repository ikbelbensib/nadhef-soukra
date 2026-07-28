/**
 * Routes d'écriture. L'authentification reste optionnelle (règle #5) :
 * le signalement anonyme est autorisé, il ne rapporte simplement aucun point.
 */

import { Router } from 'express';
import { z } from 'zod';
import express from 'express';
import {
  PHOTO_TAILLE_MAX_OCTETS,
  createConfirmationSchema,
  createReportSchema,
  createSpotSchema,
} from '@nadhef/shared';
import { asyncHandler } from '../middleware/error.js';
import { valid, validate } from '../middleware/validate.js';
import { exigerAuteur, exigerSession } from '../middleware/context.js';
import { limiteEcriture, limiteUpload } from '../middleware/rateLimit.js';
import { creerSpot } from '../services/spots.js';
import { confirmer, historique } from '../services/confirmations.js';
import { signaler } from '../services/moderation.js';
import { creerCompteLeger, rattacherContributionsAnonymes } from '../services/auth.js';
import { validerEtNettoyer } from '../services/images.js';
import { stockage } from '../services/storage.js';
import { badRequest } from '../errors.js';
import { resoudreQuartier } from '../services/boundary.js';

export const routerEcriture: Router = Router();

// --- Identité ---------------------------------------------------------------

const compteLegerSchema = z.object({
  pseudo: z.string().trim().min(2).max(32),
  quartier_id: z.string().min(1).max(64).optional(),
});

routerEcriture.post(
  '/auth/compte-leger',
  exigerAuteur,
  validate(compteLegerSchema),
  asyncHandler(async (req, res) => {
    const body = valid<typeof compteLegerSchema>(req);
    if (req.deviceId === undefined) {
      throw badRequest('DEVICE_ID_REQUIRED', 'erreurs.device_id_requis');
    }
    const { user, jeton } = await creerCompteLeger({
      pseudo: body.pseudo,
      deviceId: req.deviceId,
      quartierId: body.quartier_id ?? null,
    });
    // Les spots posés anonymement depuis cet appareil sont rattachés au compte,
    // mais sans points rétroactifs (cf. services/auth.ts).
    const rattaches = await rattacherContributionsAnonymes(user.id, req.deviceId);
    res.status(201).json({ user, token: jeton, spots_rattaches: rattaches });
  }),
);

routerEcriture.get('/me', exigerSession, (req, res) => {
  res.json({ user: req.user });
});

// --- Photos -----------------------------------------------------------------

routerEcriture.post(
  '/uploads',
  exigerAuteur,
  limiteUpload,
  // Corps binaire brut : le client envoie déjà un WebP compressé, inutile
  // d'ajouter une dépendance multipart pour un seul fichier.
  express.raw({ type: ['image/*', 'application/octet-stream'], limit: PHOTO_TAILLE_MAX_OCTETS }),
  asyncHandler(async (req, res) => {
    const corps = req.body as unknown;
    if (!Buffer.isBuffer(corps)) {
      throw badRequest('INVALID_UPLOAD', 'erreurs.image_vide');
    }
    // Format vérifié par signature et métadonnées EXIF retirées (adresse du
    // domicile potentiellement embarquée dans les photos de téléphone).
    const image = validerEtNettoyer(corps);
    const url = await stockage.enregistrer(image, 'spots');
    res.status(201).json({ url, format: image.format, octets: image.octets.length });
  }),
);

// --- Signalements -----------------------------------------------------------

routerEcriture.post(
  '/spots',
  exigerAuteur,
  limiteEcriture,
  validate(createSpotSchema),
  asyncHandler(async (req, res) => {
    const resultat = await creerSpot(valid<typeof createSpotSchema>(req), {
      user: req.user ?? null,
      deviceId: req.deviceId ?? null,
    });

    if (resultat.type === 'doublon') {
      // 200, pas 409 : ce n'est pas une erreur pour l'utilisateur. Le client
      // propose de reconfirmer le spot existant plutôt que de le bloquer.
      res.status(200).json({
        statut: 'doublon',
        message_key: 'signalement.doublon_detecte',
        spot: resultat.spot,
        distance_m: resultat.distance_m,
      });
      return;
    }

    res.status(201).json({
      statut: 'cree',
      spot: resultat.spot,
      points: resultat.points,
      recidive: resultat.recidive,
    });
  }),
);

routerEcriture.post(
  '/spots/:id/confirmations',
  exigerAuteur,
  limiteEcriture,
  validate(createConfirmationSchema),
  asyncHandler(async (req, res) => {
    const resultat = await confirmer(
      req.params.id as string,
      valid<typeof createConfirmationSchema>(req),
      { user: req.user ?? null, deviceId: req.deviceId ?? null },
    );
    res.status(201).json(resultat);
  }),
);

routerEcriture.get(
  '/spots/:id/confirmations',
  asyncHandler(async (req, res) => {
    res.json({ confirmations: await historique(req.params.id as string) });
  }),
);

// --- Signalements d'abus ----------------------------------------------------

routerEcriture.post(
  '/reports',
  exigerAuteur,
  limiteEcriture,
  validate(createReportSchema),
  asyncHandler(async (req, res) => {
    const resultat = await signaler(valid<typeof createReportSchema>(req), {
      user: req.user ?? null,
      deviceId: req.deviceId ?? null,
    });
    res.status(201).json(resultat);
  }),
);

// --- Utilitaire -------------------------------------------------------------

const positionSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/** Quartier correspondant à une position — l'écran de signalement l'affiche en direct. */
routerEcriture.get(
  '/quartier-pour',
  validate(positionSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { lat, lng } = valid<typeof positionSchema>(req, 'query');
    const { testerGeofence } = await import('../services/boundary.js');
    const geofence = testerGeofence([lng, lat]);
    res.json({
      dans_commune: geofence.dedans,
      limite: geofence.dedans && geofence.limite,
      quartier_id: geofence.dedans ? resoudreQuartier([lng, lat]) : null,
    });
  }),
);
