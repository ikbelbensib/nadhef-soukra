#!/usr/bin/env node
/**
 * Génère les icônes PWA dans client/public/icons/.
 *
 * Écrit le PNG à la main (zlib est dans Node) plutôt que d'ajouter une
 * dépendance de rendu graphique pour trois fichiers statiques.
 *
 * Motif : un repère de carte blanc sur fond ardoise, avec un point central
 * repris de la palette de gravité.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const ARDOISE = [15, 23, 42];
const BLANC = [255, 255, 255];
const ROUGE = [220, 38, 38];

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  // Une ligne = 1 octet de filtre (0 = aucun) + size × RGBA.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // profondeur
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Anticrénelage par couverture : distance signée lissée sur ~1,5 px. */
const melange = (fond, dessus, couverture) =>
  fond.map((c, i) => Math.round(c + (dessus[i] - c) * couverture));

const lisser = (d, bord = 1.5) => Math.max(0, Math.min(1, 0.5 - d / bord));

/**
 * Repère de carte : disque de rayon r centré en (cx, cy), prolongé par une
 * pointe triangulaire tangente vers le bas.
 */
function distanceRepere(x, y, size, echelle) {
  const cx = size / 2;
  const cy = size * 0.42;
  const r = size * 0.20 * echelle;
  const pointeY = size * 0.80;

  const dDisque = Math.hypot(x - cx, y - cy) - r;

  // Triangle : sommet bas en (cx, pointeY), base à hauteur du centre du disque.
  let dTriangle = Infinity;
  if (y >= cy && y <= pointeY) {
    const t = (y - cy) / (pointeY - cy);
    const demiLargeur = r * (1 - t);
    dTriangle = Math.abs(x - cx) - demiLargeur;
  }
  return Math.min(dDisque, dTriangle);
}

function dessiner(size, { maskable }) {
  // Une icône maskable doit tenir dans la « zone sûre » : 40 % du côté peuvent
  // être rognés par le masque du système.
  const echelle = maskable ? 0.72 : 1;
  const rayonCoins = maskable ? 0 : size * 0.22;

  return (x, y) => {
    // Fond : carré à coins arrondis (ou plein si maskable).
    let fond = ARDOISE;
    let alpha = 255;
    if (rayonCoins > 0) {
      const dx = Math.max(rayonCoins - x, x - (size - rayonCoins), 0);
      const dy = Math.max(rayonCoins - y, y - (size - rayonCoins), 0);
      const dCoin = Math.hypot(dx, dy) - rayonCoins;
      alpha = Math.round(255 * lisser(dCoin));
      if (alpha === 0) return [0, 0, 0, 0];
    }

    const d = distanceRepere(x, y, size, echelle);
    let couleur = melange(fond, BLANC, lisser(d));

    // Point central rouge : reprend le haut de l'échelle de gravité.
    const cx = size / 2;
    const cy = size * 0.42;
    const dPoint = Math.hypot(x - cx, y - cy) - size * 0.075 * echelle;
    couleur = melange(couleur, ROUGE, lisser(dPoint));

    return [...couleur, alpha];
  };
}

mkdirSync(OUT, { recursive: true });

const cibles = [
  { nom: 'icon-192.png', taille: 192, maskable: false },
  { nom: 'icon-512.png', taille: 512, maskable: false },
  { nom: 'icon-512-maskable.png', taille: 512, maskable: true },
  { nom: 'apple-touch-icon.png', taille: 180, maskable: true },
];

for (const { nom, taille, maskable } of cibles) {
  const buffer = png(taille, dessiner(taille, { maskable }));
  writeFileSync(join(OUT, nom), buffer);
  console.log(`  ✓ ${nom} (${taille}px, ${(buffer.length / 1024).toFixed(1)} Ko)`);
}
