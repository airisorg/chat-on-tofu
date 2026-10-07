import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import {
  mergePayloads,
  validateManifest,
  type CoverageManifest,
  type RawCoverage,
} from './coverage-validation';
const require = createRequire(import.meta.url),
  directory = resolve('test-results/combined-coverage');
const { inventory } = require('./coverage-instrumentation.cjs') as {
  inventory(root: string, id: string): CoverageManifest;
};
const manifest = JSON.parse(
  readFileSync(resolve(directory, 'manifest.json'), 'utf8'),
) as CoverageManifest;
let currentSource = true;
try {
  validateManifest(manifest, inventory(process.cwd(), manifest.runId));
} catch {
  currentSource = false;
}
function* payloads(): Iterable<RawCoverage> {
  for (const path of readdirSync(resolve(directory, 'raw')).filter((path) =>
    path.endsWith('.json'),
  ))
    yield JSON.parse(readFileSync(resolve(directory, 'raw', path), 'utf8')) as RawCoverage;
}
const { combined, browserTestIds, observedLayers } = mergePayloads(manifest, payloads());

const files = Object.fromEntries(
  Object.keys(manifest.files).map((path) => {
    const coverage = combined.fileCoverageFor(resolve(manifest.root, path));
    return [
      path,
      {
        sourceHash: manifest.files[path].sha256,
        metrics: coverage.toSummary().toJSON(),
        uncoveredLines: Object.entries(coverage.getLineCoverage())
          .filter(([, n]) => n === 0)
          .map(([n]) => Number(n)),
        uncoveredStatements: Object.entries(coverage.data.s)
          .filter(([, n]) => n === 0)
          .map(([id]) => coverage.data.statementMap[id]),
      },
    ];
  }),
);
const report = {
  scope:
    'DIAGNOSTIC actual counter union for the saved manifest; not passing-test/current-build acceptance. Files/maps/hash remain tied to that source checkpoint.',
  runId: manifest.runId,
  currentSource,
  total: combined.getCoverageSummary().toJSON(),
  browserTests: browserTestIds.size,
  layers: [...observedLayers],
  files,
};
writeFileSync(resolve(directory, 'diagnostic-gaps.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      currentSource,
      total: report.total,
      browserTests: report.browserTests,
      layers: report.layers,
    },
    null,
    2,
  ),
);
