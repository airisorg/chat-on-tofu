import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import {
  validateManifest,
  mergePayloads,
  validateExecution,
  requireCoverageFloor,
  type CoverageExecution,
  type CoverageManifest,
  type RawCoverage,
} from './coverage-validation';
const require = createRequire(import.meta.url);
const { inventory } = require('./coverage-instrumentation.cjs') as {
  inventory(root: string, runId: string): CoverageManifest;
};
const root = process.cwd(),
  output = resolve('test-results/combined-coverage');
const manifest = JSON.parse(
  readFileSync(resolve(output, 'manifest.json'), 'utf8'),
) as CoverageManifest;
validateManifest(manifest, inventory(root, manifest.runId));
const rawDirectory = resolve(output, 'raw'),
  rawFiles = readdirSync(rawDirectory).filter((path) => path.endsWith('.json'));
function* payloads(): Iterable<RawCoverage> {
  for (const path of rawFiles)
    yield JSON.parse(readFileSync(resolve(rawDirectory, path), 'utf8')) as RawCoverage;
}
const { combined, layers, observedLayers, browserTestIds } = mergePayloads(manifest, payloads());

const files = Object.fromEntries(
  Object.keys(manifest.files).map((path) => [
    path,
    combined.fileCoverageFor(resolve(root, path)).toSummary().toJSON(),
  ]),
);
const report = {
  runId: manifest.runId,
  instrumenterHash: manifest.instrumenterHash,
  scope:
    'Actual original-source Istanbul executable counters; union of snapshots, not execution cardinality. Unloaded inputs seeded zero. Denominator differs from historical c8 physical/source-mapped lines.',
  total: combined.getCoverageSummary().toJSON(),
  files,
  nonExecutableInputs: Object.entries(manifest.files)
    .filter(([, file]) => !file.executable)
    .map(([path]) => path),
  zeroLineFiles: Object.entries(files)
    .filter(([, value]) => value.lines.total > 0 && value.lines.covered === 0)
    .map(([path]) => path),
  layers: Object.fromEntries(
    [...layers].map(([name, map]) => [name, map.getCoverageSummary().toJSON()]),
  ),
  observedLayers: [...observedLayers],
  browserTests: browserTestIds.size,
  rawFiles: rawFiles.length,
  sourceInputs: Object.keys(manifest.files).length,
};
writeFileSync(resolve(output, 'coverage-summary.json'), JSON.stringify(report, null, 2));
writeFileSync(resolve(output, 'coverage-final.json'), JSON.stringify(combined.toJSON()));
console.log(
  JSON.stringify(
    {
      total: report.total,
      sourceInputs: report.sourceInputs,
      nonExecutableInputs: report.nonExecutableInputs,
      zeroLineFiles: report.zeroLineFiles,
      layers: report.layers,
      browserTests: report.browserTests,
    },
    null,
    2,
  ),
);
if (process.argv.includes('--check')) {
  const execution = JSON.parse(
    readFileSync(resolve(output, 'execution.json'), 'utf8'),
  ) as CoverageExecution;
  validateExecution(manifest.runId, execution, observedLayers, browserTestIds);
  for (const metric of ['lines', 'statements'] as const)
    requireCoverageFloor(report.total[metric], metric);
}
