import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export * from '@playwright/test';

// Explicit destruction boundaries (for example, an outbound OAuth click) may
// replace the renderer before pagehide's asynchronous binding reaches Node.
// Capture the current real realm before the test triggers that action. This
// does not stop/replay app handlers or claim their later transient execution.
export async function captureBeforeNavigation(page: Page) {
  if (process.env.CHAT_COLLECT_COVERAGE !== '1') return;
  await page.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      __coverage__?: unknown;
      __chatCoverageSnapshot: (coverage: unknown, phase?: string) => Promise<void>;
    };
    if (scope.__coverage__)
      await scope.__chatCoverageSnapshot(
        JSON.parse(JSON.stringify(scope.__coverage__)),
        'before-destructive-interaction',
      );
  });
}

// Ordinary suites keep the exact original fixture. Coverage is opt-in and has
// no network collector, runtime endpoint, app storage or provider credentials.
export const test =
  process.env.CHAT_COLLECT_COVERAGE !== '1'
    ? base
    : base.extend<{ coverageCapture: void }>({
        coverageCapture: [
          async ({ context, browser }, use, info) => {
            if (!process.env.CHAT_COVERAGE_RUN_ID)
              throw new Error('Browser coverage run ID is required.');
            let captures = 0;
            const output = resolve(
              process.env.CHAT_ISTANBUL_DIR || 'test-results/combined-coverage/raw',
            );
            await mkdir(output, { recursive: true });
            const contexts = new Set<BrowserContext>(),
              pages = new Set<Page>();
            const pending = new Set<Promise<void>>();
            let captureFailure: unknown;
            async function store(coverage: Record<string, unknown> | null, phase: string) {
              if (!coverage || !Object.keys(coverage).length) return;
              captures++;
              const path = resolve(output, `browser-${randomUUID()}.json`);
              const temporary = `${path}.tmp`;
              await writeFile(
                temporary,
                JSON.stringify({
                  layer: 'browser',
                  runId: process.env.CHAT_COVERAGE_RUN_ID,
                  testId: info.testId,
                  retry: info.retry,
                  phase,
                  coverage,
                }),
              );
              await rename(temporary, path);
            }
            async function capture(page: Page, phase: string) {
              if (page.isClosed()) return;
              const coverage = await page.evaluate(() => {
                const values = (globalThis as typeof globalThis & { __coverage__?: unknown })
                  .__coverage__;
                return values
                  ? (JSON.parse(JSON.stringify(values)) as Record<string, unknown>)
                  : null;
              });
              await store(coverage, phase);
            }
            function preparePage(page: Page) {
              if (pages.has(page)) return;
              pages.add(page);
              // Capture before document replacement/close, not after its JS realm is
              // destroyed. This also preserves earlier reload-path executions.
              for (const method of ['goto', 'reload', 'goBack', 'goForward', 'close'] as const) {
                const original = page[method].bind(page);
                Object.assign(page, {
                  [method]: async (...args: unknown[]) => {
                    await capture(page, method);
                    return (original as (...input: unknown[]) => Promise<unknown>)(...args);
                  },
                });
              }
            }
            async function prepareContext(value: BrowserContext) {
              if (contexts.has(value)) return;
              contexts.add(value);
              // Script/link navigations can destroy a realm without invoking a
              // Playwright navigation method. Send the counter snapshot across
              // the exposed binding before pagehide; drain all writes at teardown.
              await value.exposeBinding('__chatCoverageSnapshot', (_source, coverage, phase) => {
                const write = store(
                  coverage as Record<string, unknown> | null,
                  typeof phase === 'string' ? phase : 'pagehide',
                );
                pending.add(write);
                void write.then(
                  () => pending.delete(write),
                  (error) => {
                    captureFailure ||= error;
                    pending.delete(write);
                  },
                );
                return write;
              });
              await value.addInitScript(() => {
                const scope = globalThis as typeof globalThis & {
                  __coverage__?: unknown;
                  __chatCoverageSnapshot: (coverage: unknown) => Promise<void>;
                };
                addEventListener('pagehide', () => {
                  if (scope.__coverage__)
                    void scope.__chatCoverageSnapshot(
                      JSON.parse(JSON.stringify(scope.__coverage__)),
                    );
                });
              });
              value.pages().forEach(preparePage);
              value.on('page', preparePage);
              const original = value.close.bind(value);
              value.close = async (options) => {
                for (const page of value.pages()) await capture(page, 'context-close');
                return original(options);
              };
            }
            const originalNewContext = browser.newContext.bind(browser);
            browser.newContext = async (options) => {
              // The coverage-only functional config intentionally bypasses CSP for
              // its routed synthetic providers; production security uses base.
              const value = await originalNewContext({ ...options, bypassCSP: true });
              await prepareContext(value);
              return value;
            };
            await prepareContext(context);
            let failure: unknown;
            try {
              await use();
            } catch (error) {
              failure = error;
            }
            try {
              for (const value of contexts)
                for (const page of value.pages()) await capture(page, 'test-end');
              await Promise.all(pending);
              if (captureFailure) throw captureFailure;
            } catch (error) {
              failure ||= error;
            } finally {
              browser.newContext = originalNewContext;
            }
            if (failure) throw failure;
            if (!captures) throw new Error(`No browser counters collected for ${info.title}.`);
          },
          { auto: true },
        ],
      });
