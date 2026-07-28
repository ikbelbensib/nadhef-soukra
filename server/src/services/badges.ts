/**
 * Badges.
 *
 * Les conditions sont décrites en données (`badges.condition_json`) et non en
 * code : ajouter un badge doit être une migration SQL, pas un déploiement. Le
 * format est volontairement pauvre — `{metric, op, value}` — pour rester
 * évaluable sans interpréteur et sans surprise.
 *
 * Les compteurs se lisent tous depuis le ledger `point_events` ou depuis les
 * tables métier : aucun compteur dénormalisé à maintenir, donc rien à
 * resynchroniser quand un point est retiré.
 */

import { z } from 'zod';
import { all, one, run } from '../db/client.js';

export const METRIQUES = [
  'spots_approuves',
  'reconfirmations',
  'participations',
  'organisations',
  'spots_fermes',
  'kg_collectes',
  'points',
] as const;
export type Metrique = (typeof METRIQUES)[number];

const conditionSchema = z.object({
  metric: z.enum(METRIQUES),
  op: z.enum(['>=', '>', '==']),
  value: z.number(),
});

export interface BadgeDto {
  id: string;
  code: string;
  nom_fr: string;
  nom_ar: string;
  description_fr: string;
  description_ar: string;
  condition: { metric: Metrique; op: string; value: number };
  /** Renseigné quand on interroge le profil d'un utilisateur. */
  awarded_at?: string;
}

interface BadgeRow {
  id: string;
  code: string;
  nom_fr: string;
  nom_ar: string;
  description_fr: string;
  description_ar: string;
  condition_json: string;
}

/** Une seule requête par métrique, calculée à la demande. */
async function calculerMetriques(userId: string): Promise<Record<Metrique, number>> {
  const [ledger, kg] = await Promise.all([
    all<{ action: string; n: number }>(
      `SELECT action, COUNT(*) AS n FROM point_events WHERE user_id = ? GROUP BY action`,
      [userId],
    ),
    one<{ total: number }>(
      // Les kilos comptent pour tous les PRÉSENTS, pas seulement l'organisateur :
      // c'est un effort collectif, et le badge doit le refléter.
      `SELECT COALESCE(SUM(e.kg_collectes), 0) AS total
         FROM participations p
         JOIN events e ON e.id = p.event_id
        WHERE p.user_id = ? AND p.statut = 'present' AND e.statut = 'termine'`,
      [userId],
    ),
    ]);

  const parAction = new Map(ledger.map((r) => [r.action, Number(r.n)]));
  const points = await one<{ total: number }>(
    'SELECT COALESCE(SUM(points), 0) AS total FROM point_events WHERE user_id = ?',
    [userId],
  );

  return {
    spots_approuves: parAction.get('spot_cree') ?? 0,
    reconfirmations: parAction.get('spot_reconfirme') ?? 0,
    participations: parAction.get('participation') ?? 0,
    organisations: parAction.get('organisation') ?? 0,
    spots_fermes: parAction.get('spot_ferme') ?? 0,
    kg_collectes: Number(kg?.total ?? 0),
    points: Number(points?.total ?? 0),
  };
}

export function conditionRemplie(
  condition: { op: string; value: number },
  valeur: number,
): boolean {
  switch (condition.op) {
    case '>=':
      return valeur >= condition.value;
    case '>':
      return valeur > condition.value;
    case '==':
      return valeur === condition.value;
    default:
      return false;
  }
}

function parser(row: BadgeRow): BadgeDto | null {
  const parsed = conditionSchema.safeParse(JSON.parse(row.condition_json));
  if (!parsed.success) {
    // Un badge mal décrit ne doit jamais bloquer l'attribution des autres.
    console.error(`✗ Badge ${row.code} : condition invalide`, parsed.error.issues);
    return null;
  }
  return {
    id: row.id,
    code: row.code,
    nom_fr: row.nom_fr,
    nom_ar: row.nom_ar,
    description_fr: row.description_fr,
    description_ar: row.description_ar,
    condition: parsed.data,
  };
}

export async function catalogue(): Promise<BadgeDto[]> {
  const rows = await all<BadgeRow>('SELECT * FROM badges ORDER BY code');
  return rows.map(parser).filter((b): b is BadgeDto => b !== null);
}

/**
 * Évalue et attribue les badges nouvellement mérités.
 *
 * Appelé après chaque gain de points. L'écriture est idempotente par la clé
 * primaire composite de `user_badges` — rejouer ne duplique pas.
 */
export async function evaluerBadges(userId: string): Promise<BadgeDto[]> {
  const [badges, metriques, deja] = await Promise.all([
    catalogue(),
    calculerMetriques(userId),
    all<{ badge_id: string }>('SELECT badge_id FROM user_badges WHERE user_id = ?', [userId]),
  ]);

  const possedes = new Set(deja.map((d) => d.badge_id));
  const nouveaux: BadgeDto[] = [];
  const horodatage = new Date().toISOString();

  for (const badge of badges) {
    if (possedes.has(badge.id)) continue;
    if (!conditionRemplie(badge.condition, metriques[badge.condition.metric])) continue;
    await run(
      'INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_at) VALUES (?,?,?)',
      [userId, badge.id, horodatage],
    );
    nouveaux.push({ ...badge, awarded_at: horodatage });
  }
  return nouveaux;
}

export async function badgesDe(userId: string): Promise<BadgeDto[]> {
  const rows = await all<BadgeRow & { awarded_at: string }>(
    `SELECT b.*, ub.awarded_at
       FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = ?
      ORDER BY ub.awarded_at DESC`,
    [userId],
  );
  const badges: BadgeDto[] = [];
  for (const row of rows) {
    const badge = parser(row);
    if (badge) badges.push({ ...badge, awarded_at: row.awarded_at });
  }
  return badges;
}

export const _metriques = calculerMetriques;
