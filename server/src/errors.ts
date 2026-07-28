/**
 * Erreurs applicatives. Le client ne reçoit jamais de texte, seulement une clé
 * i18n — toutes les chaînes affichées passent par i18next (règle de code).
 */

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`${code}: ${messageKey}`);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, key: string, details?: Record<string, unknown>) =>
  new AppError(400, code, key, details);

export const unauthorized = (key = 'erreurs.authentification_requise') =>
  new AppError(401, 'UNAUTHORIZED', key);

export const forbidden = (code: string, key: string, details?: Record<string, unknown>) =>
  new AppError(403, code, key, details);

export const notFound = (code = 'NOT_FOUND', key = 'erreurs.introuvable') =>
  new AppError(404, code, key);

export const conflict = (code: string, key: string, details?: Record<string, unknown>) =>
  new AppError(409, code, key, details);

export const unprocessable = (code: string, key: string, details?: Record<string, unknown>) =>
  new AppError(422, code, key, details);

export const tooManyRequests = (code: string, key: string, details?: Record<string, unknown>) =>
  new AppError(429, code, key, details);
