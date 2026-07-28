/**
 * Code de présence rotatif.
 *
 * L'enjeu : un QR statique serait photographié et partagé dans le groupe
 * WhatsApp du quartier, et cinquante points iraient à des gens qui ne sont pas
 * venus. Ces tests vérifient que le code change bien, et qu'un code périmé ne
 * passe plus.
 */

import { describe, expect, it } from 'vitest';
import { PAS_TOTP_S } from '@nadhef/shared';
import { compteurPour, genererCode, secondesRestantes, verifierCode } from '../services/totp.js';

const SECRET = Buffer.from('chantier-borj-louzir-2026').toString('base64url');
const AUTRE_SECRET = Buffer.from('chantier-chotrana-2026').toString('base64url');

const a = (iso: string): Date => new Date(iso);

describe('génération', () => {
  it('produit six chiffres', () => {
    expect(genererCode(SECRET, a('2026-07-27T10:00:00Z'))).toMatch(/^\d{6}$/);
  });

  it('est déterministe pour un même instant', () => {
    const t = a('2026-07-27T10:00:00Z');
    expect(genererCode(SECRET, t)).toBe(genererCode(SECRET, t));
  });

  it('reste stable à l’intérieur d’une fenêtre de 30 s', () => {
    const debut = a('2026-07-27T10:00:00Z');
    const presqueFin = a('2026-07-27T10:00:29Z');
    expect(genererCode(SECRET, debut)).toBe(genererCode(SECRET, presqueFin));
  });

  it('change d’une fenêtre à l’autre', () => {
    const avant = a('2026-07-27T10:00:00Z');
    const apres = a('2026-07-27T10:00:30Z');
    expect(genererCode(SECRET, avant)).not.toBe(genererCode(SECRET, apres));
  });

  it('diffère d’un chantier à l’autre au même instant', () => {
    const t = a('2026-07-27T10:00:00Z');
    expect(genererCode(SECRET, t)).not.toBe(genererCode(AUTRE_SECRET, t));
  });
});

describe('compteur et compte à rebours', () => {
  it('avance d’une unité par pas', () => {
    const t0 = a('2026-07-27T10:00:00Z');
    const t1 = new Date(t0.getTime() + PAS_TOTP_S * 1000);
    expect(compteurPour(t1) - compteurPour(t0)).toBe(1);
  });

  it('annonce le temps restant avant rotation', () => {
    expect(secondesRestantes(a('2026-07-27T10:00:00Z'))).toBe(30);
    expect(secondesRestantes(a('2026-07-27T10:00:10Z'))).toBe(20);
    expect(secondesRestantes(a('2026-07-27T10:00:29Z'))).toBe(1);
  });
});

describe('vérification', () => {
  const t = a('2026-07-27T10:00:00Z');

  it('accepte le code de la fenêtre courante', () => {
    expect(verifierCode(SECRET, genererCode(SECRET, t), t)).toBe(true);
  });

  it('tolère une fenêtre d’écart, dans les deux sens', () => {
    // Les horloges de téléphones dérivent : sans tolérance, on refuserait des
    // présences légitimes en plein chantier.
    const avant = new Date(t.getTime() - PAS_TOTP_S * 1000);
    const apres = new Date(t.getTime() + PAS_TOTP_S * 1000);
    expect(verifierCode(SECRET, genererCode(SECRET, avant), t)).toBe(true);
    expect(verifierCode(SECRET, genererCode(SECRET, apres), t)).toBe(true);
  });

  it('refuse un code de deux fenêtres — donc une capture d’écran partagée', () => {
    const vieux = new Date(t.getTime() - 2 * PAS_TOTP_S * 1000);
    expect(verifierCode(SECRET, genererCode(SECRET, vieux), t)).toBe(false);
  });

  it('refuse franchement un code d’il y a dix minutes', () => {
    const tresVieux = new Date(t.getTime() - 600_000);
    expect(verifierCode(SECRET, genererCode(SECRET, tresVieux), t)).toBe(false);
  });

  it('refuse le code d’un autre chantier', () => {
    expect(verifierCode(SECRET, genererCode(AUTRE_SECRET, t), t)).toBe(false);
  });

  it('refuse les formats invalides sans lever d’exception', () => {
    for (const mauvais of ['', '12345', '1234567', 'abcdef', '12 34 56', '  ']) {
      expect(verifierCode(SECRET, mauvais, t)).toBe(false);
    }
  });

  it('tolère les espaces autour du code saisi', () => {
    expect(verifierCode(SECRET, `  ${genererCode(SECRET, t)}  `, t)).toBe(true);
  });

  it('ne laisse pas passer un code deviné au hasard', () => {
    // Sur 500 codes tirés, aucun ne doit passer : l'espace est de 10^6 et la
    // fenêtre d'acceptation ne couvre que 3 codes.
    let acceptes = 0;
    for (let i = 0; i < 500; i++) {
      const candidat = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      if (verifierCode(SECRET, candidat, t)) acceptes++;
    }
    expect(acceptes).toBeLessThanOrEqual(1);
  });
});
