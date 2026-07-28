/** Décroissance des signalements — règle non négociable #2. */

import { describe, expect, it } from 'vitest';
import {
  JOURS_AVANT_A_VERIFIER,
  JOURS_AVANT_ARCHIVE,
  estVisibleParDefaut,
  freshness,
  joursAvantProchainPalier,
  joursDepuis,
  opacite,
} from '@nadhef/shared';

const NOW = new Date('2026-07-27T12:00:00.000Z');
const ilYA = (jours: number): string =>
  new Date(NOW.getTime() - jours * 86_400_000).toISOString();

describe('freshness', () => {
  it('un spot confirmé à l’instant est frais', () => {
    expect(freshness(ilYA(0), NOW)).toBe('frais');
  });

  it('reste frais jusqu’au seuil inclus', () => {
    expect(freshness(ilYA(44.9), NOW)).toBe('frais');
    expect(freshness(ilYA(JOURS_AVANT_A_VERIFIER), NOW)).toBe('frais');
  });

  it('bascule en « à vérifier » juste après 45 jours', () => {
    expect(freshness(ilYA(45.1), NOW)).toBe('a_verifier');
    expect(freshness(ilYA(60), NOW)).toBe('a_verifier');
    expect(freshness(ilYA(JOURS_AVANT_ARCHIVE), NOW)).toBe('a_verifier');
  });

  it('bascule en archive juste après 90 jours', () => {
    expect(freshness(ilYA(90.1), NOW)).toBe('archive');
    expect(freshness(ilYA(365), NOW)).toBe('archive');
  });

  it('une date future ne casse pas le calcul', () => {
    expect(freshness(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW)).toBe('frais');
  });

  it('refuse une date invalide plutôt que de renvoyer un résultat silencieux', () => {
    expect(() => freshness('pas-une-date', NOW)).toThrow(/ISO invalide/);
  });
});

describe('opacité sur la carte', () => {
  it('applique 100 % / 40 % / masqué', () => {
    expect(opacite(ilYA(10), NOW)).toBe(1);
    expect(opacite(ilYA(50), NOW)).toBe(0.4);
    expect(opacite(ilYA(120), NOW)).toBe(0);
  });
});

describe('visibilité par défaut', () => {
  it('masque les spots archivés et garde les autres', () => {
    expect(estVisibleParDefaut(ilYA(10), NOW)).toBe(true);
    expect(estVisibleParDefaut(ilYA(50), NOW)).toBe(true);
    expect(estVisibleParDefaut(ilYA(91), NOW)).toBe(false);
  });

  it('une reconfirmation ramène un spot ancien dans la vue', () => {
    // Le point clé du mécanisme : c'est last_confirmed_at qui compte, pas created_at.
    const spotAncienMaisReconfirme = ilYA(2);
    expect(estVisibleParDefaut(spotAncienMaisReconfirme, NOW)).toBe(true);
    expect(freshness(spotAncienMaisReconfirme, NOW)).toBe('frais');
  });
});

describe('joursAvantProchainPalier', () => {
  it('compte vers le palier « à vérifier » puis vers l’archivage', () => {
    expect(joursAvantProchainPalier(ilYA(40), NOW)).toBe(5);
    expect(joursAvantProchainPalier(ilYA(80), NOW)).toBe(10);
  });

  it('ne renvoie plus rien une fois archivé', () => {
    expect(joursAvantProchainPalier(ilYA(120), NOW)).toBeNull();
  });
});

describe('joursDepuis', () => {
  it('mesure en jours fractionnaires', () => {
    expect(joursDepuis(ilYA(1.5), NOW)).toBeCloseTo(1.5, 6);
  });
});
