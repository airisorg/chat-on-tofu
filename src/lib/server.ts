import { createClient, type User } from '@supabase/supabase-js';
import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { databaseTls } from './database-tls';
import type { Attachment, ChatAction, ChatState, Message, Person } from './types';
import { ACTION_RETRY_WINDOW_MS, MAX_RECENT_ACTIONS, canonicalJson } from './action-identity';
import { MAX_CONVERSATION_MEMBERS } from './chat-limits';
import { isNativeEmoji } from './native-emoji';
import { MAX_ACTION_BODY_BYTES, MAX_ATTACHMENT_BASE64_LENGTH, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_HISTORY_PAYLOAD_BYTES, MAX_STAGED_ATTACHMENT_BYTES, MAX_STAGED_ATTACHMENTS, UPLOAD_CHUNK_BYTES, UPLOAD_TTL_SECONDS } from './media-limits';

export class ChatError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function publicConfig() {
  let supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  let supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  // A mistaken server-key assignment must never become a public config leak.
  if (!supabaseAnonKey.startsWith('sb_publishable_')) {
    try {
      const claims = JSON.parse(Buffer.from(supabaseAnonKey.split('.')[1] ?? '', 'base64url').toString('utf8')) as { role?: string };
      if (claims.role !== 'anon') supabaseAnonKey = '';
    } catch { supabaseAnonKey = ''; }
  }
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) supabaseUrl = '';
    else supabaseUrl = url.origin + url.pathname.replace(/\/$/, '');
  } catch { supabaseUrl = ''; }
  return { supabaseUrl, supabaseAnonKey: supabaseUrl ? supabaseAnonKey : '', databaseConfigured: Boolean(process.env.DATABASE_URL) };
}

let db: postgres.Sql | undefined;
let migration: Promise<void> | undefined;
type Query = postgres.Sql | postgres.TransactionSql;

async function transaction<T>(sql: postgres.Sql, work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await sql.begin(work) as T; }
    catch (error) {
      // PostgreSQL has definitely rolled back a deadlock victim. Network and
      // unknown commit outcomes must never cause an automatic mutation replay.
      if (attempt >= 2 || !error || typeof error !== 'object' || !('code' in error) || error.code !== '40P01') throw error;
      // Let the surviving transaction release its locks before competing again.
      await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt + Math.floor(Math.random() * 25)));
    }
  }
}

// These tables are accessed only by the authenticated app server. RLS denies
// direct browser access through a shared Supabase REST endpoint.
export const SCHEMA = `
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
`;

