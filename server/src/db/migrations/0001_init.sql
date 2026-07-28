-- 0001_init — schéma initial Nadhef Soukra
-- libSQL/SQLite : pas d'ENUM natif (CHECK), pas de booléen (INTEGER 0/1),
-- timestamps en TEXT ISO-8601 UTC.

CREATE TABLE quartiers (
  id                  TEXT PRIMARY KEY,
  nom_fr              TEXT NOT NULL,
  nom_ar              TEXT NOT NULL,
  codegeo             TEXT,
  osm_relation_id     INTEGER,
  geojson_polygon     TEXT NOT NULL,
  population_estimee  INTEGER NOT NULL CHECK (population_estimee > 0),
  centre_lat          REAL NOT NULL,
  centre_lng          REAL NOT NULL
);

-- phone_hash est NULLABLE : un « compte léger » (pseudo + appareil) accumule des
-- points immédiatement, mais n'apparaît au classement public qu'une fois vérifié.
-- Le hachage est un HMAC-SHA256 avec un pepper hors base : un sha256 simple est
-- brute-forçable (l'espace des numéros tunisiens tient dans 10^8).
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  phone_hash    TEXT UNIQUE,
  device_id     TEXT UNIQUE,
  pseudo        TEXT NOT NULL UNIQUE,
  quartier_id   TEXT REFERENCES quartiers(id),
  points        INTEGER NOT NULL DEFAULT 0,
  role          TEXT NOT NULL DEFAULT 'citoyen'
                CHECK (role IN ('citoyen','moderateur','admin')),
  created_at    TEXT NOT NULL,
  banned_at     TEXT,
  ban_reason    TEXT,
  CHECK (phone_hash IS NOT NULL OR device_id IS NOT NULL)
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
  id                  TEXT PRIMARY KEY,
  lat                 REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                 REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  geohash8            TEXT NOT NULL,
  quartier_id         TEXT REFERENCES quartiers(id),
  type                TEXT NOT NULL CHECK (type IN (
                        'ordures_menageres','gravats','dechets_verts','encombrants',
                        'depot_sauvage','terrain_abandonne','conteneur_deborde')),
  gravite             INTEGER NOT NULL CHECK (gravite BETWEEN 1 AND 4),
  statut              TEXT NOT NULL DEFAULT 'signale' CHECK (statut IN (
                        'signale','confirme','planifie','nettoye','recidive',
                        'a_verifier','rejete')),
  description         TEXT,
  photo_url           TEXT,
  created_by          TEXT REFERENCES users(id),
  created_by_device   TEXT,
  created_at          TEXT NOT NULL,
  -- Pilote toute la décroissance (règle #2). Vaut created_at à la création.
  last_confirmed_at   TEXT NOT NULL,
  cleaned_at          TEXT,
  is_private_property INTEGER NOT NULL DEFAULT 0 CHECK (is_private_property IN (0,1)),
  moderation_status   TEXT NOT NULL DEFAULT 'pending'
                        CHECK (moderation_status IN ('pending','approved','rejected','hidden')),
  hidden_reason       TEXT,
  parent_spot_id      TEXT REFERENCES spots(id),
  idempotency_key     TEXT UNIQUE,
  CHECK (created_by IS NOT NULL OR created_by_device IS NOT NULL)
);

CREATE TABLE confirmations (
  id         TEXT PRIMARY KEY,
  spot_id    TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id),
  device_id  TEXT,
  kind       TEXT NOT NULL CHECK (kind IN ('toujours_la','c_est_propre')),
  -- Position au moment du geste : une reconfirmation ne rapporte de points que
  -- faite sur place (150 m). Sans cela le classement se gagne depuis un canapé.
  lat        REAL,
  lng        REAL,
  photo_url  TEXT,
  created_at TEXT NOT NULL,
  CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)
);

CREATE TABLE events (
  id                      TEXT PRIMARY KEY,
  titre                   TEXT NOT NULL,
  description             TEXT,
  date_debut              TEXT NOT NULL,
  date_fin                TEXT NOT NULL,
  point_rdv_lat           REAL NOT NULL,
  point_rdv_lng           REAL NOT NULL,
  organisateur_id         TEXT NOT NULL REFERENCES users(id),
  capacite                INTEGER CHECK (capacite IS NULL OR capacite > 0),
  materiel_fourni         TEXT,
  autorisation_obtenue    INTEGER NOT NULL DEFAULT 0 CHECK (autorisation_obtenue IN (0,1)),
  -- Règle non négociable #3 : pas de chantier sans filière d'évacuation.
  evacuation_par          TEXT NOT NULL CHECK (evacuation_par IN (
                            'municipalite','tunisie_recyclage','prestataire_prive','non_confirme')),
  contact_evacuation_nom  TEXT NOT NULL,
  contact_evacuation_tel  TEXT NOT NULL,
  evacuation_risque_acquittee INTEGER NOT NULL DEFAULT 0
                            CHECK (evacuation_risque_acquittee IN (0,1)),
  statut                  TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN (
                            'brouillon','publie','en_cours','termine','annule')),
  qr_secret               TEXT NOT NULL,
  photo_avant_url         TEXT,
  photo_apres_url         TEXT,
  kg_collectes            REAL CHECK (kg_collectes IS NULL OR kg_collectes >= 0),
  created_at              TEXT NOT NULL,
  cloture_at              TEXT,
  CHECK (date_fin > date_debut),
  -- Publier avec une évacuation non confirmée exige un acquittement explicite.
  -- La règle est au niveau base : elle ne peut pas être contournée par un bug applicatif.
  CHECK (evacuation_par <> 'non_confirme'
         OR statut = 'brouillon'
         OR evacuation_risque_acquittee = 1)
);

CREATE TABLE event_spots (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  spot_id  TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, spot_id)
);

CREATE TABLE participations (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  statut        TEXT NOT NULL DEFAULT 'inscrit'
                  CHECK (statut IN ('inscrit','present','absent')),
  checked_in_at TEXT,
  method        TEXT CHECK (method IS NULL OR method IN ('qr','geo','organisateur')),
  checkin_lat   REAL,
  checkin_lng   REAL,
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
  condition_json TEXT NOT NULL
);

CREATE TABLE user_badges (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id   TEXT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at TEXT NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

-- Ledger de points : jamais d'UPDATE aveugle sur users.points.
-- La contrainte UNIQUE rend l'attribution idempotente (rejeu, double requête).
CREATE TABLE point_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN (
                'spot_cree','spot_reconfirme','participation','organisation','spot_ferme')),
  points      INTEGER NOT NULL,
  ref_type    TEXT NOT NULL CHECK (ref_type IN ('spot','event','confirmation')),
  ref_id      TEXT NOT NULL,
  -- Figé au moment du gain : un déménagement ne doit pas réécrire l'historique
  -- du classement par quartier.
  quartier_id TEXT REFERENCES quartiers(id),
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, action, ref_type, ref_id)
);

CREATE TABLE reports (
  id              TEXT PRIMARY KEY,
  target_type     TEXT NOT NULL CHECK (target_type IN ('spot','event','user')),
  target_id       TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN (
                    'propriete_privee','harcelement','faux_signalement','contenu_choquant','autre')),
  details         TEXT,
  reporter_id     TEXT REFERENCES users(id),
  reporter_device TEXT,
  statut          TEXT NOT NULL DEFAULT 'ouvert'
                    CHECK (statut IN ('ouvert','traite','rejete')),
  handled_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL
);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  payload     TEXT,
  created_at  TEXT NOT NULL
);
