const { instrument } = require('./coverage-instrumentation.cjs');
const { readFileSync } = require('node:fs');
const { resolve, relative } = require('node:path');
const { createHash } = require('node:crypto');
module.exports = function coverageLoader(source) {
  this.cacheable(false);
  this.addDependency(resolve('test-results/combined-coverage/manifest.json'));
  const manifest = JSON.parse(
    readFileSync(resolve('test-results/combined-coverage/manifest.json'), 'utf8'),
  );
  const file = relative(manifest.root, this.resourcePath).split(require('node:path').sep).join('/');
  if (manifest.files[file]?.sha256 !== createHash('sha256').update(source).digest('hex'))
    throw new Error(`Coverage build source drift: ${file}`);
  const data = instrument(source, this.resourcePath, manifest.runId);
  this.callback(null, data.code, data.map);
};
