/**
 * Gravité 1→4 : pilote la couleur du marqueur et le poids dans le heatmap.
 *
 * La palette de l'interface reste en neutres froids ; la couleur est réservée à
 * la gravité, pour rester lisible en plein soleil.
 */

import type { Gravite } from './types.js';

export interface NiveauGravite {
  niveau: Gravite;
  /** Clé i18n — jamais de texte en dur. */
  labelKey: string;
  couleur: string;
  /** Poids dans le calque heatmap, normalisé 0→1. */
  poidsHeatmap: number;
}

export const NIVEAUX_GRAVITE: Record<Gravite, NiveauGravite> = {
  1: { niveau: 1, labelKey: 'gravite.1', couleur: '#16a34a', poidsHeatmap: 0.25 },
  2: { niveau: 2, labelKey: 'gravite.2', couleur: '#eab308', poidsHeatmap: 0.5 },
  3: { niveau: 3, labelKey: 'gravite.3', couleur: '#f97316', poidsHeatmap: 0.75 },
  4: { niveau: 4, labelKey: 'gravite.4', couleur: '#dc2626', poidsHeatmap: 1 },
};

export const couleurGravite = (g: Gravite): string => NIVEAUX_GRAVITE[g].couleur;
export const poidsHeatmap = (g: Gravite): number => NIVEAUX_GRAVITE[g].poidsHeatmap;

export function estGravite(n: number): n is Gravite {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

/** Expression MapLibre pour colorer les marqueurs selon la gravité. */
export const EXPRESSION_COULEUR_GRAVITE = [
  'match',
  ['get', 'gravite'],
  1,
  NIVEAUX_GRAVITE[1].couleur,
  2,
  NIVEAUX_GRAVITE[2].couleur,
  3,
  NIVEAUX_GRAVITE[3].couleur,
  4,
  NIVEAUX_GRAVITE[4].couleur,
  '#64748b',
] as const;
