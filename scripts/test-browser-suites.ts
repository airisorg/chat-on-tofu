import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Suite = { config: string; specs: string[]; environment: 'demo' | 'production' };
type Pattern = string | RegExp;
type Config = { testDir?: string; testMatch?: Pattern | Pattern[]; testIgnore?: Pattern | Pattern[]; grep?: unknown; grepInvert?: unknown; projects?: Config[] };
export type Targets = { demo: string; production: string | null };
export type FileBinding = Record<string, string>;
type ChildResult = { status: number | null; stdout?: string | null; stderr?: string | null; error?: unknown };
type Executor = (suite: Suite, environment: NodeJS.ProcessEnv) => ChildResult;
const SECURITY_CONFIG = 'playwright.security.config.ts';
const posix = (path: string) => path.split(sep).join('/');
const patterns = (value: Pattern | Pattern[] | undefined): Pattern[] => value === undefined ? [] : [value].flat();

export function validateLoopback(value: string, label: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an HTTP loopback URL`); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error(`${label} must be an HTTP loopback URL without credentials`);
  }
  return value;
}

export function browserTargets(environment: { APP_URL?: string; CHAT_PRODUCTION_APP_URL?: string }, productionRequired: boolean): Targets {
  const demo = validateLoopback(environment.APP_URL || 'http://127.0.0.1:3000', 'APP_URL');
  const production = environment.CHAT_PRODUCTION_APP_URL
    ? validateLoopback(environment.CHAT_PRODUCTION_APP_URL, 'CHAT_PRODUCTION_APP_URL') : null;
  if (productionRequired && !production) throw new Error('Set CHAT_PRODUCTION_APP_URL to a separately configured production loopback server before running all suites or the security suite. APP_URL is the demo/preview server.');
  if (productionRequired && new URL(demo).href === new URL(production!).href) throw new Error('APP_URL and CHAT_PRODUCTION_APP_URL must identify separate demo and production servers');
  return { demo, production };
}

export function parseArguments(args: string[]) {
  let list = false;
  const configs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--list') list = true;
    else if (arg === '--config' || arg.startsWith('--config=')) {
      const value = arg === '--config' ? args[++index] : arg.slice('--config='.length);
      if (!value || value.startsWith('--')) throw new Error('--config needs a config filename');
      configs.push(...value.split(',').map(name => name.replace(/^\.\//, '')));
    } else throw new Error(`Unsupported runner argument: ${arg}. Use --list or --config <filename>; screenshot updates are never forwarded.`);
  }
  return { list, configs: [...new Set(configs)].sort() };
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(entry => {
    if (entry.name.startsWith('.env') || ['node_modules', '.git', '.next', 'test-results', 'coverage'].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Source/test inventory does not follow symlinks: ${path}`);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

export function specFiles(root: string): string[] {
  return walk(resolve(root, 'tests')).filter(path => /\.spec\.[cm]?[jt]sx?$/.test(path)).map(path => posix(relative(root, path))).sort();
}

function matches(pattern: Pattern, file: string): boolean {
  if (pattern instanceof RegExp) { const copy = new RegExp(pattern.source, pattern.flags); copy.lastIndex = 0; return copy.test(file); }
  if (/[\[\]{}!\n\r]/.test(pattern)) throw new Error(`Unsupported test pattern: ${pattern}`);
  // Match Playwright's implicit **/ prefix, case-insensitive file glob and dot files.
  const value = pattern.startsWith('**/') ? pattern : `**/${pattern}`;
  let source = '^';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '*' && value[index + 1] === '*') {
      index++;
      if (value[index + 1] === '/') { source += '(?:.*/)?'; index++; } else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[\\^$+?.()|]/g, '\\$&');
  }
  return new RegExp(source + '$', 'i').test(file);
}

export function mapSuite(root: string, config: string, loaded: Config, specs: string[]): Suite {
  const projects = loaded.projects?.length ? loaded.projects : [{}];
  const selected = specs.filter(spec => projects.some(project => {
    if (project.grep || project.grepInvert || loaded.grep || loaded.grepInvert) throw new Error(`${config} uses title filters; file inventory alone cannot prove coverage`);
    const directory = resolve(root, project.testDir || loaded.testDir || '.');
    const file = resolve(root, spec), inside = relative(directory, file);
    if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) return false;
    const include = patterns(project.testMatch ?? loaded.testMatch);
    if (!include.length) throw new Error(`${config} must explicitly select its browser specs`);
    return include.some(pattern => matches(pattern, posix(file))) && !patterns(project.testIgnore ?? loaded.testIgnore).some(pattern => matches(pattern, posix(file)));
  }));
  if (!selected.length) throw new Error(`${config} selects no discovered browser specs`);
  return { config, specs: selected.sort(), environment: config === SECURITY_CONFIG ? 'production' : 'demo' };
}

