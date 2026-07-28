/** Schémas Zod partagés. Toute entrée serveur est validée par l'un d'eux. */

import { z } from 'zod';
import {
  CONFIRMATION_KINDS,
  EVACUATION_PAR,
  EVENT_STATUTS,
  GRAVITES,
  MODERATION_STATUSES,
  REPORT_REASONS,
  REPORT_TARGETS,
  SPOT_STATUTS,
  SPOT_TYPES,
} from './types.js';
import { PHOTO_TAILLE_MAX_OCTETS } from './limits.js';

export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

/** Liste séparée par des virgules dans la query string → tableau typé. */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();

export const bboxQuery = z
  .string()
  .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, 'bbox attendu : minLng,minLat,maxLng,maxLat');

export const spotsQuerySchema = z.object({
  bbox: bboxQuery.optional(),
  type: csvEnum(SPOT_TYPES),
  gravite: z
    .string()
    .transform((s) => s.split(',').map((v) => Number(v.trim())))
    .pipe(z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])).min(1))
    .optional(),
  statut: csvEnum(SPOT_STATUTS),
  quartier_id: z.string().min(1).max(64).optional(),
  /** Sans ce drapeau, les spots de plus de 90 jours sont masqués (règle #2). */
  include_archives: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
});
export type SpotsQuery = z.infer<typeof spotsQuerySchema>;

export const createSpotSchema = z.object({
  lat: latitude,
  lng: longitude,
  type: z.enum(SPOT_TYPES),
  gravite: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  description: z.string().trim().max(500).optional(),
  photo_url: z.string().url().max(500).optional(),
  is_private_property: z.boolean().default(false),
  /** Horodatage local, pour les signalements mis en file hors ligne. */
  client_created_at: z.string().datetime().optional(),
  /** Clé d'idempotence : rejouer la file offline ne doit pas dupliquer. */
  idempotency_key: z.string().uuid().optional(),
});
export type CreateSpotInput = z.infer<typeof createSpotSchema>;

export const createConfirmationSchema = z.object({
  kind: z.enum(CONFIRMATION_KINDS),
  lat: latitude.optional(),
  lng: longitude.optional(),
  photo_url: z.string().url().max(500).optional(),
});
export type CreateConfirmationInput = z.infer<typeof createConfirmationSchema>;

export const createReportSchema = z.object({
  target_type: z.enum(REPORT_TARGETS),
  target_id: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(500).optional(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const moderateSpotSchema = z.object({
  decision: z.enum(MODERATION_STATUSES).exclude(['pending']),
  reason: z.string().trim().max(300).optional(),
});

export const uploadConstraints = {
  maxBytes: PHOTO_TAILLE_MAX_OCTETS,
  mimeTypes: ['image/webp', 'image/jpeg', 'image/png'] as const,
};

// ---------------------------------------------------------------------------
// Chantiers
// ---------------------------------------------------------------------------

export const MATERIELS = ['gants', 'sacs', 'pinces', 'brouette', 'masques', 'gilets'] as const;
export type Materiel = (typeof MATERIELS)[number];

export const createEventSchema = z
  .object({
    titre: z.string().trim().min(5).max(120),
    description: z.string().trim().max(2000).optional(),
    date_debut: z.string().datetime(),
    date_fin: z.string().datetime(),
    point_rdv_lat: latitude,
    point_rdv_lng: longitude,
    capacite: z.number().int().min(1).max(1000).optional(),
    materiel_fourni: z.array(z.enum(MATERIELS)).max(6).default([]),
    autorisation_obtenue: z.boolean().default(false),
    spot_ids: z.array(z.string().min(1).max(64)).min(1).max(20),

    // Règle non négociable #3 : pas de chantier sans filière d'évacuation.
    // Ces champs ne sont pas optionnels, et le contact non plus.
    evacuation_par: z.enum(EVACUATION_PAR),
    contact_evacuation_nom: z.string().trim().min(2).max(120),
    contact_evacuation_tel: z.string().trim().min(6).max(30),
    /** Case à cocher explicite, exigée pour publier une évacuation non confirmée. */
    evacuation_risque_acquittee: z.boolean().default(false),
  })
  .refine((v) => Date.parse(v.date_fin) > Date.parse(v.date_debut), {
    message: 'La fin doit suivre le début',
    path: ['date_fin'],
  })
  .refine((v) => Date.parse(v.date_debut) > Date.now() - 3_600_000, {
    message: 'Un chantier ne se programme pas dans le passé',
    path: ['date_debut'],
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.object({
  titre: z.string().trim().min(5).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  date_debut: z.string().datetime().optional(),
  date_fin: z.string().datetime().optional(),
  point_rdv_lat: latitude.optional(),
  point_rdv_lng: longitude.optional(),
  capacite: z.number().int().min(1).max(1000).optional(),
  materiel_fourni: z.array(z.enum(MATERIELS)).max(6).optional(),
  autorisation_obtenue: z.boolean().optional(),
  spot_ids: z.array(z.string().min(1).max(64)).min(1).max(20).optional(),
  evacuation_par: z.enum(EVACUATION_PAR).optional(),
  contact_evacuation_nom: z.string().trim().min(2).max(120).optional(),
  contact_evacuation_tel: z.string().trim().min(6).max(30).optional(),
  evacuation_risque_acquittee: z.boolean().optional(),
});

export const eventsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  statut: csvEnum(EVENT_STATUTS),
  quartier_id: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type EventsQuery = z.infer<typeof eventsQuerySchema>;

/** Check-in : par code QR, ou par position en repli. */
export const checkinSchema = z
  .object({
    code: z.string().trim().regex(/^\d{6}$/).optional(),
    lat: latitude.optional(),
    lng: longitude.optional(),
  })
  .refine((v) => v.code !== undefined || (v.lat !== undefined && v.lng !== undefined), {
    message: 'Un code ou une position est requis',
  });
export type CheckinInput = z.infer<typeof checkinSchema>;

export const clotureEventSchema = z.object({
  kg_collectes: z.number().min(0).max(100_000),
  photo_avant_url: z.string().url().max(500),
  photo_apres_url: z.string().url().max(500),
  /** Spots effectivement nettoyés — passent en `nettoye`. */
  spots_nettoyes: z.array(z.string().min(1).max(64)).default([]),
});
export type ClotureEventInput = z.infer<typeof clotureEventSchema>;

// ---------------------------------------------------------------------------
// Identité
// ---------------------------------------------------------------------------

/** Identifiant d'appareil pour le signalement anonyme (règle #5). */
export const deviceIdSchema = z.string().uuid();

export const demandeOtpSchema = z.object({
  telephone: z.string().trim().min(8).max(20),
});

export const verificationOtpSchema = z.object({
  telephone: z.string().trim().min(8).max(20),
  code: z.string().trim().regex(/^\d{6}$/),
});

export const graviteSchema = z.union([
  z.literal(GRAVITES[0]),
  z.literal(GRAVITES[1]),
  z.literal(GRAVITES[2]),
  z.literal(GRAVITES[3]),
]);
