-- 0002_indexes — index de lecture.
-- Pas de spatial en libSQL : le filtrage carte se fait par bbox sur (lat,lng)
-- indexés, puis raffinement exact en mémoire côté service.

CREATE INDEX idx_spots_bbox       ON spots (lat, lng);
CREATE INDEX idx_spots_geohash    ON spots (geohash8);
CREATE INDEX idx_spots_quartier   ON spots (quartier_id, statut);
CREATE INDEX idx_spots_lastconf   ON spots (last_confirmed_at);
CREATE INDEX idx_spots_moderation ON spots (moderation_status, created_at);
CREATE INDEX idx_spots_created_by ON spots (created_by, created_at);
CREATE INDEX idx_spots_device     ON spots (created_by_device, created_at);

CREATE INDEX idx_conf_spot        ON confirmations (spot_id, created_at);
CREATE INDEX idx_conf_user        ON confirmations (user_id, created_at);

CREATE INDEX idx_events_dates     ON events (statut, date_debut);
CREATE INDEX idx_events_orga      ON events (organisateur_id);

CREATE INDEX idx_part_event       ON participations (event_id, statut);
CREATE INDEX idx_part_user        ON participations (user_id);

CREATE INDEX idx_points_user      ON point_events (user_id, created_at);
CREATE INDEX idx_points_quartier  ON point_events (quartier_id, created_at);

CREATE INDEX idx_reports_target   ON reports (target_type, target_id, statut);
CREATE INDEX idx_otp_phone        ON otp_codes (phone_hash, created_at);
