import {
  createCoverageMap,
  type CoverageMapData,
  type FileCoverageData,
} from 'istanbul-lib-coverage';
export type BoundCoverage = FileCoverageData & {
  sourceHash: string;
  instrumenterHash: string;
  runId: string;
};
export type CoverageManifest = {
  root: string;
  runId: string;
  instrumenterHash: string;
  files: Record<
    string,
    { sha256: string; executable: boolean; statementCount: number; lines: number }
  >;
  seed: Record<string, BoundCoverage>;
  scope: string;
};
export type RawCoverage = {
  layer: string;
  runId: string;
  testId?: string;
  coverage: CoverageMapData;
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function validateManifest(manifest: CoverageManifest, fresh: CoverageManifest) {
  if (!equal(manifest, fresh))
    throw new Error('Coverage manifest differs from the fresh complete original-source inventory.');
}
export function validatePayload(manifest: CoverageManifest, raw: RawCoverage) {
  if (raw.runId !== manifest.runId) throw new Error('Stale coverage run ID.');
  if (!['node', 'server', 'browser'].includes(raw.layer))
    throw new Error('Unknown coverage layer.');
  let observed = false;
  for (const [filename, value] of Object.entries(raw.coverage)) {
    const expected = manifest.seed[filename];
    if (!expected) throw new Error(`Unknown counter input: ${filename}`);
    const actual = value as BoundCoverage;
    if (actual.path !== filename) throw new Error('Counter path mismatch.');
    for (const key of [
      'sourceHash',
      'instrumenterHash',
      'runId',
      'statementMap',
      'fnMap',
      'branchMap',
    ] as const)
      if (!equal(actual[key], expected[key]))
        throw new Error(`Counter/source binding mismatch: ${filename} ${key}`);
    for (const key of ['s', 'f', 'b'] as const) {
      if (!equal(Object.keys(actual[key] || {}), Object.keys(expected[key])))
        throw new Error(`Missing or extra ${key} counter keys: ${filename}`);
      for (const id of Object.keys(expected[key])) {
        const count = actual[key][id];
        if (key === 'b' && !Array.isArray(count))
          throw new Error('Branch counters must be arrays.');
        const values: unknown[] = key === 'b' && Array.isArray(count) ? count : [count];
        if (
          !Array.isArray(values) ||
          (!Array.isArray(expected.b[id]) && key === 'b') ||
          (key === 'b' && values.length !== expected.b[id].length)
        )
          throw new Error('Incorrect branch counter cardinality.');
        if (
          values.some(
            (value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0,
          )
        )
          throw new Error('Invalid coverage count.');
        if (values.some((value) => typeof value === 'number' && value > 0)) observed = true;
      }
    }
  }
  return observed;
}
export function mergePayloads(manifest: CoverageManifest, payloads: Iterable<RawCoverage>) {
  const combined = createCoverageMap(structuredClone(manifest.seed)),
    layers = new Map<string, ReturnType<typeof createCoverageMap>>(),
    observedLayers = new Set<string>(),
    browserTestIds = new Set<string>();
  for (const raw of payloads) {
    if (validatePayload(manifest, raw)) {
      observedLayers.add(raw.layer);
      if (raw.layer === 'browser' && raw.testId) browserTestIds.add(raw.testId);
    }
    const layer = layers.get(raw.layer) || createCoverageMap(structuredClone(manifest.seed));
    layer.merge(structuredClone(raw.coverage));
    layers.set(raw.layer, layer);
    combined.merge(structuredClone(raw.coverage));
  }
  return { combined, layers, observedLayers, browserTestIds };
}

export type CoverageExecution = {
  runId: string;
  node: { exitCode: number };
  browser: { exitCode: number; tests: number; testIds: string[] };
  server: { exitCode: number };
};
export function requireCoverageFloor(metric: { covered: number; total: number }, name: string) {
  // Rounded report percentages can display95 at94.995. Gate the exact counts.
  if (!metric.total || metric.covered * 100 < metric.total * 95)
    throw new Error(`Combined executable ${name} coverage is below95%.`);
}
export function validateExecution(
  runId: string,
  execution: CoverageExecution,
  observedLayers: Set<string>,
  browserTestIds: Set<string>,
) {
  if (
    !execution ||
    execution.runId !== runId ||
    [execution.node?.exitCode, execution.browser?.exitCode, execution.server?.exitCode].some(
      (code) => code !== 0,
    )
  )
    throw new Error(
      'Coverage acceptance requires passing source-bound Node, browser and server runs.',
    );
  for (const layer of ['node', 'server', 'browser'])
    if (!observedLayers.has(layer))
      throw new Error(`No actual execution observed for required layer ${layer}.`);
  const expected = execution.browser.testIds;
  if (
    !Array.isArray(expected) ||
    !expected.length ||
    new Set(expected).size !== expected.length ||
    expected.length !== execution.browser.tests ||
    !equal([...browserTestIds].sort(), [...expected].sort())
  )
    throw new Error('Browser coverage/test participation mismatch.');
}
