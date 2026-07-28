import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api, type ConfigDto, type SpotProperties } from '../api/client';
import { construireStyle, pmtilesDisponible, resoudreGlyphs } from './style';
import { couchesSpots, couchesTerritoire, sourcesCarte, SRC_HEAT, SRC_POINTS } from './layers';

// Enregistré une seule fois pour tout le module : MapLibre résout alors
// les URL `pmtiles://` par requêtes Range sur un fichier statique.
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// Pas de greffon RTL ni de glyphes SDF : la carte ne dessine aucun texte.
//
// Les noms de quartiers sont posés en HTML (voir plus bas), ce qui donne une
// mise en forme arabe correcte sans jeu de glyphes. Retirer le texte SDF fait
// disparaître d'un coup trois fragilités constatées : la dépendance à un
// domaine externe pour les glyphes, l'inversion des lettres quand ils manquent,
// et surtout un blocage silencieux — `setRTLTextPlugin` ne peut être appelé
// qu'une fois par page, et un second appel laisse tout style contenant du texte
// figé avant `style.load`, sans erreur, carte apparemment vide.
//
// À rétablir le jour où l'on servira nos propres glyphes depuis /fonts.

/**
 * Attend que toutes les sources nommées soient présentes sur la carte.
 *
 * Elles sont déclarées dans le style, donc disponibles dès que MapLibre l'a
 * analysé. On sonde sur `styledata` plutôt que sur `load`, avec une limite de
 * temps pour ne jamais laisser une promesse pendante.
 */
async function attendreSources(
  map: MapLibreMap,
  ids: readonly string[],
  limiteMs = 10_000,
): Promise<boolean> {
  const toutesPresentes = (): boolean => ids.every((id) => map.getSource(id) !== undefined);
  if (toutesPresentes()) return true;

  return new Promise<boolean>((resolve) => {
    const fini = (valeur: boolean): void => {
      map.off('styledata', surStyle);
      clearTimeout(minuteur);
      resolve(valeur);
    };
    const surStyle = (): void => {
      if (toutesPresentes()) fini(true);
    };
    const minuteur = setTimeout(() => fini(toutesPresentes()), limiteMs);
    map.on('styledata', surStyle);
  });
}

interface CarteInitiale {
  style: StyleSpecification;
  schematique: boolean;
  nbSpots: number;
}

/**
 * Prépare tout ce dont la carte a besoin AVANT de l'instancier : sonde du fond
 * de tuiles, disponibilité des glyphes, et données métier — le tout intégré
 * directement dans le style.
 *
 * Ce choix supprime une classe entière de bugs. Muter la carte après coup
 * (addSource/addLayer/setData dans un gestionnaire `load`) supposait à la fois
 * que l'événement se déclenche et qu'il arrive après notre abonnement ; toute
 * dérive de minutage laissait une carte vide et silencieuse. Ici, une carte
 * existe si et seulement si elle a ses données.
 */
function useCarteInitiale(config: ConfigDto): {
  carte: CarteInitiale | null;
  erreur: string | null;
} {
  const [carte, setCarte] = useState<CarteInitiale | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const pmtilesUrl = config.tiles.pmtiles_url;

  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const [avecTuiles, glyphs, commune, quartiers, spots] = await Promise.all([
          pmtilesDisponible(pmtilesUrl),
          resoudreGlyphs(),
          api.boundary(),
          api.quartiers(),
          api.spots({ limit: 2000 }),
        ]);
        if (annule) return;

        const avecTexte = glyphs !== null;
        setCarte({
          schematique: !avecTuiles,
          nbSpots: spots.features.length,
          style: construireStyle({
            pmtilesUrl: avecTuiles ? pmtilesUrl : null,
            glyphs,
            sources: sourcesCarte({
              commune: commune as unknown as GeoJSON.Feature,
              quartiers: quartiers as unknown as GeoJSON.FeatureCollection,
              spots: spots as unknown as GeoJSON.FeatureCollection,
            }),
            layers: [
              ...couchesTerritoire({ fondSchematique: !avecTuiles }),
              ...couchesSpots({ avecTexte }),
            ],
          }),
        });
      } catch (err) {
        if (!annule) setErreur(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      annule = true;
    };
  }, [pmtilesUrl]);

  return { carte, erreur };
}

interface Props {
  config: ConfigDto;
  /** Filtres de la carte, passés tels quels à `GET /spots`. */
  parametres?: Record<string, string>;
  onSpotClick?: (spot: SpotProperties) => void;
  onCompteChange?: (n: number) => void;
  onFondSchematique?: (schematique: boolean) => void;
}

