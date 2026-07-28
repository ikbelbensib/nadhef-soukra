/**
 * Barème et garde-fous anti-farming — règle non négociable #4.
 * « Les points récompensent la présence vérifiée, pas le signalement. »
 */

import { describe, expect, it } from 'vitest';
import {
  BAREME,
  MIN_PRESENTS_ORGANISATION,
  PLAFOND_POINTS_CONFIRMATION_JOUR,
  RAYON_RECONFIRMATION_M,
  deciderFermetureSpot,
  deciderOrganisation,
  deciderParticipation,
  deciderReconfirmation,
  deciderSpotCree,
} from '@nadhef/shared';

const NOW = new Date('2026-07-27T12:00:00.000Z');
const ilYA = (jours: number): string =>
  new Date(NOW.getTime() - jours * 86_400_000).toISOString();

describe('barème', () => {
  it('respecte les valeurs du cahier des charges', () => {
    expect(BAREME).toEqual({
      spot_cree: 5,
      spot_reconfirme: 1,
      participation: 50,
      organisation: 150,
      spot_ferme: 25,
    });
  });

  it('valorise la présence bien au-dessus du signalement', () => {
    // C'est tout l'équilibre du produit : signaler doit rapporter dix fois
    // moins que se déplacer.
    expect(BAREME.participation).toBeGreaterThan(BAREME.spot_cree * 5);
    expect(BAREME.organisation).toBeGreaterThan(BAREME.participation);
  });
});

describe('création de spot', () => {
  it('ne rapporte rien tant que la modération n’a pas approuvé', () => {
    const d = deciderSpotCree({ estAuthentifie: true, moderationApprouvee: false });
    expect(d.attribue).toBe(false);
    expect(d.attribue === false && d.raison).toBe('moderation_en_attente');
  });

  it('rapporte 5 points à l’approbation', () => {
    const d = deciderSpotCree({ estAuthentifie: true, moderationApprouvee: true });
    expect(d).toEqual({ attribue: true, action: 'spot_cree', points: 5 });
  });

  it('ne rapporte jamais rien à un signalement anonyme', () => {
    // Règle #5 : l'anonymat est autorisé, mais c'est le compte qui est incité.
    const d = deciderSpotCree({ estAuthentifie: false, moderationApprouvee: true });
    expect(d.attribue).toBe(false);
    expect(d.attribue === false && d.raison).toBe('anonyme');
  });
});

describe('reconfirmation', () => {
  const base = {
    estAuthentifie: true,
    distanceMetres: 20,
    pointsConfirmationAujourdhui: 0,
    derniereConfirmationSurCeSpot: null,
    now: NOW,
  };

  it('rapporte 1 point sur place', () => {
    expect(deciderReconfirmation(base)).toEqual({
      attribue: true,
      action: 'spot_reconfirme',
      points: 1,
    });
  });

  it('accepte jusqu’au rayon exact et refuse au-delà', () => {
    expect(deciderReconfirmation({ ...base, distanceMetres: RAYON_RECONFIRMATION_M }).attribue).toBe(true);
    const trop = deciderReconfirmation({ ...base, distanceMetres: RAYON_RECONFIRMATION_M + 1 });
    expect(trop.attribue).toBe(false);
    expect(trop.attribue === false && trop.raison).toBe('trop_loin');
  });

  it('refuse sans position : c’est la seule preuve de présence disponible', () => {
    const d = deciderReconfirmation({ ...base, distanceMetres: null });
    expect(d.attribue === false && d.raison).toBe('position_absente');
  });

  it('applique le plafond quotidien', () => {
    const juste = deciderReconfirmation({
      ...base,
      pointsConfirmationAujourdhui: PLAFOND_POINTS_CONFIRMATION_JOUR - 1,
    });
    expect(juste.attribue).toBe(true);

    const trop = deciderReconfirmation({
      ...base,
      pointsConfirmationAujourdhui: PLAFOND_POINTS_CONFIRMATION_JOUR,
    });
    expect(trop.attribue === false && trop.raison).toBe('plafond_quotidien');
  });

  it('ne repaie pas le même spot avant la fin du cycle de péremption', () => {
    const recent = deciderReconfirmation({ ...base, derniereConfirmationSurCeSpot: ilYA(10) });
    expect(recent.attribue === false && recent.raison).toBe('deja_confirme_recemment');

    // Passé 45 jours, l'information redevient neuve : le geste est à nouveau utile.
    expect(deciderReconfirmation({ ...base, derniereConfirmationSurCeSpot: ilYA(46) }).attribue).toBe(true);
  });

  it('ne rapporte rien à un anonyme', () => {
    const d = deciderReconfirmation({ ...base, estAuthentifie: false });
    expect(d.attribue === false && d.raison).toBe('anonyme');
  });

  it('un utilisateur immobile ne peut pas dépasser le plafond quotidien', () => {
    // Simule une session de farming : 50 tentatives depuis chez soi.
    let gagnes = 0;
    for (let i = 0; i < 50; i++) {
      const d = deciderReconfirmation({
        ...base,
        distanceMetres: 3000,
        pointsConfirmationAujourdhui: gagnes,
      });
      if (d.attribue) gagnes += d.points;
    }
    expect(gagnes).toBe(0);
  });
});

describe('participation', () => {
  it('exige une présence vérifiée', () => {
    const d = deciderParticipation({ presenceVerifiee: false, estOrganisateur: false });
    expect(d.attribue === false && d.raison).toBe('presence_non_verifiee');
  });

  it('rapporte 50 points sur présence vérifiée', () => {
    expect(deciderParticipation({ presenceVerifiee: true, estOrganisateur: false }).attribue).toBe(true);
  });

  it('interdit à l’organisateur de se pointer lui-même', () => {
    // Il est rémunéré sur résultat par deciderOrganisation, pas sur présence.
    const d = deciderParticipation({ presenceVerifiee: true, estOrganisateur: true });
    expect(d.attribue === false && d.raison).toBe('auto_attribution');
  });
});

describe('organisation', () => {
  const base = { aPhotoAvant: true, aPhotoApres: true, nombrePresents: 5 };

  it('rapporte 150 points sur chantier mené à terme', () => {
    expect(deciderOrganisation(base)).toEqual({
      attribue: true,
      action: 'organisation',
      points: 150,
    });
  });

  it('exige les deux photos', () => {
    expect(deciderOrganisation({ ...base, aPhotoApres: false }).attribue).toBe(false);
    expect(deciderOrganisation({ ...base, aPhotoAvant: false }).attribue).toBe(false);
  });

  it('exige une mobilisation réelle', () => {
    const d = deciderOrganisation({ ...base, nombrePresents: MIN_PRESENTS_ORGANISATION - 1 });
    expect(d.attribue === false && d.raison).toBe('participants_insuffisants');
  });
});

describe('fermeture de spot', () => {
  it('exige la preuve avant/après', () => {
    const d = deciderFermetureSpot({ estAuthentifie: true, aPhotoAvant: true, aPhotoApres: false });
    expect(d.attribue === false && d.raison).toBe('preuves_manquantes');
  });

  it('rapporte 25 points avec les deux preuves', () => {
    expect(
      deciderFermetureSpot({ estAuthentifie: true, aPhotoAvant: true, aPhotoApres: true }),
    ).toEqual({ attribue: true, action: 'spot_ferme', points: 25 });
  });
});
