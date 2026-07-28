/**
 * Classements.
 *
 * Deux décisions structurantes, prises contre l'évidence :
 *
 * 1. **Fenêtre glissante de 90 jours.** Un classement cumulatif fige le
 *    résultat : le quartier parti en premier reste premier pour toujours, et
 *    les autres décrochent au bout d'un mois. Une saison qui se rejoue donne
 *    une raison de s'y remettre.
 *
 * 2. **Seuil d'activité minimal.** Sans lui, un quartier avec trois
 *    participations et peu d'habitants rafle la tête au ratio. En dessous du
 *    seuil, le quartier est « non classé » — visible, mais hors podium.
 *
 * Le classement citoyens ne liste que les comptes vérifiés : c'est l'incitation
 * à la vérification, sans jamais bloquer la contribution.
 */

import {
  FENETRE_CLASSEMENT_J,
  MIN_PARTICIPATIONS_CLASSEMENT,
} from '@nadhef/shared';
import { all } from '../db/client.js';

export type Periode = '30d' | '90d' | 'all';

const JOURS: Record<Periode, number | null> = { '30d': 30, '90d': FENETRE_CLASSEMENT_J, all: null };

export interface LigneQuartier {
  rang: number | null;
  quartier_id: string;
  nom_fr: string;
  nom_ar: string;
  population_estimee: number;
  points: number;
  /** Points pour 1 000 habitants — la seule comparaison honnête entre quartiers. */
  points_par_1000: number;
  contributeurs: number;
  actions: number;
  classe: boolean;
  spots_fermes: number;
  kg_collectes: number;
}

export async function classementQuartiers(periode: Periode = '90d'): Promise<{
  periode: Periode;
  seuil_actions: number;
  lignes: LigneQuartier[];
}> {
  const jours = JOURS[periode];
  const filtreDate = jours === null ? '' : `AND pe.created_at > datetime('now','-${jours} days')`;

  const lignes = await all<{
    quartier_id: string;
    nom_fr: string;
    nom_ar: string;
    population_estimee: number;
    points: number;
    contributeurs: number;
    actions: number;
  }>(
    `SELECT q.id AS quartier_id, q.nom_fr, q.nom_ar, q.population_estimee,
            COALESCE(SUM(pe.points), 0) AS points,
            COUNT(DISTINCT pe.user_id) AS contributeurs,
            COUNT(pe.id) AS actions
       FROM quartiers q
       LEFT JOIN point_events pe ON pe.quartier_id = q.id ${filtreDate}
      GROUP BY q.id
      ORDER BY q.nom_fr`,
  );

  // Les indicateurs de résultat se lisent sur les faits, pas sur les points :
  // c'est ce qui parle à une municipalité.
  const fermes = await all<{ quartier_id: string; spots_fermes: number }>(
    `SELECT quartier_id, COUNT(*) AS spots_fermes
       FROM spots
      WHERE quartier_id IS NOT NULL AND statut = 'nettoye'
      GROUP BY quartier_id`,
  );

  /**
   * Un chantier peut couvrir plusieurs quartiers : ses kilos sont répartis à
   * parts égales entre eux. Les attribuer en entier à chacun gonflerait le
   * total au-delà de ce qui a réellement été collecté.
   */
  const kilos = await all<{ quartier_id: string; kg: number }>(
    `WITH paires AS (
       SELECT DISTINCT es.event_id, s.quartier_id
         FROM event_spots es JOIN spots s ON s.id = es.spot_id
        WHERE s.quartier_id IS NOT NULL
     ),
     comptes AS (SELECT event_id, COUNT(*) AS n FROM paires GROUP BY event_id)
     SELECT p.quartier_id, SUM(e.kg_collectes * 1.0 / c.n) AS kg
       FROM paires p
       JOIN comptes c ON c.event_id = p.event_id
       JOIN events  e ON e.id = p.event_id
      WHERE e.statut = 'termine' AND e.kg_collectes IS NOT NULL
      GROUP BY p.quartier_id`,
  );

  const fermesPar = new Map(fermes.map((r) => [r.quartier_id, Number(r.spots_fermes)]));
  const kilosPar = new Map(kilos.map((r) => [r.quartier_id, Number(r.kg)]));

  const enrichies: LigneQuartier[] = lignes.map((l) => {
    const points = Number(l.points);
    const actions = Number(l.actions);
    return {
      rang: null,
      quartier_id: l.quartier_id,
      nom_fr: l.nom_fr,
      nom_ar: l.nom_ar,
      population_estimee: l.population_estimee,
      points,
      points_par_1000: Number(((points / l.population_estimee) * 1000).toFixed(2)),
      contributeurs: Number(l.contributeurs),
      actions,
      classe: actions >= MIN_PARTICIPATIONS_CLASSEMENT,
      spots_fermes: fermesPar.get(l.quartier_id) ?? 0,
      kg_collectes: Number((kilosPar.get(l.quartier_id) ?? 0).toFixed(1)),
    };
  });

  // Les quartiers classés en tête, triés au ratio ; les autres à la suite.
  enrichies.sort((a, b) => {
    if (a.classe !== b.classe) return a.classe ? -1 : 1;
    return b.points_par_1000 - a.points_par_1000;
  });
  let rang = 0;
  for (const ligne of enrichies) {
    ligne.rang = ligne.classe ? ++rang : null;
  }

  return { periode, seuil_actions: MIN_PARTICIPATIONS_CLASSEMENT, lignes: enrichies };
}

