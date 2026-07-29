/**
 * Parité des traductions.
 *
 * Deux pièges que la relecture humaine ne voit pas :
 *
 * 1. Une clé ajoutée d'un seul côté. i18next retombe alors sur l'arabe
 *    (`fallbackLng`), et une interface française affiche de l'arabe sans que
 *    rien ne signale l'erreur.
 *
 * 2. Les pluriels arabes. L'arabe a six catégories — zero, one, two, few, many,
 *    other — là où le français en a deux. Si elles manquent, i18next se rabat
 *    sur la forme unique et affiche « 2 نقطة » au lieu de « نقطتان », ou
 *    « 3 نقطة » au lieu de « 3 نقاط ». Aucune erreur, juste une langue fausse
 *    dans la langue par défaut de l'application.
 *
 * Les fichiers sont lus depuis le disque : le serveur ne dépend pas du client,
 * on ne fait que constater l'état du dépôt.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const I18N = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'client', 'src', 'i18n');

type Arbre = { [k: string]: string | Arbre };

const charger = (nom: string): Arbre =>
  JSON.parse(readFileSync(join(I18N, `${nom}.json`), 'utf8')) as Arbre;

/** Aplatit `{a:{b:'x'}}` en `['a.b']`. */
function chemins(arbre: Arbre, prefixe = ''): string[] {
  return Object.entries(arbre).flatMap(([cle, valeur]) =>
    typeof valeur === 'string' ? [prefixe + cle] : chemins(valeur, `${prefixe}${cle}.`),
  );
}

const fr = charger('fr');
const ar = charger('ar');
const clesFr = new Set(chemins(fr));
const clesAr = new Set(chemins(ar));

/** Catégories exigées par Intl.PluralRules pour l'arabe. */
const FORMES_ARABES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

/** Une clé est « comptée » si le français en donne une variante plurielle. */
const clesComptees = [...clesFr]
  .filter((k) => k.endsWith('_other'))
  .map((k) => k.slice(0, -'_other'.length));

describe('traductions', () => {
  it('les deux langues couvrent les mêmes clés de base', () => {
    const suffixes = new RegExp(`_(${FORMES_ARABES.join('|')})$`);
    const base = (s: Set<string>): Set<string> =>
      new Set([...s].map((k) => k.replace(suffixes, '')));

    const baseFr = base(clesFr);
    const baseAr = base(clesAr);
    expect([...baseFr].filter((k) => !baseAr.has(k))).toEqual([]);
    expect([...baseAr].filter((k) => !baseFr.has(k))).toEqual([]);
  });

  it('chaque clé comptée possède les six formes arabes', () => {
    expect(clesComptees.length).toBeGreaterThan(0);
    const manquantes = clesComptees.flatMap((base) =>
      FORMES_ARABES.filter((f) => !clesAr.has(`${base}_${f}`)).map((f) => `${base}_${f}`),
    );
    expect(manquantes).toEqual([]);
  });

  it('aucune traduction vide', () => {
    const valeur = (arbre: Arbre, chemin: string): string =>
      chemin.split('.').reduce<Arbre | string>((n, c) => (n as Arbre)[c] ?? '', arbre) as string;
    for (const cles of [
      { langue: 'fr', arbre: fr, liste: clesFr },
      { langue: 'ar', arbre: ar, liste: clesAr },
    ]) {
      for (const k of cles.liste) {
        expect(valeur(cles.arbre, k).trim(), `${cles.langue} · ${k}`).not.toBe('');
      }
    }
  });

  it("les formes arabes qui n'affichent pas le nombre ne gardent pas d'interpolation orpheline", () => {
    // `one` et `two` disent « نقطة واحدة » / « نقطتان » sans chiffre : y laisser
    // {{count}} afficherait « 1 نقطة واحدة ».
    for (const base of clesComptees) {
      for (const forme of ['one', 'two'] as const) {
        const texte = ar[base.split('.')[0] as string] as Arbre | undefined;
        const brut = texte?.[`${base.split('.').slice(1).join('.')}_${forme}`];
        if (typeof brut !== 'string') continue;
        expect(brut, `${base}_${forme}`).not.toMatch(/\{\{count\}\}/);
      }
    }
  });
});