export function MapView({
  config,
  parametres,
  onSpotClick,
  onCompteChange,
  onFondSchematique,
}: Props) {
  const conteneur = useRef<HTMLDivElement>(null);
  const instance = useRef<MapLibreMap | null>(null);
  const { carte, erreur } = useCarteInitiale(config);
  const clefParametres = JSON.stringify(parametres ?? {});

  /**
   * Les rappels passent par une référence, jamais par les dépendances de
   * l'effet de montage.
   *
   * Le parent les déclare en ligne (`onSpotClick={(s) => naviguer(...)}`), donc
   * leur identité change à chaque rendu. Les mettre en dépendance détruisait et
   * reconstruisait la carte à chaque changement d'état du parent : recadrage
   * perdu, requêtes refaites, et les mises à jour de filtre n'atterrissaient
   * jamais sur une carte assez stable pour les recevoir.
   */
  const rappels = useRef({ onSpotClick, onCompteChange, onFondSchematique });
  rappels.current = { onSpotClick, onCompteChange, onFondSchematique };

  useEffect(() => {
    if (!carte) return;
    rappels.current.onFondSchematique?.(carte.schematique);
    rappels.current.onCompteChange?.(carte.nbSpots);
  }, [carte]);

  useEffect(() => {
    const element = conteneur.current;
    if (!element || !carte || instance.current) return;

    const { bbox } = config.commune;
    const map = new maplibregl.Map({
      container: element,
      style: carte.style,
      bounds: [
        [bbox.minLng, bbox.minLat],
        [bbox.maxLng, bbox.maxLat],
      ],
      fitBoundsOptions: { padding: 24 },
      // La carte est bornée à La Soukra : la navigation ne dérive pas hors sujet.
      maxBounds: [
        [bbox.minLng - 0.08, bbox.minLat - 0.08],
        [bbox.maxLng + 0.08, bbox.maxLat + 0.08],
      ],
      minZoom: 10,
      maxZoom: 19,
      attributionControl: { compact: true },
    });
    instance.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-left',
    );
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    // Noms de quartiers en HTML plutôt qu'en calque `symbol` : le navigateur
    // applique la vraie police arabe et sa mise en forme contextuelle, sans
    // dépendre d'un jeu de glyphes SDF distant. Sept étiquettes statiques.
    const etiquettes = config.quartiers.map((q) => {
      const el = document.createElement('div');
      el.className =
        'pointer-events-none select-none whitespace-nowrap text-[13px] font-semibold ' +
        'text-slate-600 [text-shadow:0_0_3px_#fff,0_0_3px_#fff,0_0_3px_#fff]';
      el.textContent = q.nom_ar;
      return new maplibregl.Marker({ element: el }).setLngLat(q.centre).addTo(map);
    });

    map.on('click', 'spots-marqueurs', (e) => {
      const feature = e.features?.[0];
      if (feature) {
        rappels.current.onSpotClick?.(feature.properties as unknown as SpotProperties);
      }
    });

    // Un clic sur un agrégat zoome dedans plutôt que de ne rien faire.
    map.on('click', 'spots-clusters', (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      map.easeTo({
        center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
        zoom: Math.min(19, map.getZoom() + 2),
      });
    });

    for (const couche of ['spots-marqueurs', 'spots-clusters']) {
      map.on('mouseenter', couche, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', couche, () => {
        map.getCanvas().style.cursor = '';
      });
    }

    return () => {
      for (const etiquette of etiquettes) etiquette.remove();
      map.remove();
      instance.current = null;
    };
    // Volontairement sans les rappels : voir `rappels` plus haut.
  }, [carte, config]);

  /**
   * Application des filtres.
   *
   * Ici `setData` est sûr : les sources sont déclarées dans le style, donc
   * elles existent dès que le style est chargé. On ne recrée jamais la carte
   * pour un changement de filtre — cela réinitialiserait le cadrage.
   */
  useEffect(() => {
    const map = instance.current;
    if (!map || !carte) return;
    // Le montage a déjà chargé le jeu complet : inutile de le redemander.
    if (clefParametres === '{}') return;

    let annule = false;

    void api
      .spots({ limit: 2000, ...(parametres ?? {}) })
      .then(async (spots) => {
        if (annule) return;
        // On attend que les sources EXISTENT, sans passer par `isStyleLoaded()`
        // ni par l'événement `load` : le premier reste faux sur une carte
        // pourtant peinte, le second ne se redéclenche pas si l'on s'abonne
        // trop tard. Les sources étant déclarées dans le style, leur simple
        // présence est le signal fiable.
        const sources = await attendreSources(map, [SRC_HEAT, SRC_POINTS]);
        if (annule || !sources) return;
        for (const id of [SRC_HEAT, SRC_POINTS]) {
          (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(
            spots as unknown as GeoJSON.FeatureCollection,
          );
        }
        rappels.current.onCompteChange?.(spots.features.length);
      })
      .catch((err: unknown) => console.error('[carte] filtres non appliqués', err));

    return () => {
      annule = true;
    };
    // `parametres` est comparé par sa forme sérialisée, pas par identité.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clefParametres, carte]);

  return (
    <div className="relative h-full w-full">
      <div ref={conteneur} className="h-full w-full" />
      {erreur !== null && (
        <div className="absolute inset-x-3 top-3 rounded-lg bg-red-600 px-3 py-2 text-sm text-white shadow-lg">
          {erreur}
        </div>
      )}
    </div>
  );
}
