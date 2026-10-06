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
  deleted boolean NOT NULL DEFAULT false, parent_id uuid REFERENCES relay.messages(id), attachments jsonb NOT NULL DEFAULT '[]'
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
CREATE INDEX IF NOT EXISTS relay_participants_user ON relay.participants(user_id);
CREATE INDEX IF NOT EXISTS relay_messages_conversation_date ON relay.messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS relay_invites_email ON relay.invites(email);
CREATE INDEX IF NOT EXISTS relay_events_user_date ON relay.events(user_id,created_at);
ALTER TABLE relay.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA relay FROM PUBLIC;
