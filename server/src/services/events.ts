/**
 * Chantiers collectifs.
 *
 * Règle non négociable #3 : **pas de publication sans filière d'évacuation**.
 * Le mode d'échec numéro un des prédécesseurs, c'est 200 sacs empilés qu'aucun
 * camion ne vient chercher — plus laid qu'avant, et une communauté brûlée. La
 * contrainte existe à trois niveaux : schéma Zod, service, et CHECK en base.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { InArgs } from '@libsql/client';
import {
  MIN_PRESENTS_ORGANISATION,
  RAYON_CHECKIN_M,
  TOLERANCE_CHECKIN_MIN,
  deciderOrganisation,
  deciderParticipation,
  haversine,
  type CheckinInput,
  type CheckinMethod,
  type ClotureEventInput,
  type CreateEventInput,
  type EventStatut,
  type EventsQuery,
  type LngLat,
} from '@nadhef/shared';
import { all, count, db, one, run } from '../db/client.js';
import { assertDansCommune, resoudreQuartier } from './boundary.js';
import { attribuer } from './points.js';
import { assertVerifie, type UtilisateurSession } from './auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { genererCode, secondesRestantes, verifierCode } from './totp.js';

export interface EventRow {
  id: string;
  titre: string;
  description: string | null;
  date_debut: string;
  date_fin: string;
  point_rdv_lat: number;
  point_rdv_lng: number;
  organisateur_id: string;
  capacite: number | null;
  materiel_fourni: string | null;
  autorisation_obtenue: number;
  evacuation_par: string;
  contact_evacuation_nom: string;
  contact_evacuation_tel: string;
  evacuation_risque_acquittee: number;
  statut: EventStatut;
  photo_avant_url: string | null;
  photo_apres_url: string | null;
  kg_collectes: number | null;
  created_at: string;
  cloture_at: string | null;
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
    par: string;
    contact_nom: string;
    contact_tel: string;
    risque_acquitte: boolean;
    /** Déclenche le bandeau orange côté interface. */
    avertissement: boolean;
  };
  statut: EventStatut;
  photo_avant_url: string | null;
  photo_apres_url: string | null;
  kg_collectes: number | null;
  spots: { id: string; type: string; gravite: number; statut: string }[];
  inscrits: number;
  presents: number;
  created_at: string;
}

