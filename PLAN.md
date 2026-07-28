# Nadhef Soukra — PLAN.md

PWA citoyenne de cartographie et de résorption des points noirs de déchets.
Périmètre géographique : commune de La Soukra (Ariana, Tunisie).

> Ce document est le contrat d'implémentation. Il doit être validé avant la Phase 0.
> Les décisions marquées **[Q]** attendent une réponse (voir §9).

---

## 1. Principes directeurs (rappel, non négociables)

| # | Règle | Traduction technique |
|---|---|---|
| 1 | Pas de Google Maps | MapLibre GL JS + tuiles OSM (Protomaps `.pmtiles` recommandé, MapTiler en repli) |
| 2 | Un signalement pourrit | `last_confirmed_at` + fraîcheur **dérivée au read** (45 j → `a_verifier`, 90 j → archive) |
| 3 | Pas de chantier sans filière | `events.evacuation_par NOT NULL` + `contact_evacuation NOT NULL` + acquittement explicite si `non_confirme` |
| 4 | Points = présence vérifiée | QR **rotatif** + géo-checkin 150 m ; jamais d'auto-déclaration |
| 5 | Consultation sans compte | Toutes les routes `GET` publiques ; auth requise seulement pour écrire/scorer |
| 6 | Geofence strict | Point-in-polygon serveur sur `/server/data/soukra-boundary.geojson` |
| 7 | Offline-first signalement | File IndexedDB + compression WebP 1280 px côté client |

---

## 2. Arborescence du projet

```
citypro/
├─ PLAN.md
├─ README.md
├─ docker-compose.yml            # app + libsql-server local (dev sans Turso)
├─ Dockerfile                    # build multi-stage : client → static, server → node
├─ .env.example
├─ package.json                  # workspaces npm : client, server, shared
├─ tsconfig.base.json            # strict: true, noUncheckedIndexedAccess, no any
│
├─ shared/                       # types + logique pure partagée client/serveur
│  ├─ src/
│  │  ├─ types.ts                # Spot, Event, User, enums (source de vérité TS)
│  │  ├─ schemas.ts              # schémas Zod partagés (payloads API)
│  │  ├─ geo.ts                  # pointInPolygon, haversine, bbox, geohash8 + voisins
│  │  ├─ freshness.ts            # decay 45/90 j — fonction pure, testée
│  │  ├─ gravite.ts              # gravité → couleur, poids heatmap
│  │  └─ points.ts               # barème + règles anti-farming — fonction pure, testée
│  └─ package.json
│
├─ server/
│  ├─ src/
│  │  ├─ index.ts                # bootstrap express, graceful shutdown
│  │  ├─ app.ts                  # middlewares, routes, error handler
│  │  ├─ env.ts                  # parsing env via Zod, fail-fast au boot
│  │  ├─ db/
│  │  │  ├─ client.ts            # @libsql/client, helpers query typés
│  │  │  ├─ migrate.ts           # runner de migrations (table _migrations)
│  │  │  ├─ migrations/
│  │  │  │  ├─ 0001_init.sql
│  │  │  │  ├─ 0002_indexes.sql
│  │  │  │  └─ 0003_badges_seed.sql
│  │  │  └─ seed.ts              # quartiers réels + 30 spots fictifs + 2 events
│  │  ├─ middleware/
│  │  │  ├─ auth.ts              # requireAuth / optionalAuth (JWT)
│  │  │  ├─ device.ts            # X-Device-Id, validation format
│  │  │  ├─ rateLimit.ts         # par IP, par device, par user, par action
│  │  │  ├─ validate.ts          # wrapper Zod (body/query/params)
│  │  │  └─ error.ts             # AppError → JSON { code, message_key, details }
│  │  ├─ services/
│  │  │  ├─ geofence.ts          # chargement boundary + buffer, assert dans commune
│  │  │  ├─ quartiers.ts         # résolution lat/lng → quartier_id
│  │  │  ├─ spots.ts             # création, dédup 30 m, transitions de statut
│  │  │  ├─ confirmations.ts     # toujours_la / c_est_propre, règles de clôture
│  │  │  ├─ decay.ts             # job quotidien + calcul dérivé
│  │  │  ├─ events.ts            # création, publication, clôture
│  │  │  ├─ checkin.ts           # TOTP QR + géo-checkin
│  │  │  ├─ points.ts            # attribution transactionnelle + ledger
│  │  │  ├─ badges.ts            # évaluation condition_json
│  │  │  ├─ leaderboard.ts       # quartiers (normalisé) + citoyens
│  │  │  ├─ stats.ts             # agrégats publics (cache 5 min)
│  │  │  ├─ moderation.ts        # file, auto-hide, décisions
│  │  │  ├─ storage/             # R2 (S3 API) + fallback disque local en dev
│  │  │  ├─ images.ts            # magic bytes, strip EXIF, re-encode, clé aléatoire
│  │  │  ├─ og.ts                # image Open Graph par spot (satori/resvg)
│  │  │  └─ sms/
│  │  │     ├─ SmsProvider.ts    # interface
│  │  │     └─ ConsoleSmsProvider.ts
│  │  ├─ routes/                 # un fichier par ressource (§4)
│  │  ├─ jobs/
│  │  │  └─ nightly.ts           # decay, recalcul stats, purge OTP
│  │  └─ tests/                  # vitest — logique métier uniquement
│  ├─ data/
│  │  ├─ soukra-boundary.geojson # relation OSM admin_level=8
│  │  └─ quartiers.geojson       # 5 secteurs
│  └─ package.json
│
└─ client/
   ├─ src/
   │  ├─ main.tsx
   │  ├─ App.tsx                 # router + dir/lang sur <html>
   │  ├─ i18n/
   │  │  ├─ index.ts             # i18next, détection, fallback ar
   │  │  ├─ ar.json              # langue par défaut
   │  │  └─ fr.json
   │  ├─ map/
   │  │  ├─ MapView.tsx          # MapLibre, 2 sources (heatmap / clusters)
   │  │  ├─ layers.ts            # définitions de calques + expressions
   │  │  └─ style.ts             # style pmtiles/maptiler + protocole
   │  ├─ screens/
   │  │  ├─ MapScreen.tsx        Carte (accueil)
   │  │  ├─ ReportScreen.tsx     Signaler (3 taps max)
   │  │  ├─ SpotScreen.tsx       Fiche spot
   │  │  ├─ EventsScreen.tsx     Chantiers
   │  │  ├─ EventCreateScreen.tsx
   │  │  ├─ OrganizerScreen.tsx  Mode jour J (QR plein écran)
   │  │  ├─ LeaderboardScreen.tsx
   │  │  ├─ StatsScreen.tsx
   │  │  └─ AdminScreen.tsx      (Phase 4)
   │  ├─ components/             # boutons, sheet, badge gravité, bandeaux
   │  ├─ offline/
   │  │  ├─ queue.ts             # IndexedDB (idb), file de signalements
   │  │  ├─ sync.ts              # flush sur online + visibilitychange (iOS)
   │  │  └─ image.ts             # canvas → WebP 1280 px
   │  ├─ api/client.ts           # fetch typé, erreurs → clés i18n
   │  └─ store/                  # zustand : session, filtres, file offline
   ├─ public/                    # manifest, icônes, polices Noto Sans Arabic
   ├─ vite.config.ts             # @tailwindcss/vite + vite-plugin-pwa
   └─ package.json
```

