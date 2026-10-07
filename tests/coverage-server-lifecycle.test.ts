import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { requireOwnedServerShutdown } from '../scripts/coverage-server-lifecycle';

test('owned graceful SIGTERM accepts Next exit143 after actual child cleanup', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      'process.on("SIGTERM",()=>process.exit(143)); process.stdout.write("ready"); setInterval(()=>{},1000);',
    ],
    {
      env: { PATH: process.env.PATH, NODE_OPTIONS: '', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const closed = once(child, 'close');
  try {
    await once(child.stdout, 'data');
    const requested = child.kill('SIGTERM');
    const [code, signal] = await closed;
    assert.equal(code, 143);
    assert.equal(signal, null);
    assert.doesNotThrow(() => requireOwnedServerShutdown(requested, code, signal));
    assert.throws(() => requireOwnedServerShutdown(false, code, signal), /Unexpected/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
});

test('unexpected or unrequested child exits remain failures', () => {
  for (const [code, signal] of [
    [1, null],
    [137, null],
    [null, 'SIGKILL'],
  ] as const)
    assert.throws(() => requireOwnedServerShutdown(true, code, signal), /Unexpected/);
  for (const [code, signal] of [
    [0, null],
    [143, null],
    [null, 'SIGTERM'],
  ] as const)
    assert.throws(() => requireOwnedServerShutdown(false, code, signal), /Unexpected/);
  assert.doesNotThrow(() => requireOwnedServerShutdown(true, 0, null));
  assert.doesNotThrow(() => requireOwnedServerShutdown(true, null, 'SIGTERM'));
});
