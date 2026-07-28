/**
 * Seed de développement : quartiers réels + jeu de données fictif.
 *
 * Les spots sont volontairement répartis sur toute la plage de fraîcheur
 * (frais / à vérifier / archivé) afin que la décroissance soit visible dès le
 * premier lancement plutôt que dans 45 jours.
 *
 * Déterministe : même graine, même jeu de données.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  geohashEncode,
  pointInGeometry,
  geometryBBox,
  type GeoJsonAreaGeometry,
  type Gravite,
  type LngLat,
  type SpotType,
} from '@nadhef/shared';
import { db, run, count, initPragmas } from './client.js';
import { env } from '../env.js';
import { estExecuteDirectement } from '../cli.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const MS_JOUR = 86_400_000;

interface QuartierFeature {
  properties: {
    id: string;
    osm_relation_id: number;
    codegeo: string;
    nom_fr: string;
    nom_ar: string;
    population_estimee: number;
    centre_lat: number;
    centre_lng: number;
  };
  geometry: GeoJsonAreaGeometry;
}

/** PRNG déterministe (mulberry32) : le seed doit être reproductible. */
function prng(graine: number): () => number {
  let a = graine;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = prng(20260727);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
const entre = (min: number, max: number): number => min + rand() * (max - min);
const iso = (jours: number): string => new Date(Date.now() - jours * MS_JOUR).toISOString();

/** Tirage rejeté jusqu'à tomber dans le polygone : garantit un point réellement dedans. */
function pointDansQuartier(feature: QuartierFeature): LngLat {
  const box = geometryBBox(feature.geometry);
  for (let i = 0; i < 500; i++) {
    const p: LngLat = [entre(box.minLng, box.maxLng), entre(box.minLat, box.maxLat)];
    if (pointInGeometry(p, feature.geometry)) return p;
  }
  // Repli : le centroïde d'un secteur concave peut être hors polygone, mais il
  // reste dans la commune, ce qui suffit pour un jeu de démonstration.
  return [feature.properties.centre_lng, feature.properties.centre_lat];
}

const TYPES: readonly SpotType[] = [
  'ordures_menageres',
  'gravats',
  'dechets_verts',
  'encombrants',
  'depot_sauvage',
  'terrain_abandonne',
  'conteneur_deborde',
];

const DESCRIPTIONS: Record<SpotType, readonly string[]> = {
  ordures_menageres: ['Sacs éventrés au pied de l\'immeuble', 'Ordures hors des bacs depuis une semaine'],
  gravats: ['Gravats de chantier déversés en bord de route', 'Restes de démolition sur le trottoir'],
  dechets_verts: ['Tailles de haie abandonnées', 'Branchages entassés après élagage'],
  encombrants: ['Vieux canapé et matelas sur le trottoir', 'Électroménager hors d\'usage abandonné'],
  depot_sauvage: ['Dépôt régulier sur le terrain vague', 'Déchets mêlés déversés de nuit'],
  terrain_abandonne: ['Parcelle non clôturée devenue dépotoir', 'Terrain à l\'abandon envahi de déchets'],
  conteneur_deborde: ['Conteneur non collecté, débordement au sol', 'Bac plein depuis plusieurs jours'],
};

/**
 * Répartition de fraîcheur : la décroissance doit être démontrable immédiatement.
 * 16 frais · 7 à vérifier (>45 j) · 7 archivés (>90 j)
 */
const PROFILS_AGE: readonly { min: number; max: number; n: number }[] = [
  { min: 0, max: 40, n: 16 },
  { min: 48, max: 85, n: 7 },
  { min: 95, max: 200, n: 7 },
];

const hashTelephone = (tel: string): string =>
  createHmac('sha256', env.PHONE_PEPPER).update(tel.trim()).digest('hex');

async function seed(): Promise<void> {
  await initPragmas();

  if ((await count('SELECT COUNT(*) AS n FROM _migrations')) === 0) {
    throw new Error('Base non migrée. Lancez `npm run migrate -w server` d\'abord.');
  }
  if ((await count('SELECT COUNT(*) AS n FROM spots')) > 0) {
    console.log('· Des spots existent déjà — seed ignoré. `npm run reset -w server` pour repartir de zéro.');
    return;
  }

  // --- Quartiers -----------------------------------------------------------
  const collection = JSON.parse(
    readFileSync(join(DATA_DIR, 'quartiers.geojson'), 'utf8'),
  ) as { features: QuartierFeature[] };
  const features = collection.features;

  for (const f of features) {
    const p = f.properties;
    await run(
      `INSERT INTO quartiers (id, nom_fr, nom_ar, codegeo, osm_relation_id,
        geojson_polygon, population_estimee, centre_lat, centre_lng)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         nom_fr=excluded.nom_fr, nom_ar=excluded.nom_ar,
         geojson_polygon=excluded.geojson_polygon,
         population_estimee=excluded.population_estimee`,
      [
        p.id, p.nom_fr, p.nom_ar, p.codegeo, p.osm_relation_id,
        JSON.stringify(f.geometry), p.population_estimee, p.centre_lat, p.centre_lng,
      ],
    );
  }
  console.log(`  ✓ ${features.length} quartiers`);

  // --- Utilisateurs --------------------------------------------------------
  const admin = {
    id: 'usr_admin',
    pseudo: env.SEED_ADMIN_PSEUDO,
    phone_hash: hashTelephone(env.SEED_ADMIN_PHONE),
    quartier: features[0]?.properties.id ?? null,
    role: 'admin' as const,
  };
  const citoyens = [
    { id: 'usr_amina', pseudo: 'Amina', tel: '+21620000001', quartier: 'chotrana' },
    { id: 'usr_slim', pseudo: 'Slim', tel: '+21620000002', quartier: 'borj-louzir' },
    { id: 'usr_nadia', pseudo: 'Nadia', tel: '+21620000003', quartier: 'soukra' },
  ];

  await run(
    `INSERT INTO users (id, phone_hash, pseudo, quartier_id, points, role, created_at)
     VALUES (?,?,?,?,0,?,?)`,
    [admin.id, admin.phone_hash, admin.pseudo, admin.quartier, admin.role, iso(120)],
  );
  for (const c of citoyens) {
    await run(
      `INSERT INTO users (id, phone_hash, pseudo, quartier_id, points, role, created_at)
       VALUES (?,?,?,?,0,'citoyen',?)`,
      [c.id, hashTelephone(c.tel), c.pseudo, c.quartier, iso(90)],
    );
  }
  console.log(`  ✓ 1 admin (${admin.pseudo}) + ${citoyens.length} citoyens`);

  // --- Spots ---------------------------------------------------------------
  const auteurs = [null, ...citoyens.map((c) => c.id)];
  const spots: { id: string; quartier: string; lng: number; lat: number }[] = [];
  let index = 0;

  for (const profil of PROFILS_AGE) {
    for (let i = 0; i < profil.n; i++) {
      const feature = features[index % features.length] as QuartierFeature;
      const [lng, lat] = pointDansQuartier(feature);
      const type = pick(TYPES);
      const gravite = pick([1, 2, 2, 3, 3, 4] as const) as Gravite;
      const ageJours = entre(profil.min, profil.max);
      const createdAt = iso(ageJours);
      const auteur = pick(auteurs);
      const id = `spt_${String(index + 1).padStart(3, '0')}`;

      // Un spot ancien mais reconfirmé récemment reste frais : c'est tout
      // l'intérêt du mécanisme, il faut que le seed en contienne.
      const reconfirmeRecemment = profil.min === 0 && rand() < 0.35;
      const lastConfirmed = reconfirmeRecemment ? iso(entre(0, 20)) : createdAt;

      const statut =
        profil.min >= 95 && rand() < 0.4
          ? 'nettoye'
          : profil.min >= 48
            ? 'a_verifier'
            : rand() < 0.3
              ? 'confirme'
              : 'signale';

      await run(
        `INSERT INTO spots (id, lat, lng, geohash8, quartier_id, type, gravite, statut,
           description, created_by, created_by_device, created_at, last_confirmed_at,
           cleaned_at, is_private_property, moderation_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          Number(lat.toFixed(6)),
          Number(lng.toFixed(6)),
          geohashEncode(lng, lat, 8),
          feature.properties.id,
          type,
          gravite,
          statut,
          pick(DESCRIPTIONS[type]),
          auteur,
          auteur === null ? `dev_seed_${index}` : null,
          createdAt,
          lastConfirmed,
          statut === 'nettoye' ? iso(entre(1, 30)) : null,
          type === 'terrain_abandonne' ? 1 : 0,
          // Deux spots restent en attente pour que la file de modération ne soit
          // pas vide au premier lancement.
          index % 15 === 7 ? 'pending' : 'approved',
        ],
      );
      spots.push({ id, quartier: feature.properties.id, lng, lat });
      index++;
    }
  }
  console.log(`  ✓ ${spots.length} spots (16 frais · 7 à vérifier · 7 archivés)`);

  // --- Confirmations -------------------------------------------------------
  let nbConfirmations = 0;
  for (const spot of spots.slice(0, 12)) {
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const auteur = pick(citoyens);
      await run(
        `INSERT INTO confirmations (id, spot_id, user_id, kind, lat, lng, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [
          `cnf_${randomBytes(6).toString('hex')}`,
          spot.id,
          auteur.id,
          'toujours_la',
          Number((spot.lat + entre(-0.0003, 0.0003)).toFixed(6)),
          Number((spot.lng + entre(-0.0003, 0.0003)).toFixed(6)),
          iso(entre(1, 40)),
        ],
      );
      nbConfirmations++;
    }
  }
  console.log(`  ✓ ${nbConfirmations} confirmations`);

  // --- Chantiers -----------------------------------------------------------
  const qrSecret = (): string => randomBytes(20).toString('base64url');
  const dansNJours = (n: number, h: number): string =>
    new Date(Date.now() + n * MS_JOUR + h * 3_600_000).toISOString();

  const chantiers = [
    {
      id: 'evt_chotrana',
      titre: 'Nettoyage du terrain vague de Chotrana II',
      description:
        'Rendez-vous devant la pharmacie. Gants et sacs fournis. Deux heures suffiront si nous sommes nombreux.',
      debut: dansNJours(7, 8),
      fin: dansNJours(7, 11),
      // Filière confirmée : cas nominal.
      evacuation: 'municipalite',
      contact_nom: 'Service propreté — commune de La Soukra',
      contact_tel: '+21671000000',
      acquittee: 0,
      autorisation: 1,
      quartier: 'chotrana',
    },
    {
      id: 'evt_borj_louzir',
      titre: 'Grand ramassage à Borj Louzir',
      description:
        'Opération de ramassage le long de l\'avenue principale. Apportez de bonnes chaussures.',
      debut: dansNJours(14, 9),
      fin: dansNJours(14, 12),
      // Cas volontairement dégradé : déclenche le bandeau orange dans l'interface,
      // et n'est publiable que parce que le risque a été acquitté explicitement.
      evacuation: 'non_confirme',
      contact_nom: 'Slim (organisateur)',
      contact_tel: '+21620000002',
      acquittee: 1,
      autorisation: 0,
      quartier: 'borj-louzir',
    },
  ] as const;

  for (const c of chantiers) {
    const q = features.find((f) => f.properties.id === c.quartier)?.properties;
    await run(
      `INSERT INTO events (id, titre, description, date_debut, date_fin,
         point_rdv_lat, point_rdv_lng, organisateur_id, capacite, materiel_fourni,
         autorisation_obtenue, evacuation_par, contact_evacuation_nom,
         contact_evacuation_tel, evacuation_risque_acquittee, statut, qr_secret, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'publie',?,?)`,
      [
        c.id, c.titre, c.description, c.debut, c.fin,
        q?.centre_lat ?? 36.88, q?.centre_lng ?? 10.23,
        c.quartier === 'chotrana' ? 'usr_amina' : 'usr_slim',
        30, JSON.stringify(['gants', 'sacs', 'pinces']),
        c.autorisation, c.evacuation, c.contact_nom, c.contact_tel, c.acquittee,
        qrSecret(), iso(3),
      ],
    );
    for (const spot of spots.filter((s) => s.quartier === c.quartier).slice(0, 3)) {
      await run('INSERT INTO event_spots (event_id, spot_id) VALUES (?,?)', [c.id, spot.id]);
      await run('UPDATE spots SET statut = ? WHERE id = ? AND statut IN (?,?)', [
        'planifie', spot.id, 'signale', 'confirme',
      ]);
    }
  }
  console.log(`  ✓ ${chantiers.length} chantiers (dont 1 « évacuation non confirmée »)`);

  for (const c of citoyens.slice(0, 2)) {
    await run(
      `INSERT INTO participations (id, event_id, user_id, statut, created_at) VALUES (?,?,?,?,?)`,
      [`prt_${randomBytes(6).toString('hex')}`, 'evt_chotrana', c.id, 'inscrit', iso(2)],
    );
  }

  const checksum = createHash('sha256')
    .update(spots.map((s) => s.id).join(','))
    .digest('hex')
    .slice(0, 8);
  console.log(`✓ Seed terminé (empreinte ${checksum})`);
}

if (estExecuteDirectement(import.meta.url)) {
  console.log('→ Seed…');
  seed()
    .then(() => db.close())
    .then(() => process.exit(0))
    .catch((err: Error) => {
      console.error('✗ Seed échoué :', err.message);
      process.exit(1);
    });
}

export { seed };