---

## 3. Schéma SQL complet (libSQL / SQLite)

Conventions : identifiants `TEXT` (UUIDv7), timestamps `TEXT` ISO-8601 UTC,
booléens `INTEGER 0/1`, pas d'ENUM natif → `CHECK`.

```sql
-- 0001_init.sql

CREATE TABLE quartiers (
  id                  TEXT PRIMARY KEY,
  nom_fr              TEXT NOT NULL,
  nom_ar              TEXT NOT NULL,
  geojson_polygon     TEXT NOT NULL,
  population_estimee  INTEGER NOT NULL CHECK (population_estimee > 0),
  centre_lat          REAL NOT NULL,
  centre_lng          REAL NOT NULL
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  phone_hash    TEXT UNIQUE,                  -- HMAC-SHA256(phone, PEPPER) — voir §7
  pseudo        TEXT NOT NULL UNIQUE,
  quartier_id   TEXT REFERENCES quartiers(id),
  points        INTEGER NOT NULL DEFAULT 0,
  role          TEXT NOT NULL DEFAULT 'citoyen'
                CHECK (role IN ('citoyen','moderateur','admin')),
  created_at    TEXT NOT NULL,
  banned_at     TEXT,
  ban_reason    TEXT
);

CREATE TABLE otp_codes (
  id          TEXT PRIMARY KEY,
  phone_hash  TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE spots (
  id                TEXT PRIMARY KEY,
  lat               REAL NOT NULL,
  lng               REAL NOT NULL,
  geohash8          TEXT NOT NULL,
  quartier_id       TEXT REFERENCES quartiers(id),
  type              TEXT NOT NULL CHECK (type IN (
                      'ordures_menageres','gravats','dechets_verts','encombrants',
                      'depot_sauvage','terrain_abandonne','conteneur_deborde')),
  gravite           INTEGER NOT NULL CHECK (gravite BETWEEN 1 AND 4),
  statut            TEXT NOT NULL DEFAULT 'signale' CHECK (statut IN (
                      'signale','confirme','planifie','nettoye','recidive',
                      'a_verifier','rejete')),
  description       TEXT,
  photo_url         TEXT,
  created_by        TEXT REFERENCES users(id),   -- NULL si anonyme
  created_by_device TEXT,                        -- device id si anonyme
  created_at        TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,               -- = created_at à la création
  cleaned_at        TEXT,
  is_private_property INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'pending'
                      CHECK (moderation_status IN ('pending','approved','rejected','hidden')),
  hidden_reason     TEXT,
  parent_spot_id    TEXT REFERENCES spots(id),   -- récidive → spot d'origine
  CHECK (created_by IS NOT NULL OR created_by_device IS NOT NULL)
);

CREATE TABLE confirmations (
  id         TEXT PRIMARY KEY,
  spot_id    TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id),
  device_id  TEXT,
  kind       TEXT NOT NULL CHECK (kind IN ('toujours_la','c_est_propre')),
  lat        REAL, lng        REAL,        -- position au moment du geste (anti-canapé)
  photo_url  TEXT,                         -- preuve pour c_est_propre
  created_at TEXT NOT NULL,
  CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)
);

CREATE TABLE events (
  id                 TEXT PRIMARY KEY,
  titre              TEXT NOT NULL,
  description        TEXT,
  date_debut         TEXT NOT NULL,
  date_fin           TEXT NOT NULL,
  point_rdv_lat      REAL NOT NULL,
  point_rdv_lng      REAL NOT NULL,
  organisateur_id    TEXT NOT NULL REFERENCES users(id),
  capacite           INTEGER,
  materiel_fourni    TEXT,                       -- JSON array de codes
  autorisation_obtenue INTEGER NOT NULL DEFAULT 0,
  evacuation_par     TEXT NOT NULL CHECK (evacuation_par IN (
                       'municipalite','tunisie_recyclage','prestataire_prive','non_confirme')),
  contact_evacuation_nom  TEXT NOT NULL,
  contact_evacuation_tel  TEXT NOT NULL,
  evacuation_risque_acquittee INTEGER NOT NULL DEFAULT 0,
  statut             TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN (
                       'brouillon','publie','en_cours','termine','annule')),
  qr_secret          TEXT NOT NULL,              -- base32, sert de clé TOTP
  photo_avant_url    TEXT,
  photo_apres_url    TEXT,
  kg_collectes       REAL,
  created_at         TEXT NOT NULL,
  cloture_at         TEXT,
  CHECK (date_fin > date_debut),
  CHECK (evacuation_par <> 'non_confirme' OR statut = 'brouillon'
         OR evacuation_risque_acquittee = 1)     -- règle #3, au niveau DB
);

CREATE TABLE event_spots (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  spot_id  TEXT NOT NULL REFERENCES spots(id)  ON DELETE CASCADE,
  PRIMARY KEY (event_id, spot_id)
);

CREATE TABLE participations (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  statut        TEXT NOT NULL DEFAULT 'inscrit' CHECK (statut IN ('inscrit','present','absent')),
  checked_in_at TEXT,
  method        TEXT CHECK (method IN ('qr','geo','organisateur')),
  checkin_lat   REAL, checkin_lng REAL,
  created_at    TEXT NOT NULL,
  UNIQUE (event_id, user_id)
);

CREATE TABLE badges (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  nom_fr         TEXT NOT NULL,
  nom_ar         TEXT NOT NULL,
  description_fr TEXT NOT NULL,
  description_ar TEXT NOT NULL,
  condition_json TEXT NOT NULL       -- {metric, op, value} évalué par badges.ts
);

CREATE TABLE user_badges (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id   TEXT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at TEXT NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

-- Ledger de points : jamais d'UPDATE aveugle sur users.points.
CREATE TABLE point_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN (
                'spot_cree','spot_reconfirme','participation','organisation','spot_ferme')),
  points      INTEGER NOT NULL,
  ref_type    TEXT NOT NULL CHECK (ref_type IN ('spot','event','confirmation')),
  ref_id      TEXT NOT NULL,
  quartier_id TEXT REFERENCES quartiers(id),   -- figé au moment du gain
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, action, ref_type, ref_id)   -- idempotence : anti double-crédit
);

CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('spot','event','user')),
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN (
                'propriete_privee','harcelement','faux_signalement','contenu_choquant','autre')),
  details     TEXT,
  reporter_id TEXT REFERENCES users(id),
  reporter_device TEXT,
  statut      TEXT NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert','traite','rejete')),
  handled_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT REFERENCES users(id),
  action     TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL
);
```

