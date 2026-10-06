import type { ChatAction, ChatState, Conversation, Person } from './types';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from './media-limits';

export const DEMO_STORAGE_KEY = 'relay-chat-explicit-demo-v1';

const self: Person = { id: 'demo-you', name: 'Alex Morgan', email: 'alex@example.com', color: '#1967d2', status: 'Available' };
const people: Person[] = [
  self,
  { id: 'demo-maya', name: 'Maya Chen', email: 'maya@example.com', color: '#b06c49', status: 'Available' },
  { id: 'demo-jordan', name: 'Jordan Lee', email: 'jordan@example.com', color: '#7b669e', status: 'Focusing' },
  { id: 'demo-sam', name: 'Sam Rivera', email: 'sam@example.com', color: '#368178', status: 'Available' },
];

export function createDemoState(): ChatState {
  const now = Date.now();
  const time = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const conversations: Conversation[] = [
    { id: 'demo-design', name: 'Design team', kind: 'space', description: 'A place for ideas, feedback, and a little inspiration.', members: people, updatedAt: time(3), unread: 2, pinned: true },
    { id: 'demo-maya-dm', name: 'Maya Chen', kind: 'dm', members: [self, people[1]], updatedAt: time(18), unread: 1 },
    { id: 'demo-launch', name: 'Product launch', kind: 'space', description: 'Bringing the next big thing to life.', members: [self, people[1], people[2]], updatedAt: time(46), unread: 0 },
    { id: 'demo-jordan-dm', name: 'Jordan Lee', kind: 'dm', members: [self, people[2]], updatedAt: time(95), unread: 0 },
    { id: 'demo-weekend', name: 'Weekend plans', kind: 'group', members: [self, people[1], people[3]], updatedAt: time(240), unread: 0 },
  ];
  const msg = (id: string, conversationId: string, author: Person, text: string, minutes: number) => ({ id, conversationId, author, text, createdAt: time(minutes), reactions: [] as { emoji: string; userIds: string[] }[], attachments: [] });
  const messages = [
    msg('demo-message-1', 'demo-design', people[1], 'Good morning, team! ☀️ I’ve been exploring a fresh direction for our new project.', 60),
    msg('demo-message-2', 'demo-design', people[2], 'Love it. The simpler layout gives everything a little more room to breathe.', 55),
    msg('demo-message-3', 'demo-design', self, 'Agreed! Let’s keep the experience calm and make the important things easy to find.', 48),
    { ...msg('demo-message-4', 'demo-design', people[3], 'The new color palette is looking great 🎨', 12), reactions: [{ emoji: '👍', userIds: [self.id, people[1].id] }] },
    msg('demo-message-5', 'demo-design', people[1], 'Can we do a quick review this afternoon? I’d love your thoughts before we move forward.', 3),
    msg('demo-message-6', 'demo-maya-dm', people[1], 'Hey! Do you have a minute to look at the new designs?', 18),
    msg('demo-message-7', 'demo-launch', people[2], 'Everything is ready for our launch checklist. Let’s make it happen 🚀', 46),
    msg('demo-message-8', 'demo-jordan-dm', self, 'Thanks for your help today, Jordan!', 95),
    msg('demo-message-9', 'demo-weekend', people[3], 'Coffee and a walk on Saturday? ☕', 240),
  ];
  for (const conversation of conversations) conversation.lastMessage = messages.filter(m => m.conversationId === conversation.id).at(-1)?.text;
  return structuredClone({ user: self, conversations, messages });
}

function requireText(value: string, max: number, label: string, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error(`${label} must be ${empty ? 'at most' : 'between 1 and'} ${max} characters.`);
  return value.trim();
}

function invitePeople(emails: string[], existing: Person[]): Person[] {
  if (!Array.isArray(emails) || emails.length > 30) throw new Error('Invite up to 30 people at a time.');
  return emails.map(value => {
    const email = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter valid email addresses.');
    return existing.find(p => p.email === email) ?? { id: `demo-invite-${email}`, email, name: email.split('@')[0], status: 'Invited · demo', color: '#6d7780' };
  });
}

