/** Client HTTP typé. Les erreurs serveur arrivent sous forme de clé i18n. */

import type {
  CheckinInput,
  ClotureEventInput,
  ConfirmationKind,
  CreateEventInput,
  CreateReportInput,
  CreateSpotInput,
  EvacuationPar,
  EventStatut,
  Freshness,
  Gravite,
  SpotStatut,
  SpotType,
} from '@nadhef/shared';
import { idAppareil, jeton, type UtilisateurLocal } from './session';

const BASE = import.meta.env['VITE_API_URL'] ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`${code} (${status})`);
    this.name = 'ApiError';
  }
}

/** Identité envoyée à chaque requête : appareil toujours, jeton si connecté. */
function entetes(supplementaires: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'X-Device-Id': idAppareil(),
    ...supplementaires,
  };
  const token = jeton();
  if (token !== null) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function traiter<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const corps = (await response.json().catch(() => null)) as {
      error?: { code: string; message_key: string; details?: Record<string, unknown> };
    } | null;
    throw new ApiError(
      response.status,
      corps?.error?.code ?? 'HTTP_ERROR',
      corps?.error?.message_key ?? 'erreurs.interne',
      corps?.error?.details,
    );
  }
  return (await response.json()) as T;
}

async function get<T>(chemin: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE}${chemin}`, window.location.origin);
  for (const [cle, valeur] of Object.entries(params ?? {})) {
    if (valeur !== undefined) url.searchParams.set(cle, String(valeur));
  }

  let response: Response;
  try {
    response = await fetch(url, { headers: entetes() });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'erreurs.reseau');
  }
  return traiter<T>(response);
}

async function post<T>(chemin: string, corps: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${chemin}`, {
      method: 'POST',
      headers: entetes({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(corps),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'erreurs.reseau');
  }
  return traiter<T>(response);
}

// --- Types de réponse -------------------------------------------------------

export interface BBoxDto {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface QuartierDto {
  id: string;
  nom_fr: string;
  nom_ar: string;
  population_estimee: number;
  centre: [number, number];
}

export interface ConfigDto {
  commune: {
    nom_fr: string;
    nom_ar: string;
    codegeo: string;
    osm_relation_id: number;
    bbox: BBoxDto;
    centre: [number, number];
  };
  tiles: { pmtiles_url: string; satellite_url: string | null };
  quartiers: QuartierDto[];
  referentiel: {
    types: readonly SpotType[];
    statuts: readonly SpotStatut[];
    gravites: { niveau: Gravite; labelKey: string; couleur: string; poidsHeatmap: number }[];
  };
  regles: {
    jours_avant_a_verifier: number;
    jours_avant_archive: number;
    rayon_dedup_m: number;
    bareme: Record<string, number>;
  };
}

export interface SpotProperties {
  id: string;
  type: SpotType;
  gravite: Gravite;
  statut: SpotStatut;
  freshness: Freshness;
  poids: number;
  description: string | null;
  photo_url: string | null;
  quartier_id: string | null;
  created_at: string;
  last_confirmed_at: string;
  cleaned_at: string | null;
  is_private_property: boolean;
  en_attente_moderation: boolean;
  confirmations_count: number;
}

export interface FeatureCollectionDto<P> {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: P;
  }[];
}

export interface GeoJsonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

export interface SpotFeatureDto {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: SpotProperties;
}

export type ReponseCreationSpot =
  | { statut: 'cree'; spot: SpotFeatureDto; points: number; recidive: boolean }
  | { statut: 'doublon'; spot: SpotFeatureDto; distance_m: number; message_key: string };

export interface ConfirmationDto {
  id: string;
  kind: ConfirmationKind;
  pseudo: string | null;
  anonyme: boolean;
  a_photo: boolean;
  created_at: string;
}

export interface ReponseConfirmation {
  id: string;
  kind: ConfirmationKind;
  statut_spot: SpotStatut;
  last_confirmed_at: string;
  points: number;
  raison_sans_points?: string;
  spot_ferme: boolean;
  spot_approuve: boolean;
}

export interface ReponsePosition {
  dans_commune: boolean;
  limite: boolean;
  quartier_id: string | null;
}