export async function applySchema(sql: postgres.Sql): Promise<void> {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(724931108)`;
    const marker = await tx`select to_regclass('relay.schema_migrations') is not null as present`;
    if (marker[0].present) {
      const installed = await tx`select version from relay.schema_migrations where version=6`;
      if (installed.length) return;
    }
    // Static trusted schema only; all user values use bound parameters.
    for (const statement of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) await tx.unsafe(statement);
    const roles = await tx`select rolname from pg_roles where rolname in ('anon','authenticated')`;
    for (const role of roles) {
      await tx`revoke all on schema relay from ${tx(String(role.rolname))}`;
      await tx`revoke all on all tables in schema relay from ${tx(String(role.rolname))}`;
    }
    const authFunction = await tx`select to_regprocedure('auth.uid()') is not null as present`;
    if (roles.some(role => role.rolname === 'authenticated') && authFunction[0].present) {
      const policies = await tx`select 1 from pg_policies where schemaname='relay' and tablename='events' and policyname='relay_events_own_select'`;
      if (!policies.length) await tx.unsafe('CREATE POLICY relay_events_own_select ON relay.events FOR SELECT TO authenticated USING (user_id=auth.uid()::text)');
      await tx.unsafe('GRANT USAGE ON SCHEMA relay TO authenticated');
      await tx.unsafe('GRANT SELECT ON relay.events TO authenticated');
    }
    const publication = await tx`select 1 from pg_publication where pubname='supabase_realtime'`;
    if (publication.length) {
      const published = await tx`select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='relay' and tablename='events'`;
      if (!published.length) await tx.unsafe('ALTER PUBLICATION supabase_realtime ADD TABLE relay.events');
    }
    await tx`insert into relay.schema_migrations(version) values(6) on conflict do nothing`;
  });
}

async function database(): Promise<postgres.Sql> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new ChatError('The chat database is not connected yet.', 503);
  db ??= postgres(url, { ssl: databaseTls(url), max: 3, prepare: false, idle_timeout: 20, connect_timeout: 15 });
  if (!migration) {
    const pending = applySchema(db);
    migration = pending;
    pending.catch(() => { if (migration === pending) migration = undefined; });
  }
  await migration;
  return db;
}

export async function authenticatedUser(request: Request): Promise<User> {
  const config = publicConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) throw new ChatError('Google sign-in is not connected yet.', 503);
  const auth = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s]{20,10000}$/.test(auth)) throw new ChatError('Sign in to continue.', 401);
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(6000) }) },
  });
  const { data, error } = await client.auth.getUser(auth.slice(7));
  if (error) {
    const invalid = error.status === 401 || error.status === 403 || ['bad_jwt','session_not_found','user_not_found','session_expired'].includes(error.code ?? '') || error.name === 'AuthSessionMissingError';
    if (invalid) throw new ChatError('Your session expired. Please sign in again.', 401);
    throw new ChatError('Sign-in is temporarily unavailable. Your session is still saved; please try again.', 503);
  }
  if (!data.user) throw new ChatError('Sign-in is temporarily unavailable. Please try again.', 503);
  if (!data.user.email || !data.user.email_confirmed_at) throw new ChatError('Verify your email to join conversations.', 403);
  return data.user;
}

export type RequestBucket = 'read' | 'write' | 'upload' | 'media';
const REQUEST_LIMITS: Record<RequestBucket, number> = { read: 600, write: 120, upload: 120, media: 120 };

/** Atomic database counters span server instances; only verified account IDs reach this helper. */
export async function enforceRequestLimit(user: User, bucket: RequestBucket, connection?: postgres.Sql): Promise<void> {
  const sql = connection ?? await database();
  const rows = await sql`insert into relay.request_limits(owner_id,bucket,window_start,requests)
    values(${user.id},${bucket},date_trunc('minute',now()),1)
    on conflict(owner_id,bucket,window_start) do update set requests=relay.request_limits.requests+1
    where relay.request_limits.requests < ${REQUEST_LIMITS[bucket]} returning requests`;
  if (!rows.length) throw new ChatError('Too many requests. Please wait a minute, then try again.', 429);
  if (Number(rows[0].requests) === 1) await sql`delete from relay.request_limits
    where owner_id=${user.id} and bucket=${bucket} and window_start < date_trunc('minute',now())-interval '2 minutes'`;
}

function safeAvatar(value: unknown) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    const googleImage = ['googleusercontent.com', 'gstatic.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    return url.protocol === 'https:' && !url.username && !url.password && googleImage ? url.href : null;
  } catch { return null; }
}

async function prepareUser(sql: Query, user: User) {
  const email = user.email!.trim().toLowerCase();
  const metadata = user.user_metadata ?? {};
  const rawName = metadata.full_name || metadata.name || email.split('@')[0];
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 80) : email.split('@')[0];
  const avatar = safeAvatar(metadata.avatar_url || metadata.picture);
  // Even a no-op ON CONFLICT DO UPDATE locks a unique-key profile row. Two
  // members can then deadlock while event foreign keys inspect each other's
  // profiles. Common requests only read; genuine verified-email/avatar changes
  // still update, and an initial concurrent sign-in uses an insert-only race.
  const readProfile = async () => (await sql`select p.*,
    exists(select 1 from relay.invites where email=${email}) as has_pending_invites
    from relay.profiles p where p.id=${user.id}`)[0];
  let existing = await readProfile();
  // An absent profile always attempts a claim: an invitation can race the
  // initial insert. Existing profiles check anew on every request, never cache.
  const claimInvites = !existing || Boolean(existing.has_pending_invites);
  if (!existing) {
    // Concurrent first requests can conflict on either id or unique email.
    // Always reread our verified id; an email owned by another identity is not
    // a reason to share its profile or workspace.
    const inserted = await sql`insert into relay.profiles (id,email,name,avatar) values (${user.id},${email},${name},${avatar}) on conflict do nothing returning *`;
    existing = inserted[0] ?? await readProfile();
    if (!existing) throw new ChatError('This verified email is already linked to another account.', 409);
  }
  if (existing.email !== email) {
    const changed = await sql`update relay.profiles set email=${email} where id=${user.id} and email is distinct from ${email} returning *`;
    existing = changed[0] ?? await readProfile();
  }
  if (avatar && !existing.avatar) {
    const changed = await sql`update relay.profiles set avatar=${avatar} where id=${user.id} and avatar is null returning *`;
    existing = changed[0] ?? await readProfile();
  }
  if (claimInvites) await sql`with claimed as (delete from relay.invites where email=${email} returning conversation_id)
    insert into relay.participants (conversation_id,user_id)
    select conversation_id,${user.id} from claimed
    on conflict(conversation_id,user_id) do nothing`;
  return existing;
}

function person(row: Record<string, unknown>): Person {
  return { id: String(row.id), name: String(row.name), email: String(row.email), avatar: safeAvatar(row.avatar) ?? undefined, color: '#1967d2', status: String(row.status ?? 'Available') };
}
function iso(value: unknown) { return new Date(value as string).toISOString(); }

async function stateFor(sql: Query, userId: string, preparedProfile?: Record<string, unknown>): Promise<ChatState> {
  const profileQuery = preparedProfile ? Promise.resolve([preparedProfile]) : sql`select * from relay.profiles where id=${userId}`;
  const conversationQuery = sql`select c.*,p.pinned,p.muted,p.section,p.force_unread,
    (select count(*)::integer from relay.messages m where m.conversation_id=c.id and m.author_id<>${userId} and not m.deleted and m.created_at>p.last_read_at) as unread,
    (select case when m.deleted then 'Message deleted' when m.text<>'' then m.text else 'Attachment' end from relay.messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1) as last_message
    from relay.conversations c join relay.participants p on p.conversation_id=c.id
    where p.user_id=${userId} order by c.updated_at desc,c.id`;
  const rosterQuery = sql`select p.id,p.name,p.email,p.avatar,p.status,cp.conversation_id,false as invited from relay.profiles p
    join relay.participants cp on cp.user_id=p.id
    where exists(select 1 from relay.participants mine where mine.conversation_id=cp.conversation_id and mine.user_id=${userId})
    union all
    select null::text,null::text,i.email,null::text,'Invited'::text,i.conversation_id,true from relay.invites i where exists
    (select 1 from relay.participants mine where mine.conversation_id=i.conversation_id and mine.user_id=${userId})`;
  // Select indexed ordering keys before fetching message payloads. The
  // parameterized LIMIT 1 lookup avoids the global join plan that scanned
  // unrelated histories in our native PostgreSQL benchmark.
  const messageQuery = sql`with selected as materialized (
    select m.* from relay.participants mine cross join lateral (
      select id,conversation_id,created_at
      from relay.messages where conversation_id=mine.conversation_id
      order by created_at desc,id desc limit 2000
    ) m where mine.user_id=${userId}
    order by m.created_at desc,m.id desc limit 2000
  ), recent as (
    select m.id,m.conversation_id,m.author_id,m.text,m.created_at,m.edited,m.deleted,m.parent_id,
      coalesce((select jsonb_agg((file.value - 'url') || jsonb_build_object('url',
        '/api/attachments?messageId=' || m.id::text || '&index=' || (file.ordinality-1)::text)
        order by file.ordinality) from jsonb_array_elements(m.attachment_metadata) with ordinality as file(value,ordinality)), '[]'::jsonb) as attachments
    from selected selected_id cross join lateral (
      select id,conversation_id,author_id,text,created_at,edited,deleted,parent_id,attachment_metadata
      from relay.messages where id=selected_id.id limit 1
    ) m
  ), bounded as (
    select recent.*,sum(octet_length(attachments::text)+octet_length(text)+300) over(order by created_at desc,id desc) as payload_bytes from recent
  ) select m.*,p.name,p.email,p.avatar,p.status,
    exists(select 1 from relay.stars s where s.message_id=m.id and s.user_id=${userId}) as starred
    from bounded m join relay.profiles p on p.id=m.author_id
    where m.payload_bytes <= ${MAX_HISTORY_PAYLOAD_BYTES} order by m.created_at desc,m.id desc`;
  const [profiles, conversations, roster, messages] = await Promise.all([profileQuery, conversationQuery, rosterQuery, messageQuery]);
  if (!profiles.length) throw new ChatError('Your profile is not available.', 500);
  const messageIds = new Set(messages.map(message => String(message.id)));
  const missingParents = [...new Set(messages.flatMap(message => message.parent_id && !messageIds.has(String(message.parent_id)) ? [String(message.parent_id)] : []))];
  // A reply's older root may lie outside the working history. Include owned
  // root context before applying the final byte budget, without reading media.
  const parents = missingParents.length ? await sql`select m.id,m.conversation_id,m.author_id,m.text,m.created_at,m.edited,m.deleted,m.parent_id,
    coalesce((select jsonb_agg((file.value - 'url') || jsonb_build_object('url',
      '/api/attachments?messageId=' || m.id::text || '&index=' || (file.ordinality-1)::text)
      order by file.ordinality) from jsonb_array_elements(m.attachment_metadata) with ordinality as file(value,ordinality)), '[]'::jsonb) as attachments,
    p.name,p.email,p.avatar,p.status,
    exists(select 1 from relay.stars s where s.message_id=m.id and s.user_id=${userId}) as starred
    from relay.messages m join relay.profiles p on p.id=m.author_id
    join relay.participants mine on mine.conversation_id=m.conversation_id and mine.user_id=${userId}
    where m.id=any(${missingParents}::uuid[]) and m.parent_id is null` : [];
  const availableMessages = [...messages, ...parents];
  const reactions = messages.length ? await sql`select r.message_id,r.emoji,array_agg(r.user_id order by r.user_id) as user_ids from relay.reactions r
    where r.message_id = any(${availableMessages.map(m => String(m.id))}::uuid[]) group by r.message_id,r.emoji` : [];
  const membersByConversation = new Map<string, Person[]>();
  for (const member of roster.filter(member => !member.invited)) {
    const key = String(member.conversation_id);
    const list = membersByConversation.get(key) ?? [];
    list.push(person(member)); membersByConversation.set(key,list);
  }
  for (const invite of roster.filter(member => member.invited)) {
    const key = String(invite.conversation_id);
    const list = membersByConversation.get(key) ?? [];
    list.push({id:`invite:${invite.email}`,name:String(invite.email).split('@')[0],email:String(invite.email),status:'Invited',color:'#6d7780'});
    membersByConversation.set(key,list);
  }
  const reactionsByMessage = new Map<string, {emoji:string;userIds:string[]}[]>();
  for (const reaction of reactions) {
    const key = String(reaction.message_id);
    const list = reactionsByMessage.get(key) ?? [];
    list.push({emoji:String(reaction.emoji),userIds:(reaction.user_ids as unknown[]).map(String)});
    reactionsByMessage.set(key,list);
  }
  const state: ChatState = {
    user: person(profiles[0]),
    conversations: conversations.map(c => {
      const allMembers = membersByConversation.get(String(c.id)) ?? [];
      return { id: String(c.id), name: c.kind === 'dm' ? allMembers.find(p => p.id !== userId)?.name ?? String(c.name) : String(c.name), kind: c.kind as 'dm' | 'group' | 'space', members: allMembers, description: String(c.description), lastMessage: c.last_message ? String(c.last_message) : undefined, updatedAt: iso(c.updated_at), unread: c.force_unread ? Math.max(1, Number(c.unread)) : Number(c.unread), pinned: Boolean(c.pinned), muted: Boolean(c.muted), section: String(c.section) };
    }),
    messages: availableMessages.map(m => {
      return { id: String(m.id), conversationId: String(m.conversation_id), author: person({ ...m, id: m.author_id }), text: m.deleted ? '' : String(m.text), createdAt: iso(m.created_at), edited: Boolean(m.edited), deleted: Boolean(m.deleted), parentId: m.parent_id ? String(m.parent_id) : undefined, starred: !m.deleted && Boolean(m.starred), attachments: m.deleted ? [] : (m.attachments as Attachment[]), reactions: m.deleted ? [] : reactionsByMessage.get(String(m.id)) ?? [] };
    }),
  };
  return boundStatePayload(state);
}

function boundStatePayload(state: ChatState): ChatState {
  const candidates = [...state.messages].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const byId = new Map(candidates.map(message => [message.id, message]));
  const selected = new Map<string, Message>();
  // Count the actual serialized fields, including reaction UUIDs, escaped text,
  // authors and conversation members. Leave room for the small API envelope.
  let bytes = Buffer.byteLength(JSON.stringify({ ...state, messages: [] }));
  const limit = MAX_HISTORY_PAYLOAD_BYTES - 1024;
  if (bytes > limit) throw new ChatError('This workspace is too large to load. Contact support.', 503);
  const messageBytes = new Map(candidates.map(message => [message.id, Buffer.byteLength(JSON.stringify(message)) + 1]));
  for (const message of candidates) {
    if (selected.has(message.id)) continue;
    const bundle = new Map<string, Message>();
    let current: Message | undefined = message;
    while (current && !selected.has(current.id) && !bundle.has(current.id)) {
      bundle.set(current.id, current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const extraBytes = [...bundle.keys()].reduce((total, id) => total + messageBytes.get(id)!, 0);
    if (selected.size + bundle.size > 2000 || bytes + extraBytes > limit) break;
    for (const item of bundle.values()) selected.set(item.id, item);
    bytes += extraBytes;
  }
  return { ...state, messages: candidates.filter(message => selected.has(message.id)).reverse() };
}

function text(value: unknown, max: number, label: string, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new ChatError(`${label} must be ${empty ? 'at most' : 'between 1 and'} ${max} characters.`);
  return value.trim();
}
function uuid(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ChatError('This item is not available.');
  return value.toLowerCase();
}
function bool(value: unknown) { if (typeof value !== 'boolean') throw new ChatError('Invalid preference.'); return value; }
function emails(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_CONVERSATION_MEMBERS) throw new ChatError(`Invite up to ${MAX_CONVERSATION_MEMBERS} people at a time.`);
  return [...new Set(value.map(v => {
    const email = text(v, 254, 'Email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ChatError('Enter valid email addresses.');
    return email;
  }))];
}

const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain', 'application/pdf', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav'];
function attachmentMetadata(value: unknown): Pick<Attachment, 'name' | 'type' | 'size'> {
  if (!value || typeof value !== 'object') throw new ChatError('Invalid attachment.');
  const item = value as Record<string, unknown>;
  const name = text(item.name, 120, 'Filename').replace(/[\x00-\x1f\x7f]/g, '');
  if (!name || typeof item.type !== 'string' || !ATTACHMENT_TYPES.includes(item.type) || typeof item.size !== 'number' || !Number.isInteger(item.size) || item.size < 1 || item.size > MAX_ATTACHMENT_BYTES) throw new ChatError('Use an image, voice note, text file, or PDF up to 5 MB.');
  return { name, type: item.type, size: item.size };
}

export type UploadChunk = { clientMessageId: string; conversationId: string; attachmentIndex: number; name: string; type: string; size: number; chunkIndex: number; totalChunks: number; data: string };
export function validateUploadChunk(value: unknown): UploadChunk {
  if (!value || typeof value !== 'object') throw new ChatError('Invalid file upload.');
  const item = value as Record<string, unknown>;
  const metadata = attachmentMetadata(item);
  const clientMessageId = uuid(item.clientMessageId), conversationId = uuid(item.conversationId);
  const attachmentIndex = item.attachmentIndex, chunkIndex = item.chunkIndex, totalChunks = Math.ceil(metadata.size / UPLOAD_CHUNK_BYTES);
  if (typeof attachmentIndex !== 'number' || !Number.isInteger(attachmentIndex) || attachmentIndex < 0 || attachmentIndex >= MAX_ATTACHMENTS || item.totalChunks !== totalChunks || typeof chunkIndex !== 'number' || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) throw new ChatError('Invalid file chunk.');
  const length = Math.min(UPLOAD_CHUNK_BYTES, metadata.size - chunkIndex * UPLOAD_CHUNK_BYTES);
  if (typeof item.data !== 'string' || item.data.length !== 4 * Math.ceil(length / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) throw new ChatError('Invalid file chunk data.');
  const bytes = Buffer.from(item.data, 'base64');
  if (bytes.length !== length || bytes.toString('base64') !== item.data) throw new ChatError('Invalid file chunk data.');
  return { ...metadata, clientMessageId, conversationId, attachmentIndex, chunkIndex, totalChunks, data: item.data };
}

export async function stageUpload(user: User, input: unknown, connection?: postgres.Sql): Promise<{ ok: true }> {
  const chunk = validateUploadChunk(input);
  const sql = connection ?? await database();
  return transaction(sql, async tx => {
    await prepareUser(tx, user);
    await membership(tx, chunk.conversationId, user.id);
    // Bound concurrent reservations per account, and serialize with final send.
    await tx`select pg_advisory_xact_lock(hashtextextended(${`relay-upload-owner:${user.id}`},0))`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`relay-send:${chunk.clientMessageId}`},0))`;
    const committed = await tx`select author_id,conversation_id,attachments,deleted from relay.messages where id=${chunk.clientMessageId} for update`;
    if (committed.length) {
      const row = committed[0], file = (row.attachments as Attachment[])[chunk.attachmentIndex];
      if (row.author_id !== user.id || String(row.conversation_id) !== chunk.conversationId || row.deleted || !file || file.name !== chunk.name || file.type !== chunk.type || file.size !== chunk.size) throw new ChatError('This message identifier was already used for a different message.', 409);
      const bytes = Buffer.from(file.url.slice(file.url.indexOf(',') + 1), 'base64');
      if (bytes.subarray(chunk.chunkIndex * UPLOAD_CHUNK_BYTES, (chunk.chunkIndex + 1) * UPLOAD_CHUNK_BYTES).toString('base64') !== chunk.data) throw new ChatError('This file chunk was already used for different data.', 409);
      return { ok: true };
    }
    await tx`delete from relay.uploads where owner_id=${user.id} and expires_at <= now()`;
    await tx`delete from relay.uploads where (message_id,attachment_index) in
      (select message_id,attachment_index from relay.uploads where expires_at <= now() limit 100)`;
    const existing = await tx`select * from relay.uploads where message_id=${chunk.clientMessageId} and attachment_index=${chunk.attachmentIndex} for update`;
    let row = existing[0];
    if (row) {
      if (row.owner_id !== user.id || String(row.conversation_id) !== chunk.conversationId || row.name !== chunk.name || row.mime_type !== chunk.type || Number(row.size) !== chunk.size || Number(row.total_chunks) !== chunk.totalChunks) throw new ChatError('This upload identifier was already used for a different file.', 409);
    } else {
      const usage = await tx`select count(*)::integer as files,coalesce(sum(size),0)::integer as bytes from relay.uploads where owner_id=${user.id} and expires_at>now()`;
      if (Number(usage[0].files) >= MAX_STAGED_ATTACHMENTS || Number(usage[0].bytes) + chunk.size > MAX_STAGED_ATTACHMENT_BYTES) throw new ChatError('Too many unfinished file uploads. Retry your earlier message or wait 15 minutes.', 429);
      const inserted = await tx`insert into relay.uploads(message_id,attachment_index,owner_id,conversation_id,name,mime_type,size,total_chunks,expires_at)
        values(${chunk.clientMessageId},${chunk.attachmentIndex},${user.id},${chunk.conversationId},${chunk.name},${chunk.type},${chunk.size},${chunk.totalChunks},now()+${UPLOAD_TTL_SECONDS}*interval '1 second') returning *`;
      row = inserted[0];
    }
    const previous = (row.chunks as Record<string, string>)[String(chunk.chunkIndex)];
    if (previous !== undefined && previous !== chunk.data) throw new ChatError('This file chunk was already used for different data.', 409);
    if (previous === undefined) await tx`update relay.uploads set chunks=chunks || ${tx.json({ [chunk.chunkIndex]: chunk.data })} where message_id=${chunk.clientMessageId} and attachment_index=${chunk.attachmentIndex}`;
    return { ok: true };
  });
}