export async function inventory(root: string): Promise<{ suites: Suite[]; specs: string[] }> {
  const specs = specFiles(root);
  const configs = readdirSync(root).filter(name => /^playwright(?:\.[\w-]+)?\.config\.ts$/.test(name)).sort();
  if (!specs.length || !configs.length) throw new Error('Browser inventory requires at least one config and one spec');
  const suites: Suite[] = [];
  for (const config of configs) suites.push(mapSuite(root, config, (await import(pathToFileURL(resolve(root, config)).href)).default, specs));
  const orphans = specs.filter(spec => !suites.some(suite => suite.specs.includes(spec)));
  if (orphans.length) throw new Error(`Browser specs missing a suite: ${orphans.join(', ')}`);
  return { suites, specs };
}

export function captureBinding(root: string): FileBinding {
  const directories = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && ['src', 'public', 'tests', 'scripts'].includes(entry.name));
  const rootFiles = readdirSync(root).filter(name => /^(?:package(?:-lock)?\.json|tsconfig\.json|next-env\.d\.ts|(?:next|postcss|playwright(?:\.[\w-]+)?)\.config\.[cm]?[jt]s)$/.test(name)).map(name => resolve(root, name));
  const files = [...rootFiles, ...directories.flatMap(entry => walk(resolve(root, entry.name)))].sort();
  return Object.fromEntries(files.map(path => [posix(relative(root, path)), createHash('sha256').update(readFileSync(path)).digest('hex')]));
}

export function bindingChanges(before: FileBinding, after: FileBinding): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(file => before[file] !== after[file]);
}

export function runSuites(root: string, suites: Suite[], targets: Targets, execute: Executor = (suite, env) => spawnSync(process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test', '--config', suite.config, '--workers=1'], { cwd: root, encoding: 'utf8', env, maxBuffer: 20 * 1024 * 1024 })) {
  if (!suites.length) throw new Error('No browser suites selected');
  const folder = resolve(root, 'test-results/all-suites'); mkdirSync(folder, { recursive: true });
  const before = captureBinding(root), startedAt = new Date().toISOString();
  const git = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout?.trim() || '';
  const revisionBefore = git(['rev-parse', 'HEAD']), workingTreeBefore = git(['status', '--porcelain']);
  const results: Array<{ config: string; environment: string; baseURL: string; exitCode: number; elapsedMs: number; log: string; drift: string[] }> = [];
  let after = before, driftDetected = false;
  const persist = () => {
    const completed = results.length === suites.length;
    const passed = completed ? !driftDetected && results.every(result => result.exitCode === 0) : null;
    writeFileSync(resolve(folder, 'result.json'), JSON.stringify({ revisionBefore, revisionAfter: git(['rev-parse', 'HEAD']), workingTreeBefore,
      workingTreeAfter: git(['status', '--porcelain']), startedAt, updatedAt: new Date().toISOString(), completed,
      status: completed ? passed ? 'passed' : 'failed' : 'running', suites, results, binding: { before, after }, driftDetected, passed }, null, 2) + '\n');
  };
  persist();
  for (const suite of suites) {
    const baseURL = suite.environment === 'production' ? targets.production : targets.demo;
    if (!baseURL) throw new Error(`${suite.config} requires CHAT_PRODUCTION_APP_URL`);
    const driftBefore = bindingChanges(before, captureBinding(root));
    console.log(`Running ${suite.config} (${suite.specs.length} specs; ${suite.environment}: ${baseURL})`);
    const start = Date.now(), child = execute(suite, { ...process.env, APP_URL: baseURL });
    const log = `test-results/all-suites/${suite.config}.log`;
    writeFileSync(resolve(root, log), (child.stdout || '') + (child.stderr || '') + (child.error ? String(child.error) : ''));
    after = captureBinding(root);
    const drift = [...new Set([...driftBefore, ...bindingChanges(before, after)])].sort();
    driftDetected ||= drift.length > 0;
    const entry = { config: suite.config, environment: suite.environment, baseURL, exitCode: child.status ?? 1, elapsedMs: Date.now() - start, log, drift };
    results.push(entry);
    persist();
    console.log(`${entry.exitCode === 0 && !drift.length ? 'PASS' : 'FAIL'} ${suite.config} (${Math.round(entry.elapsedMs / 1000)}s); ${log}${drift.length ? `; source drift: ${drift.join(', ')}` : ''}`);
  }
  return { results, before, after, driftDetected, passed: !driftDetected && results.every(result => result.exitCode === 0) };
}

async function main() {
  const root = process.cwd(), args = parseArguments(process.argv.slice(2));
  const targets = browserTargets({ APP_URL: process.env.APP_URL, CHAT_PRODUCTION_APP_URL: process.env.CHAT_PRODUCTION_APP_URL },
    !args.list && (!args.configs.length || args.configs.includes(SECURITY_CONFIG)));
  const discovered = await inventory(root);
  const unknown = args.configs.filter(config => !discovered.suites.some(suite => suite.config === config));
  if (unknown.length) throw new Error(`Unknown browser config: ${unknown.join(', ')}`);
  const suites = args.configs.length ? discovered.suites.filter(suite => args.configs.includes(suite.config)) : discovered.suites;
  if (args.list) { console.log(JSON.stringify({ targets, suites, specCount: discovered.specs.length }, null, 2)); return; }
  process.exitCode = runSuites(root, suites, targets).passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
