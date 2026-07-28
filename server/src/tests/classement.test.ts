/**
 * Classement par quartier.
 *
 * Deux propriétés à protéger, toutes deux contre-intuitives :
 *   · normaliser par habitant, sinon Chotrana (39 000 hab.) écrase tout ;
 *   · exiger un minimum d'activité, sinon un quartier à trois actions prend la
 *     tête au ratio et le classement perd tout sens.
 */

import { describe, expect, it } from 'vitest';
import { MIN_PARTICIPATIONS_CLASSEMENT } from '@nadhef/shared';
import { conditionRemplie } from '../services/badges.js';

/** Réimplémente le classement sur des données en mémoire, sans base. */
interface Entree {
  id: string;
  population: number;
  points: number;
  actions: number;
}

function classer(entrees: Entree[]): { id: string; rang: number | null; ratio: number }[] {
  const lignes = entrees.map((e) => ({
    id: e.id,
    ratio: Number(((e.points / e.population) * 1000).toFixed(2)),
    classe: e.actions >= MIN_PARTICIPATIONS_CLASSEMENT,
    rang: null as number | null,
  }));
  lignes.sort((a, b) => {
    if (a.classe !== b.classe) return a.classe ? -1 : 1;
    return b.ratio - a.ratio;
  });
  let rang = 0;
  for (const l of lignes) l.rang = l.classe ? ++rang : null;
  return lignes.map(({ id, rang: r, ratio }) => ({ id, rang: r, ratio }));
}

describe('normalisation par habitant', () => {
  it('un petit quartier très actif passe devant un gros quartier moyennement actif', () => {
    // C'est tout l'intérêt : sans normalisation, Chotrana gagnerait toujours.
    const resultat = classer([
      { id: 'chotrana', population: 39000, points: 3000, actions: 100 },
      { id: 'ettaamir', population: 11000, points: 1500, actions: 60 },
    ]);
    expect(resultat[0]?.id).toBe('ettaamir');
    expect(resultat[1]?.id).toBe('chotrana');
  });

  it('calcule un ratio pour 1 000 habitants', () => {
    const [ligne] = classer([{ id: 'q', population: 20000, points: 400, actions: 50 }]);
    expect(ligne?.ratio).toBe(20);
  });

  it('à ratio égal, les deux quartiers se valent', () => {
    const r = classer([
      { id: 'a', population: 10000, points: 200, actions: 40 },
      { id: 'b', population: 20000, points: 400, actions: 40 },
    ]);
    expect(r[0]?.ratio).toBe(r[1]?.ratio);
  });
});

describe('seuil d’activité', () => {
  it('écarte du podium un quartier sous le seuil, même avec un ratio énorme', () => {
    const resultat = classer([
      { id: 'minuscule', population: 500, points: 200, actions: MIN_PARTICIPATIONS_CLASSEMENT - 1 },
      { id: 'serieux', population: 30000, points: 900, actions: 80 },
    ]);
    expect(resultat[0]?.id).toBe('serieux');
    expect(resultat[0]?.rang).toBe(1);
    // Non classé, mais toujours visible : on ne cache pas un quartier.
    expect(resultat[1]?.id).toBe('minuscule');
    expect(resultat[1]?.rang).toBeNull();
  });

  it('classe dès que le seuil est atteint', () => {
    const resultat = classer([
      { id: 'a', population: 1000, points: 100, actions: MIN_PARTICIPATIONS_CLASSEMENT },
      { id: 'b', population: 30000, points: 900, actions: 80 },
    ]);
    expect(resultat[0]?.id).toBe('a');
    expect(resultat[0]?.rang).toBe(1);
  });

  it('numérote les rangs sans trou parmi les classés', () => {
    const resultat = classer([
      { id: 'a', population: 10000, points: 500, actions: 50 },
      { id: 'b', population: 10000, points: 300, actions: 50 },
      { id: 'hors', population: 10000, points: 900, actions: 1 },
      { id: 'c', population: 10000, points: 100, actions: 50 },
    ]);
    expect(resultat.filter((l) => l.rang !== null).map((l) => l.rang)).toEqual([1, 2, 3]);
    expect(resultat.find((l) => l.id === 'hors')?.rang).toBeNull();
  });
});

describe('conditions de badge', () => {
  it('évalue les opérateurs supportés', () => {
    expect(conditionRemplie({ op: '>=', value: 10 }, 10)).toBe(true);
    expect(conditionRemplie({ op: '>=', value: 10 }, 9)).toBe(false);
    expect(conditionRemplie({ op: '>', value: 10 }, 10)).toBe(false);
    expect(conditionRemplie({ op: '>', value: 10 }, 11)).toBe(true);
    expect(conditionRemplie({ op: '==', value: 1 }, 1)).toBe(true);
    expect(conditionRemplie({ op: '==', value: 1 }, 2)).toBe(false);
  });

  it('refuse plutôt que de deviner pour un opérateur inconnu', () => {
    expect(conditionRemplie({ op: '<', value: 10 }, 1)).toBe(false);
  });
});