async function resolveSendAttachments(tx: Query, value: unknown, messageId: string, conversationId: string, userId: string, prior?: Record<string, unknown>): Promise<Attachment[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw new ChatError(`Attach up to ${MAX_ATTACHMENTS} files.`);
  const result: Attachment[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index] as Attachment;
    if (!item || typeof item.url !== 'string' || !item.url.startsWith('upload:')) { result.push(...validateAttachments([item])); continue; }
    const metadata = attachmentMetadata(item);
    if (item.url.toLowerCase() !== `upload:${messageId}:${index}`) throw new ChatError('This upload does not belong to this message.', 409);
    if (prior) {
      const file = (prior.attachments as Attachment[])[index];
      if (prior.author_id !== userId || String(prior.conversation_id) !== conversationId || prior.deleted || !file || file.name !== metadata.name || file.type !== metadata.type || file.size !== metadata.size) throw new ChatError('This message identifier was already used for a different message.', 409);
      result.push(file);
      continue;
    }
    const rows = await tx`select * from relay.uploads where message_id=${messageId} and attachment_index=${index} and owner_id=${userId} and conversation_id=${conversationId} and expires_at>now() for update`;
    const row = rows[0];
    if (!row || row.name !== metadata.name || row.mime_type !== metadata.type || Number(row.size) !== metadata.size) throw new ChatError('This file upload is incomplete or expired. Retry your message.', 409);
    const chunks = row.chunks as Record<string, string>;
    const total = Number(row.total_chunks), parts: Buffer[] = [];
    for (let chunkIndex = 0; chunkIndex < total; chunkIndex++) {
      const chunk = validateUploadChunk({ ...metadata, clientMessageId: messageId, conversationId, attachmentIndex: index, chunkIndex, totalChunks: total, data: chunks[String(chunkIndex)] });
      parts.push(Buffer.from(chunk.data, 'base64'));
    }
    const bytes = Buffer.concat(parts);
    result.push(...validateAttachments([{ ...metadata, url: `data:${metadata.type};base64,${bytes.toString('base64')}` }]));
  }
  return result;
}

