import { createClient, type User } from '@supabase/supabase-js';
import postgres from 'postgres';
import type { Attachment, ChatAction, ChatState, Person } from './types';

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
`;

export async function applySchema(sql: postgres.Sql): Promise<void> {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(724931108)`;
    const marker = await tx`select to_regclass('relay.schema_migrations') is not null as present`;
    if (marker[0].present) {
      const installed = await tx`select version from relay.schema_migrations where version=2`;
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
    await tx`insert into relay.schema_migrations(version) values(2) on conflict do nothing`;
  });
}

async function database(): Promise<postgres.Sql> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new ChatError('The chat database is not connected yet.', 503);
  db ??= postgres(url, { ssl: process.env.NODE_ENV === 'production' ? 'require' : undefined, max: 3, prepare: false, idle_timeout: 20, connect_timeout: 15 });
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
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.getUser(auth.slice(7));
  if (error || !data.user) throw new ChatError('Your session expired. Please sign in again.', 401);
  if (!data.user.email || !data.user.email_confirmed_at) throw new ChatError('Verify your email to join conversations.', 403);
  return data.user;
}

function safeAvatar(value: unknown) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}

async function prepareUser(sql: Query, user: User) {
  const email = user.email!.trim().toLowerCase();
  const metadata = user.user_metadata ?? {};
  const rawName = metadata.full_name || metadata.name || email.split('@')[0];
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 80) : email.split('@')[0];
  const avatar = safeAvatar(metadata.avatar_url || metadata.picture);
  await sql`insert into relay.profiles (id,email,name,avatar) values (${user.id},${email},${name},${avatar})
    on conflict(id) do update set email=excluded.email,avatar=coalesce(relay.profiles.avatar,excluded.avatar)
    where relay.profiles.email is distinct from excluded.email or (relay.profiles.avatar is null and excluded.avatar is not null)`;
  await sql`with claimed as (delete from relay.invites where email=${email} returning conversation_id)
    insert into relay.participants (conversation_id,user_id)
    select conversation_id,${user.id} from claimed
    on conflict(conversation_id,user_id) do nothing`;
}

function person(row: Record<string, unknown>): Person {
  return { id: String(row.id), name: String(row.name), email: String(row.email), avatar: row.avatar ? String(row.avatar) : undefined, color: '#1967d2', status: String(row.status ?? 'Available') };
}
function iso(value: unknown) { return new Date(value as string).toISOString(); }

async function stateFor(sql: Query, userId: string): Promise<ChatState> {
  const profileQuery = sql`select * from relay.profiles where id=${userId}`;
  const conversationQuery = sql`select c.*,p.pinned,p.muted,p.section,p.force_unread,
    (select count(*)::integer from relay.messages m where m.conversation_id=c.id and m.author_id<>${userId} and not m.deleted and m.created_at>p.last_read_at) as unread,
    (select case when m.deleted then 'Message deleted' when m.text<>'' then m.text else 'Attachment' end from relay.messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1) as last_message
    from relay.conversations c join relay.participants p on p.conversation_id=c.id
    where p.user_id=${userId} order by c.updated_at desc,c.id`;
  const memberQuery = sql`select p.*,cp.conversation_id from relay.profiles p
    join relay.participants cp on cp.user_id=p.id
    where exists(select 1 from relay.participants mine where mine.conversation_id=cp.conversation_id and mine.user_id=${userId})`;
  const inviteQuery = sql`select i.conversation_id,i.email from relay.invites i where exists
    (select 1 from relay.participants mine where mine.conversation_id=i.conversation_id and mine.user_id=${userId})`;
  const messageQuery = sql`with recent as (
    select m.* from relay.messages m where exists
      (select 1 from relay.participants mine where mine.conversation_id=m.conversation_id and mine.user_id=${userId})
    order by m.created_at desc,m.id desc limit 2000
  ), bounded as (
    select recent.*,sum(octet_length(attachments::text)+octet_length(text)+300) over(order by created_at desc,id desc) as payload_bytes from recent
  ) select m.*,p.name,p.email,p.avatar,p.status,
    exists(select 1 from relay.stars s where s.message_id=m.id and s.user_id=${userId}) as starred
    from bounded m join relay.profiles p on p.id=m.author_id
    where m.payload_bytes <= 6000000 order by m.created_at desc,m.id desc`;
  const [profiles, conversations, members, invites, messages] = await Promise.all([profileQuery, conversationQuery, memberQuery, inviteQuery, messageQuery]);
  if (!profiles.length) throw new ChatError('Your profile is not available.', 500);
  const reactions = messages.length ? await sql`select r.* from relay.reactions r
    where r.message_id = any(${messages.map(m => String(m.id))}::uuid[])` : [];
  return {
    user: person(profiles[0]),
    conversations: conversations.map(c => {
      const conversationMembers = members.filter(m => m.conversation_id === c.id).map(person);
      const pending = invites.filter(i => i.conversation_id === c.id).map(i => ({ id: `invite:${i.email}`, name: String(i.email).split('@')[0], email: String(i.email), status: 'Invited', color: '#6d7780' }));
      const allMembers = [...conversationMembers, ...pending];
      return { id: String(c.id), name: c.kind === 'dm' ? allMembers.find(p => p.id !== userId)?.name ?? String(c.name) : String(c.name), kind: c.kind as 'dm' | 'group' | 'space', members: allMembers, description: String(c.description), lastMessage: c.last_message ? String(c.last_message) : undefined, updatedAt: iso(c.updated_at), unread: c.force_unread ? Math.max(1, Number(c.unread)) : Number(c.unread), pinned: Boolean(c.pinned), muted: Boolean(c.muted), section: String(c.section) };
    }),
    messages: messages.reverse().map(m => {
      const grouped = new Map<string, string[]>();
      if (!m.deleted) for (const r of reactions.filter(r => r.message_id === m.id)) grouped.set(String(r.emoji), [...(grouped.get(String(r.emoji)) ?? []), String(r.user_id)]);
      return { id: String(m.id), conversationId: String(m.conversation_id), author: person({ ...m, id: m.author_id }), text: m.deleted ? '' : String(m.text), createdAt: iso(m.created_at), edited: Boolean(m.edited), deleted: Boolean(m.deleted), parentId: m.parent_id ? String(m.parent_id) : undefined, starred: !m.deleted && Boolean(m.starred), attachments: m.deleted ? [] : (m.attachments as Attachment[]), reactions: [...grouped.entries()].map(([emoji, userIds]) => ({ emoji, userIds })) };
    }),
  };
}

