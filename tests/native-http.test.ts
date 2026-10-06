import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fixtureUser, freePort, nativeCluster, nativeEnabled, nativeSkip, recordNativeEvidence, spawnNext, stopChild, until } from './helpers/native-postgres';

test('opt-in actual Next HTTP routes bridge HTTPS getUser and native PostgreSQL with synthetic identities', { skip: nativeEnabled ? false : nativeSkip, timeout: 90000 }, async t => {
  const cluster = await nativeCluster('http');
  const owner = fixtureUser('http-owner'), peer = fixtureUser('http-peer'), outsider = fixtureUser('http-outsider');
  // Deliberately recognizable fixture strings, not credentials or real sessions.
  const tokens = new Map([['synthetic-native-owner-token', owner], ['synthetic-native-peer-token', peer], ['synthetic-native-outsider-token', outsider]]);
  let providerMode: 'normal' | 'outage' = 'normal', identityRequests = 0;
  const provider = createServer({ key: await readFile(cluster.keyPath), cert: await readFile(cluster.certPath) }, (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url !== '/auth/v1/user') { response.writeHead(404); response.end(JSON.stringify({ message: 'Fixture path unavailable' })); return; }
    identityRequests++;
    if (providerMode === 'outage') { response.writeHead(503); response.end(JSON.stringify({ message: 'Fixture auth outage' })); return; }
    const token = String(request.headers.authorization ?? '').replace(/^Bearer /, ''), user = tokens.get(token);
    if (!user) { response.writeHead(401); response.end(JSON.stringify({ message: 'Fixture token rejected', code: 'bad_jwt' })); return; }
    response.writeHead(200); response.end(JSON.stringify(user));
  });
  let next: ReturnType<typeof spawnNext> | undefined;
  let evidence: Record<string, unknown> | undefined;
  const started = Date.now(), completed: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve); });
    const address = provider.address();
    assert.ok(address && typeof address !== 'string');
    // Installed NextURL normalizes loopback hostnames to localhost. Use that
    // canonical origin for both the actual wire Host and browser Origin header.
    const authUrl = `https://127.0.0.1:${address.port}`, port = await freePort(), origin = `http://localhost:${port}`;
    const buildId = (await readFile('.next/BUILD_ID', 'utf8')).trim();
    if (process.env.CHAT_NATIVE_EXPECTED_BUILD_ID) assert.equal(buildId, process.env.CHAT_NATIVE_EXPECTED_BUILD_ID, 'explicit externally reviewed build binding');
    let buildBinding: { buildId: string; runtimeSourceHashes: Record<string, string>; scope: string } | undefined;
    if (process.env.CHAT_NATIVE_BUILD_BINDING) {
      buildBinding = JSON.parse(await readFile(process.env.CHAT_NATIVE_BUILD_BINDING, 'utf8'));
      assert.equal(buildBinding!.buildId, buildId);
      for (const [path, hash] of Object.entries(buildBinding!.runtimeSourceHashes)) assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hash, `fresh-build source binding for ${path}`);
    }
    next = spawnNext(port, {
      ...process.env,
      NODE_ENV: 'production',
      NODE_EXTRA_CA_CERTS: cluster.certPath,
      DATABASE_URL: cluster.url,
      SUPABASE_URL: authUrl,
      SUPABASE_ANON_KEY: 'sb_publishable_native_fixture',
      NEXT_PUBLIC_SUPABASE_URL: authUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_native_fixture',
      NEXT_TELEMETRY_DISABLED: '1',
    });
    await until(async () => {
      if (next!.child.exitCode !== null) throw new Error(`Isolated Next process exited before readiness: ${next!.diagnostics()}`);
      try { return (await fetch(`${origin}/api/config`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
    }, 'isolated production Next API', 20000);
    const admin = cluster.client();
    const tokenFor = (who: 'owner' | 'peer' | 'outsider' = 'owner') => `synthetic-native-${who}-token`;
    async function request(path: string, body?: unknown, who: 'owner' | 'peer' | 'outsider' = 'owner', extra: Record<string, string> = {}) {
      return fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${tokenFor(who)}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    }
    async function json(path: string, body?: unknown, who: 'owner' | 'peer' | 'outsider' = 'owner') {
      const response = await request(path, body, who);
      const data = await response.json();
      assert.equal(response.status, 200, `expected success for ${path}; received ${response.status}: ${data.error ?? ''}`);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      return data;
    }
    let conversationId = '', messageId = '';
    await t.test('actual HTTP config, verified identity, invitation claims and send receipt replay', async () => {
      const configResponse = await fetch(origin + '/api/config'), config = await configResponse.json();
      assert.equal(config.databaseConfigured, true); assert.equal(config.supabaseUrl, authUrl);
      assert.equal(config.supabaseAnonKey, 'sb_publishable_native_fixture');
      assert.deepEqual(Object.keys(config).sort(), ['databaseConfigured', 'supabaseAnonKey', 'supabaseUrl']);
      assert.ok(!JSON.stringify(config).includes('chat_fixture'));
      assert.equal((await json('/api/chat')).state.user.id, owner.id);
      const clientActionId = crypto.randomUUID(), creation = { type: 'create', kind: 'group', name: 'Real HTTP fixture', emails: [peer.email!], clientActionId, clientActionCreatedAt: new Date().toISOString() };
      const created = await json('/api/chat', creation); conversationId = created.id;
      assert.ok(conversationId);
      assert.equal((await json('/api/chat', creation)).id, conversationId, 'create receipt prevents a duplicate group across actual HTTP retries');
      const confirmation = await json(`/api/chat?clientActionId=${clientActionId}`);
      assert.equal(confirmation.actionId, clientActionId); assert.equal(confirmation.id, conversationId);
      assert.equal((await json('/api/chat', undefined, 'peer')).state.conversations[0].id, conversationId, 'verified email claims its invitation');
      messageId = crypto.randomUUID();
      const send = { type: 'send', conversationId, clientMessageId: messageId, text: 'Actual route and native driver message' };
      await json('/api/chat', send); await json('/api/chat', send);
      const peerState = (await json('/api/chat', undefined, 'peer')).state;
      assert.equal(peerState.messages.filter((message: { id: string }) => message.id === messageId).length, 1);
      assert.equal(Number((await admin`select count(*)::int as count from relay.conversations`)[0].count), 1);
      assert.equal(Number((await admin`select count(*)::int as count from relay.messages`)[0].count), 1);
      assert.equal(Number((await admin`select count(*)::int as count from relay.events where conversation_id=${conversationId}`)[0].count), 3, 'one creation event before peer joined, then two send events; replay emits none');
      completed.push('positive config/auth/invite/send/create receipt bridge');
    });
    await t.test('actual chunk upload, private byte stream and ownership protections', async () => {
      const bytes = Buffer.from('Private native HTTP attachment\n'), id = crypto.randomUUID();
      const upload = { conversationId, clientMessageId: id, attachmentIndex: 0, name: 'private.txt', type: 'text/plain', size: bytes.length, chunkIndex: 0, totalChunks: 1, data: bytes.toString('base64') };
      await json('/api/uploads', upload); await json('/api/uploads', upload);
      const send = { type: 'send', conversationId, clientMessageId: id, text: 'Chunk file', attachments: [{ name: upload.name, type: upload.type, size: upload.size, url: `upload:${id}:0` }] };
      await json('/api/chat', send);
      const state = (await json('/api/chat', undefined, 'peer')).state;
      const fileMessage = state.messages.find((message: { id: string }) => message.id === id);
      assert.equal(fileMessage.attachments[0].url, `/api/attachments?messageId=${id}&index=0`, 'state has a protected reference, never file base64');
      const response = await request(`/api/attachments?messageId=${id}&index=0`, undefined, 'peer');
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'text/plain');
      assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
      assert.match(response.headers.get('vary') ?? '', /Authorization/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.equal((await request(`/api/attachments?messageId=${id}&index=0`, undefined, 'outsider')).status, 404);
      assert.equal((await json('/api/chat', undefined, 'outsider')).state.conversations.length, 0);
      assert.equal((await request('/api/chat', { type: 'edit', messageId, text: 'Foreign edit' }, 'peer')).status, 403);
      assert.equal((await request('/api/uploads', upload, 'outsider')).status, 404);
      assert.equal(Number((await admin`select count(*)::int as count from relay.uploads`)[0].count), 0);
      completed.push('chunk/private stream/foreign account and author isolation');
    });
    await t.test('actual HTTP origin, auth rejection, provider outage and write quota classification', async () => {
      const before = Number((await admin`select count(*)::int as count from relay.messages`)[0].count);
      assert.equal((await fetch(origin + '/api/chat')).status, 401);
      assert.equal((await request('/api/chat', undefined, 'owner', { Authorization: 'Bearer synthetic-native-rejected-token' })).status, 401);
      assert.equal((await request('/api/chat', { type: 'profile', name: 'Must not change' }, 'owner', { Origin: 'https://foreign.invalid' })).status, 403);
      providerMode = 'outage';
      const outage = await request('/api/chat');
      assert.equal(outage.status, 503); assert.match((await outage.json()).error, /session is still saved/i);
      providerMode = 'normal';
      assert.equal((await json('/api/chat')).state.user.id, owner.id);
      await admin`insert into relay.request_limits(owner_id,bucket,window_start,requests) values(${owner.id},'write',date_trunc('minute',now()),120) on conflict(owner_id,bucket,window_start) do update set requests=120`;
      const limited = await request('/api/chat', { type: 'send', conversationId, text: 'Quota cannot commit', clientMessageId: crypto.randomUUID() });
      assert.equal(limited.status, 429); assert.match((await limited.json()).error, /wait a minute/);
      assert.equal(Number((await admin`select count(*)::int as count from relay.messages`)[0].count), before);
      completed.push('HTTP cross-origin/auth outage/invalid token/quota status');
    });
    const sourceHashes = Object.fromEntries(await Promise.all(['src/lib/server.ts', 'src/app/api/chat/route.ts', 'src/app/api/uploads/route.ts', 'src/app/api/attachments/route.ts', 'tests/native-http.test.ts', 'tests/helpers/native-postgres.ts'].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
    evidence = { scope: 'Actual prebuilt Next production HTTP handlers -> actual Supabase SDK getUser over local CA-trusted HTTPS -> actual postgres.js SSL driver -> fresh native PostgreSQL. Identities, tokens and provider responses are synthetic; no real Google/Supabase/Tofu account, browser or hosting proof.', buildId, buildBinding, prebuiltSourceVerification: buildBinding ? 'Externally recorded fresh production build ID and all recorded runtime source hashes matched before launch.' : 'Prebuilt source alignment unverified; hashes describe working files, not their presence in the compiled bundle.', sourceHashes, cases: completed, passed: completed.length === 3, identityRequests, durationMs: Date.now() - started, productionDatabaseTls: 'unchanged ssl=require; encryption verified separately but server certificate verification remains a documented operational gap' };
  } finally {
    const failures: unknown[] = [];
    try { if (next) await stopChild(next.child); } catch (error) { failures.push(error); }
    try { provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); } catch (error) { failures.push(error); }
    try { await cluster.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new Error('Native HTTP fixture teardown did not complete; inspect its private work directory.');
  }
  if (evidence) await recordNativeEvidence('native-http', { ...evidence, cleanup: 'Next child stopped, provider closed, and exact temporary database stopped/removed successfully' });
});
