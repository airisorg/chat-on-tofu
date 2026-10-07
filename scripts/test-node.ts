import { spawnSync } from 'node:child_process';
import { testFiles, nodeLayer, requireNativeBinding, type NodeLayer } from './test-catalog';

const mode = process.argv[2] || 'default';
const layers: Record<string, NodeLayer[]> = {
  default: ['unit', 'sql'],
  unit: ['unit'],
  sql: ['sql'],
  native: ['native'],
};
if (!Object.hasOwn(layers, mode) || process.argv.length > 3)
  throw new Error('Use test-node.ts [default|unit|sql|native].');
if (mode === 'native')
  requireNativeBinding(process.cwd(), {
    CHAT_NATIVE_WORK_DIR: process.env.CHAT_NATIVE_WORK_DIR,
    CHAT_NATIVE_BUILD_BINDING: process.env.CHAT_NATIVE_BUILD_BINDING,
  });
const files = testFiles(process.cwd()).filter((path) =>
  layers[mode].includes(nodeLayer(process.cwd(), path)),
);
if (!files.length) throw new Error('Selected test layer has no files.');
console.log(
  `Node test layer ${mode}: ${files.length} files; native fixtures ${mode === 'native' ? 'explicitly enabled' : 'not selected'}.`,
);
const child = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  stdio: 'inherit',
  env: process.env,
});
if (child.error) console.error(child.error);
process.exitCode = child.status ?? 1;
