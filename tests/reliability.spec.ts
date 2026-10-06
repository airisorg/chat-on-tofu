import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import type { ChatAction, ChatState, Message, Person } from '../src/lib/types';

// These browser regressions exercise the authenticated hook through fake SDK
// session storage and routed localhost APIs. No real account, credential,
// hosted endpoint, database, or realtime provider is used. The mock server's
// dedupe model tests the client's request contract, not production SQL dedupe.
const baseURL = process.env.APP_URL || 'http://127.0.0.1:3000';
const appOrigin = new URL(baseURL).origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) {
  throw new Error('The reliability fixture suite accepts only a localhost APP_URL.');
}

const fakeSupabaseOrigin = 'https://reliability-test.invalid';
const authStorageKey = 'relay-chat-auth-v1';
const userId = '00000000-0000-4000-8000-000000000111';
const conversationId = '00000000-0000-4000-8000-000000000222';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Send = Extract<ChatAction, { type: 'send' }> & { clientMessageId?: string };

function fixtureState(): ChatState {
  const user: Person = { id: userId, name: 'Local Test Person', email: 'local-test@example.invalid', status: 'Active', color: '#1967d2' };
  const peer: Person = { id: '00000000-0000-4000-8000-000000000333', name: 'Local Test Peer', email: 'local-peer@example.invalid', color: '#b06c49' };
  const now = new Date().toISOString();
  return {
    user,
    conversations: [{ id: conversationId, name: 'Reliability workspace', kind: 'space', description: 'Local route fixture only.', members: [user, peer], updatedAt: now, unread: 0 }],
    messages: [{ id: randomUUID(), conversationId, author: peer, text: 'Initial workspace content stays available.', createdAt: now, reactions: [], attachments: [] }],
  };
}

class ChatApiFixture {
  state = fixtureState();
  getMode: 'ok' | 'outage' | 'hold-next' = 'ok';
  getCount = 0;
  failedStatusGets = 0;
  successfulGets = 0;
  heldGets = 0;
  releasedGets = 0;
  failedGetRequests: string[] = [];
  sends: Send[] = [];
  loseNextSendResponse = false;
  private held: (() => void)[] = [];
  private sendsById = new Map<string, { payload: string; id: string }>();

  addPeerMessage(text: string) {
    const message: Message = {
      id: randomUUID(), conversationId, author: this.state.conversations[0].members[1], text,
      createdAt: new Date().toISOString(), reactions: [], attachments: [],
    };
    this.state.messages.push(message);
    this.state.conversations[0].lastMessage = text;
    return message.id;
  }

  releaseHeld() {
    this.held.splice(0).forEach(release => release());
  }

  async get(route: Route) {
    this.getCount++;
    if (this.getMode === 'outage') {
      this.failedStatusGets++;
      return route.fulfill({ status: 503, json: { error: 'Temporary local test chat outage.' } });
    }
    if (this.getMode === 'hold-next') {
      this.getMode = 'ok';
      const snapshot = structuredClone(this.state);
      this.heldGets++;
      await new Promise<void>(resolve => this.held.push(resolve));
      try {
        await route.fulfill({ status: 200, json: { state: snapshot } });
        this.releasedGets++;
      } catch { /* A timed-out browser request is already aborted. */ }
      return;
    }
    this.successfulGets++;
    return route.fulfill({ status: 200, json: { state: this.state } });
  }

  async post(route: Route) {
    const action = route.request().postDataJSON() as ChatAction;
    if (action.type !== 'send') return route.fulfill({ status: 200, json: { state: this.state } });
    const send = structuredClone(action) as Send;
    this.sends.push(send);
    const logicalPayload = JSON.stringify({
      conversationId: send.conversationId, text: send.text.trim(),
      parentId: send.parentId || null, attachments: send.attachments || [],
    });
    const previous = send.clientMessageId ? this.sendsById.get(send.clientMessageId) : undefined;
    if (previous && previous.payload !== logicalPayload) {
      return route.fulfill({ status: 409, json: { error: 'Local fixture idempotency conflict.' } });
    }
    const id = previous?.id || send.clientMessageId || randomUUID();
    if (!previous) {
      this.state.messages.push({
        id, conversationId: send.conversationId, author: this.state.user, text: send.text.trim(),
        parentId: send.parentId, attachments: send.attachments || [],
        createdAt: new Date().toISOString(), reactions: [],
      });
      if (send.clientMessageId) this.sendsById.set(send.clientMessageId, { payload: logicalPayload, id });
      this.state.conversations[0].lastMessage = send.text.trim();
    }
    if (this.loseNextSendResponse) {
      this.loseNextSendResponse = false;
      // The fixture has committed above, but the browser receives no response.
      return route.abort('connectionreset');
    }
    return route.fulfill({ status: 200, json: { state: this.state, id } });
  }
}

