import type { Plugin } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

export function componentCoveragePlugins(): Plugin[] {
  if (process.env.CHAT_COLLECT_COVERAGE !== '1') return [];
  const runId = process.env.CHAT_COVERAGE_RUN_ID;
  const manifest = JSON.parse(
    readFileSync(resolve('test-results/combined-coverage/manifest.json'), 'utf8'),
  ) as { runId: string; files: Record<string, { sha256: string }> };
  if (!runId || manifest.runId !== runId)
    throw new Error('Standalone component coverage must use the current bound manifest.');
  const require = createRequire(resolve('package.json'));
  const { instrument } = require('./scripts/coverage-instrumentation.cjs') as {
    instrument(source: string, filename: string, runId: string): { code: string };
  };
  return [
    {
      name: 'bound-component-coverage',
      setup(builder) {
        builder.onLoad({ filter: /\.[jt]sx?$/ }, ({ path }) => {
          const key = relative(process.cwd(), path).replaceAll('\\', '/');
          const entry = manifest.files[key];
          if (!entry) return null;
          const source = readFileSync(path, 'utf8');
          if (createHash('sha256').update(source).digest('hex') !== entry.sha256)
            throw new Error(`Standalone component source drift: ${key}`);
          return {
            contents: instrument(source, path, runId).code,
            loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : 'js',
            resolveDir: dirname(path),
          };
        });
      },
    },
  ];
}
