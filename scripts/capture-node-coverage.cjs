const { mkdirSync, writeFileSync, renameSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const vm = require('node:vm');
const { syncBuiltinESMExports } = require('node:module');

if (!process.env.CHAT_COVERAGE_RUN_ID) throw new Error('Node coverage run ID is required.');
if (!process.env.CHAT_ISTANBUL_DIR) throw new Error('Node coverage output directory is required.');
const output = resolve(process.env.CHAT_ISTANBUL_DIR);
mkdirSync(output, { recursive: true });
globalThis.__coverage__ ||= {};
// Actual VM executions (including sw.js) use separate globals. Share only the
// counter table, so their real execution is collected without mocking code.
if (process.env.CHAT_COVERAGE_LAYER === 'node') {
  const createContext = vm.createContext;
  vm.createContext = (sandbox = {}, options) => {
    if (!Object.hasOwn(sandbox, '__coverage__')) sandbox.__coverage__ = globalThis.__coverage__;
    return createContext(sandbox, options);
  };
  const runInNewContext = vm.runInNewContext;
  vm.runInNewContext = (code, sandbox = {}, options) => {
    if (!Object.hasOwn(sandbox, '__coverage__')) sandbox.__coverage__ = globalThis.__coverage__;
    return runInNewContext(code, sandbox, options);
  };
  syncBuiltinESMExports();
}

function capture() {
  if (!globalThis.__coverage__) return;
  const path = resolve(output, `node-${process.pid}-${randomUUID()}.json`);
  const temporary = `${path}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({
      layer: process.env.CHAT_COVERAGE_LAYER || 'node',
      runId: process.env.CHAT_COVERAGE_RUN_ID,
      coverage: globalThis.__coverage__,
    }),
  );
  renameSync(temporary, path);
}
process.once('exit', capture);
function handleSignal(signal) {
  capture();
  // A once listener has already been removed. Preserve default termination in
  // plain Node children; Next's own graceful listener remains responsible there.
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}
process.once('SIGTERM', () => handleSignal('SIGTERM'));
process.once('SIGINT', () => handleSignal('SIGINT'));
