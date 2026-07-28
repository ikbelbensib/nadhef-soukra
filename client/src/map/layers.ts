/**
 * Sources et calques des points noirs.
 *
 * Ces fonctions renvoient des DESCRIPTEURS, insérés directement dans le style
 * passé au constructeur. On n'appelle donc jamais addSource/addLayer après
 * coup : plus de dépendance à l'événement `load`, plus de fenêtre pendant
 * laquelle la carte existe sans ses données.
 */

import type {
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
} from 'maplibre-gl';
import { NIVEAUX_GRAVITE, OPACITE_PAR_FRESHNESS } from '@nadhef/shared';

export const SRC_HEAT = 'spots-heat';
export const SRC_POINTS = 'spots-points';
export const SRC_COMMUNE = 'commune';
export const SRC_QUARTIERS = 'quartiers';

export const ZOOM_BASCULE = 14;

type GeoJson = GeoJSON.Feature | GeoJSON.FeatureCollection;

/** Couleur du marqueur selon la gravité (vert → jaune → orange → rouge). */
const COULEUR_GRAVITE: ExpressionSpecification = [
  'match',
  ['get', 'gravite'],
  1, NIVEAUX_GRAVITE[1].couleur,
  2, NIVEAUX_GRAVITE[2].couleur,
  3, NIVEAUX_GRAVITE[3].couleur,
  4, NIVEAUX_GRAVITE[4].couleur,
  '#64748b',
];

/**
 * Opacité pilotée par la fraîcheur : un signalement non reconfirmé depuis
 * 45 jours tombe à 40 %. C'est la traduction visuelle de la règle #2 —
 * la carte doit montrer que l'information vieillit.
 */
const OPACITE_FRESHNESS: ExpressionSpecification = [
  'match',
  ['get', 'freshness'],
  'frais', OPACITE_PAR_FRESHNESS.frais,
  'a_verifier', OPACITE_PAR_FRESHNESS.a_verifier,
  'archive', 0.25,
  1,
];

/**
 * Deux sources pour la même donnée : MapLibre agrège les features quand
 * `cluster: true`, ce qui détruit le heatmap. On sépare donc
 *   · `spots-heat`   (non clusterisée) → heatmap, en dessous de z14
 *   · `spots-points` (clusterisée)     → cercles + compteurs, à partir de z14
 */
export function sourcesCarte(donnees: {
  commune: GeoJson;
  quartiers: GeoJson;
  spots: GeoJson;
}): Record<string, SourceSpecification> {
  return {
    [SRC_COMMUNE]: { type: 'geojson', data: donnees.commune },
    [SRC_QUARTIERS]: { type: 'geojson', data: donnees.quartiers },
    [SRC_HEAT]: { type: 'geojson', data: donnees.spots },
    [SRC_POINTS]: {
      type: 'geojson',
      data: donnees.spots,
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 16,
      // Somme des gravités du cluster : sert à colorer l'agrégat par sévérité
      // plutôt que par simple densité.
      clusterProperties: { gravite_totale: ['+', ['get', 'gravite']] },
    },
  };
}

/** Limite communale et secteurs. Sert aussi de fond quand il n'y a pas de tuiles. */
export function couchesTerritoire(options: { fondSchematique: boolean }): LayerSpecification[] {
  const couches: LayerSpecification[] = [];

  if (options.fondSchematique) {
    // Sans tuiles, les polygones administratifs FONT le fond de carte.
    couches.push(
      {
        id: 'commune-fond',
        type: 'fill',
        source: SRC_COMMUNE,
        paint: { 'fill-color': '#e2e8f0' },
      },
      {
        id: 'quartiers-fond',
        type: 'fill',
        source: SRC_QUARTIERS,
        paint: { 'fill-color': '#e8edf3', 'fill-opacity': 0.9 },
      },
    );
  }

  couches.push(
    {
      id: 'quartiers-contour',
      type: 'line',
      source: SRC_QUARTIERS,
      paint: { 'line-color': '#94a3b8', 'line-width': 1, 'line-dasharray': [3, 2] },
    },
    {
      id: 'commune-contour',
      type: 'line',
      source: SRC_COMMUNE,
      paint: { 'line-color': '#475569', 'line-width': 2.5 },
    },
  );

  // Les noms de quartiers ne sont PAS un calque symbol : ils sont posés en HTML
  // par MapView (marqueurs), pour bénéficier de la mise en forme arabe du
  // navigateur sans dépendre d'un jeu de glyphes SDF.

  return couches;
}

export function couchesSpots(options: { avecTexte: boolean }): LayerSpecification[] {
  const couches: LayerSpecification[] = [
    {
      id: 'spots-heatmap',
      type: 'heatmap',
      source: SRC_HEAT,
      maxzoom: ZOOM_BASCULE + 1,
      paint: {
        // Le poids vient de la gravité, précalculé côté serveur.
        'heatmap-weight': ['coalesce', ['get', 'poids'], 0.5],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.6, ZOOM_BASCULE, 2],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, ZOOM_BASCULE, 36],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.2, 'rgba(22,163,74,0.45)',
          0.4, 'rgba(234,179,8,0.55)',
          0.6, 'rgba(249,115,22,0.65)',
          0.85, 'rgba(220,38,38,0.78)',
          1, 'rgba(153,27,27,0.88)',
        ],
        'heatmap-opacity': [
          'interpolate', ['linear'], ['zoom'],
          ZOOM_BASCULE - 1, 0.85,
          ZOOM_BASCULE + 1, 0,
        ],
      },
    },
    {
      id: 'spots-clusters',
      type: 'circle',
      source: SRC_POINTS,
      filter: ['has', 'point_count'],
      minzoom: ZOOM_BASCULE,
      paint: {
        'circle-color': [
          'step', ['/', ['get', 'gravite_totale'], ['get', 'point_count']],
          NIVEAUX_GRAVITE[1].couleur,
          1.75, NIVEAUX_GRAVITE[2].couleur,
          2.5, NIVEAUX_GRAVITE[3].couleur,
          3.25, NIVEAUX_GRAVITE[4].couleur,
        ],
        'circle-radius': ['step', ['get', 'point_count'], 16, 5, 22, 15, 28],
        'circle-opacity': 0.9,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    },
    {
      id: 'spots-marqueurs',
      type: 'circle',
      source: SRC_POINTS,
      filter: ['!', ['has', 'point_count']],
      minzoom: ZOOM_BASCULE,
      paint: {
        'circle-color': COULEUR_GRAVITE,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], ZOOM_BASCULE, 6, 18, 13],
        'circle-opacity': OPACITE_FRESHNESS,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': OPACITE_FRESHNESS,
      },
    },
  ];

  if (options.avecTexte) {
    couches.push({
      id: 'spots-clusters-compte',
      type: 'symbol',
      source: SRC_POINTS,
      filter: ['has', 'point_count'],
      minzoom: ZOOM_BASCULE,
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 13,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff' },
    });
  }

  return couches;
}
