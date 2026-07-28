/**
 * Limitation de débit en mémoire, par fenêtre glissante.
 *
 * Sert de garde-fou générique contre l'abus mécanique (IP, appareil). Les
 * limites qui portent une règle métier — 10 signalements par jour, 1 par zone
 * de 30 m — vivent dans les services et s'appuient sur la base : elles doivent
 * survivre à un redémarrage et rester vraies avec plusieurs instances.
 */

import type { RequestHandler } from 'express';
import { tooManyRequests } from '../errors.js';

interface Fenetre {
  horodatages: number[];
}

const compteurs = new Map<string, Fenetre>();

/** Purge périodique : sans elle la table grossit indéfiniment. */
const NETTOYAGE_MS = 5 * 60_000;
setInterval(() => {
  const limite = Date.now() - 60 * 60_000;
  for (const [cle, fenetre] of compteurs) {
    fenetre.horodatages = fenetre.horodatages.filter((t) => t > limite);
    if (fenetre.horodatages.length === 0) compteurs.delete(cle);
  }
}, NETTOYAGE_MS).unref();

export interface OptionsLimite {
  fenetreMs: number;
  max: number;
  /** Clé de comptage. Par défaut l'IP. */
  cle?: (req: Parameters<RequestHandler>[0]) => string;
  code?: string;
  messageKey?: string;
}

export function rateLimit(options: OptionsLimite): RequestHandler {
  const {
    fenetreMs,
    max,
    cle = (req) => req.ip ?? 'inconnu',
    code = 'RATE_LIMITED',
    messageKey = 'erreurs.trop_de_requetes',
  } = options;

  return (req, res, next) => {
    const identifiant = `${code}:${cle(req)}`;
    const maintenant = Date.now();
    const fenetre = compteurs.get(identifiant) ?? { horodatages: [] };

    fenetre.horodatages = fenetre.horodatages.filter((t) => t > maintenant - fenetreMs);

    if (fenetre.horodatages.length >= max) {
      const plusAncien = fenetre.horodatages[0] ?? maintenant;
      const resteS = Math.ceil((plusAncien + fenetreMs - maintenant) / 1000);
      res.setHeader('Retry-After', String(resteS));
      next(tooManyRequests(code, messageKey, { retry_after_s: resteS }));
      return;
    }

    fenetre.horodatages.push(maintenant);
    compteurs.set(identifiant, fenetre);
    next();
  };
}

/** Limite globale par IP, appliquée à toute l'API. */
export const limiteGlobale = rateLimit({
  fenetreMs: 60_000,
  max: 300,
  code: 'RATE_LIMITED_IP',
});

/** Écritures : plus strict, et compté par appareil quand il est connu. */
export const limiteEcriture = rateLimit({
  fenetreMs: 60_000,
  max: 20,
  cle: (req) => req.user?.id ?? req.deviceId ?? req.ip ?? 'inconnu',
  code: 'RATE_LIMITED_WRITE',
});

/** Envoi d'images : coûteux en bande passante et en stockage. */
export const limiteUpload = rateLimit({
  fenetreMs: 60_000,
  max: 12,
  cle: (req) => req.user?.id ?? req.deviceId ?? req.ip ?? 'inconnu',
  code: 'RATE_LIMITED_UPLOAD',
});

/** Exposé pour les tests : remet les compteurs à zéro. */
export const reinitialiserLimites = (): void => compteurs.clear();
