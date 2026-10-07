import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { inventory } from './test-browser-suites';

export type NodeLayer = 'unit' | 'sql' | 'native';
export function testFiles(root: string): string[] {
  function walk(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith('.') || ['node_modules', 'test-results'].includes(entry.name))
        return [];
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Test discovery must not follow symlinks.');
      return entry.isDirectory()
        ? walk(path)
        : entry.isFile()
          ? [relative(root, path).split(sep).join('/')]
          : [];
    });
  }
  return walk(resolve(root, 'tests'))
    .filter((path) => /\.test\.[cm]?[jt]sx?$/.test(path))
    .sort();
}

export function nodeLayer(root: string, path: string): NodeLayer {
  const source = ts.createSourceFile(
    path,
    readFileSync(resolve(root, path), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = source.statements
    .filter(ts.isImportDeclaration)
    .flatMap((statement) =>
      ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : [],
    );
  if (imports.some((value) => /(?:^|\/)helpers\/native-postgres$/.test(value))) return 'native';
  return imports.includes('@electric-sql/pglite') ? 'sql' : 'unit';
}

/** Acceptance entrypoint: reject missing/stale proof before native fixtures start. */
export function requireNativeBinding(
  root: string,
  environment: { CHAT_NATIVE_WORK_DIR?: string; CHAT_NATIVE_BUILD_BINDING?: string },
) {
  if (!environment.CHAT_NATIVE_WORK_DIR)
    throw new Error('Native tests require an explicit CHAT_NATIVE_WORK_DIR; see docs/testing.md.');
  if (!environment.CHAT_NATIVE_BUILD_BINDING)
    throw new Error(
      'Native acceptance requires CHAT_NATIVE_BUILD_BINDING from a fresh production build.',
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(root, environment.CHAT_NATIVE_BUILD_BINDING), 'utf8'));
  } catch {
    throw new Error('Native acceptance requires a readable JSON build binding.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Native build binding must contain a buildId and runtimeSourceHashes.');
  const binding = parsed as Record<string, unknown>,
    hashes = binding.runtimeSourceHashes;
  if (
    typeof binding.buildId !== 'string' ||
    !binding.buildId.trim() ||
    !hashes ||
    typeof hashes !== 'object' ||
    Array.isArray(hashes)
  )
    throw new Error('Native build binding must contain a buildId and runtimeSourceHashes.');
  const entries = Object.entries(hashes);
  if (
    !entries.length ||
    !Object.hasOwn(hashes, 'src/lib/server.ts') ||
    entries.some(
      ([path, hash]) => !path || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash),
    )
  )
    throw new Error(
      'Native build binding requires valid SHA-256 runtime inputs including src/lib/server.ts.',
    );
  let buildId: string;
  try {
    buildId = readFileSync(resolve(root, '.next/BUILD_ID'), 'utf8').trim();
  } catch {
    throw new Error('Native acceptance requires a freshly built .next/BUILD_ID.');
  }
  if (binding.buildId !== buildId)
    throw new Error('Native build binding does not match the current production BUILD_ID.');
  const physicalRoot = realpathSync(root);
  for (const [path, hash] of entries) {
    const file = resolve(root, path),
      inside = relative(root, file);
    if (isAbsolute(path) || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw new Error('Native build binding cannot read inputs outside the checkout.');
    let physical: string;
    try {
      physical = relative(physicalRoot, realpathSync(file));
    } catch {
      throw new Error(`Native build input is unavailable: ${path}`);
    }
    if (physical === '..' || physical.startsWith(`..${sep}`) || isAbsolute(physical))
      throw new Error('Native build binding cannot read inputs outside the checkout.');
    let actual: string;
    try {
      actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    } catch {
      throw new Error(`Native build input is unavailable: ${path}`);
    }
    if (actual !== hash)
      throw new Error(`Native build input changed after the recorded build: ${path}`);
  }
}

export async function testCatalog(root: string) {
  const browser = await inventory(root);
  return {
    scope: 'File membership and entrypoints, not executed-test counts or code coverage.',
    node: testFiles(root).map((path) => ({ path, layer: nodeLayer(root, path) })),
    browser: browser.suites,
    browserSpecCount: browser.specs.length,
    repeatedBrowserSpecs: browser.specs.filter(
      (path) => browser.suites.filter((suite) => suite.specs.includes(path)).length > 1,
    ),
    benchmarks: [
      'scripts/benchmark-chat.ts',
      'tests/benchmark-groups.ts',
      'tests/benchmark-dense.ts',
      'tests/open-source-capacity-benchmark.ts',
    ],
    benchmarkScope: {
      'scripts/benchmark-chat.ts': 'Embedded PGlite; two synthetic identities and small media.',
      'tests/benchmark-groups.ts': 'Embedded PGlite; synthetic group/action workloads.',
      'tests/benchmark-dense.ts': 'Embedded PGlite; synthetic dense-history workloads.',
      'tests/open-source-capacity-benchmark.ts':
        'Disposable native PostgreSQL; explicit local source/evidence paths and CHAT_NATIVE_WORK_DIR required. Five measured samples after two warmups; no HTTP/auth/quota measurement.',
    },
    nativeRequirements:
      'test:native requires CHAT_NATIVE_WORK_DIR, installed PostgreSQL/OpenSSL, and CHAT_NATIVE_BUILD_BINDING matching a fresh production build. Direct unbound native diagnostics are separate from acceptance.',
    visualScope:
      'Own-app reviewed macOS image baselines; no Google pixel-parity or physical-device claim.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  testCatalog(process.cwd())
    .then((value) => console.log(JSON.stringify(value, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
