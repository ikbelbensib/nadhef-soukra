/** Gestionnaire d'erreurs terminal : toute erreur sort en JSON avec une clé i18n. */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../errors.js';
import { isProd } from '../env.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message_key: 'erreurs.route_introuvable' },
  });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message_key: err.messageKey,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Une erreur non prévue est un bug : on la journalise entière côté serveur et
  // on ne renvoie rien d'exploitable au client.
  console.error('✗ Erreur non gérée :', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message_key: 'erreurs.interne',
      ...(isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
  });
};

/** Enrobe un handler async pour que les rejets partent bien dans le gestionnaire. */
export const asyncHandler =
  <T extends RequestHandler>(handler: T): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