export interface LigneCitoyen {
  rang: number;
  user_id: string;
  pseudo: string;
  quartier_id: string | null;
  points: number;
  actions: number;
  badges: number;
}

export async function classementCitoyens(
  periode: Periode = '90d',
  limite = 100,
): Promise<{ periode: Periode; lignes: LigneCitoyen[] }> {
  const jours = JOURS[periode];
  const filtreDate = jours === null ? '' : `AND pe.created_at > datetime('now','-${jours} days')`;

  const lignes = await all<{
    user_id: string;
    pseudo: string;
    quartier_id: string | null;
    points: number;
    actions: number;
    badges: number;
  }>(
    `SELECT u.id AS user_id, u.pseudo, u.quartier_id,
            COALESCE(SUM(pe.points), 0) AS points,
            COUNT(pe.id) AS actions,
            (SELECT COUNT(*) FROM user_badges ub WHERE ub.user_id = u.id) AS badges
       FROM users u
       JOIN point_events pe ON pe.user_id = u.id ${filtreDate}
      WHERE u.banned_at IS NULL
        AND u.phone_hash IS NOT NULL
      GROUP BY u.id
     -- SUM explicite : un alias "points" nu serait ambigu, la table users
     -- portant elle aussi une colonne de ce nom.
     HAVING SUM(pe.points) > 0
      ORDER BY SUM(pe.points) DESC, u.created_at ASC
      LIMIT ?`,
    [limite],
  );

  return {
    periode,
    lignes: lignes.map((l, i) => ({
      rang: i + 1,
      user_id: l.user_id,
      pseudo: l.pseudo,
      quartier_id: l.quartier_id,
      points: Number(l.points),
      actions: Number(l.actions),
      badges: Number(l.badges),
    })),
  };
}

/** Rang personnel, y compris pour un compte non vérifié absent du classement public. */
export async function rangPersonnel(
  userId: string,
  periode: Periode = '90d',
): Promise<{ points: number; rang: number | null; verifie: boolean } | null> {
  const jours = JOURS[periode];
  // La colonne DOIT être qualifiée : `users` et `point_events` ont tous deux un
  // `created_at`, et une sous-requête corrélée le résout silencieusement sur la
  // mauvaise table — ou échoue en « ambiguous column name ».
  const filtreDate = jours === null ? '' : `AND pe.created_at > datetime('now','-${jours} days')`;

  const [moi] = await all<{ points: number; verifie: number }>(
    `SELECT COALESCE((SELECT SUM(pe.points) FROM point_events pe
                       WHERE pe.user_id = u.id ${filtreDate}), 0) AS points,
            CASE WHEN u.phone_hash IS NOT NULL THEN 1 ELSE 0 END AS verifie
       FROM users u WHERE u.id = ?`,
    [userId],
  );
  if (!moi) return null;

  const [devant] = await all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT u.id, COALESCE(SUM(pe.points), 0) AS pts
         FROM users u JOIN point_events pe ON pe.user_id = u.id ${filtreDate}
        WHERE u.banned_at IS NULL AND u.phone_hash IS NOT NULL
        GROUP BY u.id
       HAVING pts > ?
     )`,
    [Number(moi.points)],
  );

  return {
    points: Number(moi.points),
    rang: moi.verifie === 1 ? Number(devant?.n ?? 0) + 1 : null,
    verifie: moi.verifie === 1,
  };
}