function text(value: unknown, max: number, label: string, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new ChatError(`${label} must be ${empty ? 'at most' : 'between 1 and'} ${max} characters.`);
  return value.trim();
}
function uuid(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ChatError('This item is not available.');
  return value;
}
function bool(value: unknown) { if (typeof value !== 'boolean') throw new ChatError('Invalid preference.'); return value; }
function emails(value: unknown) {
  if (!Array.isArray(value) || value.length > 30) throw new ChatError('Invite up to 30 people at a time.');
  return [...new Set(value.map(v => {
    const email = text(v, 254, 'Email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ChatError('Enter valid email addresses.');
    return email;
  }))];
}

export function validateAttachments(value: unknown): Attachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) throw new ChatError('Attach up to 3 files.');
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new ChatError('Invalid attachment.');
    const name = text(item.name, 120, 'Filename').replace(/[\x00-\x1f\x7f]/g, '');
    const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain', 'application/pdf', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    if (!allowed.includes(item.type) || typeof item.url !== 'string' || item.url.length > 1_400_000) throw new ChatError('Use an image, voice note, text file, or PDF under 1 MB.');
    const prefix = `data:${item.type};base64,`;
    if (!item.url.startsWith(prefix)) throw new ChatError('Attachments must contain the selected file data.');
    const encoded = item.url.slice(prefix.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new ChatError('Invalid attachment data.');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > 1_048_576 || bytes.length === 0 || item.size !== bytes.length || bytes.toString('base64') !== encoded) throw new ChatError('Each attachment must be under 1 MB.');
    const signatures: Record<string, () => boolean> = {
      'image/png': () => bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
      'image/jpeg': () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      'image/gif': () => /^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii')),
      'image/webp': () => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
      'application/pdf': () => bytes.subarray(0, 5).toString('ascii') === '%PDF-',
      'audio/webm': () => bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
      'audio/mp4': () => bytes.subarray(4, 8).toString('ascii') === 'ftyp',
      'audio/ogg': () => bytes.subarray(0, 4).toString('ascii') === 'OggS',
    };
    if (signatures[item.type] && !signatures[item.type]()) throw new ChatError('The file content does not match its type.');
    return { name, type: item.type, url: item.url, size: bytes.length };
  });
}

async function membership(sql: Query, conversationId: string, userId: string) {
  const rows = await sql`select c.kind from relay.conversations c join relay.participants p on p.conversation_id=c.id where c.id=${conversationId} and p.user_id=${userId} for share of p`;
  if (!rows.length) throw new ChatError('This conversation is no longer available.', 404);
  return rows[0];
}
async function accessibleMessage(sql: Query, messageId: string, userId: string) {
  const rows = await sql`select m.* from relay.messages m join relay.participants p on p.conversation_id=m.conversation_id where m.id=${messageId} and p.user_id=${userId} for update of m for share of p`;
  if (!rows.length) throw new ChatError('This message is no longer available.', 404);
  return rows[0];
}
async function invite(sql: Query, conversationId: string, values: string[]) {
  for (const email of values) {
    const existing = await sql`select id from relay.profiles where email=${email}`;
    if (existing.length) await sql`insert into relay.participants (conversation_id,user_id) values (${conversationId},${existing[0].id}) on conflict do nothing`;
    else await sql`insert into relay.invites (conversation_id,email) values (${conversationId},${email}) on conflict do nothing`;
  }
}

