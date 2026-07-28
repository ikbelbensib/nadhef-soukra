/**
 * Contexte de requête : appareil et session.
 *
 * Règle #5 — la consultation ne demande jamais de compte. L'authentification
 * est donc *optionnelle* partout, et chaque service décide lui-même de ce qu'il
 * exige. Rien n'échoue faute de jeton tant qu'on ne fait que lire.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { deviceIdSchema, type UserRole } from '@nadhef/shared';
import { chargerUtilisateur, verifierJeton, type UtilisateurSession } from '../services/auth.js';
import { badRequest, forbidden, unauthorized } from '../errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    deviceId?: string;
    user?: UtilisateurSession;
  }
}

/** Identifiant d'appareil, requis pour toute écriture anonyme. */
export const lireDevice: RequestHandler = (req, _res, next) => {
  const brut = req.header('X-Device-Id');
  if (brut !== undefined) {
    const parsed = deviceIdSchema.safeParse(brut);
    if (!parsed.success) {
      next(badRequest('INVALID_DEVICE_ID', 'erreurs.device_id_invalide'));
      return;
    }
    req.deviceId = parsed.data;
  }
  next();
};

/** Charge la session si un jeton valide est présent ; ne bloque jamais sinon. */
export function sessionOptionnelle(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const entete = req.header('Authorization');
    if (entete === undefined || !entete.startsWith('Bearer ')) {
      next();
      return;
    }
    void (async () => {
      try {
        const userId = await verifierJeton(entete.slice('Bearer '.length));
        if (userId !== null) {
          const user = await chargerUtilisateur(userId);
          if (user) req.user = user;
        }
        next();
      } catch (err) {
        // Un compte banni lève ici : l'erreur doit remonter, pas être ignorée.
        next(err);
      }
    })();
  };
}

/** Exige une session. À placer après `sessionOptionnelle`. */
export const exigerSession: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  next();
};

/** Exige un rôle. À placer après `exigerSession`. */
export function exigerRole(...roles: readonly UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden('FORBIDDEN_ROLE', 'erreurs.droits_insuffisants'));
      return;
    }
    next();
  };
}

/**
 * Exige de pouvoir identifier l'auteur : compte OU appareil.
 * Une écriture totalement anonyme et non traçable est refusée — c'est la seule
 * prise qui reste contre le spam quand aucun compte n'est requis.
 */
export const exigerAuteur: RequestHandler = (req, _res, next) => {
  if (!req.user && req.deviceId === undefined) {
    next(badRequest('DEVICE_ID_REQUIRED', 'erreurs.device_id_requis'));
    return;
  }
  next();
};