```sql
-- 0002_indexes.sql
CREATE INDEX idx_spots_bbox        ON spots (lat, lng);
CREATE INDEX idx_spots_geohash     ON spots (geohash8);
CREATE INDEX idx_spots_quartier    ON spots (quartier_id, statut);
CREATE INDEX idx_spots_lastconf    ON spots (last_confirmed_at);
CREATE INDEX idx_spots_moderation  ON spots (moderation_status, created_at);
CREATE INDEX idx_conf_spot         ON confirmations (spot_id, created_at);
CREATE INDEX idx_conf_user         ON confirmations (user_id, created_at);
CREATE INDEX idx_events_dates      ON events (statut, date_debut);
CREATE INDEX idx_part_event        ON participations (event_id, statut);
CREATE INDEX idx_points_user       ON point_events (user_id, created_at);
CREATE INDEX idx_points_quartier   ON point_events (quartier_id, created_at);
CREATE INDEX idx_reports_target    ON reports (target_type, target_id, statut);
```

### Fraîcheur : dérivée, pas stockée

`statut` reste piloté par le cycle de vie métier. La fraîcheur est **calculée au read** :

```sql
CASE
  WHEN julianday('now') - julianday(last_confirmed_at) > 90 THEN 'archive'
  WHEN julianday('now') - julianday(last_confirmed_at) > 45 THEN 'a_verifier'
  ELSE 'frais'
END AS freshness
```

Le job nocturne écrit en plus `statut = 'a_verifier'` pour les exports/stats, mais la carte
n'en dépend pas : si le cron meurt, l'affichage reste correct. (Objection §8.2)

---

## 4. API — endpoints

Base : `/api`. Erreurs : `{ error: { code, message_key, details? } }`, `message_key` résolu par i18next côté client.
Auth : `Authorization: Bearer <JWT>`. Anonyme : header `X-Device-Id` (UUID persisté localStorage).