export async function getChat(user: User, serverConnection?: postgres.Sql): Promise<ChatState> {
  const sql = serverConnection ?? await database();
  return sql.begin(async tx => { await prepareUser(tx, user); return stateFor(tx, user.id); });
}

export async function mutateChat(user: User, input: unknown, serverConnection?: postgres.Sql): Promise<{ state: ChatState; id?: string }> {
  if (!input || typeof input !== 'object' || !('type' in input)) throw new ChatError('Choose a valid action.');
  const action = input as ChatAction;
  const sql = serverConnection ?? await database();
  return sql.begin(async tx => {
    await prepareUser(tx, user);
    const userId = user.id;
    let id: string | undefined;
    let changedConversationId: string | undefined;
    switch (action.type) {
      case 'send': {
        const conversationId = uuid(action.conversationId);
        await membership(tx, conversationId, userId);
        const files = validateAttachments(action.attachments);
        const body = text(action.text, 6000, 'Message', files.length > 0);
        const parentId = action.parentId === undefined ? null : uuid(action.parentId);
        if (parentId) {
          const parent = await accessibleMessage(tx, parentId, userId);
          if (parent.conversation_id !== conversationId || parent.deleted) throw new ChatError('This thread is no longer available.');
        }
        id = crypto.randomUUID();
        await tx`insert into relay.messages (id,conversation_id,author_id,text,parent_id,attachments) values (${id},${conversationId},${userId},${body},${parentId},${tx.json(files)})`;
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
        await tx`update relay.messages set text='',attachments='[]',deleted=true where id=${messageId} and author_id=${userId}`;
        await tx`delete from relay.reactions where message_id=${messageId}`;
        await tx`delete from relay.stars where message_id=${messageId}`;
        break;
      }
      case 'react': {
        const messageId = uuid(action.messageId);
        const message = await accessibleMessage(tx, messageId, userId);
        changedConversationId = String(message.conversation_id);
        if (message.deleted) throw new ChatError('This message was deleted.');
        const emoji = text(action.emoji, 20, 'Reaction');
        if (!/\p{Extended_Pictographic}/u.test(emoji)) throw new ChatError('Choose an emoji reaction.');
        const removed = await tx`delete from relay.reactions where message_id=${messageId} and user_id=${userId} and emoji=${emoji} returning message_id`;
        if (!removed.length) await tx`insert into relay.reactions (message_id,user_id,emoji) values (${messageId},${userId},${emoji}) on conflict do nothing`;
        break;
      }
      case 'star': {
        const messageId = uuid(action.messageId);
        const message = await accessibleMessage(tx, messageId, userId);
        changedConversationId = String(message.conversation_id);
        if (message.deleted) throw new ChatError('This message was deleted.');
        const removed = await tx`delete from relay.stars where message_id=${messageId} and user_id=${userId} returning message_id`;
        if (!removed.length) await tx`insert into relay.stars (message_id,user_id) values (${messageId},${userId}) on conflict do nothing`;
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
        break;
      }
      case 'conversation': {
        const conversationId = uuid(action.conversationId);
        await membership(tx, conversationId, userId);
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
        if (conversation.kind === 'dm') throw new ChatError('Create a group to add more people.');
        await invite(tx, conversationId, emails(action.emails));
        break;
      }
      case 'leave': {
        const conversationId = uuid(action.conversationId);
        await membership(tx, conversationId, userId);
        await tx`delete from relay.participants where conversation_id=${conversationId} and user_id=${userId}`;
        await tx`delete from relay.invites where conversation_id=${conversationId} and email=${user.email!.toLowerCase()}`;
        break;
      }
      case 'profile':
        if (action.name !== undefined) await tx`update relay.profiles set name=${text(action.name, 80, 'Name')} where id=${userId}`;
        if (action.status !== undefined) await tx`update relay.profiles set status=${text(action.status, 80, 'Status', true)} where id=${userId}`;
        break;
      default: throw new ChatError('Choose a valid action.');
    }
    if (action.type !== 'read') {
      const conversationId = 'conversationId' in action ? action.conversationId : changedConversationId ?? (action.type === 'create' ? id : undefined);
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
    return { state: await stateFor(tx, userId), id };
  });
}

export function apiError(error: unknown) {
  if (error instanceof ChatError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  // Database/provider errors can contain credentials; never return or print them.
  return Response.json({ error: 'Chat is temporarily unavailable. Please try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

export async function readActionBody(request: Request): Promise<unknown> {
  const max = 4_300_000;
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