export function applyDemoAction(previous: ChatState, action: ChatAction): { state: ChatState; id?: string } {
  const state = structuredClone(previous);
  const userId = state.user.id;
  const now = new Date().toISOString();
  let id: string | undefined;
  const conversation = 'conversationId' in action ? state.conversations.find(c => c.id === action.conversationId) : undefined;
  const message = 'messageId' in action ? state.messages.find(m => m.id === action.messageId) : undefined;
  if ('conversationId' in action && !conversation) throw new Error('This conversation is no longer available.');
  if ('messageId' in action && !message) throw new Error('This message is no longer available.');
  switch (action.type) {
    case 'send': {
      const text = requireText(action.text, 6000, 'Message', Boolean(action.attachments?.length));
      if (action.parentId && !state.messages.some(m => m.id === action.parentId && m.conversationId === conversation!.id && !m.deleted)) throw new Error('This thread is no longer available.');
      if ((action.attachments?.length ?? 0) > MAX_ATTACHMENTS || action.attachments?.some(a => a.size > MAX_ATTACHMENT_BYTES || !/^data:(image\/(png|jpeg|gif|webp)|audio\/(webm|mp4|ogg|mpeg|wav)|text\/plain|application\/pdf);base64,/.test(a.url))) throw new Error(`Attach up to ${MAX_ATTACHMENTS} images, voice notes, text files, or PDFs, each up to 5 MB.`);
      id = crypto.randomUUID();
      state.messages.push({ id, conversationId: conversation!.id, author: state.user, text, createdAt: now, reactions: [], attachments: action.attachments ?? [], parentId: action.parentId });
      conversation!.lastMessage = text || `Attachment: ${action.attachments?.[0]?.name}`;
      conversation!.updatedAt = now;
      conversation!.unread = 0;
      break;
    }
    case 'edit':
      if (message!.author.id !== userId || message!.deleted) throw new Error('You can only edit your own messages.');
      message!.text = requireText(action.text, 6000, 'Message');
      message!.edited = true;
      break;
    case 'delete':
      if (message!.author.id !== userId) throw new Error('You can only delete your own messages.');
      message!.text = ''; message!.attachments = []; message!.deleted = true; message!.reactions = []; message!.starred = false;
      break;
    case 'react': {
      if (message!.deleted) throw new Error('This message was deleted.');
      const emoji = requireText(action.emoji, 20, 'Reaction');
      const reaction = message!.reactions.find(r => r.emoji === emoji);
      if (!reaction) message!.reactions.push({ emoji, userIds: [userId] });
      else if (reaction.userIds.includes(userId)) reaction.userIds = reaction.userIds.filter(id => id !== userId);
      else reaction.userIds.push(userId);
      message!.reactions = message!.reactions.filter(r => r.userIds.length);
      break;
    }
    case 'star':
      if (message!.deleted) throw new Error('This message was deleted.');
      message!.starred = !message!.starred;
      break;
    case 'read': conversation!.unread = action.unread ? Math.max(1, conversation!.unread) : 0; break;
    case 'create': {
      const name = requireText(action.name, 80, 'Conversation name');
      const invited = invitePeople(action.emails, state.conversations.flatMap(c => c.members));
      if (action.kind === 'dm' && invited.filter(p => p.id !== userId).length !== 1) throw new Error('Choose one other person for a direct message.');
      id = crypto.randomUUID();
      state.conversations.unshift({ id, name, kind: action.kind, description: action.description ? requireText(action.description, 500, 'Description', true) : '', members: [...new Map([state.user, ...invited].map(p => [p.id, p])).values()], updatedAt: now, unread: 0 });
      break;
    }
    case 'conversation':
      if (action.name !== undefined) conversation!.name = requireText(action.name, 80, 'Conversation name');
      if (action.description !== undefined) conversation!.description = requireText(action.description, 500, 'Description', true);
      if (action.pinned !== undefined) conversation!.pinned = action.pinned;
      if (action.muted !== undefined) conversation!.muted = action.muted;
      if (action.section !== undefined) conversation!.section = requireText(action.section, 40, 'Section', true);
      break;
    case 'invite': {
      if (conversation!.kind === 'dm') throw new Error('Create a group to add more people.');
      const members = invitePeople(action.emails, state.conversations.flatMap(c => c.members));
      conversation!.members = [...new Map([...conversation!.members, ...members].map(p => [p.id, p])).values()];
      break;
    }
    case 'leave':
      state.conversations = state.conversations.filter(c => c.id !== conversation!.id);
      state.messages = state.messages.filter(m => m.conversationId !== conversation!.id);
      break;
    case 'profile':
      if (action.name !== undefined) state.user.name = requireText(action.name, 80, 'Name');
      if (action.status !== undefined) state.user.status = requireText(action.status, 80, 'Status', true);
      state.conversations.forEach(c => { c.members = c.members.map(p => p.id === userId ? state.user : p); });
      state.messages.forEach(m => { if (m.author.id === userId) m.author = state.user; });
      break;
  }
  // Previews also reflect edits and deleted messages.
  for (const c of state.conversations) {
    const last = state.messages.filter(m => m.conversationId === c.id).at(-1);
    if (last) c.lastMessage = last.deleted ? 'Message deleted' : last.text || `Attachment: ${last.attachments[0]?.name ?? 'file'}`;
  }
  return { state, id };
}