### Public — aucune authentification

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/health` | liveness + version + migration head |
| GET | `/config` | bbox commune, boundary simplifiée, quartiers, flags, barème |
| GET | `/quartiers` | liste + polygones |
| GET | `/spots` | GeoJSON FeatureCollection. Query : `bbox`, `type[]`, `gravite[]`, `statut[]`, `quartier_id`, `include_archives`, `since` |
| GET | `/spots/:id` | fiche complète + timeline confirmations |
| GET | `/spots/:id/og.png` | image Open Graph générée (cache 24 h) |
| GET | `/events` | `from`, `to`, `statut`, `quartier_id` |
| GET | `/events/:id` | + spots liés, nb inscrits, bandeau évacuation |
| GET | `/stats/public` | kg, spots fermés, taux de récidive, chantiers |
| GET | `/leaderboard/quartiers` | `period=30d\|90d\|all`, normalisé /1000 hab. |
| GET | `/leaderboard/citoyens` | `period`, top 100 |
| GET | `/users/:id/profile` | pseudo, points, badges (jamais de téléphone) |
| GET | `/badges` | catalogue |

### Auth

| POST | `/auth/otp/request` | `{ phone }` → envoi via `SmsProvider` (rate-limité) |
| POST | `/auth/otp/verify` | `{ phone, code, pseudo?, quartier_id? }` → `{ token, user }` |
| POST | `/auth/refresh` | rotation du token |
| GET | `/me` | session courante |
| PATCH | `/me` | `pseudo`, `quartier_id` |
| POST | `/me/claim-anonymous` | rattache les spots d'un `device_id` au compte (sans points rétroactifs) |

### Écritures citoyennes

| POST | `/spots` | auth optionnelle. Geofence + dédup 30 m + rate limit. Anonyme = 0 point |
| POST | `/spots/:id/confirmations` | `{ kind, lat, lng, photo_url? }` |
| POST | `/spots/:id/close` | clôture avec preuve avant/après (25 pts) |
| POST | `/reports` | signalement d'abus |
| POST | `/uploads` | multipart, 1 image, ≤ 5 Mo → validation magic bytes, strip EXIF, R2 |

### Chantiers

| POST | `/events` | crée en `brouillon` |
| PATCH | `/events/:id` | organisateur uniquement |
| POST | `/events/:id/publish` | valide règle #3 ; 409 si évacuation non acquittée |
| POST | `/events/:id/inscription` / DELETE | un tap |
| GET | `/events/:id/qr` | organisateur : `{ code, expires_in }` — TOTP 30 s |
| POST | `/events/:id/checkin` | `{ code }` ou `{ lat, lng }` (≤ 150 m, fenêtre horaire) |
| GET | `/events/:id/participants` | organisateur : temps réel (polling 10 s) |
| POST | `/events/:id/cloture` | `{ kg_collectes, photo_avant_url, photo_apres_url }` → points |
| POST | `/events/:id/annuler` | |

### Modération / admin (Phase 4)

| GET | `/admin/moderation/queue` | spots `pending`/`hidden`, reports ouverts |
| POST | `/admin/spots/:id/moderate` | `{ decision: approve\|reject\|hide, reason }` |
| POST | `/admin/reports/:id/resolve` | |
| POST | `/admin/users/:id/ban` / `unban` | |
| GET | `/admin/export/spots.csv` | export municipalité |
| GET | `/admin/export/events.csv` | |
| GET | `/admin/audit` | |

---

## 5. Règles métier critiques (testées unitairement)

### 5.1 Geofence
Chargement de `soukra-boundary.geojson` au boot. Ray-casting sur (multi)polygone.
**Buffer de tolérance de 200 m** hors frontière : accepté mais marqué `hors_commune_limite`.
Au-delà → `422 GEOFENCE_REJECTED` + message i18n.

### 5.2 Dédup 30 m — *corrigé en Phase 0, le test a invalidé la conception initiale*

`geohash8` seul ne suffit pas : la cellule mesure ≈ 38 × 19 m et deux points distants de
5 m peuvent tomber dans deux cellules.

**Le rattrapage « cellule + 8 voisines » ne suffit pas non plus.** Le bloc 3×3 fait
≈ 114 × 57 m, mais il est centré sur la *cellule*, pas sur le point : celui-ci peut être au
bord de la sienne. La portée **garantie** depuis le point n'est donc que de ~38 m en
longitude et **~19 m en latitude** — un voisin à 30 m plein nord échappe à la recherche.
Le test `geohash.test.ts › le bloc 3×3 ne couvre PAS 30 m dans toutes les directions`
verrouille ce constat.

Algorithme retenu :
1. `bboxAutour(point, 30 m)` → `BETWEEN` sur les colonnes indexées `(lat, lng)` ;
2. fenêtre : 24 dernières heures ;
3. filtre exact `haversine ≤ 30 m` (la bbox est un sur-ensemble : ses coins sont à ~42 m) ;
4. si un spot actif existe, la requête devient une **reconfirmation** de ce spot — pas une
   erreur : l'utilisateur est dans la rue, on ne le bloque pas.

`geohash8` reste stocké comme clé de regroupement grossier et pour la détection de récidive,
mais il ne porte plus la garantie de distance.

### 5.3 Décroissance
Fonction pure `freshness(last_confirmed_at, now)` → `frais | a_verifier | archive`.
Carte : opacité 1.0 / 0.4 / masqué (sauf filtre archives).

### 5.4 Clôture d'un spot
`c_est_propre` ne ferme que si **2 confirmations indépendantes de comptes authentifiés**
(device anonyme = signal uniquement, ne compte pas), OU 1 confirmation avec photo,
OU décision modérateur. Indépendance = users distincts, comptes créés > 24 h, IP distinctes.
Puis `statut='nettoye'`, `cleaned_at=now`. Tout nouveau spot dans la même cellule < 90 j
après → `recidive` + `parent_spot_id`.

### 5.5 Points (ledger idempotent)
| Action | Pts | Garde-fou |
|---|---|---|
| Spot créé | 5 | crédité **à l'approbation** modération, pas à la création |
| Reconfirmation | 1 | 1 fois par (user, spot) / 45 j ; max 10 pts/jour ; position ≤ 150 m du spot |
| Participation | 50 | `statut='present'` uniquement ; l'organisateur ne peut pas se check-in lui-même |
| Organisation | 150 | à la clôture, avec photos avant **et** après ET ≥ 3 présents |
| Fermeture avec preuve | 25 | photo avant/après, 1 fois par spot |

### 5.6 Classement quartiers
`SUM(points) / population_estimee * 1000` sur une **fenêtre glissante 90 j**, avec seuil
minimal d'activité (≥ 20 participations sur la période) sinon « non classé ».
Sans fenêtre glissante, le quartier premier arrivé reste premier pour toujours et les autres décrochent.

### 5.7 Check-in
QR = TOTP (HMAC-SHA1, pas 30 s) dérivé de `events.qr_secret`, ré-encodé côté client toutes
les 30 s. Le serveur accepte ±1 fenêtre. Empêche la capture d'écran partagée sur WhatsApp.
Fallback géo : `haversine(user, point_rdv) ≤ 150 m` ET `date_debut - 30min ≤ now ≤ date_fin + 30min`.

---

## 6. Carte — architecture MapLibre

Le clustering et le heatmap ne peuvent pas partager une source (`cluster: true` agrège les
features). Deux sources sur le même endpoint :

- `spots-heat` (non clusterisée) → calque `heatmap`, `weight = gravite/4`, visible z < 14
- `spots-points` (`cluster: true`, supercluster natif MapLibre) → cercles + compteurs, z ≥ 14
- Couleur marqueur : gravité 1 `#16a34a` → 2 `#eab308` → 3 `#f97316` → 4 `#dc2626`
- Opacité pilotée par `freshness` via expression `case`
- Fond : `pmtiles://` (protocole enregistré) ou style MapTiler selon **[Q3]**