async function authenticatedFixture(page: Page, context: BrowserContext) {
  const fixture = new ChatApiFixture();
  const now = Math.floor(Date.now() / 1000);
  const fakeToken = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url'),
    'LOCAL_TEST_INVALID_SIGNATURE',
  ].join('.');
  const fakeUser = {
    id: userId, aud: 'authenticated', role: 'authenticated', email: 'local-test@example.invalid',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Local Test Person' },
    created_at: new Date().toISOString(), email_confirmed_at: new Date().toISOString(),
  };
  await context.addInitScript(({ key, session }) => {
    localStorage.removeItem('relay-chat-demo-choice-v1');
    localStorage.setItem(key, JSON.stringify(session));
  }, {
    key: authStorageKey,
    session: { access_token: fakeToken, refresh_token: 'LOCAL_TEST_NOT_A_REAL_REFRESH_TOKEN', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: fakeUser },
  });
  // Close the fake realtime socket before any connection is made.
  await page.routeWebSocket(`${fakeSupabaseOrigin.replace('https:', 'wss:')}/**`, socket => socket.close({ code: 1000, reason: 'Local fixture; no provider connection.' }));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== appOrigin) {
      if (url.origin === fakeSupabaseOrigin && url.pathname === '/auth/v1/user') {
        return route.fulfill({ status: 200, json: fakeUser });
      }
      // No network request to a real hosted service is allowed by this suite.
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/api/config') {
      return route.fulfill({ status: 200, json: {
        supabaseUrl: fakeSupabaseOrigin,
        supabaseAnonKey: 'sb_publishable_LOCAL_TEST_ONLY_NOT_A_REAL_KEY', databaseConfigured: true,
      } });
    }
    if (url.pathname === '/api/chat') {
      if (request.headers().authorization !== `Bearer ${fakeToken}`) {
        return route.fulfill({ status: 401, json: { error: 'The local fixture session was not restored.' } });
      }
      return request.method() === 'GET' ? fixture.get(route) : fixture.post(route);
    }
    return route.continue();
  });
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/api/chat' && request.method() === 'GET') fixture.failedGetRequests.push(request.failure()?.errorText || 'failed');
  });
  await page.goto(baseURL);
  await expect(page.getByRole('main').getByRole('heading', { name: 'Reliability workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('article').filter({ hasText: 'Initial workspace content stays available.' })).toBeVisible();
  await expect(page.getByText('DEMO WORKSPACE', { exact: true })).toHaveCount(0);
  return fixture;
}

async function triggerSync(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

async function expectAccountRetained(page: Page) {
  await expect(page.getByRole('main').getByRole('heading', { name: 'Reliability workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Your profile', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('main').getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toHaveCount(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}').user?.id, authStorageKey)).toBe(userId);
}

async function send(page: Page, text: string) {
  const main = page.getByRole('main');
  await main.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await main.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(main.getByRole('article').filter({ hasText: text })).toBeVisible();
}

test('temporary GET503 keeps the session and workspace, then refresh recovers', async ({ page, context }) => {
  const fixture = await authenticatedFixture(page, context);
  fixture.getMode = 'outage';
  await triggerSync(page);
  await expect.poll(() => fixture.failedStatusGets).toBeGreaterThan(0);
  await expect(page.getByText('Temporary local test chat outage.', { exact: true })).toBeVisible();
  await expectAccountRetained(page);
  await expect(page.getByRole('article').filter({ hasText: 'Initial workspace content stays available.' })).toBeVisible();
  fixture.getMode = 'ok';
  fixture.addPeerMessage('A refresh after the temporary outage succeeds.');
  await triggerSync(page);
  await expect(page.getByRole('article').filter({ hasText: 'A refresh after the temporary outage succeeds.' })).toBeVisible();
  await expectAccountRetained(page);
});

test('a delayed stale GET cannot overwrite an acknowledged send', async ({ page, context }) => {
  const fixture = await authenticatedFixture(page, context);
  try {
    fixture.getMode = 'hold-next';
    await triggerSync(page);
    await expect.poll(() => fixture.heldGets).toBe(1);
    await expectAccountRetained(page);
    const text = 'An acknowledged send survives a stale delayed refresh.';
    await send(page, text);
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/chat' && response.request().method() === 'GET' && response.status() === 200);
    fixture.releaseHeld();
    await (await responsePromise).finished();
    // Allow the stale JSON response and React commit to finish before asserting.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('main').getByRole('article').filter({ hasText: text })).toHaveCount(1);
    await expectAccountRetained(page);
  } finally { fixture.releaseHeld(); }
});

test('a hung GET reaches its deadline and a later poll recovers', async ({ page, context }) => {
  // Controlled browser time exercises the actual AbortController/deadline path
  // without spending eight seconds waiting. It is not a network latency test.
  await page.clock.install();
  const fixture = await authenticatedFixture(page, context);
  try {
    const failedBefore = fixture.failedGetRequests.length;
    const successfulBefore = fixture.successfulGets;
    fixture.getMode = 'hold-next';
    await triggerSync(page);
    await expect.poll(() => fixture.heldGets).toBe(1);
    await page.clock.fastForward(8_100);
    await expect.poll(() => fixture.failedGetRequests.length).toBeGreaterThan(failedBefore);
    await expectAccountRetained(page);
    fixture.addPeerMessage('The workspace refreshes after a hung request times out.');
    await page.clock.fastForward(3_100);
    await expect.poll(() => fixture.successfulGets).toBeGreaterThan(successfulBefore);
    await expect(page.getByRole('article').filter({ hasText: 'The workspace refreshes after a hung request times out.' })).toBeVisible();
    await send(page, 'Sending still works after a hung refresh.');
    await expectAccountRetained(page);
  } finally { fixture.releaseHeld(); }
});

test('lost POST response retains the draft and retries the same message ID once', async ({ page, context }) => {
  const fixture = await authenticatedFixture(page, context);
  const text = 'Retry this committed message after its response is lost.';
  fixture.loseNextSendResponse = true;
  const main = page.getByRole('main');
  await main.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await main.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => fixture.sends.length).toBe(1);
  await expect(main.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(main.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(text);
  expect(fixture.sends[0].clientMessageId).toMatch(uuid);
  expect(fixture.state.messages.filter(message => message.text === text)).toHaveLength(1);
  await main.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => fixture.sends.length).toBe(2);
  await expect(main.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  expect(fixture.sends[1].clientMessageId).toBe(fixture.sends[0].clientMessageId);
  expect(fixture.state.messages.filter(message => message.text === text)).toHaveLength(1);
  await expect(main.getByRole('article').filter({ hasText: text })).toHaveCount(1);
  await expectAccountRetained(page);
});

test('lost committed POST response retries the restored draft with the same ID after reload', async ({ page, context }) => {
  const fixture = await authenticatedFixture(page, context);
  const text = 'Retry the saved draft after reloading a lost response.';
  fixture.loseNextSendResponse = true;
  const main = page.getByRole('main');
  await main.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await main.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => fixture.sends.length).toBe(1);
  await expect(main.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(main.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(text);
  const originalId = fixture.sends[0].clientMessageId;
  expect(originalId).toMatch(uuid);
  expect(fixture.state.messages.filter(message => message.text === text)).toHaveLength(1);

  // The routed server keeps its committed state while reload recreates the
  // hook and restores the identity-scoped draft and pending retry metadata.
  await page.reload();
  await expectAccountRetained(page);
  await expect(main.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(text);
  await expect(main.getByRole('article').filter({ hasText: text })).toHaveCount(1);
  await main.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => fixture.sends.length).toBe(2);
  await expect(main.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  expect(fixture.sends[1].clientMessageId).toBe(originalId);
  expect(fixture.state.messages.filter(message => message.text === text)).toHaveLength(1);
  await expect(main.getByRole('article').filter({ hasText: text })).toHaveCount(1);
  await expectAccountRetained(page);
});

test('intentional repeated successful identical messages receive new IDs', async ({ page, context }) => {
  const fixture = await authenticatedFixture(page, context);
  const text = 'An intentionally repeated message.';
  await send(page, text);
  await expect(page.getByRole('main').getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  await page.getByRole('main').getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('main').getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => fixture.sends.length).toBe(2);
  await expect(page.getByRole('main').getByRole('article').filter({ hasText: text })).toHaveCount(2);
  expect(fixture.sends[0].clientMessageId).toMatch(uuid);
  expect(fixture.sends[1].clientMessageId).toMatch(uuid);
  expect(fixture.sends[1].clientMessageId).not.toBe(fixture.sends[0].clientMessageId);
  expect(new Set(fixture.state.messages.filter(message => message.text === text).map(message => message.id)).size).toBe(2);
});
