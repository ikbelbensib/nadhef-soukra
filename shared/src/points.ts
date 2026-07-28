/**
 * Barème et garde-fous anti-farming (règle non négociable #4).
 *
 * « Les points récompensent la présence vérifiée, pas le signalement. »
 * Chaque fonction ici est une décision pure : le service serveur l'appelle puis
 * écrit dans le ledger `point_events`, dont la contrainte UNIQUE garantit
 * l'idempotence. Aucun UPDATE aveugle sur users.points.
 */

import type { PointAction } from './types.js';
import {
  JOURS_AVANT_A_VERIFIER,
} from './freshness.js';
import {
  MIN_PRESENTS_ORGANISATION,
  PLAFOND_POINTS_CONFIRMATION_JOUR,
  RAYON_RECONFIRMATION_M,
} from './limits.js';

export const BAREME: Record<PointAction, number> = {
  spot_cree: 5,
  spot_reconfirme: 1,
  participation: 50,
  organisation: 150,
  spot_ferme: 25,
};

export const RAISONS_REFUS = [
  'anonyme',
  'trop_loin',
  'position_absente',
  'plafond_quotidien',
  'deja_confirme_recemment',
  'moderation_en_attente',
  'presence_non_verifiee',
  'auto_attribution',
  'preuves_manquantes',
  'participants_insuffisants',
] as const;
export type RaisonRefus = (typeof RAISONS_REFUS)[number];

export type DecisionPoints =
  | { attribue: true; action: PointAction; points: number }
  | { attribue: false; action: PointAction; raison: RaisonRefus };

const accorde = (action: PointAction): DecisionPoints => ({
  attribue: true,
  action,
  points: BAREME[action],
});
const refuse = (action: PointAction, raison: RaisonRefus): DecisionPoints => ({
  attribue: false,
  action,
  raison,
});

/**
 * Création d'un spot : 5 points, mais seulement à l'APPROBATION.
 * Créditer à la création rendrait le spam de signalements rentable.
 * Le signalement anonyme ne rapporte rien — c'est l'incitation au compte.
 */
export function deciderSpotCree(ctx: {
  estAuthentifie: boolean;
  moderationApprouvee: boolean;
}): DecisionPoints {
  if (!ctx.estAuthentifie) return refuse('spot_cree', 'anonyme');
  if (!ctx.moderationApprouvee) return refuse('spot_cree', 'moderation_en_attente');
  return accorde('spot_cree');
}

/**
 * Reconfirmation : 1 point, sous trois garde-fous cumulés.
 * Sans eux, le classement se gagne depuis un canapé en tapotant la carte —
 * exactement le mode d'échec que la règle #4 cherche à éviter.
 */
export function deciderReconfirmation(ctx: {
  estAuthentifie: boolean;
  distanceMetres: number | null;
  pointsConfirmationAujourdhui: number;
  derniereConfirmationSurCeSpot: string | null;
  now?: Date;
}): DecisionPoints {
  if (!ctx.estAuthentifie) return refuse('spot_reconfirme', 'anonyme');
  if (ctx.distanceMetres === null) return refuse('spot_reconfirme', 'position_absente');
  if (ctx.distanceMetres > RAYON_RECONFIRMATION_M) {
    return refuse('spot_reconfirme', 'trop_loin');
  }
  if (ctx.pointsConfirmationAujourdhui >= PLAFOND_POINTS_CONFIRMATION_JOUR) {
    return refuse('spot_reconfirme', 'plafond_quotidien');
  }
  if (ctx.derniereConfirmationSurCeSpot !== null) {
    const now = ctx.now ?? new Date();
    const jours =
      (now.getTime() - Date.parse(ctx.derniereConfirmationSurCeSpot)) / 86_400_000;
    // Un même spot ne rapporte qu'une fois par cycle de péremption : le geste
    // n'a de valeur que s'il porte une information nouvelle.
    if (jours < JOURS_AVANT_A_VERIFIER) {
      return refuse('spot_reconfirme', 'deja_confirme_recemment');
    }
  }
  return accorde('spot_reconfirme');
}

/**
 * Participation : 50 points, uniquement sur présence vérifiée (QR ou géo).
 * L'organisateur ne peut pas se check-in lui-même — il est payé par
 * `deciderOrganisation`, sur résultat.
 */
export function deciderParticipation(ctx: {
  presenceVerifiee: boolean;
  estOrganisateur: boolean;
}): DecisionPoints {
  if (ctx.estOrganisateur) return refuse('participation', 'auto_attribution');
  if (!ctx.presenceVerifiee) return refuse('participation', 'presence_non_verifiee');
  return accorde('participation');
}

/** Organisation : 150 points à la clôture, sur preuve avant/après et mobilisation réelle. */
export function deciderOrganisation(ctx: {
  aPhotoAvant: boolean;
  aPhotoApres: boolean;
  nombrePresents: number;
}): DecisionPoints {
  if (!ctx.aPhotoAvant || !ctx.aPhotoApres) {
    return refuse('organisation', 'preuves_manquantes');
  }
  if (ctx.nombrePresents < MIN_PRESENTS_ORGANISATION) {
    return refuse('organisation', 'participants_insuffisants');
  }
  return accorde('organisation');
}

/** Fermeture d'un spot avec preuve photo avant/après : 25 points. */
export function deciderFermetureSpot(ctx: {
  estAuthentifie: boolean;
  aPhotoAvant: boolean;
  aPhotoApres: boolean;
}): DecisionPoints {
  if (!ctx.estAuthentifie) return refuse('spot_ferme', 'anonyme');
  if (!ctx.aPhotoAvant || !ctx.aPhotoApres) {
    return refuse('spot_ferme', 'preuves_manquantes');
  }
  return accorde('spot_ferme');
}
