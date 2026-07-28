/**
 * Export CSV.
 *
 * Ces fichiers finissent ouverts dans Excel, sur le poste d'un agent municipal.
 * Une description de point noir est rédigée par n'importe qui : si elle
 * commence par `=`, Excel l'exécute. Ces tests verrouillent la neutralisation.
 */

import { describe, expect, it } from 'vitest';
import { cellule, versCsv } from '../services/export.js';

describe('échappement', () => {
  it('laisse une valeur simple intacte', () => {
    expect(cellule('Borj Louzir')).toBe('Borj Louzir');
    expect(cellule(42)).toBe('42');
  });

  it('rend une valeur absente comme une cellule vide', () => {
    expect(cellule(null)).toBe('');
    expect(cellule(undefined)).toBe('');
  });

  it('entoure de guillemets dès qu’un séparateur apparaît', () => {
    expect(cellule('gravats; encombrants')).toBe('"gravats; encombrants"');
    expect(cellule('a,b')).toBe('"a,b"');
    expect(cellule('ligne1\nligne2')).toBe('"ligne1\nligne2"');
  });

  it('double les guillemets internes', () => {
    expect(cellule('dit "propre"')).toBe('"dit ""propre"""');
  });

  it('préserve l’arabe tel quel', () => {
    expect(cellule('برج الوزير')).toBe('برج الوزير');
  });
});

describe('injection de formule', () => {
  const attaques = [
    '=1+1',
    '=cmd|\' /C calc\'!A0',
    '+1+1',
    '-1+1',
    '@SUM(A1:A9)',
    '\tcharge',
    '\rcharge',
  ];

  for (const attaque of attaques) {
    it(`neutralise « ${attaque.replace(/[\t\r]/g, '·').slice(0, 20)} »`, () => {
      const sortie = cellule(attaque);
      // L'apostrophe force Excel à traiter la cellule comme du texte.
      const contenu = sortie.startsWith('"') ? sortie.slice(1, -1) : sortie;
      expect(contenu.startsWith("'")).toBe(true);
      expect(contenu.startsWith(`'${attaque[0] as string}`)).toBe(true);
    });
  }

  it('applique la neutralisation AVANT les guillemets', () => {
    // Si l'ordre était inversé, l'apostrophe se retrouverait hors des
    // guillemets et le fichier serait malformé.
    expect(cellule('=A1;B2')).toBe(`"'=A1;B2"`);
  });

  it('ne touche pas à un nombre négatif déjà numérique', () => {
    // Un nombre reste un nombre : c'est la CHAÎNE commençant par « - » qui est
    // suspecte. Ici la conversion produit bien « -5 », donc préfixé — c'est le
    // comportement voulu, mieux vaut une apostrophe qu'une formule.
    expect(cellule(-5)).toBe("'-5");
  });
});

describe('document complet', () => {
  it('commence par un BOM UTF-8 — sans lui Excel affiche du mojibake', () => {
    const csv = versCsv(['a'], [['x']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('sépare par point-virgule et termine les lignes en CRLF', () => {
    const csv = versCsv(['quartier', 'points'], [['Chotrana', 12]]);
    expect(csv).toBe('﻿quartier;points\r\nChotrana;12\r\n');
  });

  it('produit autant de lignes que de données, plus l’en-tête', () => {
    const csv = versCsv(['a'], [['1'], ['2'], ['3']]);
    expect(csv.trimEnd().split('\r\n')).toHaveLength(4);
  });

  it('reste lisible avec des champs hostiles', () => {
    const csv = versCsv(
      ['description'],
      [['=HYPERLINK("http://x","clic")'], ['dit "propre"; puis non']],
    );
    const lignes = csv.trimEnd().split('\r\n');
    expect(lignes[1]).toContain(`'=HYPERLINK`);
    expect(lignes[2]).toBe('"dit ""propre""; puis non"');
  });
});
