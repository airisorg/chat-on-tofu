import { test, expect } from './coverage-test';

test('production document hydrates with unique request nonces and blocks a parser-injected script', async ({
  page,
}) => {
  const response = await page.goto('/');
  const headers = response!.headers();
  const policy = headers['content-security-policy'];
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain('unsafe-eval');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['permissions-policy']).toContain('microphone=(self)');
  await expect(page.getByRole('heading', { name: /^Welcome to Chat\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore demo', exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(await page.evaluate(() => document.fonts.check('16px "Google Sans"'))).toBe(true);
  const nonce = policy.match(/'nonce-([^']+)'/)![1];
  const scripts = await page
    .locator('script')
    .evaluateAll((elements) => elements.map((element) => (element as HTMLScriptElement).nonce));
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((value) => value === nonce)).toBe(true);
  // Simulate untrusted HTML reaching the response. addScriptTag is unsuitable:
  // strict-dynamic deliberately trusts descendants created by running scripts.
  await page.route(page.url(), async (route) => {
    const original = await route.fetch();
    const html = await original.text();
    await route.fulfill({
      response: original,
      body: html.replace(
        '</body>',
        '<script data-security-probe>window.chatInjectedSecurityProbe = true;</script></body>',
      ),
    });
  });
  const next = await page.reload();
  expect(next!.headers()['content-security-policy'].match(/'nonce-([^']+)'/)![1]).not.toBe(nonce);
  await expect(page.locator('script[data-security-probe]')).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { chatInjectedSecurityProbe?: boolean }).chatInjectedSecurityProbe,
    ),
  ).toBeUndefined();
  await expect(page.getByRole('heading', { name: /^Welcome to Chat\./ })).toBeVisible();
});

test('private routes reject unauthenticated requests without returning stored data', async ({
  request,
}) => {
  for (const path of [
    '/api/chat',
    '/api/attachments?messageId=11111111-1111-4111-8111-111111111111&index=0',
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = await response.json();
    expect(body).not.toHaveProperty('state');
    expect(body).not.toHaveProperty('supabaseAnonKey');
  }
  const blocked = await request.post('/api/chat', {
    headers: { Origin: 'https://untrusted.example' },
    data: { type: 'profile', name: 'injected' },
  });
  expect(blocked.status()).toBe(403);
});
