/**
 * Statistiques publiques.
 *
 * Cette page a deux publics : les habitants, qu'elle doit motiver, et la
 * municipalité ou un bailleur, qu'elle doit convaincre. D'où le choix des
 * indicateurs : pas de vanité (« X signalements ! »), mais des résultats —
 * points fermés, kilos, et surtout **taux de récidive**, le seul chiffre qui
 * dise si un nettoyage a tenu.
 */

import { JOURS_AVANT_A_VERIFIER, JOURS_AVANT_ARCHIVE } from '@nadhef/shared';
import { all, count, one } from '../db/client.js';

export interface StatsPubliques {
  genere_le: string;
  commune: string;
  spots: {
    total: number;
    actifs: number;
    nettoyes: number;
    a_verifier: number;
    archives: number;
    en_recidive: number;
    /** Part des spots nettoyés qui ont été re-signalés au même endroit. */
    taux_recidive: number;
  };
  chantiers: {
    realises: number;
    a_venir: number;
    kg_collectes: number;
    participations: number;
    sans_evacuation_confirmee: number;
  };
  communaute: {
    contributeurs: number;
    contributeurs_verifies: number;
    confirmations: number;
  };
  par_quartier: {
    quartier_id: string;
    nom_fr: string;
    nom_ar: string;
    spots_actifs: number;
    spots_nettoyes: number;
  }[];
  par_type: { type: string; total: number; nettoyes: number }[];
  /** Douze derniers mois, pour montrer une tendance et non un instantané. */
  historique: { mois: string; signales: number; nettoyes: number }[];
}

let cache: { valeur: StatsPubliques; expire: number } | null = null;
const DUREE_CACHE_MS = 5 * 60_000;

export async function statsPubliques(commune: string): Promise<StatsPubliques> {
  if (cache && cache.expire > Date.now()) return cache.valeur;

  const visible = "moderation_status NOT IN ('rejected','hidden') AND statut <> 'rejete'";

  const [
    total,
    nettoyes,
    recidives,
    aVerifier,
    archives,
    chantiersFaits,
    chantiersAVenir,
    sansEvacuation,
    confirmations,
    contributeurs,
    verifies,
  ] = await Promise.all([
    count(`SELECT COUNT(*) AS n FROM spots WHERE ${visible}`),
    count(`SELECT COUNT(*) AS n FROM spots WHERE ${visible} AND statut = 'nettoye'`),
    count(`SELECT COUNT(*) AS n FROM spots WHERE ${visible} AND parent_spot_id IS NOT NULL`),
    count(
      `SELECT COUNT(*) AS n FROM spots WHERE ${visible}
         AND statut <> 'nettoye'
         AND julianday('now') - julianday(last_confirmed_at) BETWEEN ${JOURS_AVANT_A_VERIFIER} AND ${JOURS_AVANT_ARCHIVE}`,
    ),
    count(
      `SELECT COUNT(*) AS n FROM spots WHERE ${visible}
         AND julianday('now') - julianday(last_confirmed_at) > ${JOURS_AVANT_ARCHIVE}`,
    ),
    count("SELECT COUNT(*) AS n FROM events WHERE statut = 'termine'"),
    count("SELECT COUNT(*) AS n FROM events WHERE statut IN ('publie','en_cours')"),
    count(
      `SELECT COUNT(*) AS n FROM events
        WHERE evacuation_par = 'non_confirme' AND statut IN ('publie','en_cours','termine')`,
    ),
    count('SELECT COUNT(*) AS n FROM confirmations'),
    count('SELECT COUNT(DISTINCT user_id) AS n FROM point_events'),
    count('SELECT COUNT(*) AS n FROM users WHERE phone_hash IS NOT NULL AND banned_at IS NULL'),
  ]);

  const [kg, participations] = await Promise.all([
    one<{ total: number }>(
      "SELECT COALESCE(SUM(kg_collectes), 0) AS total FROM events WHERE statut = 'termine'",
    ),
    count("SELECT COUNT(*) AS n FROM participations WHERE statut = 'present'"),
  ]);

  const parQuartier = await all<{
    quartier_id: string;
    nom_fr: string;
    nom_ar: string;
    spots_actifs: number;
    spots_nettoyes: number;
  }>(
    `SELECT q.id AS quartier_id, q.nom_fr, q.nom_ar,
            COUNT(CASE WHEN s.statut <> 'nettoye' THEN 1 END) AS spots_actifs,
            COUNT(CASE WHEN s.statut = 'nettoye'  THEN 1 END) AS spots_nettoyes
       FROM quartiers q
       LEFT JOIN spots s ON s.quartier_id = q.id
            AND s.moderation_status NOT IN ('rejected','hidden')
            AND s.statut <> 'rejete'
      GROUP BY q.id
      ORDER BY spots_actifs DESC`,
  );

  const parType = await all<{ type: string; total: number; nettoyes: number }>(
    `SELECT type, COUNT(*) AS total,
            COUNT(CASE WHEN statut = 'nettoye' THEN 1 END) AS nettoyes
       FROM spots WHERE ${visible}
      GROUP BY type ORDER BY total DESC`,
  );

  const historique = await all<{ mois: string; signales: number; nettoyes: number }>(
    `SELECT strftime('%Y-%m', created_at) AS mois,
            COUNT(*) AS signales,
            COUNT(CASE WHEN statut = 'nettoye' THEN 1 END) AS nettoyes
       FROM spots
      WHERE ${visible} AND created_at > datetime('now','-12 months')
      GROUP BY mois ORDER BY mois ASC`,
  );

  const valeur: StatsPubliques = {
    genere_le: new Date().toISOString(),
    commune,
    spots: {
      total,
      actifs: total - nettoyes,
      nettoyes,
      a_verifier: aVerifier,
      archives,
      en_recidive: recidives,
      // Rapporté aux spots nettoyés, pas au total : c'est la question « est-ce
      // que ça tient ? », et elle n'a de sens que là où on est intervenu.
      taux_recidive: nettoyes > 0 ? Number(((recidives / nettoyes) * 100).toFixed(1)) : 0,
    },
    chantiers: {
      realises: chantiersFaits,
      a_venir: chantiersAVenir,
      kg_collectes: Number(kg?.total ?? 0),
      participations,
      sans_evacuation_confirmee: sansEvacuation,
    },
    communaute: {
      contributeurs,
      contributeurs_verifies: verifies,
      confirmations,
    },
    par_quartier: parQuartier.map((q) => ({
      ...q,
      spots_actifs: Number(q.spots_actifs),
      spots_nettoyes: Number(q.spots_nettoyes),
    })),
    par_type: parType.map((t) => ({
      type: t.type,
      total: Number(t.total),
      nettoyes: Number(t.nettoyes),
    })),
    historique: historique.map((h) => ({
      mois: h.mois,
      signales: Number(h.signales),
      nettoyes: Number(h.nettoyes),
    })),
  };

  cache = { valeur, expire: Date.now() + DUREE_CACHE_MS };
  return valeur;
}

/** Utilisé par les tests et après une écriture massive. */
export const viderCacheStats = (): void => {
  cache = null;
};
