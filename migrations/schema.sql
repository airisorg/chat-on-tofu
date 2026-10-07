-- Schema6 bootstrap snapshot of src/lib/server.ts:SCHEMA/applySchema.
-- The application still owns versioned upgrades and writes the version marker.
-- This SQL is transactional and idempotent; the audit test verifies core DDL
-- equality and executes its role/RLS/publication setup before runtime migration.
-- relay is a dedicated application schema; do not mix unrelated tables into it.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(724931108);
-- BEGIN RUNTIME SCHEMA
CREATE SCHEMA IF NOT EXISTS relay;
REVOKE ALL ON SCHEMA relay FROM PUBLIC;
CREATE TABLE IF NOT EXISTS relay.schema_migrations (
  version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS relay.profiles (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
  avatar text, status text NOT NULL DEFAULT 'Available', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS relay.conversations (
  id uuid PRIMARY KEY, name text NOT NULL, kind text NOT NULL CHECK(kind IN ('dm','group','space')),
  description text NOT NULL DEFAULT '', creator_id text NOT NULL REFERENCES relay.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS relay.participants (
  conversation_id uuid NOT NULL REFERENCES relay.conversations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES relay.profiles(id), joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(), pinned boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false, section text NOT NULL DEFAULT '', force_unread boolean NOT NULL DEFAULT false,
  PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE IF NOT EXISTS relay.invites (
  conversation_id uuid NOT NULL REFERENCES relay.conversations(id) ON DELETE CASCADE,
  email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(conversation_id,email)
);
CREATE TABLE IF NOT EXISTS relay.messages (
  id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES relay.conversations(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES relay.profiles(id), text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), edited boolean NOT NULL DEFAULT false,
  deleted boolean NOT NULL DEFAULT false, parent_id uuid REFERENCES relay.messages(id), attachments jsonb NOT NULL DEFAULT '[]',
  attachment_metadata jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS relay.reactions (
  message_id uuid NOT NULL REFERENCES relay.messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES relay.profiles(id), emoji text NOT NULL,
  PRIMARY KEY(message_id,user_id,emoji)
);
CREATE TABLE IF NOT EXISTS relay.stars (
  message_id uuid NOT NULL REFERENCES relay.messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES relay.profiles(id), PRIMARY KEY(message_id,user_id)
);
CREATE TABLE IF NOT EXISTS relay.events (
  id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES relay.profiles(id),
  conversation_id uuid REFERENCES relay.conversations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS relay.uploads (
  message_id uuid NOT NULL, attachment_index integer NOT NULL CHECK(attachment_index BETWEEN 0 AND 2),
  owner_id text NOT NULL REFERENCES relay.profiles(id),
  conversation_id uuid NOT NULL REFERENCES relay.conversations(id) ON DELETE CASCADE,
  name text NOT NULL, mime_type text NOT NULL, size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880),
  total_chunks integer NOT NULL CHECK(total_chunks BETWEEN 1 AND 5), chunks jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL, PRIMARY KEY(message_id,attachment_index)
);
CREATE TABLE IF NOT EXISTS relay.operations (
  id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES relay.profiles(id),
  digest text NOT NULL CHECK(length(digest)=64), result_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS relay.request_limits (
  owner_id text NOT NULL, bucket text NOT NULL CHECK(bucket IN ('read','write','upload','media')),
  window_start timestamptz NOT NULL, requests integer NOT NULL CHECK(requests>0),
  PRIMARY KEY(owner_id,bucket,window_start)
);
CREATE INDEX IF NOT EXISTS relay_participants_user ON relay.participants(user_id);
ALTER TABLE relay.messages ADD COLUMN IF NOT EXISTS attachment_metadata jsonb NOT NULL DEFAULT '[]';
UPDATE relay.messages SET attachment_metadata=(
  SELECT coalesce(jsonb_agg(file.value - 'url' ORDER BY file.ordinality),'[]'::jsonb)
  FROM jsonb_array_elements(attachments) WITH ORDINALITY AS file(value,ordinality)
) WHERE attachment_metadata='[]'::jsonb AND jsonb_array_length(attachments)>0;
CREATE INDEX IF NOT EXISTS relay_messages_conversation_recent ON relay.messages(conversation_id,created_at DESC,id DESC);
DROP INDEX IF EXISTS relay.relay_messages_conversation_date;
CREATE INDEX IF NOT EXISTS relay_invites_email ON relay.invites(email);
CREATE INDEX IF NOT EXISTS relay_events_user_date ON relay.events(user_id,created_at);
CREATE INDEX IF NOT EXISTS relay_uploads_owner_expiry ON relay.uploads(owner_id,expires_at);
CREATE INDEX IF NOT EXISTS relay_uploads_expiry ON relay.uploads(expires_at);
CREATE INDEX IF NOT EXISTS relay_operations_owner_expiry ON relay.operations(owner_id,expires_at);
CREATE INDEX IF NOT EXISTS relay_operations_expiry ON relay.operations(expires_at);
ALTER TABLE relay.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA relay FROM PUBLIC;
-- END RUNTIME SCHEMA

DO $relay_security$
DECLARE
  role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA relay FROM %I', role_name);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA relay FROM %I', role_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND to_regprocedure('auth.uid()') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'relay' AND tablename = 'events' AND policyname = 'relay_events_own_select') THEN
      CREATE POLICY relay_events_own_select ON relay.events FOR SELECT TO authenticated USING (user_id = auth.uid()::text);
    END IF;
    GRANT USAGE ON SCHEMA relay TO authenticated;
    GRANT SELECT ON relay.events TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'relay' AND tablename = 'events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE relay.events;
  END IF;
END
$relay_security$;

COMMIT;
