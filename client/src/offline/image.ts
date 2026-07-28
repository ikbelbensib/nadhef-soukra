/**
 * Compression des photos côté client (règle #7).
 *
 * On signale dans la rue, avec un réseau médiocre : envoyer 4 Mo de photo brute
 * est le meilleur moyen de perdre le signalement. On redimensionne à 1280 px de
 * large et on encode en WebP avant tout envoi.
 *
 * Effet de bord utile : passer par un canvas fait disparaître les métadonnées
 * EXIF, donc les coordonnées GPS du domicile. Le serveur nettoie quand même —
 * on ne fait pas confiance au client — mais la fuite est déjà close ici.
 */

import { PHOTO_LARGEUR_MAX } from '@nadhef/shared';

export interface PhotoCompressee {
  blob: Blob;
  largeur: number;
  hauteur: number;
  octets: number;
  type: string;
}

const QUALITE = 0.82;

/** Certains vieux WebView Android n'encodent pas le WebP : on retombe sur JPEG. */
function typeSupporte(): 'image/webp' | 'image/jpeg' {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL('image/webp').startsWith('data:image/webp')
    ? 'image/webp'
    : 'image/jpeg';
}

async function chargerImage(fichier: Blob): Promise<{ source: CanvasImageSource; largeur: number; hauteur: number; liberer: () => void }> {
  // createImageBitmap applique l'orientation EXIF et décode hors du fil
  // principal : l'interface ne se fige pas sur une photo de 12 Mpx.
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      largeur: bitmap.width,
      hauteur: bitmap.height,
      liberer: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(fichier);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = url;
  });
  return {
    source: img,
    largeur: img.naturalWidth,
    hauteur: img.naturalHeight,
    liberer: () => URL.revokeObjectURL(url),
  };
}

export async function compresserPhoto(fichier: Blob): Promise<PhotoCompressee> {
  const { source, largeur, hauteur, liberer } = await chargerImage(fichier);
  try {
    const echelle = Math.min(1, PHOTO_LARGEUR_MAX / Math.max(largeur, 1));
    const cibleL = Math.max(1, Math.round(largeur * echelle));
    const cibleH = Math.max(1, Math.round(hauteur * echelle));

    const canvas = document.createElement('canvas');
    canvas.width = cibleL;
    canvas.height = cibleH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Contexte 2D indisponible');
    ctx.drawImage(source, 0, 0, cibleL, cibleH);

    const type = typeSupporte();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, QUALITE),
    );
    if (!blob) throw new Error('Compression impossible');

    return { blob, largeur: cibleL, hauteur: cibleH, octets: blob.size, type };
  } finally {
    liberer();
  }
}
