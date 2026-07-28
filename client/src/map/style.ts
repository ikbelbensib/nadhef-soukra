/**
 * Fond de carte — règle non négociable #1 : pas de Google Maps.
 *
 * Source : Protomaps .pmtiles auto-hébergé (un fichier statique lu par requêtes
 * Range, sans clé d'API ni facturation au chargement).
 *
 * Si aucun .pmtiles n'est disponible, on bascule sur un fond SCHÉMATIQUE
 * construit à partir de nos propres polygones (limite communale + secteurs).
 * L'application reste donc entièrement fonctionnelle sans aucun actif externe :
 * `docker compose up` suffit, on perd seulement le détail des rues.
 */

import type { StyleSpecification } from 'maplibre-gl';

/** Neutres froids : la couleur est réservée aux niveaux de gravité. */
export const PALETTE = {
  fond: '#eef2f6',
  terre: '#e7ecf1',
  eau: '#cbd9e6',
  batiments: '#dde4ec',
  espacesVerts: '#dfe9e0',
  routes: '#ffffff',
  routesContour: '#c8d2dc',
  autoroutes: '#f7f9fb',
  texte: '#334155',
  texteHalo: '#ffffff',
  limiteCommune: '#475569',
  limiteQuartier: '#94a3b8',
} as const;

export const SOURCE_BASE = 'protomaps';

/**
 * Le fichier de tuiles est optionnel : on vérifie sa présence avant de
 * l'utiliser.
 *
 * Un simple `res.ok` ne suffit pas — le repli SPA (serveur de développement
 * comme production) répond 200 avec index.html pour n'importe quel chemin
 * inconnu. Le style déclarerait alors une source vectorielle pointant sur du
 * HTML : la source ne se charge jamais, et MapLibre laisse le style
 * indéfiniment « non chargé ». La carte reste alors figée, sans erreur.
 *
 * On exige donc la signature du format : un fichier PMTiles commence par les
 * sept octets ASCII « PMTiles ».
 */
export async function pmtilesDisponible(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-7' } });
    if (!res.ok && res.status !== 206) return false;
    const octets = new Uint8Array((await res.arrayBuffer()).slice(0, 7));
    return new TextDecoder().decode(octets) === 'PMTiles';
  } catch {
    return false;
  }
}

const GLYPHS_LOCAUX = '/fonts/{fontstack}/{range}.pbf';

/**
 * MapLibre ne dessine aucun texte sans glyphes : on vérifie qu'ils sont servis.
 *
 * Un simple `res.ok` ne suffit pas — le repli SPA du serveur de développement
 * renvoie index.html en 200 pour n'importe quel chemin. MapLibre lit alors du
 * HTML comme un protobuf, échoue, et retombe sur un rendu local sans liaisons
 * arabes. On exige donc un type de contenu binaire.
 */
export async function resoudreGlyphs(): Promise<string | null> {
  try {
    const res = await fetch(
      GLYPHS_LOCAUX.replace('{fontstack}', 'Noto%20Sans%20Regular').replace('{range}', '0-255'),
    );
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && !type.includes('text/html')) return GLYPHS_LOCAUX;
  } catch {
    /* pas de glyphes servis */
  }
  // Aucun glyphe : les calques de texte sont omis plutôt que d'afficher des
  // étiquettes cassées ou de dépendre d'un domaine externe.
  return null;
}

/** Couches vectorielles pour le schéma Protomaps basemap v4. */
function couchesBase(avecTexte: boolean): StyleSpecification['layers'] {
  const src = { source: SOURCE_BASE } as const;
  const couches: StyleSpecification['layers'] = [
    { id: 'terre', type: 'fill', ...src, 'source-layer': 'earth',
      paint: { 'fill-color': PALETTE.terre } },
    { id: 'espaces-verts', type: 'fill', ...src, 'source-layer': 'landuse',
      paint: { 'fill-color': PALETTE.espacesVerts, 'fill-opacity': 0.7 } },
    { id: 'eau', type: 'fill', ...src, 'source-layer': 'water',
      paint: { 'fill-color': PALETTE.eau } },
    { id: 'batiments', type: 'fill', ...src, 'source-layer': 'buildings',
      minzoom: 14,
      paint: { 'fill-color': PALETTE.batiments, 'fill-opacity': 0.8 } },
    { id: 'routes-contour', type: 'line', ...src, 'source-layer': 'roads',
      minzoom: 11,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': PALETTE.routesContour,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 1.4, 18, 14],
      } },
    { id: 'routes', type: 'line', ...src, 'source-layer': 'roads',
      minzoom: 11,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': PALETTE.routes,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 0.6, 18, 11],
      } },
  ];

  if (avecTexte) {
    couches.push({
      id: 'lieux', type: 'symbol', ...src, 'source-layer': 'places',
      minzoom: 12,
      layout: {
        // Le champ arabe d'abord : l'arabe est la langue par défaut de l'app.
        'text-field': ['coalesce', ['get', 'name:ar'], ['get', 'name']],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 15],
        'text-font': ['Noto Sans Regular'],
        'text-max-width': 8,
      },
      paint: {
        'text-color': PALETTE.texte,
        'text-halo-color': PALETTE.texteHalo,
        'text-halo-width': 1.6,
      },
    });
  }

  return couches;
}

/**
 * Style complet. `pmtilesUrl` est ignoré si le fichier n'est pas servi —
 * la carte tombe alors sur le fond schématique.
 */
export function construireStyle(options: {
  pmtilesUrl: string | null;
  glyphs: string | null;
  sources: StyleSpecification['sources'];
  layers: StyleSpecification['layers'];
}): StyleSpecification {
  const avecTuiles = options.pmtilesUrl !== null;
  return {
    version: 8,
    // Un style sans `glyphs` est valide tant qu'aucun calque symbol n'existe ;
    // c'est le cas quand les glyphes sont introuvables (cf. resoudreGlyphs).
    ...(options.glyphs !== null ? { glyphs: options.glyphs } : {}),
    sources: {
      ...(avecTuiles
        ? {
            [SOURCE_BASE]: {
              type: 'vector',
              url: `pmtiles://${options.pmtilesUrl}`,
              attribution: '© OpenStreetMap · Protomaps',
            } satisfies StyleSpecification['sources'][string],
          }
        : {}),
      ...options.sources,
    },
    layers: [
      { id: 'fond', type: 'background', paint: { 'background-color': PALETTE.fond } },
      ...(avecTuiles ? couchesBase(options.glyphs !== null) : []),
      ...options.layers,
    ],
  };
}