export function validateAttachments(value: unknown): Attachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw new ChatError(`Attach up to ${MAX_ATTACHMENTS} files.`);
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new ChatError('Invalid attachment.');
    const name = text(item.name, 120, 'Filename').replace(/[\x00-\x1f\x7f]/g, '');
    const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain', 'application/pdf', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav'];
    if (!allowed.includes(item.type) || typeof item.url !== 'string' || item.url.length > MAX_ATTACHMENT_BASE64_LENGTH + 64) throw new ChatError('Use an image, voice note, text file, or PDF up to 5 MB.');
    const prefix = `data:${item.type};base64,`;
    if (!item.url.startsWith(prefix)) throw new ChatError('Attachments must contain the selected file data.');
    const encoded = item.url.slice(prefix.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new ChatError('Invalid attachment data.');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > MAX_ATTACHMENT_BYTES || bytes.length === 0 || item.size !== bytes.length || bytes.toString('base64') !== encoded) throw new ChatError('Each attachment must contain matching file data up to 5 MB.');
    const signatures: Record<string, () => boolean> = {
      'image/png': () => bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
      'image/jpeg': () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      'image/gif': () => /^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii')),
      'image/webp': () => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
      'application/pdf': () => bytes.subarray(0, 5).toString('ascii') === '%PDF-',
      'audio/webm': () => bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
      'audio/mp4': () => bytes.subarray(4, 8).toString('ascii') === 'ftyp',
      'audio/ogg': () => bytes.subarray(0, 4).toString('ascii') === 'OggS',
      'audio/wav': () => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE',
      'audio/mpeg': () => (bytes.length >= 10 && bytes.subarray(0, 3).toString('ascii') === 'ID3' && bytes[3] >= 2 && bytes[3] <= 4 && bytes.subarray(6, 10).every(byte => byte < 128)) || (bytes.length >= 4 && bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0 && (bytes[2] >> 4) !== 15 && ((bytes[2] >> 2) & 3) !== 3),
    };
    if (signatures[item.type] && !signatures[item.type]()) throw new ChatError('The file content does not match its type.');
    return { name, type: item.type, url: item.url, size: bytes.length };
  });
}

