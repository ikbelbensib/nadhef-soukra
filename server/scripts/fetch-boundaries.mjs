#!/usr/bin/env node
/**
 * Génère server/data/soukra-boundary.geojson et server/data/quartiers.geojson
 * depuis OpenStreetMap (Overpass API).
 *
 * Note sur la hiérarchie administrative tunisienne : contrairement à ce que
 * suppose la plupart de la documentation OSM, il n'existe PAS d'admin_level=8
 * en Tunisie. La hiérarchie réelle est :
 *   4 = gouvernorat · 5 = délégation (mutamadiya) · 6 = secteur (imada)
 *
 * La Soukra correspond donc à la relation 4184709 (Délégation Soukra, Ariana,
 * ref:tn:codegeo=1252), et ses quartiers aux 7 secteurs admin_level=6 qu'elle
 * contient. Ces limites sont officielles, pas approximées à la main.
 *
 * Usage : node server/scripts/fetch-boundaries.mjs
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
/** Les miroirs Overpass renvoient fréquemment 429/504 aux heures chargées.
 *  On les essaie en rotation avec backoff plutôt que d'échouer au premier refus. */
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const DELEGATION_ID = 4184709;
const SECTEUR_IDS = [7114900, 7114901, 7114902, 7114903, 7114904, 7114905, 7114906];

/** Population estimée par secteur. À remplacer par des chiffres INS avant
 *  toute publication du classement normalisé (cf. PLAN.md §9). */
const POPULATION = {
  125251: 34000, // Soukra
  125252: 18000, // Dar Fadhal
  125253: 16000, // El Bassatine
  125254: 39000, // Chotrana
  125255: 28000, // Borj Louzir
  125256: 14000, // Ennassim
  125257: 11000, // Ettaamir
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cachePath = (name) => join(DATA_DIR, '.osm-cache', `${name}.json`);

/** Interroge Overpass avec cache disque : une génération réussie rend les
 *  suivantes reproductibles et hors ligne. `npm run boundaries -- --refresh`
 *  force un nouvel appel réseau. */
async function overpassCached(name, query) {
  const file = cachePath(name);
  if (!process.argv.includes('--refresh')) {
    try {
      const cached = JSON.parse(await readFile(file, 'utf8'));
      if (cached.elements?.length > 0) {
        console.log(`    · cache (${cached.elements.length} élément(s))`);
        return cached;
      }
    } catch {
      /* pas de cache — on interroge le réseau */
    }
  }
  const json = await overpass(query);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(json));
  return json;
}

