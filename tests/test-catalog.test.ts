import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { nodeLayer, testFiles, requireNativeBinding } from '../scripts/test-catalog';

test('recursive Node inventory includes nested tests while excluding browser specs, helpers and benchmarks', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'chat-node-catalog-'));
  try {
    mkdirSync(resolve(root, 'tests/nested'), { recursive: true });
    for (const file of [
      'a.test.ts',
      'nested/b.test.ts',
      'view.spec.ts',
      'benchmark.ts',
      'helper.ts',
    ])
      writeFileSync(resolve(root, 'tests', file), '');
    assert.deepEqual(testFiles(root), ['tests/a.test.ts', 'tests/nested/b.test.ts']);
    symlinkSync(resolve(root, 'tests/a.test.ts'), resolve(root, 'tests/link.test.ts'));
    assert.throws(() => testFiles(root), /symlinks/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('layers use actual module imports, not quote style or a native-helper name in a comment', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'chat-node-layer-'));
  try {
    const put = (file: string, source: string) => {
      writeFileSync(resolve(root, file), source);
      return nodeLayer(root, file);
    };
    assert.equal(
      put('native.ts', 'import { nativeEnabled } from "../helpers/native-postgres";'),
      'native',
    );
    assert.equal(put('sql.ts', 'import { PGlite } from "@electric-sql/pglite";'), 'sql');
    assert.equal(
      put('unit.ts', '// from \'./helpers/native-postgres\'\nimport assert from "node:assert";'),
      'unit',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native acceptance rejects missing, malformed and stale build bindings before fixture execution', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'chat-native-binding-'));
  try {
    mkdirSync(resolve(root, 'src/lib'), { recursive: true });
    mkdirSync(resolve(root, '.next'));
    writeFileSync(resolve(root, 'src/lib/server.ts'), 'frozen fixture source');
    writeFileSync(resolve(root, '.next/BUILD_ID'), 'fixture-build-id\n');
    const bindingPath = resolve(root, 'binding.json');
    const environment = {
      CHAT_NATIVE_WORK_DIR: resolve(root, 'disposable'),
      CHAT_NATIVE_BUILD_BINDING: bindingPath,
    };
    const hash = createHash('sha256').update('frozen fixture source').digest('hex');
    const valid = {
      buildId: 'fixture-build-id',
      runtimeSourceHashes: { 'src/lib/server.ts': hash },
    };
    const put = (value: unknown) => writeFileSync(bindingPath, JSON.stringify(value));
    assert.throws(() => requireNativeBinding(root, {}), /CHAT_NATIVE_WORK_DIR/);
    assert.throws(
      () => requireNativeBinding(root, { CHAT_NATIVE_WORK_DIR: environment.CHAT_NATIVE_WORK_DIR }),
      /CHAT_NATIVE_BUILD_BINDING/,
    );
    assert.throws(() => requireNativeBinding(root, environment), /readable JSON/);
    writeFileSync(bindingPath, '{bad json');
    assert.throws(() => requireNativeBinding(root, environment), /readable JSON/);
    for (const value of [
      {},
      { buildId: 'fixture-build-id', runtimeSourceHashes: {} },
      { buildId: 'fixture-build-id', runtimeSourceHashes: { 'src/lib/server.ts': 'not-a-hash' } },
    ]) {
      put(value);
      assert.throws(() => requireNativeBinding(root, environment), /buildId|SHA-256/);
    }
    put({ ...valid, buildId: 'stale-build' });
    assert.throws(() => requireNativeBinding(root, environment), /BUILD_ID/);
    put(valid);
    assert.doesNotThrow(() => requireNativeBinding(root, environment));
    put({ ...valid, runtimeSourceHashes: { ...valid.runtimeSourceHashes, '../outside.ts': hash } });
    assert.throws(() => requireNativeBinding(root, environment), /outside/);
    put(valid);
    writeFileSync(resolve(root, 'src/lib/server.ts'), 'changed after build');
    assert.throws(() => requireNativeBinding(root, environment), /changed after/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
