/** Types et énumérations partagés client / serveur. Source de vérité unique. */

export const SPOT_TYPES = [
  'ordures_menageres',
  'gravats',
  'dechets_verts',
  'encombrants',
  'depot_sauvage',
  'terrain_abandonne',
  'conteneur_deborde',
] as const;
export type SpotType = (typeof SPOT_TYPES)[number];

export const SPOT_STATUTS = [
  'signale',
  'confirme',
  'planifie',
  'nettoye',
  'recidive',
  'a_verifier',
  'rejete',
] as const;
export type SpotStatut = (typeof SPOT_STATUTS)[number];

export const MODERATION_STATUSES = ['pending', 'approved', 'rejected', 'hidden'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const GRAVITES = [1, 2, 3, 4] as const;
export type Gravite = (typeof GRAVITES)[number];

export const CONFIRMATION_KINDS = ['toujours_la', 'c_est_propre'] as const;
export type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number];

export const EVACUATION_PAR = [
  'municipalite',
  'tunisie_recyclage',
  'prestataire_prive',
  'non_confirme',
] as const;
export type EvacuationPar = (typeof EVACUATION_PAR)[number];

export const EVENT_STATUTS = ['brouillon', 'publie', 'en_cours', 'termine', 'annule'] as const;
export type EventStatut = (typeof EVENT_STATUTS)[number];

export const PARTICIPATION_STATUTS = ['inscrit', 'present', 'absent'] as const;
export type ParticipationStatut = (typeof PARTICIPATION_STATUTS)[number];

export const CHECKIN_METHODS = ['qr', 'geo', 'organisateur'] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

export const USER_ROLES = ['citoyen', 'moderateur', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const REPORT_TARGETS = ['spot', 'event', 'user'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = [
  'propriete_privee',
  'harcelement',
  'faux_signalement',
  'contenu_choquant',
  'autre',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Fraîcheur d'un spot — dérivée de last_confirmed_at, jamais stockée (PLAN.md §3). */
export const FRESHNESS = ['frais', 'a_verifier', 'archive'] as const;
export type Freshness = (typeof FRESHNESS)[number];

export const POINT_ACTIONS = [
  'spot_cree',
  'spot_reconfirme',
  'participation',
  'organisation',
  'spot_ferme',
] as const;
export type PointAction = (typeof POINT_ACTIONS)[number];

export interface Quartier {
  id: string;
  nom_fr: string;
  nom_ar: string;
  population_estimee: number;
  centre_lat: number;
  centre_lng: number;
}

export interface Spot {
  id: string;
  lat: number;
  lng: number;
  geohash8: string;
  quartier_id: string | null;
  type: SpotType;
  gravite: Gravite;
  statut: SpotStatut;
  description: string | null;
  photo_url: string | null;
  created_by: string | null;
  created_at: string;
  last_confirmed_at: string;
  cleaned_at: string | null;
  is_private_property: boolean;
  moderation_status: ModerationStatus;
  parent_spot_id: string | null;
  /** Champs calculés au read, absents en base. */
  freshness: Freshness;
  confirmations_count: number;
}

export interface PublicUser {
  id: string;
  pseudo: string;
  quartier_id: string | null;
  points: number;
  role: UserRole;
  /** true dès qu'un numéro est vérifié — condition d'entrée au classement public. */
  is_verified: boolean;
  created_at: string;
}

export type LngLat = readonly [number, number];

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}