async function overpass(query, attempts = 3) {
  let lastError = 'inconnue';
  for (let round = 0; round < attempts; round++) {
    for (const mirror of MIRRORS) {
      const host = new URL(mirror).host;
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          headers: { 'User-Agent': 'nadhef-soukra/0.1 (boundary generator)' },
          body: query,
          signal: AbortSignal.timeout(180_000),
        });
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          console.log(`    · ${host} → ${lastError}`);
          continue;
        }
        const json = await res.json();
        // Un miroir désynchronisé répond 200 avec une collection vide : c'est un
        // échec, pas un résultat. Sans ce garde-fou on écrit des données vides.
        if (!json.elements || json.elements.length === 0) {
          lastError = 'réponse vide';
          console.log(`    · ${host} → ${lastError}`);
          continue;
        }
        console.log(`    · ${host} → ${json.elements.length} élément(s)`);
        return json;
      } catch (err) {
        lastError = err.message;
        console.log(`    · ${host} → ${lastError}`);
      }
    }
    if (round < attempts - 1) {
      const wait = 5000 * (round + 1);
      console.log(`    … tous les miroirs occupés, nouvelle tentative dans ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`Overpass indisponible sur ${MIRRORS.length} miroirs (${lastError})`);
}

/**
 * Assemble les ways d'une relation OSM en anneaux fermés.
 * Les ways d'une frontière arrivent dans un ordre arbitraire et avec une
 * orientation arbitraire : il faut les chaîner par extrémités communes.
 */
function stitchRings(ways) {
  const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const pending = ways.map((w) => w.geometry.slice()).filter((g) => g.length > 1);
  const rings = [];

  while (pending.length > 0) {
    let ring = pending.shift();
    let progressed = true;
    while (progressed && key(ring[0]) !== key(ring[ring.length - 1])) {
      progressed = false;
      for (let i = 0; i < pending.length; i++) {
        const seg = pending[i];
        const tail = key(ring[ring.length - 1]);
        const head = key(ring[0]);
        if (key(seg[0]) === tail) {
          ring = ring.concat(seg.slice(1));
        } else if (key(seg[seg.length - 1]) === tail) {
          ring = ring.concat(seg.slice().reverse().slice(1));
        } else if (key(seg[seg.length - 1]) === head) {
          ring = seg.slice(0, -1).concat(ring);
        } else if (key(seg[0]) === head) {
          ring = seg.slice().reverse().slice(0, -1).concat(ring);
        } else {
          continue;
        }
        pending.splice(i, 1);
        progressed = true;
        break;
      }
    }
    if (key(ring[0]) !== key(ring[ring.length - 1])) {
      console.warn(`  ⚠ anneau non fermé (${ring.length} points) — fermeture forcée`);
      ring.push(ring[0]);
    }
    rings.push(ring.map((p) => [Number(p.lon.toFixed(7)), Number(p.lat.toFixed(7))]));
  }
  return rings;
}

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
};

/** Construit une géométrie GeoJSON : le plus grand anneau est l'extérieur. */
function toGeometry(relation) {
  const outerWays = relation.members.filter(
    (m) => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === ''),
  );
  const innerWays = relation.members.filter(
    (m) => m.type === 'way' && m.geometry && m.role === 'inner',
  );
  const outers = stitchRings(outerWays).sort((a, b) => ringArea(b) - ringArea(a));
  const inners = stitchRings(innerWays);
  if (outers.length === 0) throw new Error(`Relation ${relation.id} : aucun anneau extérieur`);
  if (outers.length === 1) {
    return { type: 'Polygon', coordinates: [outers[0], ...inners] };
  }
  return { type: 'MultiPolygon', coordinates: outers.map((o, i) => (i === 0 ? [o, ...inners] : [o])) };
}

function bboxOf(geometry) {
  const box = [180, 90, -180, -90];
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      box[0] = Math.min(box[0], c[0]);
      box[1] = Math.min(box[1], c[1]);
      box[2] = Math.max(box[2], c[0]);
      box[3] = Math.max(box[3], c[1]);
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return box.map((n) => Number(n.toFixed(6)));
}

/** Centroïde surfacique de l'anneau extérieur principal. */
function centroidOf(geometry) {
  const ring =
    geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  a *= 0.5;
  if (a === 0) return [ring[0][0], ring[0][1]];
  return [Number((cx / (6 * a)).toFixed(6)), Number((cy / (6 * a)).toFixed(6))];
}

const slug = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  console.log(`→ Récupération de la délégation ${DELEGATION_ID} (La Soukra)…`);
  const del = await overpassCached(
    'delegation',
    `[out:json][timeout:120];rel(${DELEGATION_ID});out geom;`,
  );
  const relation = del.elements.find((e) => e.type === 'relation');
  if (!relation) throw new Error('Relation de la délégation introuvable');

  const boundaryGeom = toGeometry(relation);
  const boundary = {
    type: 'Feature',
    properties: {
      osm_relation_id: relation.id,
      admin_level: relation.tags.admin_level,
      codegeo: relation.tags['ref:tn:codegeo'],
      nom_fr: 'La Soukra',
      // Le tag OSM vaut « معتمدية سكرة » : « معتمدية » est le mot administratif
      // pour délégation, hors de propos dans l'interface.
      nom_ar: 'سكرة',
      source: 'OpenStreetMap © contributeurs — ODbL',
      generated_at: new Date().toISOString(),
      note:
        "Délégation (admin_level=5). La Tunisie n'utilise pas admin_level=8 : " +
        'la hiérarchie OSM y est 4=gouvernorat, 5=délégation, 6=secteur.',
    },
    bbox: bboxOf(boundaryGeom),
    geometry: boundaryGeom,
  };
  await writeFile(join(DATA_DIR, 'soukra-boundary.geojson'), JSON.stringify(boundary, null, 2) + '\n');
  console.log(`  ✓ soukra-boundary.geojson — bbox ${boundary.bbox.join(', ')}`);

  console.log('→ Récupération des secteurs (admin_level=6)…');
  // Les identifiants sont figés : la résolution par aire (map_to_area) dépasse
  // régulièrement le timeout d'Overpass et rend la génération non reproductible.
  // Ils correspondent aux 7 imadas de la délégation, vérifiés par ref:tn:codegeo.
  const sec = await overpassCached(
    'secteurs',
    `[out:json][timeout:180];rel(id:${SECTEUR_IDS.join(',')});out geom;`,
  );
  const relations = sec.elements.filter((e) => e.type === 'relation');

  const features = relations
    .map((r) => {
      const geometry = toGeometry(r);
      const codegeo = r.tags['ref:tn:codegeo'];
      const nomFr = r.tags['name:fr'] ?? r.tags.int_name ?? r.tags.name;
      const [lng, lat] = centroidOf(geometry);
      return {
        type: 'Feature',
        properties: {
          id: slug(nomFr),
          osm_relation_id: r.id,
          codegeo,
          nom_fr: nomFr,
          // `name` de préférence : sur Ettaamir, name:ar traîne un « 2 » parasite.
          nom_ar: r.tags.name ?? r.tags['name:ar'],
          population_estimee: POPULATION[codegeo] ?? 10000,
          population_source: POPULATION[codegeo] ? 'estimation projet' : 'défaut',
          centre_lat: lat,
          centre_lng: lng,
        },
        bbox: bboxOf(geometry),
        geometry,
      };
    })
    .sort((a, b) => a.properties.codegeo.localeCompare(b.properties.codegeo));

  const quartiers = {
    type: 'FeatureCollection',
    properties: {
      source: 'OpenStreetMap © contributeurs — ODbL',
      generated_at: new Date().toISOString(),
    },
    features,
  };
  await writeFile(join(DATA_DIR, 'quartiers.geojson'), JSON.stringify(quartiers, null, 2) + '\n');
  console.log(`  ✓ quartiers.geojson — ${features.length} secteurs :`);
  for (const f of features) {
    console.log(
      `      ${f.properties.codegeo}  ${f.properties.id.padEnd(14)} ${f.properties.nom_ar}  ` +
        `(~${f.properties.population_estimee.toLocaleString('fr')} hab.)`,
    );
  }
}

main().catch((err) => {
  console.error('✗ Échec :', err.message);
  process.exit(1);
});
