/**
 * Sélecteur de position.
 *
 * Le repère reste fixe au centre et c'est la carte qui bouge. C'est plus fiable
 * au doigt que de faire glisser un marqueur : le pouce ne masque jamais la
 * cible, et le geste marche même sur un petit écran.
 */

import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { api, type ConfigDto, type GeoJsonFeature } from '../api/client';
import { construireStyle, pmtilesDisponible, resoudreGlyphs } from './style';
import { SRC_COMMUNE } from './layers';

interface Props {
  config: ConfigDto;
  position: { lat: number; lng: number };
  onChange: (position: { lat: number; lng: number }) => void;
}

export function PickerCarte({ config, position, onChange }: Props) {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<MapLibreMap | null>(null);
  const [pret, setPret] = useState(false);
  // La position vient aussi de l'extérieur (bouton « ma position ») : on garde
  // une référence pour distinguer un recentrage programmatique d'un geste.
  const derniereEmise = useRef(position);

  useEffect(() => {
    const element = conteneur.current;
    if (!element || carte.current) return;
    let annule = false;

    void (async () => {
      const [avecTuiles, glyphs, commune] = await Promise.all([
        pmtilesDisponible(config.tiles.pmtiles_url),
        resoudreGlyphs(),
        api.boundary().catch((): GeoJsonFeature | null => null),
      ]);
      if (annule || !element) return;

      const map = new maplibregl.Map({
        container: element,
        style: construireStyle({
          pmtilesUrl: avecTuiles ? config.tiles.pmtiles_url : null,
          glyphs,
          sources: commune
            ? { [SRC_COMMUNE]: { type: 'geojson', data: commune as unknown as GeoJSON.Feature } }
            : {},
          layers: commune
            ? [
                ...(avecTuiles
                  ? []
                  : [
                      {
                        id: 'commune-fond',
                        type: 'fill' as const,
                        source: SRC_COMMUNE,
                        paint: { 'fill-color': '#e2e8f0' },
                      },
                    ]),
                {
                  id: 'commune-contour',
                  type: 'line' as const,
                  source: SRC_COMMUNE,
                  paint: { 'line-color': '#475569', 'line-width': 2 },
                },
              ]
            : [],
        }),
        center: [position.lng, position.lat],
        zoom: 16,
        minZoom: 12,
        maxZoom: 19,
        attributionControl: false,
      });
      carte.current = map;

      map.on('moveend', () => {
        const centre = map.getCenter();
        const suivante = {
          lat: Number(centre.lat.toFixed(6)),
          lng: Number(centre.lng.toFixed(6)),
        };
        derniereEmise.current = suivante;
        onChange(suivante);
      });
      map.on('load', () => setPret(true));
    })();

    return () => {
      annule = true;
      carte.current?.remove();
      carte.current = null;
    };
    // Volontairement monté une seule fois : les mises à jour passent par l'effet suivant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // Recentrage quand la position change ailleurs (géolocalisation).
  useEffect(() => {
    const map = carte.current;
    if (!map) return;
    const memePosition =
      Math.abs(derniereEmise.current.lat - position.lat) < 1e-6 &&
      Math.abs(derniereEmise.current.lng - position.lng) < 1e-6;
    if (memePosition) return;
    derniereEmise.current = position;
    map.easeTo({ center: [position.lng, position.lat], duration: 400 });
  }, [position]);

  return (
    <div className="relative h-56 overflow-hidden rounded-xl ring-1 ring-slate-300">
      <div ref={conteneur} className="h-full w-full" />
      {/* Repère fixe : ancré par la pointe, pas par son centre. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <svg viewBox="0 0 24 34" className="h-9 w-auto -translate-y-4 drop-shadow-md">
          <path
            d="M12 1a10 10 0 0 0-10 10c0 7.2 10 22 10 22s10-14.8 10-22A10 10 0 0 0 12 1z"
            fill="#0f172a"
          />
          <circle cx="12" cy="11" r="4" fill="#ffffff" />
        </svg>
      </div>
      {!pret && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
    </div>
  );
}
