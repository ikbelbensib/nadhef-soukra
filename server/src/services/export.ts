/**
 * Exports CSV pour la municipalité.
 *
 * Ces fichiers seront ouverts dans Excel. Deux conséquences que le code doit
 * assumer :
 *
 * 1. **Injection de formule.** Une cellule commençant par `=`, `+`, `-`, `@`,
 *    tabulation ou retour chariot est interprétée comme une formule par Excel et
 *    LibreOffice. Une description de spot rédigée par n'importe qui devient
 *    alors un vecteur d'exécution sur le poste d'un agent municipal. On préfixe
 *    donc ces valeurs d'une apostrophe.
 *
 * 2. **Encodage.** Sans BOM UTF-8, Excel sous Windows lit « سكرة » en mojibake.
 *    Le fichier est donc préfixé du BOM.
 */

import { all } from '../db/client.js';

const DANGEREUX = /^[=+\-@\t\r]/;

/** Échappe une valeur pour CSV, et neutralise les formules. */
export function cellule(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  let texte = String(valeur);

  // La neutralisation vient AVANT l'échappement : préfixer après aurait mis
  // l'apostrophe hors des guillemets.
  if (DANGEREUX.test(texte)) texte = `'${texte}`;

  if (/[",;\n\r]/.test(texte)) {
    return `"${texte.replace(/"/g, '""')}"`;
  }
  return texte;
}

/** Point-virgule : c'est le séparateur qu'attend Excel en locale française. */
export const SEPARATEUR = ';';
const BOM = '﻿';

export function versCsv(entetes: readonly string[], lignes: readonly unknown[][]): string {
  const corps = [
    entetes.map(cellule).join(SEPARATEUR),
    ...lignes.map((l) => l.map(cellule).join(SEPARATEUR)),
  ].join('\r\n');
  return BOM + corps + '\r\n';
}

export async function exportSpots(): Promise<string> {
  const rows = await all<Record<string, unknown>>(
    `SELECT s.id, s.created_at, s.last_confirmed_at, s.cleaned_at,
            q.nom_fr AS quartier, s.type, s.gravite, s.statut, s.moderation_status,
            s.lat, s.lng, s.geohash8, s.is_private_property, s.description,
            (SELECT COUNT(*) FROM confirmations c WHERE c.spot_id = s.id) AS confirmations,
            CASE WHEN s.parent_spot_id IS NULL THEN 0 ELSE 1 END AS est_recidive
       FROM spots s LEFT JOIN quartiers q ON q.id = s.quartier_id
      WHERE s.moderation_status <> 'rejected'
      ORDER BY s.created_at DESC`,
  );

  return versCsv(
    [
      'identifiant', 'signale_le', 'dernier_contact', 'nettoye_le', 'quartier', 'type',
      'gravite', 'statut', 'moderation', 'latitude', 'longitude', 'geohash',
      'propriete_privee', 'description', 'confirmations', 'recidive',
    ],
    rows.map((r) => [
      r['id'], r['created_at'], r['last_confirmed_at'], r['cleaned_at'], r['quartier'],
      r['type'], r['gravite'], r['statut'], r['moderation_status'], r['lat'], r['lng'],
      r['geohash8'], Number(r['is_private_property']) === 1 ? 'oui' : 'non',
      r['description'], r['confirmations'], Number(r['est_recidive']) === 1 ? 'oui' : 'non',
    ]),
  );
}

export async function exportChantiers(): Promise<string> {
  const rows = await all<Record<string, unknown>>(
    `SELECT e.id, e.titre, e.date_debut, e.date_fin, e.statut, u.pseudo AS organisateur,
            e.evacuation_par, e.contact_evacuation_nom, e.contact_evacuation_tel,
            e.autorisation_obtenue, e.kg_collectes,
            (SELECT COUNT(*) FROM participations p WHERE p.event_id = e.id) AS inscrits,
            (SELECT COUNT(*) FROM participations p WHERE p.event_id = e.id AND p.statut = 'present') AS presents,
            (SELECT COUNT(*) FROM event_spots es WHERE es.event_id = e.id) AS spots
       FROM events e LEFT JOIN users u ON u.id = e.organisateur_id
      WHERE e.statut <> 'brouillon'
      ORDER BY e.date_debut DESC`,
  );

  return versCsv(
    [
      'identifiant', 'titre', 'debut', 'fin', 'statut', 'organisateur', 'evacuation_par',
      'contact_nom', 'contact_telephone', 'autorisation_municipale', 'kg_collectes',
      'inscrits', 'presents', 'points_noirs',
    ],
    rows.map((r) => [
      r['id'], r['titre'], r['date_debut'], r['date_fin'], r['statut'], r['organisateur'],
      r['evacuation_par'], r['contact_evacuation_nom'], r['contact_evacuation_tel'],
      Number(r['autorisation_obtenue']) === 1 ? 'oui' : 'non',
      r['kg_collectes'], r['inscrits'], r['presents'], r['spots'],
    ]),
  );
}

/** Synthèse par quartier — le format qu'attend un service technique. */
export async function exportQuartiers(): Promise<string> {
  const rows = await all<Record<string, unknown>>(
    `SELECT q.nom_fr, q.nom_ar, q.codegeo, q.population_estimee,
            COUNT(CASE WHEN s.statut NOT IN ('nettoye','rejete') THEN 1 END) AS actifs,
            COUNT(CASE WHEN s.statut = 'nettoye' THEN 1 END) AS nettoyes,
            COUNT(CASE WHEN s.gravite = 4 AND s.statut <> 'nettoye' THEN 1 END) AS critiques,
            COUNT(CASE WHEN s.parent_spot_id IS NOT NULL THEN 1 END) AS recidives
       FROM quartiers q
       LEFT JOIN spots s ON s.quartier_id = q.id AND s.moderation_status <> 'rejected'
      GROUP BY q.id ORDER BY actifs DESC`,
  );

  return versCsv(
    [
      'quartier', 'quartier_ar', 'codegeo', 'population_estimee', 'points_actifs',
      'points_nettoyes', 'points_critiques', 'recidives', 'points_actifs_pour_1000_hab',
    ],
    rows.map((r) => {
      const actifs = Number(r['actifs']);
      const population = Number(r['population_estimee']);
      return [
        r['nom_fr'], r['nom_ar'], r['codegeo'], population, actifs, r['nettoyes'],
        r['critiques'], r['recidives'],
        ((actifs / population) * 1000).toFixed(2).replace('.', ','),
      ];
    }),
  );
}
