/** Toutes les constantes de politique, en un seul endroit auditable. */

/** Dédup : un signalement par zone de 30 m toutes les 24 h. */
export const RAYON_DEDUP_M = 30;
export const FENETRE_DEDUP_H = 24;

/** Rate limits. */
export const MAX_SIGNALEMENTS_JOUR = 10;
export const MAX_REQUETES_IP_MINUTE = 100;
export const MAX_OTP_HEURE = 3;

/** Le geste de reconfirmation doit être fait sur place, pas depuis le canapé. */
export const RAYON_RECONFIRMATION_M = 150;
/** Plafond de points gagnables par reconfirmation en une journée. */
export const PLAFOND_POINTS_CONFIRMATION_JOUR = 10;

/** Check-in : rayon du fallback géolocalisé et tolérance horaire. */
export const RAYON_CHECKIN_M = 150;
export const TOLERANCE_CHECKIN_MIN = 30;
/** Pas de la fenêtre TOTP du QR code, en secondes. */
export const PAS_TOTP_S = 30;

/** Un chantier « mené à terme » suppose une vraie mobilisation. */
export const MIN_PRESENTS_ORGANISATION = 3;

/** Confirmations « c'est propre » requises pour fermer un spot sans preuve photo. */
export const CONFIRMATIONS_POUR_FERMETURE = 2;
/** Reconfirmations « toujours là » requises pour approuver sans modérateur. */
export const CONFIRMATIONS_POUR_APPROBATION = 2;
/** Âge minimal d'un compte pour que son vote compte (anti-comptes jetables). */
export const AGE_COMPTE_MIN_H = 24;
/** Signalements d'abus avant masquage automatique. */
export const REPORTS_POUR_MASQUAGE = 3;

/** Un nouveau spot au même endroit dans cette fenêtre après nettoyage = récidive. */
export const FENETRE_RECIDIVE_J = 90;

/** Geofence : marge tolérée hors des limites communales. */
export const BUFFER_GEOFENCE_M = 200;

/** Images : compression client. */
export const PHOTO_LARGEUR_MAX = 1280;
export const PHOTO_TAILLE_MAX_OCTETS = 5 * 1024 * 1024;

/** Classement quartiers : fenêtre glissante et seuil de classement. */
export const FENETRE_CLASSEMENT_J = 90;
export const MIN_PARTICIPATIONS_CLASSEMENT = 20;