---

## 7. Sécurité & vie privée

- **`phone_hash`** : `sha256(phone + salt)` est insuffisant — l'espace des numéros tunisiens
  fait ~10⁸ possibilités, bruteforçable en secondes. → **HMAC-SHA256 avec un pepper**
  stocké en variable d'environnement, jamais en base. (objection §8.1)
- **EXIF** : les photos de smartphone contiennent les coordonnées GPS ; une photo prise
  depuis chez soi divulgue l'adresse du domicile. → strip EXIF systématique côté serveur.
- **Uploads** : validation magic bytes, ≤ 5 Mo, re-encodage, clé objet aléatoire non énumérable.
- **Rate limits** : IP (100 req/min), device (10 spots/j), user (10 spots/j), OTP (3/h/numéro).
- **Auto-masquage** : 3 reports de comptes distincts âgés > 24 h → `hidden` + file modération.
  Sans la condition d'âge, 3 comptes jetables masquent n'importe quel spot légitime.
- **Avertissement pré-upload** : « Ne photographiez pas de personnes ni de plaques. »
- JWT court (24 h) + refresh, secret en env, `helmet`, CORS restreint.

---

## 8. Objections et modes d'échec (à arbitrer)

1. **Hash de téléphone** — corrigé ci-dessus (HMAC + pepper).
2. **`a_verifier` en tant que `statut` stocké** — dépendre d'un cron pour l'affichage crée
   une dérive silencieuse. → fraîcheur dérivée au read, cron pour les stats seulement.
3. **`c_est_propre` × 2 = fermeture** — gameable par 2 device IDs anonymes ; un déposant
   sauvage ou un propriétaire a une motivation directe à « nettoyer » la carte. → §5.4.
4. **+1 point par reconfirmation** — farmable depuis le canapé, ce qui reproduit exactement
   le mode d'échec que la règle #4 veut éviter. → plafonds + contrainte de proximité.
5. **QR statique** — screenshot partagé = 50 points pour des absents. → TOTP rotatif.
6. **libSQL n'a pas de spatial** — pas de PostGIS ni SpatiaLite. Toute la géométrie est en
   JS (bbox indexée en SQL, raffinement en mémoire). Acceptable jusqu'à ~50 k spots ;
   au-delà il faudra migrer. À acter maintenant, pas en Phase 3.
7. **`geohash8` ≠ 30 m** — voir §5.2.
8. **iOS** : pas de Background Sync API dans Safari. La file offline doit se vider sur
   `online` + `visibilitychange`, jamais via `SyncManager` seul. Pas de push web fiable →
   les rappels de chantier passeront par SMS.
9. **Classement per-capita figé** — voir §5.6.
10. **Zéro modérateur au lancement** — le parcours « 2 reconfirmations » doit suffire ;
    l'app doit être pleinement fonctionnelle sans aucun modérateur actif. **[Q6]**
11. **Arabe « tunisien » écrit** — le tunisien s'écrit peu en caractères arabes ; une UI en
    dialecte écrit risque de paraître maladroite. Recommandation : arabe standard simple.
    **[Q1]**
12. **`autorisation_obtenue`** — un rassemblement + intervention sur voie publique appelle
    normalement une information de la municipalité. Le champ doit être explicite dans l'UI
    (avertissement, pas seulement une case).
