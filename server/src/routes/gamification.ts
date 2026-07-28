/** Classements, badges et statistiques. Tout est public (règle #5). */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { valid, validate } from '../middleware/validate.js';
import { exigerSession } from '../middleware/context.js';
import {
  classementCitoyens,
  classementQuartiers,
  rangPersonnel,
  type Periode,
} from '../services/leaderboard.js';
import { badgesDe, catalogue, evaluerBadges } from '../services/badges.js';
import { statsPubliques } from '../services/stats.js';
import { communeInfo } from '../services/boundary.js';
import { all, one } from '../db/client.js';
import { notFound } from '../errors.js';

export const routerGamification: Router = Router();

const periodeSchema = z.object({
  periode: z.enum(['30d', '90d', 'all']).default('90d'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

routerGamification.get(
  '/leaderboard/quartiers',
  validate(periodeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { periode } = valid<typeof periodeSchema>(req, 'query');
    res.json(await classementQuartiers(periode as Periode));
  }),
);

routerGamification.get(
  '/leaderboard/citoyens',
  validate(periodeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { periode, limit } = valid<typeof periodeSchema>(req, 'query');
    res.json(await classementCitoyens(periode as Periode, limit));
  }),
);

/** Rang personnel, y compris pour un compte non vérifié absent du classement. */
routerGamification.get(
  '/me/rang',
  exigerSession,
  validate(periodeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { periode } = valid<typeof periodeSchema>(req, 'query');
    res.json(await rangPersonnel(req.user!.id, periode as Periode));
  }),
);

routerGamification.get(
  '/badges',
  asyncHandler(async (_req, res) => {
    res.json({ badges: await catalogue() });
  }),
);

routerGamification.get(
  '/me/badges',
  exigerSession,
  asyncHandler(async (req, res) => {
    // On réévalue à la lecture, pas seulement au gain de points. Certains
    // badges dépendent d'un fait produit par quelqu'un d'autre — les kilos
    // collectés sont saisis par l'organisateur, longtemps après le check-in du
    // participant. Sans cette réévaluation, le badge n'arriverait qu'au
    // prochain point gagné, ou jamais.
    const nouveaux = await evaluerBadges(req.user!.id);
    res.json({ badges: await badgesDe(req.user!.id), nouveaux: nouveaux.map((b) => b.code) });
  }),
);

/** Profil public : jamais de téléphone, jamais d'identifiant d'appareil. */
routerGamification.get(
  '/users/:id/profile',
  asyncHandler(async (req, res) => {
    const user = await one<{
      id: string;
      pseudo: string;
      quartier_id: string | null;
      points: number;
      created_at: string;
    }>(
      `SELECT id, pseudo, quartier_id, points, created_at
         FROM users WHERE id = ? AND banned_at IS NULL`,
      [req.params.id as string],
    );
    if (!user) throw notFound('USER_NOT_FOUND', 'erreurs.introuvable');

    const [badges, actions] = await Promise.all([
      badgesDe(user.id),
      all<{ action: string; n: number; points: number }>(
        `SELECT action, COUNT(*) AS n, SUM(points) AS points
           FROM point_events WHERE user_id = ? GROUP BY action`,
        [user.id],
      ),
    ]);

    res.json({
      user,
      badges,
      actions: actions.map((a) => ({
        action: a.action,
        nombre: Number(a.n),
        points: Number(a.points),
      })),
    });
  }),
);

routerGamification.get(
  '/stats/public',
  asyncHandler(async (_req, res) => {
    // Cache court côté client aussi : cette page est faite pour être partagée.
    res.set('Cache-Control', 'public, max-age=300');
    res.json(await statsPubliques(communeInfo.nom_fr));
  }),
);