async function enrichir(row: EventRow): Promise<EventDto> {
  const [organisateur, spots, inscrits, presents] = await Promise.all([
    one<{ pseudo: string }>('SELECT pseudo FROM users WHERE id = ?', [row.organisateur_id]),
    all<{ id: string; type: string; gravite: number; statut: string }>(
      `SELECT s.id, s.type, s.gravite, s.statut
         FROM event_spots es JOIN spots s ON s.id = es.spot_id
        WHERE es.event_id = ?`,
      [row.id],
    ),
    count('SELECT COUNT(*) AS n FROM participations WHERE event_id = ?', [row.id]),
    count("SELECT COUNT(*) AS n FROM participations WHERE event_id = ? AND statut = 'present'", [
      row.id,
    ]),
  ]);

  return {
    id: row.id,
    titre: row.titre,
    description: row.description,
    date_debut: row.date_debut,
    date_fin: row.date_fin,
    point_rdv: [row.point_rdv_lng, row.point_rdv_lat],
    organisateur: { id: row.organisateur_id, pseudo: organisateur?.pseudo ?? null },
    capacite: row.capacite,
    materiel_fourni: JSON.parse(row.materiel_fourni ?? '[]') as string[],
    autorisation_obtenue: row.autorisation_obtenue === 1,
    evacuation: {
      par: row.evacuation_par,
      contact_nom: row.contact_evacuation_nom,
      contact_tel: row.contact_evacuation_tel,
      risque_acquitte: row.evacuation_risque_acquittee === 1,
      avertissement: row.evacuation_par === 'non_confirme',
    },
    statut: row.statut,
    photo_avant_url: row.photo_avant_url,
    photo_apres_url: row.photo_apres_url,
    kg_collectes: row.kg_collectes,
    spots,
    inscrits,
    presents,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function listerEvents(query: EventsQuery): Promise<EventDto[]> {
  const where: string[] = ["statut <> 'brouillon'"];
  const args: InArgs = [];

  if (query.statut?.length) {
    where.push(`statut IN (${query.statut.map(() => '?').join(',')})`);
    args.push(...query.statut);
  }
  if (query.from) {
    where.push('date_fin >= ?');
    args.push(query.from);
  }
  if (query.to) {
    where.push('date_debut <= ?');
    args.push(query.to);
  }
  args.push(query.limit);

  const rows = await all<EventRow>(
    `SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY date_debut ASC LIMIT ?`,
    args,
  );
  return Promise.all(rows.map(enrichir));
}

export async function getEvent(id: string): Promise<EventDto | null> {
  const row = await one<EventRow>('SELECT * FROM events WHERE id = ?', [id]);
  return row ? enrichir(row) : null;
}

async function chargerBrut(id: string): Promise<EventRow> {
  const row = await one<EventRow>('SELECT * FROM events WHERE id = ?', [id]);
  if (!row) throw notFound('EVENT_NOT_FOUND', 'erreurs.chantier_introuvable');
  return row;
}

function assertOrganisateur(row: EventRow, user: UtilisateurSession): void {
  if (row.organisateur_id !== user.id && user.role === 'citoyen') {
    throw forbidden('NOT_ORGANIZER', 'erreurs.pas_organisateur');
  }
}

// ---------------------------------------------------------------------------
// Création et publication
// ---------------------------------------------------------------------------

export async function creerEvent(
  input: CreateEventInput,
  user: UtilisateurSession,
): Promise<EventDto> {
  // Organiser engage des gens sur le terrain : on exige un numéro vérifié.
  assertVerifie(user);

  const rdv: LngLat = [input.point_rdv_lng, input.point_rdv_lat];
  assertDansCommune(rdv);

  const spots = await all<{ id: string }>(
    `SELECT id FROM spots
      WHERE id IN (${input.spot_ids.map(() => '?').join(',')})
        AND statut NOT IN ('nettoye','rejete')
        AND moderation_status <> 'rejected'`,
    input.spot_ids,
  );
  if (spots.length === 0) {
    throw unprocessable('NO_VALID_SPOTS', 'erreurs.aucun_spot_valide');
  }

  const id = `evt_${randomUUID()}`;
  await run(
    `INSERT INTO events (id, titre, description, date_debut, date_fin,
       point_rdv_lat, point_rdv_lng, organisateur_id, capacite, materiel_fourni,
       autorisation_obtenue, evacuation_par, contact_evacuation_nom,
       contact_evacuation_tel, evacuation_risque_acquittee, statut, qr_secret, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'brouillon',?,?)`,
    [
      id,
      input.titre,
      input.description ?? null,
      input.date_debut,
      input.date_fin,
      input.point_rdv_lat,
      input.point_rdv_lng,
      user.id,
      input.capacite ?? null,
      JSON.stringify(input.materiel_fourni),
      input.autorisation_obtenue ? 1 : 0,
      input.evacuation_par,
      input.contact_evacuation_nom,
      input.contact_evacuation_tel,
      input.evacuation_risque_acquittee ? 1 : 0,
      randomBytes(20).toString('base64url'),
      new Date().toISOString(),
    ],
  );

  for (const spot of spots) {
    await run('INSERT INTO event_spots (event_id, spot_id) VALUES (?,?)', [id, spot.id]);
  }

  const dto = await getEvent(id);
  if (!dto) throw conflict('EVENT_CREATION_FAILED', 'erreurs.interne');
  return dto;
}

/**
 * Publication : le seul point où la règle #3 mord vraiment.
 *
 * Une évacuation `non_confirme` reste publiable — parfois il n'y a pas mieux —
 * mais uniquement si l'organisateur a coché la case reconnaissant le risque.
 * L'événement portera alors un bandeau orange bien visible.
 */
export async function publierEvent(id: string, user: UtilisateurSession): Promise<EventDto> {
  const row = await chargerBrut(id);
  assertOrganisateur(row, user);

  if (row.statut !== 'brouillon') {
    throw conflict('ALREADY_PUBLISHED', 'erreurs.chantier_deja_publie');
  }
  if (row.evacuation_par === 'non_confirme' && row.evacuation_risque_acquittee !== 1) {
    throw unprocessable('EVACUATION_NOT_ACKNOWLEDGED', 'erreurs.evacuation_non_acquittee');
  }
  // On refuse un chantier TERMINÉ, pas un chantier commencé : publier une heure
  // après le début est un cas réel (mobilisation de dernière minute), et
  // l'interdire pousserait à antidater.
  if (Date.parse(row.date_fin) < Date.now()) {
    throw unprocessable('EVENT_IN_PAST', 'erreurs.chantier_dans_le_passe');
  }

  await run("UPDATE events SET statut = 'publie' WHERE id = ?", [id]);

  // Les spots rattachés passent en « planifié » : la carte doit montrer qu'un
  // chantier est prévu, sinon d'autres organisent en double au même endroit.
  await run(
    `UPDATE spots SET statut = 'planifie'
      WHERE id IN (SELECT spot_id FROM event_spots WHERE event_id = ?)
        AND statut IN ('signale','confirme','a_verifier','recidive')`,
    [id],
  );

  const dto = await getEvent(id);
  if (!dto) throw notFound('EVENT_NOT_FOUND', 'erreurs.chantier_introuvable');
  return dto;
}

export async function annulerEvent(id: string, user: UtilisateurSession): Promise<EventDto> {
  const row = await chargerBrut(id);
  assertOrganisateur(row, user);
  if (row.statut === 'termine') {
    throw conflict('EVENT_FINISHED', 'erreurs.chantier_termine');
  }

  await run("UPDATE events SET statut = 'annule' WHERE id = ?", [id]);
  // Les spots redeviennent « confirmé » : le problème, lui, n'a pas disparu.
  await run(
    `UPDATE spots SET statut = 'confirme'
      WHERE id IN (SELECT spot_id FROM event_spots WHERE event_id = ?) AND statut = 'planifie'`,
    [id],
  );

  const dto = await getEvent(id);
  if (!dto) throw notFound('EVENT_NOT_FOUND', 'erreurs.chantier_introuvable');
  return dto;
}

// ---------------------------------------------------------------------------
// Inscriptions et présence
// ---------------------------------------------------------------------------

export async function sInscrire(
  eventId: string,
  user: UtilisateurSession,
): Promise<{ statut: string; inscrits: number }> {
  const row = await chargerBrut(eventId);
  if (row.statut !== 'publie' && row.statut !== 'en_cours') {
    throw conflict('EVENT_NOT_OPEN', 'erreurs.chantier_ferme');
  }

  const deja = await one<{ id: string }>(
    'SELECT id FROM participations WHERE event_id = ? AND user_id = ?',
    [eventId, user.id],
  );
  if (deja) return { statut: 'inscrit', inscrits: await compterInscrits(eventId) };

  if (row.capacite !== null) {
    const inscrits = await compterInscrits(eventId);
    if (inscrits >= row.capacite) {
      throw conflict('EVENT_FULL', 'erreurs.chantier_complet');
    }
  }

  await run(
    `INSERT INTO participations (id, event_id, user_id, statut, created_at)
     VALUES (?,?,?,'inscrit',?)`,
    [`prt_${randomUUID()}`, eventId, user.id, new Date().toISOString()],
  );
  return { statut: 'inscrit', inscrits: await compterInscrits(eventId) };
}

export async function seDesinscrire(eventId: string, user: UtilisateurSession): Promise<void> {
  await run("DELETE FROM participations WHERE event_id = ? AND user_id = ? AND statut = 'inscrit'", [
    eventId,
    user.id,
  ]);
}

const compterInscrits = (eventId: string): Promise<number> =>
  count('SELECT COUNT(*) AS n FROM participations WHERE event_id = ?', [eventId]);

/** Code affiché par l'organisateur, renouvelé toutes les 30 secondes. */
export async function codePresence(
  eventId: string,
  user: UtilisateurSession,
): Promise<{ code: string; expire_dans_s: number }> {
  const row = await chargerBrut(eventId);
  assertOrganisateur(row, user);
  const secret = await one<{ qr_secret: string }>('SELECT qr_secret FROM events WHERE id = ?', [
    eventId,
  ]);
  if (!secret) throw notFound('EVENT_NOT_FOUND', 'erreurs.chantier_introuvable');
  return { code: genererCode(secret.qr_secret), expire_dans_s: secondesRestantes() };
}

export interface ResultatCheckin {
  statut: 'present';
  methode: CheckinMethod;
  points: number;
  raison_sans_points?: string;
}

/**
 * Enregistrement de présence.
 *
 * Deux voies, jamais l'auto-déclaration seule : le code rotatif affiché par
 * l'organisateur, ou la position à moins de 150 m du point de rendez-vous
 * pendant la fenêtre horaire.
 */
export async function checkin(
  eventId: string,
  input: CheckinInput,
  user: UtilisateurSession,
): Promise<ResultatCheckin> {
  const row = await chargerBrut(eventId);

  if (row.statut !== 'publie' && row.statut !== 'en_cours') {
    throw conflict('EVENT_NOT_OPEN', 'erreurs.chantier_ferme');
  }

  const maintenant = Date.now();
  const tolerance = TOLERANCE_CHECKIN_MIN * 60_000;
  if (
    maintenant < Date.parse(row.date_debut) - tolerance ||
    maintenant > Date.parse(row.date_fin) + tolerance
  ) {
    throw unprocessable('OUTSIDE_TIME_WINDOW', 'erreurs.hors_fenetre_horaire');
  }

  let methode: CheckinMethod;
  if (input.code !== undefined) {
    const secret = await one<{ qr_secret: string }>('SELECT qr_secret FROM events WHERE id = ?', [
      eventId,
    ]);
    if (!secret || !verifierCode(secret.qr_secret, input.code)) {
      throw unprocessable('INVALID_CODE', 'erreurs.code_presence_invalide');
    }
    methode = 'qr';
  } else {
    const distance = haversine(
      [input.lng as number, input.lat as number],
      [row.point_rdv_lng, row.point_rdv_lat],
    );
    if (distance > RAYON_CHECKIN_M) {
      throw unprocessable('TOO_FAR', 'erreurs.trop_loin_du_rdv', {
        distance_m: Math.round(distance),
        rayon_m: RAYON_CHECKIN_M,
      });
    }
    methode = 'geo';
  }

  const existante = await one<{ id: string; statut: string }>(
    'SELECT id, statut FROM participations WHERE event_id = ? AND user_id = ?',
    [eventId, user.id],
  );
  if (existante?.statut === 'present') {
    throw conflict('ALREADY_CHECKED_IN', 'erreurs.presence_deja_enregistree');
  }

  const horodatage = new Date().toISOString();
  if (existante) {
    await run(
      `UPDATE participations SET statut = 'present', checked_in_at = ?, method = ?,
         checkin_lat = ?, checkin_lng = ? WHERE id = ?`,
      [horodatage, methode, input.lat ?? null, input.lng ?? null, existante.id],
    );
  } else {
    // Venir sans s'être inscrit est courant : on ne pénalise pas.
    await run(
      `INSERT INTO participations (id, event_id, user_id, statut, checked_in_at, method,
         checkin_lat, checkin_lng, created_at)
       VALUES (?,?,?,'present',?,?,?,?,?)`,
      [
        `prt_${randomUUID()}`,
        eventId,
        user.id,
        horodatage,
        methode,
        input.lat ?? null,
        input.lng ?? null,
        horodatage,
      ],
    );
  }

  const decision = deciderParticipation({
    presenceVerifiee: true,
    estOrganisateur: row.organisateur_id === user.id,
  });
  const attribution = await attribuer({
    userId: user.id,
    decision,
    refType: 'event',
    refId: eventId,
    quartierId: resoudreQuartier([row.point_rdv_lng, row.point_rdv_lat]),
  });

  return {
    statut: 'present',
    methode,
    points: attribution.points,
    ...(attribution.raison !== undefined ? { raison_sans_points: attribution.raison } : {}),
  };
}

export async function listerParticipants(
  eventId: string,
  user: UtilisateurSession,
): Promise<{ id: string; pseudo: string; statut: string; checked_in_at: string | null; method: string | null }[]> {
  const row = await chargerBrut(eventId);
  assertOrganisateur(row, user);
  return all(
    `SELECT p.id, u.pseudo, p.statut, p.checked_in_at, p.method
       FROM participations p JOIN users u ON u.id = p.user_id
      WHERE p.event_id = ?
      ORDER BY p.checked_in_at DESC NULLS LAST, u.pseudo ASC`,
    [eventId],
  );
}

// ---------------------------------------------------------------------------
// Clôture
// ---------------------------------------------------------------------------

export interface ResultatCloture {
  event: EventDto;
  points_organisateur: number;
  raison_sans_points?: string;
  spots_fermes: number;
}

/**
 * Clôture avec preuve avant/après.
 *
 * C'est ici que les 150 points de l'organisateur se gagnent — sur résultat
 * démontré, pas sur intention : deux photos et au moins trois présents.
 */
export async function cloturerEvent(
  eventId: string,
  input: ClotureEventInput,
  user: UtilisateurSession,
): Promise<ResultatCloture> {
  const row = await chargerBrut(eventId);
  assertOrganisateur(row, user);
  if (row.statut === 'termine') throw conflict('EVENT_FINISHED', 'erreurs.chantier_termine');
  if (row.statut === 'annule') throw conflict('EVENT_CANCELLED', 'erreurs.chantier_annule');

  const presents = await count(
    "SELECT COUNT(*) AS n FROM participations WHERE event_id = ? AND statut = 'present'",
    [eventId],
  );

  const horodatage = new Date().toISOString();
  const operations = [
    {
      sql: `UPDATE events SET statut = 'termine', kg_collectes = ?, photo_avant_url = ?,
              photo_apres_url = ?, cloture_at = ? WHERE id = ?`,
      args: [input.kg_collectes, input.photo_avant_url, input.photo_apres_url, horodatage, eventId],
    },
  ];

  // Seuls les spots déclarés nettoyés sont fermés ; les autres restent ouverts.
  // Un chantier partiel est la norme, pas l'exception.
  const aFermer = input.spots_nettoyes.length > 0 ? input.spots_nettoyes : [];
  if (aFermer.length > 0) {
    operations.push({
      sql: `UPDATE spots SET statut = 'nettoye', cleaned_at = ?
             WHERE id IN (${aFermer.map(() => '?').join(',')})
               AND id IN (SELECT spot_id FROM event_spots WHERE event_id = ?)`,
      args: [horodatage, ...aFermer, eventId],
    });
  }
  // Les spots planifiés non nettoyés retournent à « confirmé ».
  operations.push({
    sql: `UPDATE spots SET statut = 'confirme'
           WHERE id IN (SELECT spot_id FROM event_spots WHERE event_id = ?) AND statut = 'planifie'`,
    args: [eventId],
  });

  await db.batch(operations, 'write');

  const decision = deciderOrganisation({
    aPhotoAvant: true,
    aPhotoApres: true,
    nombrePresents: presents,
  });
  const attribution = await attribuer({
    userId: row.organisateur_id,
    decision,
    refType: 'event',
    refId: eventId,
    quartierId: resoudreQuartier([row.point_rdv_lng, row.point_rdv_lat]),
  });

  const event = await getEvent(eventId);
  if (!event) throw notFound('EVENT_NOT_FOUND', 'erreurs.chantier_introuvable');
  return {
    event,
    points_organisateur: attribution.points,
    ...(attribution.raison !== undefined ? { raison_sans_points: attribution.raison } : {}),
    spots_fermes: aFermer.length,
  };
}

export const MIN_PRESENTS = MIN_PRESENTS_ORGANISATION;