13. **Coût/fiabilité du SMS A2P vers la Tunisie** — c'est le point le plus susceptible de
    bloquer le lancement. **[Q2]**

---

## 9. Arbitrages rendus

| # | Sujet | Décision |
|---|---|---|
| Q1 | Registre arabe | **Arabe standard simple** (MSA, vocabulaire courant). `ar.json` rédigé dans ce registre, pas en dialecte écrit. |
| Q2 | Authentification | **Compte léger d'abord.** Inscription pseudo + device ID, points comptabilisés immédiatement. Le téléphone n'est exigé que pour *organiser un chantier* et *apparaître au classement public*. L'interface `SmsProvider` + `ConsoleSmsProvider` est construite dès la Phase 0 mais le SMS n'est pas sur le chemin critique. |
| Q3 | Fond de carte | **Protomaps `.pmtiles` auto-hébergé.** Extrait Ariana/Tunis servi depuis R2 (ou disque en dev) via range requests. Pas de clé API, pas de facturation à la charge. |
| Q4 | Modération | **Compte admin seedé** au nom du porteur du projet (rôle `admin`, seed paramétré par env). Le parcours « 2 reconfirmations » reste néanmoins suffisant pour approuver un spot, afin que l'app fonctionne si personne ne modère. |

### Conséquences sur le modèle

- `users.phone_hash` devient **nullable** (déjà le cas au schéma). Un compte léger a
  `phone_hash IS NULL`.
- Nouveau champ `users.device_id` (unique, nullable) : identifie le compte léger.
- Nouveau champ dérivé `users.is_verified` = `phone_hash IS NOT NULL`.
  Le classement public **citoyens** ne liste que les comptes vérifiés ; les comptes légers
  voient leur rang à titre personnel (« vérifie ton numéro pour apparaître »).
  C'est l'incitation à la vérification, sans bloquer l'entrée.
- `POST /events` exige `is_verified` → `403 PHONE_REQUIRED`.

### Point resté ouvert (non bloquant, tranché par défaut)

**Polygone communal** : je récupère la relation OSM `admin_level=8` de La Soukra via
Overpass en Phase 0. Si les limites des 5 secteurs (Soukra Centre, Borj Louzir,
Chotrana I/II/III, Soukra Montazah) n'existent pas dans OSM — c'est probable —, je les
trace approximativement et les marque comme **à corriger**. Les `population_estimee`
seront des estimations documentées en commentaire dans le seed, à valider avec des
chiffres INS avant toute publication du classement.

---

## 10. Découpage en phases

