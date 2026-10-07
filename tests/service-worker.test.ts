import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

function worker() {
  type WorkerEvent = {
    request?: Request | { url: string; method: string; mode: string; headers: Headers };
    waitUntil: (promise: Promise<unknown>) => void;
    respondWith: (promise: Promise<unknown>) => void;
  };
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const calls: { name: string; value?: unknown }[] = [];
  let failNetwork = false;
  let failInstall = false;
  let cacheHit = true;
  const offline = new Response('Offline. Reconnect to open your conversations.');
  const asset = new Response('public asset');
  const network = new Response('network response');
  const self = {
    location: { origin: 'https://chat.example.test' },
    addEventListener: (name: string, callback: (event: WorkerEvent) => void) =>
      listeners.set(name, callback),
    skipWaiting: async () => calls.push({ name: 'skipWaiting' }),
    clients: { claim: async () => calls.push({ name: 'claim' }) },
  };
  const caches = {
    open: async (name: string) => {
      calls.push({ name: 'open', value: name });
      return {
        addAll: async (urls: string[]) => {
          calls.push({ name: 'addAll', value: [...urls] });
          if (failInstall) throw new Error('Synthetic public asset installation failure');
        },
      };
    },
    keys: async () => ['relay-public-v1', 'relay-public-v2', 'another-app-cache'],
    delete: async (name: string) => calls.push({ name: 'delete', value: name }),
    match: async (request: Request | string) => {
      calls.push({ name: 'match', value: typeof request === 'string' ? request : request.url });
      return request === '/offline.html' ? offline : cacheHit ? asset : undefined;
    },
  };
  const file = resolve('public/sw.js');
  vm.runInNewContext(
    readFileSync(file, 'utf8'),
    {
      self,
      caches,
      URL,
      fetch: async (request: Request) => {
        calls.push({ name: 'fetch', value: request.url });
        if (failNetwork) throw new TypeError('Synthetic offline connection');
        return network;
      },
    },
    { filename: file },
  );
  return {
    calls,
    offline,
    asset,
    network,
    setOffline: () => (failNetwork = true),
    rejectInstall: () => (failInstall = true),
    missCache: () => (cacheHit = false),
    dispatch: async (name: string, request?: WorkerEvent['request']) => {
      let response: Promise<unknown> | undefined;
      let work: Promise<unknown> | undefined;
      const listener = listeners.get(name);
      assert.ok(listener, `Worker registers ${name}`);
      listener({
        request,
        respondWith: (promise) => (response = promise),
        waitUntil: (promise) => (work = promise),
      });
      await work;
      return response;
    },
  };
}

function request(
  path: string,
  overrides: Partial<{ method: string; mode: string; headers: Headers }> = {},
) {
  return {
    url: new URL(path, 'https://chat.example.test').href,
    method: 'GET',
    mode: 'navigate',
    headers: new Headers(),
    ...overrides,
  };
}

test('worker installs only public offline assets before taking control', async () => {
  const fixture = worker();
  await fixture.dispatch('install');
  assert.deepEqual(fixture.calls, [
    { name: 'open', value: 'relay-public-v2' },
    {
      name: 'addAll',
      value: [
        '/offline.html',
        '/icons/icon-180.png',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/fonts/google-sans-latin-variable.woff2',
      ],
    },
    { name: 'skipWaiting' },
  ]);
});

test('worker upgrade deletes only obsolete caches owned by this public shell', async () => {
  const fixture = worker();
  await fixture.dispatch('activate');
  assert.deepEqual(fixture.calls, [
    { name: 'delete', value: 'relay-public-v1' },
    { name: 'claim' },
  ]);
});

test('failed public asset installation cannot activate an incomplete offline shell', async () => {
  const fixture = worker();
  fixture.rejectInstall();
  await assert.rejects(fixture.dispatch('install'), /Synthetic public asset installation failure/);
  assert.deepEqual(
    fixture.calls.map((call) => call.name),
    ['open', 'addAll'],
  );
});

test('root navigation uses the network and never persists its response', async () => {
  const fixture = worker();
  assert.equal(await fixture.dispatch('fetch', request('/')), fixture.network);
  assert.deepEqual(fixture.calls, [{ name: 'fetch', value: 'https://chat.example.test/' }]);
});

test('failed root navigation returns only the public offline document', async () => {
  const fixture = worker();
  fixture.setOffline();
  assert.equal(await fixture.dispatch('fetch', request('/')), fixture.offline);
  assert.deepEqual(
    fixture.calls.map((call) => call.name),
    ['fetch', 'match'],
  );
  assert.equal(fixture.calls[1].value, '/offline.html');
});

test('worker bypasses private APIs, authenticated requests, callbacks and foreign origins', async () => {
  const fixture = worker();
  const bypass = [
    request('/api/chat'),
    request('/api/attachments?id=private'),
    request('/', { method: 'POST' }),
    request('/', { headers: new Headers({ Authorization: 'Bearer synthetic' }) }),
    request('/?code=synthetic'),
    // Synthetic defensive URL case only: Fetch normally omits fragments.
    // Browser callback handling has separate startup/security regressions.
    request('/#access_token=synthetic'),
    request('/icons/icon-192.png?cache=private'),
    request('https://external.example.test/'),
  ];
  for (const candidate of bypass)
    assert.equal(await fixture.dispatch('fetch', candidate), undefined);
  assert.deepEqual(fixture.calls, []);
});

test('public asset cache hits do not fetch and cache misses fall back to network', async () => {
  const fixture = worker();
  const icon = request('/icons/icon-192.png', { mode: 'cors' });
  assert.equal(await fixture.dispatch('fetch', icon), fixture.asset);
  assert.deepEqual(
    fixture.calls.map((call) => call.name),
    ['match'],
  );
  fixture.missCache();
  assert.equal(await fixture.dispatch('fetch', icon), fixture.network);
  assert.deepEqual(
    fixture.calls.map((call) => call.name),
    ['match', 'match', 'fetch'],
  );
});

test('an uncached public asset propagates network failure instead of returning private or HTML data', async () => {
  const fixture = worker();
  fixture.missCache();
  fixture.setOffline();
  await assert.rejects(
    fixture.dispatch('fetch', request('/fonts/google-sans-latin-variable.woff2', { mode: 'cors' })),
    /Synthetic offline/,
  );
  assert.deepEqual(
    fixture.calls.map((call) => call.name),
    ['match', 'fetch'],
  );
});
