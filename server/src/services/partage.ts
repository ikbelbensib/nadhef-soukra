/**
 * Métadonnées de partage pour les URL de spot.
 *
 * Une PWA rend son contenu côté client : les robots de WhatsApp, Facebook ou
 * Messenger ne l'exécutent pas et ne verraient qu'une coquille vide. On injecte
 * donc les balises Open Graph dans le HTML servi pour `/spot/:id`.
 *
 * L'image reste une carte statique déclinée par gravité. Une vignette composée
 * (photo + position + date) demanderait un rendu serveur de texte — reporté en
 * Phase 3 ; l'essentiel de l'information passe déjà par le titre, qui est ce
 * qu'affiche l'aperçu WhatsApp.
 */

import { one } from '../db/client.js';
import { env } from '../env.js';
import { communeInfo } from './boundary.js';

interface SpotPartage {
  id: string;
  type: string;
  gravite: number;
  statut: string;
  description: string | null;
  photo_url: string | null;
  quartier_nom_fr: string | null;
  quartier_nom_ar: string | null;
  created_at: string;
}

const LIBELLES_TYPE_FR: Record<string, string> = {
  ordures_menageres: 'Ordures ménagères',
  gravats: 'Gravats',
  dechets_verts: 'Déchets verts',
  encombrants: 'Encombrants',
  depot_sauvage: 'Dépôt sauvage',
  terrain_abandonne: 'Terrain abandonné',
  conteneur_deborde: 'Conteneur débordé',
};

const LIBELLES_GRAVITE_FR: Record<number, string> = {
  1: 'quelques détritus',
  2: 'accumulation visible',
  3: 'dépôt important',
  4: 'décharge sauvage, risque sanitaire',
};

export interface Metadonnees {
  titre: string;
  description: string;
  image: string;
  url: string;
}

export async function metadonneesPartage(spotId: string): Promise<Metadonnees | null> {
  const spot = await one<SpotPartage>(
    `SELECT s.id, s.type, s.gravite, s.statut, s.description, s.photo_url,
            q.nom_fr AS quartier_nom_fr, q.nom_ar AS quartier_nom_ar, s.created_at
       FROM spots s
       LEFT JOIN quartiers q ON q.id = s.quartier_id
      WHERE s.id = ? AND s.moderation_status NOT IN ('rejected','hidden')`,
    [spotId],
  );
  if (!spot) return null;

  const type = LIBELLES_TYPE_FR[spot.type] ?? spot.type;
  const lieu = spot.quartier_nom_fr ?? communeInfo.nom_fr;
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');

  return {
    titre:
      spot.statut === 'nettoye'
        ? `${type} — nettoyé à ${lieu}`
        : `${type} à ${lieu} — ${communeInfo.nom_fr}`,
    description:
      spot.description?.trim() ||
      `Point noir signalé à ${lieu} : ${LIBELLES_GRAVITE_FR[spot.gravite] ?? ''}. ` +
        `Confirmez s'il est toujours là, ou organisez un chantier.`,
    // La photo du spot fait une bien meilleure vignette quand elle existe.
    image: spot.photo_url?.startsWith('http')
      ? spot.photo_url
      : spot.photo_url
        ? `${base}${spot.photo_url}`
        : `${base}/og/gravite-${spot.gravite}.png`,
    url: `${base}/spot/${spot.id}`,
  };
}

const echapper = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Insère les balises juste avant `</head>` du shell de l'application. */
export function injecterMetadonnees(html: string, meta: Metadonnees): string {
  const balises = [
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${echapper(meta.titre)}">`,
    `<meta property="og:description" content="${echapper(meta.description)}">`,
    `<meta property="og:image" content="${echapper(meta.image)}">`,
    `<meta property="og:url" content="${echapper(meta.url)}">`,
    `<meta property="og:site_name" content="Nadhef Soukra">`,
    `<meta property="og:locale" content="ar_TN">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${echapper(meta.titre)}">`,
    `<meta name="twitter:description" content="${echapper(meta.description)}">`,
    `<meta name="twitter:image" content="${echapper(meta.image)}">`,
  ].join('\n    ');

  return html.replace('</head>', `    ${balises}\n  </head>`);
}
