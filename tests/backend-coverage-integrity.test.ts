import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import {
  mergePayloads,
  validatePayload,
  type BoundCoverage,
  type CoverageManifest,
  type RawCoverage,
} from '../scripts/coverage-validation';

const require = createRequire(import.meta.url);
const { instrument } = require('../scripts/coverage-instrumentation.cjs') as {
  instrument(
    source: string,
    filename: string,
    runId: string,
  ): { code: string; coverage: BoundCoverage };
};

test('combined coverage keeps its seed and each independently executed layer isolated', () => {
  const filename = '/fixture/choose.js';
  const source = `function choose(value) {
  if (value) {
    return 'node';
  }
  return 'browser';
}`;
  const { code, coverage } = instrument(source, filename, 'layer-fixture');
  const manifest: CoverageManifest = {
    root: '/fixture',
    runId: 'layer-fixture',
    instrumenterHash: coverage.instrumenterHash,
    files: {
      'choose.js': {
        sha256: coverage.sourceHash,
        lines: 6,
        statementCount: Object.keys(coverage.statementMap).length,
        executable: true,
      },
    },
    seed: { [filename]: structuredClone(coverage) },
    scope: 'Synthetic counter-merger regression, not actual application/browser execution.',
  };
  const execute = (layer: string, value: boolean): RawCoverage => {
    // Synthetic merger counters must stay outside the collector's actual app table.
    const context = vm.createContext({ __coverage__: {} });
    vm.runInContext(code, context);
    assert.equal(context.choose(value), layer);
    return {
      layer,
      runId: manifest.runId,
      ...(layer === 'browser' ? { testId: 'browser-fixture' } : {}),
      coverage: structuredClone(context.__coverage__),
    };
  };
  const payloads = [execute('node', true), execute('browser', false)];
  const originalSeed = structuredClone(manifest.seed);
  const originalPayloads = structuredClone(payloads);
  const merged = mergePayloads(manifest, payloads);

  assert.deepEqual(manifest.seed, originalSeed, 'merging must not mark the zero seed as executed');
  assert.deepEqual(payloads, originalPayloads, 'merging must not mutate collected snapshots');
  assert.deepEqual(
    { ...merged.layers.get('node')!.fileCoverageFor(filename).getLineCoverage() },
    {
      2: 1,
      3: 1,
      5: 0,
    },
  );
  assert.deepEqual(
    { ...merged.layers.get('browser')!.fileCoverageFor(filename).getLineCoverage() },
    {
      2: 1,
      3: 0,
      5: 1,
    },
  );
  assert.equal(merged.combined.getCoverageSummary().lines.covered, 3);
  assert.equal(merged.layers.get('node')!.getCoverageSummary().lines.covered, 2);
  assert.equal(merged.layers.get('browser')!.getCoverageSummary().lines.covered, 2);
  assert.deepEqual([...merged.observedLayers].sort(), ['browser', 'node']);
  assert.deepEqual([...merged.browserTestIds], ['browser-fixture']);

  const repeated = mergePayloads(manifest, payloads);
  assert.deepEqual(
    repeated.combined.toJSON(),
    merged.combined.toJSON(),
    'another merge must start from the original zero seed',
  );
});

test('a function-only module carries source binding despite having no statement counters', () => {
  const filename = '/fixture/noop.js';
  const { code, coverage } = instrument('function noop() {}', filename, 'function-fixture');
  assert.equal(Object.keys(coverage.s).length, 0);
  assert.equal(Object.keys(coverage.f).length, 1);
  const context = vm.createContext({ __coverage__: {} });
  vm.runInContext(code, context);
  context.noop();
  const actual = structuredClone(context.__coverage__[filename]) as BoundCoverage;
  assert.equal(actual.sourceHash, coverage.sourceHash);
  assert.equal(actual.instrumenterHash, coverage.instrumenterHash);
  assert.equal(actual.runId, coverage.runId);
  assert.deepEqual(Object.values(actual.f), [1]);
  const manifest: CoverageManifest = {
    root: '/fixture',
    runId: coverage.runId,
    instrumenterHash: coverage.instrumenterHash,
    files: {
      'noop.js': {
        sha256: coverage.sourceHash,
        lines: 1,
        statementCount: 0,
        executable: true,
      },
    },
    seed: { [filename]: coverage },
    scope: 'Function-only instrumentation fixture.',
  };
  assert.equal(
    validatePayload(manifest, {
      layer: 'node',
      runId: manifest.runId,
      coverage: { [filename]: actual },
    }),
    true,
  );
});
