/**
 * Décroissance des signalements (règle non négociable #2).
 *
 * La saleté est persistante : sans péremption, la carte devient un cimetière de
 * points rouges que personne ne traite — c'est ce qui a tué WeClean et Clean8.
 *
 * La fraîcheur est DÉRIVÉE de last_confirmed_at, jamais stockée comme source de
 * vérité. Si le job nocturne meurt, la carte reste juste. Le job n'écrit
 * `statut='a_verifier'` que pour les exports et les statistiques.
 */

import type { Freshness } from './types.js';

/** Sans reconfirmation au-delà de ce délai, le spot passe en « à vérifier ». */
export const JOURS_AVANT_A_VERIFIER = 45;
/** Au-delà, il sort de la vue par défaut (accessible via le filtre archives). */
export const JOURS_AVANT_ARCHIVE = 90;

/** Opacité du marqueur sur la carte, par niveau de fraîcheur. */
export const OPACITE_PAR_FRESHNESS: Record<Freshness, number> = {
  frais: 1,
  a_verifier: 0.4,
  archive: 0,
};

const MS_PAR_JOUR = 86_400_000;

export function joursDepuis(iso: string, now: Date = new Date()): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) throw new Error(`Date ISO invalide : « ${iso} »`);
  return (now.getTime() - then) / MS_PAR_JOUR;
}

/**
 * Fraîcheur d'un spot à l'instant `now`.
 * Les seuils sont stricts : à exactement 45 jours le spot est encore frais.
 */
export function freshness(lastConfirmedAt: string, now: Date = new Date()): Freshness {
  const jours = joursDepuis(lastConfirmedAt, now);
  if (jours > JOURS_AVANT_ARCHIVE) return 'archive';
  if (jours > JOURS_AVANT_A_VERIFIER) return 'a_verifier';
  return 'frais';
}

/** Un spot archivé n'est rendu que si l'appelant demande explicitement les archives. */
export function estVisibleParDefaut(lastConfirmedAt: string, now: Date = new Date()): boolean {
  return freshness(lastConfirmedAt, now) !== 'archive';
}

export function opacite(lastConfirmedAt: string, now: Date = new Date()): number {
  return OPACITE_PAR_FRESHNESS[freshness(lastConfirmedAt, now)];
}

/** Jours restants avant le prochain palier — utilisé par l'UI (« à vérifier dans 3 j »). */
export function joursAvantProchainPalier(
  lastConfirmedAt: string,
  now: Date = new Date(),
): number | null {
  const jours = joursDepuis(lastConfirmedAt, now);
  if (jours <= JOURS_AVANT_A_VERIFIER) return Math.ceil(JOURS_AVANT_A_VERIFIER - jours);
  if (jours <= JOURS_AVANT_ARCHIVE) return Math.ceil(JOURS_AVANT_ARCHIVE - jours);
  return null;
}

/** Expression SQL équivalente, pour calculer la fraîcheur directement au read. */
export const FRESHNESS_SQL = `CASE
  WHEN julianday('now') - julianday(last_confirmed_at) > ${JOURS_AVANT_ARCHIVE} THEN 'archive'
  WHEN julianday('now') - julianday(last_confirmed_at) > ${JOURS_AVANT_A_VERIFIER} THEN 'a_verifier'
  ELSE 'frais'
END`;
