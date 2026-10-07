import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
function javascript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? javascript(path)
      : entry.isFile() && path.endsWith('.js')
        ? [path]
        : [];
  });
}
const files = javascript(resolve('.next'));
if (!files.length) throw new Error('Ordinary production build is missing.');
for (const file of files)
  if (/instrumenterHash|CHAT_COVERAGE_RUN_ID|cov_[a-z0-9]+\(\)/.test(readFileSync(file, 'utf8')))
    throw new Error(`Test coverage payload found in ordinary production artifact: ${file}`);
console.log(
  `Ordinary production artifact checked: ${files.length} JavaScript files contain no coverage counter/binding payload.`,
);