### Phase 0 — Scaffold ✅ *terminée*
- Monorepo npm workspaces, TS strict partout (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`)
- Dockerfile multi-stage + compose (app + libsql local)
- Runner de migrations + `0001`/`0002`/`0003`
- `soukra-boundary.geojson` (OSM relation admin_level=8) + `quartiers.geojson` (5 secteurs)
- Extrait `.pmtiles` (Ariana) + protocole pmtiles enregistré côté client, servi en local en dev
- Seed : quartiers réels, 30 spots fictifs répartis et cohérents (types/gravités/âges variés
  pour exercer la décroissance), 2 chantiers, 3 users, **1 compte admin** (env `SEED_ADMIN_*`), badges
- `GET /health`, i18next câblé avec `ar` par défaut + RTL, écran carte vide qui charge
- Tests : geofence, geohash + voisins, freshness

**Livrable vérifiable** : carte de La Soukra avec ses 30 spots.

**Écarts constatés en Phase 0**

| Attendu | Réalité | Décision |
|---|---|---|
| Polygone OSM `admin_level=8` | N'existe pas en Tunisie (4=gouvernorat, 5=délégation, 6=secteur) | Relation **4184709** (Délégation Soukra) + ses **7 secteurs** réels |
| 5 quartiers listés au brief | Le découpage officiel en compte 7 ; « Chotrana I/II/III » est un seul secteur, « Soukra Montazah » n'en est pas un | Les 7 secteurs officiels, avec `ref:tn:codegeo` |
| Dédup par voisinage de geohash | Portée garantie ~19 m en latitude, insuffisante pour 30 m | bbox indexée + haversine (§5.2) |
| — | `tsc` ne copie pas les `.sql` : `node dist/index.js` échouait | `server/scripts/copy-migrations.mjs`, intégré au build |
| — | Muter la carte après `load` produisait une carte vide et silencieuse | Données injectées dans le style avant instanciation |

**Non vérifié** : `docker compose up`. Docker Desktop réclame `wsl --update`,
qui exige des droits administrateur dont la machine de développement ne dispose
pas. Le `Dockerfile` et le `compose` sont écrits et le chemin équivalent (build
de production + `node dist/index.js` sur base vierge → migrations → seed →
30 spots, bundle servi et vérifié au navigateur) a été validé ; l'image
elle-même n'a jamais été construite. **À faire tourner sur une machine disposant
de Docker, ou au premier déploiement Render, avant de considérer le critère
rempli.**

### Phase 1 — Carte, signalement, confirmations, décroissance ✅ *terminée*
- MapScreen complet : heatmap + clusters, filtres, geoloc contrainte, FAB « Signaler »
- ReportScreen 3 taps : caméra → gravité (4 gros boutons) → type → envoi ; drag de position
- Compression WebP 1280 px, file IndexedDB, sync online/visibilitychange
- `POST /spots` : geofence, dédup 30 m, rate limits, upload+EXIF, modération `pending`
- SpotScreen : timeline, « Toujours là » / « C'est propre », partage + image OG
- Décroissance complète (dérivée + job nocturne), filtre archives
- Tests : dédup, décroissance, geofence, transitions de statut, rate limits

**Livrable vérifiable** : utilisable seul et publiquement, sans compte.

**Vérifié de bout en bout au navigateur**

| Parcours | Résultat |
|---|---|
| Signalement en 3 taps (gravité → type → envoyer) | spot créé, `pending`, 0 point |
| Geofence | Paris rejeté en 422 `GEOFENCE_REJECTED` |
| Dédup 30 m | 2 m → `doublon` avec renvoi vers le spot existant ; 60 m → créé |
| Reconfirmation sur place | +1 point ; à 2 km → `trop_loin` ; sans position → `position_absente` |
| Signalement anonyme | accepté, 0 point |
| Écriture sans compte ni appareil | refusée (`DEVICE_ID_REQUIRED`) |
| File hors ligne | échec réseau → mise en file IndexedDB → vidage automatique au retour |
| Filtres carte | gravité 3+4 → 11 points sur 28 |
| Décroissance | 23 visibles / 30 avec archives |

**Écarts et décisions de Phase 1**

| Sujet | Décision |
|---|---|
| Texte sur la carte | **Aucun calque `symbol`.** Les noms de quartiers sont des marqueurs HTML : mise en forme arabe correcte par le navigateur, sans glyphes SDF ni greffon RTL. Supprime la dépendance à un domaine externe et un blocage silencieux (`setRTLTextPlugin` ne peut être appelé qu'une fois par page ; un second appel fige tout style contenant du texte avant `style.load`). À rétablir si l'on sert nos propres glyphes depuis `/fonts`. |
| Détection du fond de tuiles | Vérifie la **signature « PMTiles »**, pas le code HTTP : le repli SPA renvoie `index.html` en 200 pour tout chemin inconnu, et la carte déclarait alors une source vectorielle pointant sur du HTML — style bloqué à jamais, sans erreur. Même correction pour la sonde de glyphes. |
| Rappels React et carte | Les rappels passent par une `ref`, jamais par les dépendances de l'effet de montage : déclarés en ligne par le parent, ils détruisaient et reconstruisaient la carte à chaque changement d'état. |
| Envoi de photo | Corps binaire brut (`express.raw`) plutôt que multipart : le client envoie déjà un WebP compressé, aucune dépendance supplémentaire. |
| EXIF | Retiré côté serveur sans réencodage (JPEG/WebP/PNG, pur JS) — pas de dépendance native type `sharp` à installer sur l'hébergeur. |
| Image Open Graph | Métadonnées injectées côté serveur sur `/spot/:id` (les robots WhatsApp n'exécutent pas le JS). La vignette est la photo du spot, ou une carte statique par gravité. Une vignette composée avec texte demande un rendu serveur — reporté en Phase 3. |

### Phase 2 — Chantiers ✅ *terminée*
- CRUD événements + bloc évacuation obligatoire + bandeau orange + acquittement
- Liste/carte des chantiers, inscription en un tap
- Mode organisateur : QR TOTP plein écran, présents en temps réel, kg, photos avant/après
- Check-in QR + fallback géo 150 m ; passage des spots liés en `planifie` puis `nettoye`
- Tests : publication bloquée, TOTP, fenêtre de check-in, anti-auto-checkin

**Vérifié de bout en bout**

| Parcours | Résultat |
|---|---|
| Créer un chantier sans numéro vérifié | refusé (`PHONE_REQUIRED`) |
| OTP par SMS | code affiché dans les logs, numéro masqué au-delà des 4 derniers chiffres |
| Publier avec évacuation `non_confirme` sans acquittement | refusé (`EVACUATION_NOT_ACKNOWLEDGED`) |
| Publier avec acquittement | publié, bandeau orange, spots passés en `planifie` |
| Code de présence | rotation vérifiée en direct (268601 → 551116) |
| Check-in code erroné | refusé (`INVALID_CODE`) |
| Check-in QR valide | présent, +50 points |
| Double check-in | refusé (`ALREADY_CHECKED_IN`) |
| Repli géo à 3 970 m | refusé avec distance et rayon dans l'erreur |
| Repli géo à 40 m | présent, +50 points |
| Auto-check-in de l'organisateur | 0 point (`auto_attribution`) |
| Clôture (2 photos, 4 présents) | +150 points, spot en `nettoye`, 340 kg enregistrés |

**Ajouts et décisions de Phase 2**

| Sujet | Décision |
|---|---|
| **Flux OTP** | Construit ici et non en Phase 0 : sans lui, personne ne peut organiser. `ConsoleSmsProvider` affiche le code dans les logs ; le numéro y est masqué, les logs de développement finissant en captures d'écran. Code haché en base, comparaison à temps constant, 5 tentatives puis invalidation. |
| Publication d'un chantier déjà commencé | **Autorisée.** La règle refuse un chantier *terminé*, pas *commencé* : publier une heure après le début est un cas réel de mobilisation de dernière minute, et l'interdire pousserait à antidater. |
| Clôture partielle | L'organisateur coche les spots réellement nettoyés ; les autres repassent de `planifie` à `confirme`. Un chantier partiel est la norme. |
| Annulation | Les spots reviennent à `confirme` — le problème n'a pas disparu avec le chantier. |
| Venir sans s'être inscrit | Accepté : le check-in crée la participation. Courant sur le terrain, aucune raison de pénaliser. |
| Rafraîchissement du code | Piloté par `expire_dans_s` renvoyé par le serveur, pas par l'horloge du téléphone : c'est le serveur qui fait autorité. |

### Phase 3 — Gamification & statistiques ✅ *terminée*
- Ledger de points idempotent, plafonds anti-farming
- Badges (`condition_json`), attribution à l'événement
- Classements quartiers (normalisé, fenêtre 90 j) et citoyens
- Page stats publiques pensée pour le partage et pour les bailleurs (+ image OG)
- Tests : barème complet, idempotence, normalisation, plafonds

**Décisions de Phase 3**

| Sujet | Décision |
|---|---|
| Badges décrits en données | `condition_json` = `{metric, op, value}`, évalué sans interpréteur. Ajouter un badge est une migration SQL, pas un déploiement. Un badge mal décrit est ignoré et journalisé, sans bloquer les autres. |
| Réévaluation à la lecture | Les badges se réévaluent aussi sur `GET /me/badges`, pas seulement au gain de points : les kilos sont saisis par l'organisateur longtemps après le check-in du participant, donc son badge n'arriverait jamais autrement. |
| Kilos par quartier | Un chantier couvrant plusieurs quartiers voit ses kilos **répartis à parts égales**. Les attribuer en entier à chacun gonflerait le total au-delà du collecté réel. |
| Taux de récidive | Rapporté aux spots **nettoyés**, pas au total : la question est « est-ce que ça tient ? », et elle n'a de sens que là où on est intervenu. |
| Chiffre inconfortable affiché | Le nombre de chantiers sans filière d'évacuation confirmée figure sur la page publique. Le masquer serait malhonnête envers le mode d'échec principal. |
| Couleurs des graphiques | Indigo `#4f46e5` / émeraude `#059669`, validées sur les six contrôles (bande de clarté, chroma, séparation deutan/tritan, contraste). Volontairement distinctes de l'échelle de gravité vert→rouge, réservée à la sévérité. |
| Quatre chiffres de tête | Des tuiles, pas un graphique : une valeur unique se lit mieux en grand qu'en barre. |

**Défauts corrigés en chemin** : `created_at` et `points` ambigus en SQL (`users` et
`point_events` portent les deux colonnes) — silencieux dans une sous-requête
corrélée, erreur franche ailleurs ; et des backticks dans un commentaire SQL
placé à l'intérieur d'un template literal, qui fermaient la chaîne.

### Phase 4 — Modération & back-office ✅ *terminée*
- File de modération, décisions, auto-masquage, bannissements, audit log
- Back-office admin (même PWA, route protégée par rôle)
- Exports CSV municipalité (spots, chantiers, kg par quartier)
- Durcissement : rate limits fins, helmet, CSP, journalisation

**Décisions de Phase 4**

| Sujet | Décision |
|---|---|
| **Injection de formule CSV** | Une cellule commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot est préfixée d'une apostrophe. Ces fichiers s'ouvrent dans Excel sur le poste d'un agent municipal, et une description de point noir est rédigée par n'importe qui : sans cette neutralisation, le champ devient un vecteur d'exécution. La neutralisation vient **avant** l'échappement, sinon l'apostrophe se retrouve hors des guillemets. 18 tests verrouillent ce comportement. |
| Encodage des exports | BOM UTF-8 et séparateur point-virgule : sans BOM, Excel sous Windows lit « سكرة » en mojibake ; sans point-virgule, il ne découpe pas les colonnes en locale française. |
| Garde de rôle | Posé sur le sous-arbre `/admin` d'un seul `router.use`, pas route par route : impossible d'en oublier une en ajoutant un endpoint. |
| Traçabilité | Toute décision de modération, tout bannissement passe par `audit_log`. Sur un outil qui touche à la propriété et au voisinage, la traçabilité protège autant les habitants que l'équipe. |
| Hiérarchie de bannissement | Un modérateur ne peut bannir qu'un citoyen ; seul un admin peut viser un membre de l'équipe. Personne ne peut se bannir soi-même. |
| Back-office dans la même PWA | Pas de second déploiement à maintenir. L'écran ne fait que refléter le droit — c'est `exigerRole` côté serveur qui l'accorde. |
| Décision de modération et signalements | Modérer un spot clôt automatiquement les signalements d'abus qui le visent : une seule décision, pas deux files à tenir. |

**Défaut corrigé** : le numéro admin du seed (`+21600000000`) ne respectait pas
le format tunisien réel (8 chiffres commençant par 2/4/5/9) et échouait donc à ma
propre validation OTP — le compte administrateur ne pouvait pas se connecter.
Remplacé par `+21620000000`.

---

## 11. Conventions

- Commits conventionnels atomiques : `feat(spots): dedup 30m par geohash + voisins`
- Aucune chaîne en dur dans le client — `t('...')` dès le premier composant
- Tailwind : propriétés logiques uniquement (`ms-*`, `pe-*`, `text-start`) — jamais `left/right`
- Zod à chaque endpoint, schémas partagés depuis `shared/`
- Tests : vitest, sur `shared/` et `server/services/` uniquement (pas d'UI)
- Cible 360 px, contraste AA minimum, cibles tactiles ≥ 44 px
