-- Proof that a person accepted a version of a document at a moment from an
-- address. Append-only by convention: accepting a new version INSERTs, so the
-- history of what someone agreed to over time survives. Never UPDATE a row.
--
-- Not part of audit_log: that table is location-scoped and NOT NULL on
-- location_id, while an acceptance can be platform-wide and must never be
-- pruned along with a location.
CREATE TABLE IF NOT EXISTS "terms_acceptances" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"       text NOT NULL,
  "user_email"    text,
  "location_id"   uuid REFERENCES "locations"("id") ON DELETE SET NULL,
  "document"      text NOT NULL,
  "version"       text NOT NULL,
  "document_url"  text,
  "ip_address"    text,
  "user_agent"    text,
  "accepted_at"   timestamptz DEFAULT now() NOT NULL
);

-- One row per person per document version per location, so re-accepting is a
-- no-op rather than a duplicate. NULLS NOT DISTINCT so platform-wide
-- acceptances (location_id IS NULL) collide with each other as intended —
-- without it every re-accept would insert another row.
CREATE UNIQUE INDEX IF NOT EXISTS "terms_acceptance_unique_idx"
  ON "terms_acceptances" ("user_id", "document", "version", "location_id")
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS "terms_acceptance_user_idx"
  ON "terms_acceptances" ("user_id");
