/** Back-office. Toutes les routes exigent le rôle modérateur ou administrateur. */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { valid, validate } from '../middleware/validate.js';
import { exigerRole, exigerSession } from '../middleware/context.js';
import {
  bannir,
  fileModeration,
  journal,
  modererSpot,
  reintegrer,
  resoudreSignalement,
} from '../services/admin.js';
import { exportChantiers, exportQuartiers, exportSpots } from '../services/export.js';
import { all } from '../db/client.js';

export const routerAdmin: Router = Router();

// Le garde s'applique à tout le sous-arbre : impossible d'oublier une route.
routerAdmin.use('/admin', exigerSession, exigerRole('moderateur', 'admin'));

routerAdmin.get(
  '/admin/moderation/queue',
  asyncHandler(async (_req, res) => {
    res.json(await fileModeration());
  }),
);

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'hidden']),
  reason: z.string().trim().max(300).optional(),
});

routerAdmin.post(
  '/admin/spots/:id/moderate',
  validate(decisionSchema),
  asyncHandler(async (req, res) => {
    const { decision, reason } = valid<typeof decisionSchema>(req);
    res.json(await modererSpot(req.params.id as string, decision, reason, req.user!));
  }),
);

const resolutionSchema = z.object({ decision: z.enum(['traite', 'rejete']) });

routerAdmin.post(
  '/admin/reports/:id/resolve',
  validate(resolutionSchema),
  asyncHandler(async (req, res) => {
    const { decision } = valid<typeof resolutionSchema>(req);
    await resoudreSignalement(req.params.id as string, decision, req.user!);
    res.status(204).end();
  }),
);

routerAdmin.get(
  '/admin/reports',
  asyncHandler(async (_req, res) => {
    res.json({
      reports: await all(
        `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.statut,
                r.created_at, u.pseudo AS signale_par
           FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
          WHERE r.statut = 'ouvert'
          ORDER BY r.created_at DESC LIMIT 200`,
      ),
    });
  }),
);

const banSchema = z.object({ reason: z.string().trim().min(3).max(300) });

routerAdmin.post(
  '/admin/users/:id/ban',
  validate(banSchema),
  asyncHandler(async (req, res) => {
    await bannir(req.params.id as string, valid<typeof banSchema>(req).reason, req.user!);
    res.status(204).end();
  }),
);

routerAdmin.post(
  '/admin/users/:id/unban',
  asyncHandler(async (req, res) => {
    await reintegrer(req.params.id as string, req.user!);
    res.status(204).end();
  }),
);

routerAdmin.get(
  '/admin/audit',
  asyncHandler(async (_req, res) => {
    res.json({ entrees: await journal() });
  }),
);

// --- Exports ----------------------------------------------------------------

const EXPORTS = {
  spots: { fichier: 'points-noirs', generer: exportSpots },
  chantiers: { fichier: 'chantiers', generer: exportChantiers },
  quartiers: { fichier: 'synthese-quartiers', generer: exportQuartiers },
} as const;

routerAdmin.get(
  '/admin/export/:jeu.csv',
  asyncHandler(async (req, res) => {
    const jeu = req.params.jeu as keyof typeof EXPORTS;
    const config = EXPORTS[jeu];
    if (!config) {
      res.status(404).json({ error: { code: 'UNKNOWN_EXPORT', message_key: 'erreurs.introuvable' } });
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nadhef-soukra-${config.fichier}-${date}.csv"`,
    );
    res.send(await config.generer());
  }),
);
