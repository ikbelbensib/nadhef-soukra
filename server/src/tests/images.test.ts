/**
 * Validation d'image et suppression des métadonnées.
 *
 * L'enjeu n'est pas cosmétique : une photo de téléphone porte ses coordonnées
 * GPS en EXIF. Quelqu'un qui photographie le tas devant chez lui publierait son
 * adresse si on stockait le fichier tel quel.
 */

import { describe, expect, it } from 'vitest';
import { PHOTO_TAILLE_MAX_OCTETS } from '@nadhef/shared';
import { validerEtNettoyer, _internes } from '../services/images.js';

/** JPEG minimal : SOI + APP1(EXIF) + APP0(JFIF) + SOS + données + EOI. */
function jpegAvecExif(charge: Buffer): Buffer {
  const app1Contenu = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), charge]);
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    (() => {
      const t = Buffer.alloc(2);
      t.writeUInt16BE(app1Contenu.length + 2);
      return t;
    })(),
    app1Contenu,
  ]);
  // La longueur d'un segment JPEG couvre ses deux octets de longueur inclus :
  // 'JFIF\0' (5) + 11 octets = 16 de charge utile, soit 18 annoncés.
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x12]),
    Buffer.from('JFIF\0', 'ascii'),
    Buffer.alloc(11),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    app0,
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** WebP minimal : RIFF + WEBP + VP8 + EXIF. */
function webpAvecExif(charge: Buffer): Buffer {
  const fragment = (type: string, data: Buffer): Buffer => {
    const entete = Buffer.alloc(8);
    entete.write(type, 0, 'ascii');
    entete.writeUInt32LE(data.length, 4);
    const bourrage = data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
    return Buffer.concat([entete, data, bourrage]);
  };
  const corps = Buffer.concat([
    Buffer.from('WEBP', 'ascii'),
    fragment('VP8 ', Buffer.from([1, 2, 3, 4, 5, 6])),
    fragment('EXIF', charge),
  ]);
  const entete = Buffer.alloc(8);
  entete.write('RIFF', 0, 'ascii');
  entete.writeUInt32LE(corps.length, 4);
  return Buffer.concat([entete, corps]);
}

/** PNG minimal : signature + IHDR + eXIf + IDAT + IEND. */
function pngAvecExif(charge: Buffer): Buffer {
  const fragment = (type: string, data: Buffer): Buffer => {
    const taille = Buffer.alloc(4);
    taille.writeUInt32BE(data.length);
    return Buffer.concat([taille, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    fragment('IHDR', Buffer.alloc(13)),
    fragment('eXIf', charge),
    fragment('IDAT', Buffer.from([1, 2, 3])),
    fragment('IEND', Buffer.alloc(0)),
  ]);
}

/** Motif reconnaissable jouant le rôle des coordonnées GPS. */
const GPS = Buffer.from('LAT36.8811LNG10.2372DOMICILE', 'ascii');

describe('détection de format par signature', () => {
  it('reconnaît JPEG, PNG et WebP', () => {
    expect(_internes.detecterFormat(jpegAvecExif(GPS))).toBe('jpeg');
    expect(_internes.detecterFormat(pngAvecExif(GPS))).toBe('png');
    expect(_internes.detecterFormat(webpAvecExif(GPS))).toBe('webp');
  });

  it('ignore ce que prétend le client : un exécutable reste refusé', () => {
    // Renommer un .exe en .webp ne doit tromper personne.
    const faux = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);
    expect(_internes.detecterFormat(faux)).toBeNull();
    expect(() => validerEtNettoyer(faux)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_IMAGE' }),
    );
  });

  it('refuse un fichier trop court pour porter une signature', () => {
    expect(_internes.detecterFormat(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('suppression des métadonnées', () => {
  it('retire les coordonnées GPS d’un JPEG', () => {
    const avant = jpegAvecExif(GPS);
    expect(avant.includes(GPS)).toBe(true);

    const apres = validerEtNettoyer(avant);
    expect(apres.octets.includes(GPS)).toBe(false);
    expect(apres.format).toBe('jpeg');
  });

  it('conserve l’image utile du JPEG', () => {
    const apres = validerEtNettoyer(jpegAvecExif(GPS)).octets;
    // Signature de début, données compressées et marqueur de fin intacts.
    expect(apres.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(apres.includes(Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(true);
    expect(apres.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it('retire le fragment EXIF d’un WebP et corrige la taille RIFF', () => {
    const apres = validerEtNettoyer(webpAvecExif(GPS)).octets;
    expect(apres.includes(GPS)).toBe(false);
    expect(apres.toString('ascii', 0, 4)).toBe('RIFF');
    expect(apres.toString('ascii', 8, 12)).toBe('WEBP');
    // La taille annoncée doit correspondre au fichier réel, sinon les
    // décodeurs rejettent le WebP.
    expect(apres.readUInt32LE(4)).toBe(apres.length - 8);
    expect(apres.includes(Buffer.from('VP8 ', 'ascii'))).toBe(true);
  });

  it('retire le fragment eXIf d’un PNG en gardant IHDR et IDAT', () => {
    const apres = validerEtNettoyer(pngAvecExif(GPS)).octets;
    expect(apres.includes(GPS)).toBe(false);
    expect(apres.includes(Buffer.from('IHDR', 'ascii'))).toBe(true);
    expect(apres.includes(Buffer.from('IDAT', 'ascii'))).toBe(true);
    expect(apres.includes(Buffer.from('IEND', 'ascii'))).toBe(true);
  });

  it('nettoie de façon idempotente', () => {
    const une = validerEtNettoyer(jpegAvecExif(GPS)).octets;
    const deux = validerEtNettoyer(une).octets;
    expect(deux).toEqual(une);
  });
});

describe('limites de taille', () => {
  it('refuse un envoi vide', () => {
    expect(() => validerEtNettoyer(Buffer.alloc(0))).toThrowError(
      expect.objectContaining({ code: 'EMPTY_UPLOAD' }),
    );
  });

  it('refuse au-delà de la taille maximale', () => {
    const enorme = Buffer.alloc(PHOTO_TAILLE_MAX_OCTETS + 1);
    Buffer.from([0xff, 0xd8, 0xff]).copy(enorme);
    expect(() => validerEtNettoyer(enorme)).toThrowError(
      expect.objectContaining({ code: 'UPLOAD_TOO_LARGE' }),
    );
  });
});
