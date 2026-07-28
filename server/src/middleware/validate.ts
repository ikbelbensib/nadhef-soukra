/** Validation Zod. Aucune entrée n'atteint un service sans passer par ici. */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError } from '../errors.js';

type Source = 'body' | 'query' | 'params';

declare module 'express-serve-static-core' {
  interface Request {
    valid?: Record<Source, unknown>;
  }
}

export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(zodToAppError(result.error));
      return;
    }
    req.valid = { ...(req.valid ?? {}), [source]: result.data } as Record<Source, unknown>;
    next();
  };
}

/** Récupère la valeur validée, typée. Échoue bruyamment si `validate` n'a pas tourné. */
export function valid<T extends ZodTypeAny>(req: Request, source: Source = 'body'): z.infer<T> {
  const value = req.valid?.[source];
  if (value === undefined) {
    throw new Error(`validate(${source}) n'a pas été appliqué à cette route`);
  }
  return value as z.infer<T>;
}

function zodToAppError(error: ZodError): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'erreurs.validation', {
    issues: error.issues.map((i) => ({
      champ: i.path.join('.') || '(racine)',
      code: i.code,
      message: i.message,
    })),
  });
}
