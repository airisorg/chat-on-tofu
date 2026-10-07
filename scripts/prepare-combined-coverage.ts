import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { inventory, instrument } = require('./coverage-instrumentation.cjs') as {
  inventory(
    root: string,
    runId: string,
  ): { runId: string; files: Record<string, unknown>; seed: Record<string, unknown> };
  instrument(source: string, filename: string, runId: string): { code: string };
};
const root = process.cwd(),
  output = resolve('test-results/combined-coverage');
mkdirSync(output, { recursive: true });
for (const name of [
  'coverage-summary.json',
  'coverage-final.json',
  'execution.json',
  'execution-failed.json',
  'browser-results.json',
  'diagnostic-gaps.json',
])
  rmSync(resolve(output, name), { force: true });
const manifest = inventory(root, randomUUID());
rmSync(resolve(output, 'raw'), { recursive: true, force: true });
mkdirSync(resolve(output, 'raw'), { recursive: true });
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
const nodeRoot = resolve(output, 'node-source');
rmSync(nodeRoot, { recursive: true, force: true });
mkdirSync(nodeRoot, { recursive: true });
// This copy keeps assertions/import topology while leaving production source
// unchanged. Only runtime inputs receive counters; dependency trees stay shared
// read-only and are outside the runtime denominator.
for (const path of ['src', 'public', 'tests', 'scripts', 'migrations'])
  cpSync(resolve(root, path), resolve(nodeRoot, path), {
    recursive: true,
    filter: (path) => !path.endsWith('-snapshots'),
  });
for (const path of ['package.json', 'tsconfig.json'])
  cpSync(resolve(root, path), resolve(nodeRoot, path));
for (const path of readdirSync(root).filter((path) => /^playwright.*\.config\.ts$/.test(path)))
  cpSync(resolve(root, path), resolve(nodeRoot, path));
symlinkSync(resolve(root, 'node_modules'), resolve(nodeRoot, 'node_modules'), 'dir');
for (const path of Object.keys(manifest.files)) {
  const original = resolve(root, path),
    copied = resolve(nodeRoot, path);
  writeFileSync(
    copied,
    instrument(readFileSync(original, 'utf8'), original, (manifest as { runId: string }).runId)
      .code,
  );
}
console.log(
  JSON.stringify({
    scope: 'Isolated instrumented Node copy; original runtime untouched',
    nodeRoot: relative(root, nodeRoot),
    runtimeInputs: Object.keys(manifest.files).length,
    runId: (manifest as { runId: string }).runId,
  }),
);
