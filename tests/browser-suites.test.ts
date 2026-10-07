import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  bindingChanges,
  browserTargets,
  captureBinding,
  inventory,
  mapSuite,
  parseArguments,
  runSuites,
  specFiles,
} from '../scripts/test-browser-suites';

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'chat-browser-runner-'));
  const put = (path: string, content = '') => {
    mkdirSync(resolve(root, path, '..'), { recursive: true });
    writeFileSync(resolve(root, path), content);
  };
  put('tests/root.spec.ts');
  put('tests/nested/child.spec.ts');
  put('tests/nested/variant.spec.tsx');
  put('tests/unit.test.ts');
  put('tests/node_modules/ignored.spec.ts');
  return { root, put, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('recursive spec discovery is deterministic and maps nested/project scopes without mutable RegExp state', () => {
  const f = fixture();
  try {
    assert.deepEqual(specFiles(f.root), [
      'tests/nested/child.spec.ts',
      'tests/nested/variant.spec.tsx',
      'tests/root.spec.ts',
    ]);
    const all = mapSuite(
      f.root,
      'playwright.config.ts',
      { testDir: 'tests', testMatch: ['**/*.spec.ts', '**/*.spec.tsx'] },
      specFiles(f.root),
    );
    assert.equal(all.specs.length, 3);
    const scoped = mapSuite(
      f.root,
      'playwright.child.config.ts',
      {
        testMatch: /\.spec\.ts/g,
        projects: [{ testDir: 'tests/nested', testIgnore: '**/variant.*' }],
      },
      specFiles(f.root),
    );
    assert.deepEqual(scoped.specs, ['tests/nested/child.spec.ts']);
    assert.deepEqual(
      mapSuite(
        f.root,
        'playwright.root.config.ts',
        { testDir: 'tests', testMatch: 'root.spec.ts' },
        specFiles(f.root),
      ).specs,
      ['tests/root.spec.ts'],
    );
    assert.throws(
      () => mapSuite(f.root, 'empty', { testMatch: '**/absent.spec.ts' }, specFiles(f.root)),
      /selects no/,
    );
    assert.throws(
      () =>
        mapSuite(
          f.root,
          'filtered',
          { testMatch: '**/*.spec.ts', grep: /only/ },
          specFiles(f.root),
        ),
      /title filters/,
    );
    assert.throws(
      () =>
        mapSuite(
          f.root,
          'unknown-glob',
          { testMatch: '**/{root,child}.spec.ts' },
          specFiles(f.root),
        ),
      /Unsupported test pattern/,
    );
  } finally {
    f.close();
  }
});

test('inventory refuses orphan nested files before any execution', async () => {
  const f = fixture();
  try {
    f.put('playwright.config.ts', 'export default {testDir:"tests",testMatch:"**/root.spec.ts"};');
    await assert.rejects(
      inventory(f.root),
      /missing a suite: tests\/nested\/child\.spec\.ts, tests\/nested\/variant\.spec\.tsx/,
    );
  } finally {
    f.close();
  }
});

test('list/subset arguments cannot forward snapshot updates or silently select an unknown option', () => {
  assert.deepEqual(
    parseArguments(['--list', '--config=b.config.ts,a.config.ts', '--config', './a.config.ts']),
    { list: true, configs: ['a.config.ts', 'b.config.ts'] },
  );
  assert.throws(() => parseArguments(['--config']), /needs/);
  assert.throws(() => parseArguments(['--update-snapshots']), /never forwarded/);
});

test('full runs require a separately configured production target and both targets are always loopback validated', () => {
  assert.deepEqual(browserTargets({ APP_URL: 'http://127.0.0.1:3001' }, false), {
    demo: 'http://127.0.0.1:3001',
    production: null,
  });
  assert.throws(
    () => browserTargets({ APP_URL: 'http://127.0.0.1:3001' }, true),
    /CHAT_PRODUCTION_APP_URL/,
  );
  assert.throws(
    () =>
      browserTargets(
        { APP_URL: 'http://127.0.0.1:3001', CHAT_PRODUCTION_APP_URL: 'http://127.0.0.1:3001' },
        true,
      ),
    /separate/,
  );
  for (const value of [
    'https://127.0.0.1:3008',
    'http://chat.example',
    'http://secret@localhost:3008',
    'not-a-url',
  ]) {
    assert.throws(
      () =>
        browserTargets({ APP_URL: 'http://localhost:3001', CHAT_PRODUCTION_APP_URL: value }, false),
      /loopback/,
    );
    assert.throws(() => browserTargets({ APP_URL: value }, false), /loopback/);
  }
  assert.equal(
    browserTargets(
      { APP_URL: 'http://[::1]:3001', CHAT_PRODUCTION_APP_URL: 'http://localhost:3008' },
      true,
    ).production,
    'http://localhost:3008',
  );
});

test('runtime/test/config bindings catch changed, added and removed files while excluding generated artifacts and environment files', () => {
  const f = fixture();
  try {
    f.put('src/page.tsx', 'original');
    f.put('public/icon.png', 'bytes');
    f.put('scripts/check.ts', 'original');
    f.put('playwright.config.ts', 'config');
    f.put('package.json', '{}');
    f.put('src/.env.private', 'must not read');
    f.put('test-results/ignored.txt', 'not input');
    const before = captureBinding(f.root);
    assert.equal(Object.hasOwn(before, 'src/.env.private'), false);
    f.put('src/page.tsx', 'changed');
    f.put('src/new.css', 'added');
    rmSync(resolve(f.root, 'public/icon.png'));
    f.put('test-results/ignored.txt', 'changed output');
    assert.deepEqual(bindingChanges(before, captureBinding(f.root)), [
      'public/icon.png',
      'src/new.css',
      'src/page.tsx',
    ]);
  } finally {
    f.close();
  }
});

test('suite execution routes production APP_URL separately and fails the overall run on drift despite successful children', () => {
  const f = fixture();
  try {
    f.put('src/page.tsx', 'before');
    const urls: string[] = [];
    const report = runSuites(
      f.root,
      [
        { config: 'playwright.config.ts', specs: ['tests/root.spec.ts'], environment: 'demo' },
        {
          config: 'playwright.security.config.ts',
          specs: ['tests/root.spec.ts'],
          environment: 'production',
        },
      ],
      { demo: 'http://127.0.0.1:3001', production: 'http://127.0.0.1:3008' },
      (suite, env) => {
        urls.push(env.APP_URL!);
        if (suite.environment === 'production') f.put('src/page.tsx', 'during child');
        return { status: 0, stdout: 'child passed' };
      },
    );
    assert.deepEqual(urls, ['http://127.0.0.1:3001', 'http://127.0.0.1:3008']);
    assert.equal(report.passed, false);
    assert.equal(report.driftDetected, true);
    assert.deepEqual(report.results.at(-1)!.drift, ['src/page.tsx']);
    const disk = JSON.parse(
      readFileSync(resolve(f.root, 'test-results/all-suites/result.json'), 'utf8'),
    );
    assert.equal(disk.passed, false);
    assert.notEqual(disk.binding.before['src/page.tsx'], disk.binding.after['src/page.tsx']);
  } finally {
    f.close();
  }
});

test('failed child and process errors remain failures without source drift', () => {
  const f = fixture();
  try {
    const suite = [
      {
        config: 'playwright.config.ts',
        specs: ['tests/root.spec.ts'],
        environment: 'demo' as const,
      },
    ];
    const result = runSuites(
      f.root,
      suite,
      { demo: 'http://localhost:3001', production: null },
      () => ({ status: null, error: new Error('spawn failed') }),
    );
    assert.equal(result.passed, false);
    assert.equal(result.driftDetected, false);
    assert.equal(result.results[0].exitCode, 1);
    assert.match(readFileSync(resolve(f.root, result.results[0].log), 'utf8'), /spawn failed/);
  } finally {
    f.close();
  }
});

test('progress stays incomplete with no passing aggregate until all selected suites finish', () => {
  const f = fixture();
  try {
    let calls = 0;
    const result = runSuites(
      f.root,
      [
        { config: 'a.config.ts', specs: ['tests/root.spec.ts'], environment: 'demo' },
        { config: 'b.config.ts', specs: ['tests/root.spec.ts'], environment: 'demo' },
      ],
      { demo: 'http://localhost:3001', production: null },
      () => {
        const disk = JSON.parse(
          readFileSync(resolve(f.root, 'test-results/all-suites/result.json'), 'utf8'),
        );
        assert.equal(disk.status, 'running');
        assert.equal(disk.completed, false);
        assert.equal(disk.passed, null);
        assert.equal(disk.results.length, calls++);
        return { status: 0 };
      },
    );
    assert.equal(result.passed, true);
    const finished = JSON.parse(
      readFileSync(resolve(f.root, 'test-results/all-suites/result.json'), 'utf8'),
    );
    assert.equal(finished.status, 'passed');
    assert.equal(finished.completed, true);
    assert.equal(finished.passed, true);
    assert.equal(finished.results.length, 2);
  } finally {
    f.close();
  }
});