export async function getAttachment(user: User, messageIdValue: unknown, indexValue: unknown, connection?: postgres.Sql): Promise<{ file: Attachment; bytes: Buffer }> {
  const messageId = uuid(messageIdValue);
  const index = typeof indexValue === 'string' && /^[0-2]$/.test(indexValue) ? Number(indexValue) : indexValue;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= MAX_ATTACHMENTS) throw new ChatError('This file is not available.', 404);
  const sql = connection ?? await database();
  const rows = await sql`select m.attachments -> ${index}::integer as attachment
    from relay.messages m where m.id=${messageId} and not m.deleted and exists
    (select 1 from relay.participants p where p.conversation_id=m.conversation_id and p.user_id=${user.id})`;
  if (!rows[0]?.attachment) throw new ChatError('This file is not available.', 404);
  const file = validateAttachments([rows[0].attachment])[0];
  return { file, bytes: Buffer.from(file.url.slice(file.url.indexOf(',') + 1), 'base64') };
}

export function attachmentResponse(file: Attachment, bytes: Buffer): Response {
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(Uint8Array.from(bytes.subarray(offset, end)));
      offset = end;
    },
    cancel() { offset = bytes.length; },
  });
  return new Response(stream, { headers: {
    'Content-Type': file.type,
    'Content-Length': String(bytes.length),
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()]/g, character => `%${character.charCodeAt(0).toString(16)}`)}`,
    'Cache-Control': 'private, no-store, max-age=0',
    'Vary': 'Authorization',
    'X-Content-Type-Options': 'nosniff',
  } });
}

async function membership(sql: Query, conversationId: string, userId: string) {
  // Protect membership deletion/key changes without blocking independent
  // last-read/pin/mute updates on the same participant tuple.
  const rows = await sql`select c.kind from relay.conversations c join relay.participants p on p.conversation_id=c.id where c.id=${conversationId} and p.user_id=${userId} for key share of p`;
  if (!rows.length) throw new ChatError('This conversation is no longer available.', 404);
  return rows[0];
}
async function accessibleMessage(sql: Query, messageId: string, userId: string) {
  const rows = await sql`select m.id,m.conversation_id,m.author_id,m.deleted from relay.messages m join relay.participants p on p.conversation_id=m.conversation_id where m.id=${messageId} and p.user_id=${userId} for update of m for key share of p`;
  if (!rows.length) throw new ChatError('This message is no longer available.', 404);
  return rows[0];
}
async function invite(sql: Query, conversationId: string, values: string[]) {
  // Serialize slot reservations, including pending email invitations.
  await sql`select id from relay.conversations where id=${conversationId} for update`;
  const rows = await sql`select p.email from relay.participants cp join relay.profiles p on p.id=cp.user_id where cp.conversation_id=${conversationId}
    union select email from relay.invites where conversation_id=${conversationId}`;
  const reserved = new Set(rows.map(row=>String(row.email)));
  const incoming = [...new Set(values)].filter(email=>!reserved.has(email));
  if (!incoming.length) return;
  if (reserved.size + incoming.length > MAX_CONVERSATION_MEMBERS) throw new ChatError(`A conversation can have up to ${MAX_CONVERSATION_MEMBERS} people, including pending invitations.`);
  await sql`with known as (select id,email from relay.profiles where email=any(${incoming}::text[])),
    added as (insert into relay.participants(conversation_id,user_id) select ${conversationId},id from known on conflict do nothing returning user_id)
    insert into relay.invites(conversation_id,email)
    select ${conversationId},incoming.email from unnest(${incoming}::text[]) as incoming(email) where not exists(select 1 from known where known.email=incoming.email) on conflict do nothing`;
}

export async function getChat(user: User, serverConnection?: postgres.Sql): Promise<ChatState> {
  return (await getChatResult(user, undefined, serverConnection)).state;
}

export async function getChatResult(user: User, clientActionId?: string, serverConnection?: postgres.Sql): Promise<{ state: ChatState; actionId?: string; id?: string }> {
  const receiptId = clientActionId === undefined ? undefined : uuid(clientActionId);
  const sql = serverConnection ?? await database();
  return transaction(sql, async tx => {
    const profile = await prepareUser(tx, user);
    const receipt = receiptId ? (await tx`select id,result_id from relay.operations where id=${receiptId} and owner_id=${user.id} and expires_at>now()`)[0] : undefined;
    // The receipt contains no original payload. State always reflects current
    // membership, including when an acknowledged leave revoked access.
    // GET can reuse its fresh profile. Mutations reload after possible name or
    // status changes, so their acknowledgement always contains the saved value.
    return { state: await stateFor(tx, user.id, profile), ...(receipt ? { actionId: String(receipt.id), id: receipt.result_id ? String(receipt.result_id) : undefined } : {}) };
  });
}

const ACTION_FIELDS = {
  send: ['conversationId', 'text', 'parentId', 'attachments', 'clientMessageId'],
  edit: ['messageId', 'text'],
  delete: ['messageId'],
  react: ['messageId', 'emoji', 'active'],
  star: ['messageId', 'starred'],
  read: ['conversationId', 'unread'],
  create: ['name', 'kind', 'emails', 'description'],
  conversation: ['conversationId', 'name', 'description', 'pinned', 'muted', 'section'],
  invite: ['conversationId', 'emails'],
  leave: ['conversationId'],
  profile: ['name', 'status'],
} satisfies Record<ChatAction['type'], readonly string[]>;

function actionInput(input: unknown): ChatAction {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('type' in input) || typeof input.type !== 'string' || !Object.hasOwn(ACTION_FIELDS, input.type)) throw new ChatError('Choose a valid action.');
  const fields: readonly string[] = ACTION_FIELDS[input.type as ChatAction['type']];
  // A TypeScript cast does not remove surplus properties in incoming JSON.
  // Keep the current client contract and reject unsupported action fields.
  const allowed = new Set(['type', 'clientActionId', 'clientActionCreatedAt', ...fields]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new ChatError('This action contains unsupported fields.');
  return input as ChatAction;
}

export async function mutateChat(user: User, input: unknown, serverConnection?: postgres.Sql): Promise<{ state: ChatState; id?: string; actionId?: string }> {
  const action = actionInput(input);
  const actionId = action.type !== 'send' && action.clientActionId !== undefined ? uuid(action.clientActionId) : undefined;
  let expiresAt: string | undefined;
  let digest: string | undefined;
  if (actionId) {
    const timestamp = typeof action.clientActionCreatedAt === 'string' ? Date.parse(action.clientActionCreatedAt) : NaN;
    if (!Number.isFinite(timestamp)) throw new ChatError('This change needs a valid retry timestamp.');
    if (Date.now() - timestamp >= ACTION_RETRY_WINDOW_MS) throw new ChatError('This change’s retry window expired. Review the current state before making a new change.', 409);
    if (timestamp > Date.now() + 5 * 60 * 1000) throw new ChatError('Check your device clock before making changes.');
    expiresAt = new Date(timestamp + ACTION_RETRY_WINDOW_MS).toISOString();
    digest = createHash('sha256').update(canonicalJson({ ...action, clientActionId: undefined })).digest('hex');
  }
  const sql = serverConnection ?? await database();
  return transaction(sql, async tx => {
    await prepareUser(tx, user);
    const userId = user.id;
    if (actionId) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`relay-action:${actionId}`},0))`;
      const previous = (await tx`select owner_id,digest,result_id from relay.operations where id=${actionId} for update`)[0];
      if (previous) {
        if (previous.owner_id !== userId || previous.digest !== digest) throw new ChatError('This change identifier was already used for a different change.', 409);
        return { state: await stateFor(tx, userId), actionId, id: previous.result_id ? String(previous.result_id) : undefined };
      }
      await tx`select pg_advisory_xact_lock(hashtextextended(${`relay-action-owner:${userId}`},0))`;
      await tx`delete from relay.operations where id in (select id from relay.operations where expires_at<=now() order by expires_at limit 500)`;
      const count = await tx`select count(*)::int as count from relay.operations where owner_id=${userId} and expires_at>now()`;
      if (Number(count[0].count) >= MAX_RECENT_ACTIONS) throw new ChatError('Too many recent changes. Please try again after the retry window has cleared.', 429);
    }
    let id: string | undefined;
    let changedConversationId: string | undefined;
    switch (action.type) {
      case 'send': {
        const conversationId = uuid(action.conversationId);
        await membership(tx, conversationId, userId);
        changedConversationId = conversationId;
        id = action.clientMessageId === undefined ? crypto.randomUUID() : uuid(action.clientMessageId);
        let prior: Record<string, unknown> | undefined;
        if (action.clientMessageId !== undefined) {
          // Serializes concurrent retries even before the message row exists.
          await tx`select pg_advisory_xact_lock(hashtextextended(${`relay-send:${id}`},0))`;
          const rows = await tx`select author_id,conversation_id,text,parent_id,attachments,deleted from relay.messages where id=${id} for update`;
          prior = rows[0];
        }
        const files = await resolveSendAttachments(tx, action.attachments, id, conversationId, userId, prior);
        const body = text(action.text, 6000, 'Message', files.length > 0);
        const parentId = action.parentId === undefined ? null : uuid(action.parentId);
        if (prior) {
            const row = prior;
            const priorFiles = row.attachments as Attachment[];
            const equalFiles = priorFiles.length === files.length && priorFiles.every((file, i) => file.name === files[i].name && file.type === files[i].type && file.size === files[i].size && file.url === files[i].url);
            if (row.author_id !== userId || String(row.conversation_id) !== conversationId || row.text !== body || (row.parent_id ?? null) !== parentId || row.deleted || !equalFiles) throw new ChatError('This message identifier was already used for a different message.', 409);
            return { state: await stateFor(tx, userId), id };
        }
        if (parentId) {
          const parent = await accessibleMessage(tx, parentId, userId);
          if (parent.conversation_id !== conversationId || parent.deleted) throw new ChatError('This thread is no longer available.');
        }
        const metadata = files.map(file=>({name:file.name,type:file.type,size:file.size}));
        await tx`insert into relay.messages (id,conversation_id,author_id,text,parent_id,attachments,attachment_metadata) values (${id},${conversationId},${userId},${body},${parentId},${tx.json(files)},${tx.json(metadata)})`;
        await tx`delete from relay.uploads where message_id=${id} and owner_id=${userId}`;
        await tx`update relay.conversations set updated_at=now() where id=${conversationId}`;
        await tx`update relay.participants set last_read_at=now(),force_unread=false where conversation_id=${conversationId} and user_id=${userId}`;
        break;
      }
      case 'edit': {
        const messageId = uuid(action.messageId);
        const message = await accessibleMessage(tx, messageId, userId);
        changedConversationId = String(message.conversation_id);
        if (message.author_id !== userId || message.deleted) throw new ChatError('You can only edit your own messages.', 403);
        await tx`update relay.messages set text=${text(action.text, 6000, 'Message')},edited=true where id=${messageId} and author_id=${userId}`;
        break;
      }
      case 'delete': {
        const messageId = uuid(action.messageId);
        const message = await accessibleMessage(tx, messageId, userId);
        changedConversationId = String(message.conversation_id);
        if (message.author_id !== userId) throw new ChatError('You can only delete your own messages.', 403);
        await tx`update relay.messages set text='',attachments='[]',attachment_metadata='[]',deleted=true where id=${messageId} and author_id=${userId}`;
        await tx`delete from relay.reactions where message_id=${messageId}`;
        await tx`delete from relay.stars where message_id=${messageId}`;
        break;
      }
      case 'react': {
        const messageId = uuid(action.messageId);
        const message = await accessibleMessage(tx, messageId, userId);
        changedConversationId = String(message.conversation_id);
        if (message.deleted) throw new ChatError('This message was deleted.');
        if (!isNativeEmoji(action.emoji)) throw new ChatError('Choose an emoji reaction.');
        const emoji = action.emoji;
        if (action.active === undefined) {
          const removed = await tx`delete from relay.reactions where message_id=${messageId} and user_id=${userId} and emoji=${emoji} returning message_id`;
          if (!removed.length) await tx`insert into relay.reactions (message_id,user_id,emoji) values (${messageId},${userId},${emoji}) on conflict do nothing`;
        } else if (bool(action.active)) await tx`insert into relay.reactions (message_id,user_id,emoji) values (${messageId},${userId},${emoji}) on conflict do nothing`;
        else await tx`delete from relay.reactions where message_id=${messageId} and user_id=${userId} and emoji=${emoji}`;
        break;
      }
      case 'star': {
        const messageId = uuid(action.messageId);
        const message = await accessibleMessage(tx, messageId, userId);
        changedConversationId = String(message.conversation_id);
        if (message.deleted) throw new ChatError('This message was deleted.');
        if (action.starred === undefined) {
          const removed = await tx`delete from relay.stars where message_id=${messageId} and user_id=${userId} returning message_id`;
          if (!removed.length) await tx`insert into relay.stars (message_id,user_id) values (${messageId},${userId}) on conflict do nothing`;
        } else if (bool(action.starred)) await tx`insert into relay.stars (message_id,user_id) values (${messageId},${userId}) on conflict do nothing`;
        else await tx`delete from relay.stars where message_id=${messageId} and user_id=${userId}`;
        break;
      }
      case 'read': {
        const conversationId = uuid(action.conversationId);
        await membership(tx, conversationId, userId);
        const unread = action.unread === undefined ? false : bool(action.unread);
        await tx`update relay.participants set force_unread=${unread},last_read_at=case when ${unread} then last_read_at else now() end where conversation_id=${conversationId} and user_id=${userId}`;
        break;
      }
      case 'create': {
        if (!['dm','group','space'].includes(action.kind)) throw new ChatError('Choose a direct message, group, or space.');
        const invited = emails(action.emails).filter(email => email !== user.email!.toLowerCase());
        if (action.kind === 'dm' && invited.length !== 1) throw new ChatError('Choose one other person for a direct message.');
        id = crypto.randomUUID();
        const name = text(action.name, 80, 'Conversation name');
        const description = action.description === undefined ? '' : text(action.description, 500, 'Description', true);
        await tx`insert into relay.conversations (id,name,kind,description,creator_id) values (${id},${name},${action.kind},${description},${userId})`;
        await tx`insert into relay.participants (conversation_id,user_id) values (${id},${userId})`;
        await invite(tx, id, invited);
        changedConversationId = id;
        break;
      }
      case 'conversation': {
        const conversationId = uuid(action.conversationId);
        await membership(tx, conversationId, userId);
        changedConversationId = conversationId;
        if (action.name !== undefined) await tx`update relay.conversations set name=${text(action.name, 80, 'Conversation name')} where id=${conversationId}`;
        if (action.description !== undefined) await tx`update relay.conversations set description=${text(action.description, 500, 'Description', true)} where id=${conversationId}`;
        if (action.pinned !== undefined) await tx`update relay.participants set pinned=${bool(action.pinned)} where conversation_id=${conversationId} and user_id=${userId}`;
        if (action.muted !== undefined) await tx`update relay.participants set muted=${bool(action.muted)} where conversation_id=${conversationId} and user_id=${userId}`;
        if (action.section !== undefined) await tx`update relay.participants set section=${text(action.section, 40, 'Section', true)} where conversation_id=${conversationId} and user_id=${userId}`;
        break;
      }
      case 'invite': {
        const conversationId = uuid(action.conversationId);
        const conversation = await membership(tx, conversationId, userId);
        changedConversationId = conversationId;
        if (conversation.kind === 'dm') throw new ChatError('Create a group to add more people.');
        await invite(tx, conversationId, emails(action.emails));
        break;
      }
      case 'leave': {
        const conversationId = uuid(action.conversationId);
        await membership(tx, conversationId, userId);
        changedConversationId = conversationId;
        await tx`delete from relay.participants where conversation_id=${conversationId} and user_id=${userId}`;
        await tx`delete from relay.invites where conversation_id=${conversationId} and email=${user.email!.toLowerCase()}`;
        await tx`delete from relay.uploads where conversation_id=${conversationId} and owner_id=${userId}`;
        break;
      }
      case 'profile':
        if (action.name !== undefined) await tx`update relay.profiles set name=${text(action.name, 80, 'Name')} where id=${userId}`;
        if (action.status !== undefined) await tx`update relay.profiles set status=${text(action.status, 80, 'Status', true)} where id=${userId}`;
        break;
      default: throw new ChatError('Choose a valid action.');
    }
    if (action.type !== 'read') {
      // Only the selected branch's validated, authorized resource determines
      // recipients. Profile updates have no conversation target.
      const conversationId = changedConversationId;
      const personal = action.type === 'star' || (action.type === 'conversation' && action.name === undefined && action.description === undefined);
      if (personal) await tx`insert into relay.events(id,user_id,conversation_id) values (${crypto.randomUUID()},${userId},${conversationId ?? null})`;
      else if (conversationId) await tx`insert into relay.events(id,user_id,conversation_id)
        select gen_random_uuid(),user_id,${conversationId} from relay.participants where conversation_id=${conversationId}`;
      else if (action.type === 'profile') await tx`insert into relay.events(id,user_id,conversation_id)
        select gen_random_uuid(),recipient.user_id,null from (
          select distinct user_id from relay.participants where conversation_id in
            (select conversation_id from relay.participants where user_id=${userId})
          union select ${userId}
        ) recipient`;
    }
    if (actionId) await tx`insert into relay.operations(id,owner_id,digest,result_id,expires_at) values (${actionId},${userId},${digest!},${id ?? null},${expiresAt!})`;
    return { state: await stateFor(tx, userId), id, ...(actionId ? { actionId } : {}) };
  });
}

export function apiError(error: unknown) {
  if (error instanceof ChatError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  // Database/provider errors can contain credentials; never return or print them.
  return Response.json({ error: 'Chat is temporarily unavailable. Please try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

export async function readActionBody(request: Request, max = MAX_ACTION_BODY_BYTES): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > max) throw new ChatError('The attached files are too large.', 413);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ChatError('Use a JSON request.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ChatError('Choose a valid action.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new ChatError('The attached files are too large.', 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ChatError('Choose a valid action.'); }
}
