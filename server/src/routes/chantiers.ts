/** Chantiers et vérification du numéro. */

import { Router } from 'express';
import {
  checkinSchema,
  clotureEventSchema,
  createEventSchema,
  demandeOtpSchema,
  eventsQuerySchema,
  verificationOtpSchema,
} from '@nadhef/shared';
import { asyncHandler } from '../middleware/error.js';
import { valid, validate } from '../middleware/validate.js';
import { exigerSession } from '../middleware/context.js';
import { limiteEcriture, rateLimit } from '../middleware/rateLimit.js';
import {
  annulerEvent,
  checkin,
  cloturerEvent,
  codePresence,
  creerEvent,
  getEvent,
  listerEvents,
  listerParticipants,
  publierEvent,
  sInscrire,
  seDesinscrire,
} from '../services/events.js';
import { demanderCode, verifierCode } from '../services/otp.js';
import { notFound } from '../errors.js';

export const routerChantiers: Router = Router();

// --- Vérification du numéro -------------------------------------------------

const limiteOtp = rateLimit({
  fenetreMs: 60 * 60_000,
  max: 6,
  cle: (req) => req.deviceId ?? req.ip ?? 'inconnu',
  code: 'OTP_DEVICE_LIMIT',
  messageKey: 'erreurs.trop_de_codes',
});

routerChantiers.post(
  '/auth/otp/demander',
  limiteOtp,
  validate(demandeOtpSchema),
  asyncHandler(async (req, res) => {
    const { telephone } = valid<typeof demandeOtpSchema>(req);
    res.json(await demanderCode(telephone));
  }),
);

routerChantiers.post(
  '/auth/otp/verifier',
  limiteOtp,
  validate(verificationOtpSchema),
  asyncHandler(async (req, res) => {
    const { telephone, code } = valid<typeof verificationOtpSchema>(req);
    const resultat = await verifierCode({
      telephone,
      code,
      utilisateurCourant: req.user ?? null,
    });
    res.json({ user: resultat.user, token: resultat.jeton });
  }),
);

// --- Lecture publique -------------------------------------------------------

routerChantiers.get(
  '/events',
  validate(eventsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ events: await listerEvents(valid<typeof eventsQuerySchema>(req, 'query')) });
  }),
);

routerChantiers.get(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const event = await getEvent(req.params.id as string);
    // Un brouillon n'est visible que de son organisateur.
    if (!event || (event.statut === 'brouillon' && event.organisateur.id !== req.user?.id)) {
      throw notFound('EVENT_NOT_FOUND', 'erreurs.chantier_introuvable');
    }
    res.json(event);
  }),
);

// --- Écriture ---------------------------------------------------------------

routerChantiers.post(
  '/events',
  exigerSession,
  limiteEcriture,
  validate(createEventSchema),
  asyncHandler(async (req, res) => {
    const event = await creerEvent(valid<typeof createEventSchema>(req), req.user!);
    res.status(201).json(event);
  }),
);

routerChantiers.post(
  '/events/:id/publier',
  exigerSession,
  limiteEcriture,
  asyncHandler(async (req, res) => {
    res.json(await publierEvent(req.params.id as string, req.user!));
  }),
);

routerChantiers.post(
  '/events/:id/annuler',
  exigerSession,
  limiteEcriture,
  asyncHandler(async (req, res) => {
    res.json(await annulerEvent(req.params.id as string, req.user!));
  }),
);

routerChantiers.post(
  '/events/:id/inscription',
  exigerSession,
  limiteEcriture,
  asyncHandler(async (req, res) => {
    res.status(201).json(await sInscrire(req.params.id as string, req.user!));
  }),
);

routerChantiers.delete(
  '/events/:id/inscription',
  exigerSession,
  asyncHandler(async (req, res) => {
    await seDesinscrire(req.params.id as string, req.user!);
    res.status(204).end();
  }),
);

/** Code rotatif affiché par l'organisateur — jamais mis en cache. */
routerChantiers.get(
  '/events/:id/code',
  exigerSession,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await codePresence(req.params.id as string, req.user!));
  }),
);

routerChantiers.post(
  '/events/:id/checkin',
  exigerSession,
  limiteEcriture,
  validate(checkinSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(await checkin(req.params.id as string, valid<typeof checkinSchema>(req), req.user!));
  }),
);

routerChantiers.get(
  '/events/:id/participants',
  exigerSession,
  asyncHandler(async (req, res) => {
    res.json({ participants: await listerParticipants(req.params.id as string, req.user!) });
  }),
);

routerChantiers.post(
  '/events/:id/cloture',
  exigerSession,
  limiteEcriture,
  validate(clotureEventSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await cloturerEvent(req.params.id as string, valid<typeof clotureEventSchema>(req), req.user!),
    );
  }),
);