export interface EventDto {
  id: string;
  titre: string;
  description: string | null;
  date_debut: string;
  date_fin: string;
  point_rdv: [number, number];
  organisateur: { id: string; pseudo: string | null };
  capacite: number | null;
  materiel_fourni: string[];
  autorisation_obtenue: boolean;
  evacuation: {
    par: EvacuationPar;
    contact_nom: string;
    contact_tel: string;
    risque_acquitte: boolean;
    /** Vrai quand l'évacuation n'est pas confirmée : bandeau orange obligatoire. */
    avertissement: boolean;
  };
  statut: EventStatut;
  photo_avant_url: string | null;
  photo_apres_url: string | null;
  kg_collectes: number | null;
  spots: { id: string; type: SpotType; gravite: Gravite; statut: SpotStatut }[];
  inscrits: number;
  presents: number;
  created_at: string;
}

export interface LigneQuartierDto {
  rang: number | null;
  quartier_id: string;
  nom_fr: string;
  nom_ar: string;
  population_estimee: number;
  points: number;
  points_par_1000: number;
  contributeurs: number;
  actions: number;
  classe: boolean;
  spots_fermes: number;
  kg_collectes: number;
}

export interface LigneCitoyenDto {
  rang: number;
  user_id: string;
  pseudo: string;
  quartier_id: string | null;
  points: number;
  actions: number;
  badges: number;
}

export interface BadgeDto {
  id: string;
  code: string;
  nom_fr: string;
  nom_ar: string;
  description_fr: string;
  description_ar: string;
  condition: { metric: string; op: string; value: number };
  awarded_at?: string;
}

export interface StatsDto {
  genere_le: string;
  commune: string;
  spots: {
    total: number;
    actifs: number;
    nettoyes: number;
    a_verifier: number;
    archives: number;
    en_recidive: number;
    taux_recidive: number;
  };
  chantiers: {
    realises: number;
    a_venir: number;
    kg_collectes: number;
    participations: number;
    sans_evacuation_confirmee: number;
  };
  communaute: { contributeurs: number; contributeurs_verifies: number; confirmations: number };
  par_quartier: {
    quartier_id: string;
    nom_fr: string;
    nom_ar: string;
    spots_actifs: number;
    spots_nettoyes: number;
  }[];
  par_type: { type: SpotType; total: number; nettoyes: number }[];
  historique: { mois: string; signales: number; nettoyes: number }[];
}

export interface EntreeFileDto {
  spot: {
    id: string;
    type: SpotType;
    gravite: Gravite;
    statut: SpotStatut;
    description: string | null;
    photo_url: string | null;
    lat: number;
    lng: number;
    quartier_id: string | null;
    is_private_property: boolean;
    moderation_status: string;
    hidden_reason: string | null;
    created_at: string;
    auteur: string | null;
  };
  confirmations: number;
  signalements: { reason: string; details: string | null; created_at: string }[];
}

export interface EntreeAuditDto {
  id: string;
  acteur: string | null;
  action: string;
  target_type: string;
  target_id: string;
  payload: string | null;
  created_at: string;
}

export interface ParticipantDto {
  id: string;
  pseudo: string;
  statut: 'inscrit' | 'present' | 'absent';
  checked_in_at: string | null;
  method: string | null;
}

export const api = {
  config: () => get<ConfigDto>('/config'),
  boundary: () => get<GeoJsonFeature>('/boundary'),
  quartiers: () => get<{ type: 'FeatureCollection'; features: GeoJsonFeature[] }>('/quartiers'),
  spots: (params?: {
    bbox?: string;
    include_archives?: string;
    limit?: number;
    type?: string;
    gravite?: string;
    statut?: string;
    quartier_id?: string;
  }) => get<FeatureCollectionDto<SpotProperties>>('/spots', params),
  spot: (id: string) => get<SpotFeatureDto>(`/spots/${id}`),
  confirmations: (id: string) =>
    get<{ confirmations: ConfirmationDto[] }>(`/spots/${id}/confirmations`),

  positionInfo: (lat: number, lng: number) =>
    get<ReponsePosition>('/quartier-pour', { lat, lng }),

  creerCompteLeger: (pseudo: string, quartierId?: string) =>
    post<{ user: UtilisateurLocal; token: string; spots_rattaches: number }>(
      '/auth/compte-leger',
      { pseudo, ...(quartierId !== undefined ? { quartier_id: quartierId } : {}) },
    ),

  creerSpot: (input: CreateSpotInput) => post<ReponseCreationSpot>('/spots', input),

  confirmer: (
    id: string,
    input: { kind: ConfirmationKind; lat?: number; lng?: number; photo_url?: string },
  ) => post<ReponseConfirmation>(`/spots/${id}/confirmations`, input),

  signalerAbus: (input: CreateReportInput) =>
    post<{ id: string; cible_masquee: boolean }>('/reports', input),

  // --- Chantiers ---
  events: (params?: { from?: string; statut?: string; limit?: number }) =>
    get<{ events: EventDto[] }>('/events', params),
  event: (id: string) => get<EventDto>(`/events/${id}`),
  creerEvent: (input: CreateEventInput) => post<EventDto>('/events', input),
  publierEvent: (id: string) => post<EventDto>(`/events/${id}/publier`, {}),
  annulerEvent: (id: string) => post<EventDto>(`/events/${id}/annuler`, {}),
  sInscrire: (id: string) => post<{ statut: string; inscrits: number }>(`/events/${id}/inscription`, {}),
  seDesinscrire: async (id: string): Promise<void> => {
    await fetch(`${BASE}/events/${id}/inscription`, { method: 'DELETE', headers: entetes() });
  },
  codePresence: (id: string) => get<{ code: string; expire_dans_s: number }>(`/events/${id}/code`),
  checkin: (id: string, input: CheckinInput) =>
    post<{ statut: string; methode: string; points: number; raison_sans_points?: string }>(
      `/events/${id}/checkin`,
      input,
    ),
  participants: (id: string) => get<{ participants: ParticipantDto[] }>(`/events/${id}/participants`),
  cloturerEvent: (id: string, input: ClotureEventInput) =>
    post<{ event: EventDto; points_organisateur: number; raison_sans_points?: string; spots_fermes: number }>(
      `/events/${id}/cloture`,
      input,
    ),

  // --- Classements et statistiques ---
  classementQuartiers: (periode: string) =>
    get<{ periode: string; seuil_actions: number; lignes: LigneQuartierDto[] }>(
      '/leaderboard/quartiers',
      { periode },
    ),
  classementCitoyens: (periode: string) =>
    get<{ periode: string; lignes: LigneCitoyenDto[] }>('/leaderboard/citoyens', { periode }),
  monRang: (periode: string) =>
    get<{ points: number; rang: number | null; verifie: boolean }>('/me/rang', { periode }),
  mesBadges: () => get<{ badges: BadgeDto[]; nouveaux: string[] }>('/me/badges'),
  stats: () => get<StatsDto>('/stats/public'),

  // --- Modération ---
  fileModeration: () =>
    get<{ en_attente: EntreeFileDto[]; masques: EntreeFileDto[]; signalements_ouverts: number }>(
      '/admin/moderation/queue',
    ),
  modererSpot: (id: string, decision: 'approved' | 'rejected' | 'hidden', reason?: string) =>
    post<{ id: string; moderation_status: string; statut: string }>(
      `/admin/spots/${id}/moderate`,
      { decision, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
    ),
  audit: () => get<{ entrees: EntreeAuditDto[] }>('/admin/audit'),

  /**
   * Téléchargement authentifié : un simple lien ne porterait pas le jeton.
   * On récupère le corps, puis on déclenche l'enregistrement via un blob.
   */
  async telechargerExport(jeu: 'spots' | 'chantiers' | 'quartiers'): Promise<void> {
    const reponse = await fetch(`${BASE}/admin/export/${jeu}.csv`, { headers: entetes() });
    if (!reponse.ok) throw new ApiError(reponse.status, 'EXPORT_FAILED', 'erreurs.interne');
    const blob = await reponse.blob();
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = `nadhef-soukra-${jeu}-${new Date().toISOString().slice(0, 10)}.csv`;
    lien.click();
    URL.revokeObjectURL(url);
  },

  // --- Vérification du numéro ---
  demanderCodeSms: (telephone: string) =>
    post<{ expire_dans_s: number }>('/auth/otp/demander', { telephone }),
  verifierCodeSms: (telephone: string, code: string) =>
    post<{ user: UtilisateurLocal; token: string }>('/auth/otp/verifier', { telephone, code }),

  /** Envoi binaire brut : la photo est déjà compressée en WebP côté client. */
  async televerser(blob: Blob): Promise<{ url: string; format: string; octets: number }> {
    let response: Response;
    try {
      response = await fetch(`${BASE}/uploads`, {
        method: 'POST',
        headers: entetes({ 'Content-Type': blob.type || 'application/octet-stream' }),
        body: blob,
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'erreurs.reseau');
    }
    return traiter<{ url: string; format: string; octets: number }>(response);
  },
};
