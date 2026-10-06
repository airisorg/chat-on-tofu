import { expect, test, type Locator, type Page } from '@playwright/test';

// Run against a server started by the parent task. These checks use only the
// explicitly selected local demo. Mobile tests resize a browser viewport;
// they do not establish physical iPhone, keyboard, or Home Screen behavior.
const baseURL = process.env.APP_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3001';
test.setTimeout(60_000);
test.use({ baseURL, viewport: { width: 1440, height: 1000 }, actionTimeout: 10_000 });

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Chat navigation' });
const mobileNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation', includeHidden: true });
const main = (page: Page) => page.getByRole('main');
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });

async function startDemo(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await expect(mobileNav(page)).toBeAttached();
}

async function reloadDemo(page: Page) {
  await page.reload();
  // The explicit demo choice may be remembered on this device. Either path
  // checks demo persistence and does not assert Google authentication.
  const explore = page.getByRole('button', { name: 'Explore demo', exact: true });
  await expect.poll(async () => await mobileNav(page).count() > 0 || await explore.isVisible()).toBeTruthy();
  if (await explore.isVisible()) await explore.click();
  await expect(mobileNav(page)).toBeAttached();
}

async function openDesign(page: Page, mobile = false) {
  if (mobile) {
    await mobileNav(page).getByRole('button', { name: 'Home', exact: true }).click();
    await main(page).getByRole('button', { name: /Design team/ }).first().click();
  } else {
    await sidebar(page).getByRole('button', { name: /^Design team/ }).click();
  }
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
}

async function sendMessage(page: Page, text: string) {
  await main(page).getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await main(page).getByRole('button', { name: 'Send message', exact: true }).click();
  const row = main(page).getByRole('article').filter({ hasText: text });
  await expect(row).toBeVisible();
  return row;
}

async function messageActions(row: Locator) {
  await row.hover();
  await row.getByRole('button', { name: 'More actions', exact: true }).click();
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test('welcome presents Google sign-in and explicitly starts the demo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^Welcome to Chat\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await expect(page.getByText('DEMO WORKSPACE', { exact: true })).toBeVisible();
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('desktop navigation and message search open the matching conversation', async ({ page }) => {
  await startDemo(page);
  await sidebar(page).getByRole('button', { name: /^Home(?:\s*\d+)?$/ }).click();
  await expect(main(page).getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await sidebar(page).locator('.sidebar-group-heading').getByRole('button', { name: 'Direct messages', exact: true }).click();
  await expect(main(page).getByRole('heading', { name: 'Direct messages', exact: true })).toBeVisible();
  await expect(main(page).getByRole('button', { name: /Maya Chen/ }).first()).toBeVisible();
  await sidebar(page).locator('.sidebar-group-heading').getByRole('button', { name: 'Spaces', exact: true }).click();
  await expect(main(page).getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
  await openDesign(page);
  const text = 'Searchable acceptance note for the design review';
  await sendMessage(page, text);
  await page.getByRole('textbox', { name: 'Search in chat', exact: true }).fill('Searchable acceptance note');
  await expect(main(page).getByRole('heading', { name: 'Search results', exact: true })).toBeVisible();
  await main(page).getByRole('button').filter({ hasText: text }).click();
  await expect(main(page).getByRole('article').filter({ hasText: text })).toBeVisible();
});

test('reports five local demo send-to-render latency samples', async ({ page }, testInfo) => {
  await startDemo(page);
  await openDesign(page);
  const milliseconds: number[] = [];
  for (let index = 0; index < 5; index++) {
    const text = `Local latency sample ${index + 1}`;
    await main(page).getByRole('textbox', { name: 'Message', exact: true }).fill(text);
    const started = Date.now();
    await main(page).getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(main(page).getByRole('article').filter({ hasText: text })).toBeVisible();
    milliseconds.push(Date.now() - started);
  }
  const sorted = [...milliseconds].sort((a, b) => a - b);
  const baseline = {
    environment: 'localhost development, explicitly selected demo',
    measurement: 'Playwright wall clock from Send click to visible rendered message; includes automation overhead',
    samplesMilliseconds: milliseconds,
    minimumMilliseconds: sorted[0], medianMilliseconds: sorted[2], maximumMilliseconds: sorted[4],
    limitation: 'Local demo render baseline only; does not measure backend acknowledgement, production latency, load capacity or physical-device performance.',
  };
  await testInfo.attach('local-demo-send-latency.json', { body: JSON.stringify(baseline, null, 2), contentType: 'application/json' });
  console.info('Local demo send-to-render baseline:', JSON.stringify(baseline));
});

test('sent message edits and deletion persist after reloading the demo', async ({ page }) => {
  await startDemo(page);
  await openDesign(page);
  const original = 'Acceptance message to edit';
  const edited = 'Acceptance message after editing';
  let row = await sendMessage(page, original);
  await messageActions(row);
  await dialog(page, 'Message actions').getByRole('button', { name: 'Edit message', exact: true }).click();
  await dialog(page, 'Edit message').getByRole('textbox', { name: 'Message', exact: true }).fill(edited);
  await dialog(page, 'Edit message').getByRole('button', { name: 'Save', exact: true }).click();
  row = main(page).getByRole('article').filter({ hasText: edited });
  await expect(row.getByText('Edited', { exact: true })).toBeVisible();
  await reloadDemo(page);
  await openDesign(page);
  row = main(page).getByRole('article').filter({ hasText: edited });
  await expect(row).toBeVisible();
  await messageActions(row);
  await dialog(page, 'Message actions').getByRole('button', { name: 'Delete message', exact: true }).click();
  await dialog(page, 'Delete this message?').getByRole('button', { name: 'Delete message', exact: true }).click();
  await expect(main(page).getByText(edited, { exact: true })).toHaveCount(0);
  await expect(main(page).getByText('This message was deleted', { exact: true })).toBeVisible();
  await reloadDemo(page);
  await openDesign(page);
  await expect(main(page).getByText(edited, { exact: true })).toHaveCount(0);
  await expect(main(page).getByText('This message was deleted', { exact: true })).toBeVisible();
});

test('reactions, thread replies and starred messages survive reload', async ({ page }) => {
  await startDemo(page);
  await openDesign(page);
  const text = 'Acceptance anchor for a reaction and thread';
  const reply = 'Acceptance thread reply stays in its thread';
  const row = await sendMessage(page, text);
  await row.hover();
  await row.getByRole('button', { name: 'Add reaction', exact: true }).click();
  await dialog(page, 'Add a reaction').getByRole('button', { name: 'React 🎉', exact: true }).click();
  await expect(row.getByRole('button', { name: /🎉, 1 reaction/ })).toBeVisible();
  await row.hover();
  await row.getByRole('button', { name: 'Star message', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Unstar message', exact: true })).toBeAttached();
  await row.hover();
  await row.getByRole('button', { name: 'Reply in thread', exact: true }).click();
  const thread = page.getByRole('complementary').filter({ has: page.getByRole('heading', { name: 'Thread', exact: true }) });
  await thread.getByRole('textbox', { name: 'Reply in thread', exact: true }).fill(reply);
  await thread.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(thread.getByRole('article').filter({ hasText: reply })).toBeVisible();
  await page.getByRole('button', { name: 'Close thread', exact: true }).click();
  await reloadDemo(page);
  await openDesign(page);
  const saved = main(page).getByRole('article').filter({ hasText: text });
  await expect(saved.getByRole('button', { name: /🎉, 1 reaction/ })).toBeVisible();
  await saved.hover();
  await saved.getByRole('button', { name: 'Reply in thread', exact: true }).click();
  await expect(thread.getByRole('article').filter({ hasText: reply })).toBeVisible();
  await page.getByRole('button', { name: 'Close thread', exact: true }).click();
  await sidebar(page).getByRole('button', { name: 'Starred', exact: true }).click();
  await expect(main(page).getByRole('heading', { name: 'Starred', exact: true })).toBeVisible();
  await expect(main(page).getByRole('button').filter({ hasText: text })).toBeVisible();
});

test('create a space and a DM, edit profile, and open installation help', async ({ page }) => {
  await startDemo(page);
  await sidebar(page).getByRole('button', { name: 'New space', exact: true }).click();
  const create = dialog(page, 'Start a conversation');
  await create.getByRole('textbox', { name: 'Space name', exact: true }).fill('Acceptance space');
  await create.getByRole('textbox', { name: /^Add people by email/ }).fill('maya@example.com');
  await create.getByRole('textbox', { name: /Description/ }).fill('A real editable demo space');
  await create.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(main(page).getByRole('heading', { name: 'Acceptance space', exact: true })).toBeVisible();
  await sidebar(page).getByRole('button', { name: 'New direct message', exact: true }).click();
  await create.getByRole('textbox', { name: /^Conversation name/ }).fill('Acceptance DM');
  await create.getByRole('textbox', { name: /^Their email/ }).fill('jordan@example.com');
  await create.getByRole('button', { name: 'Start chat', exact: true }).click();
  await expect(main(page).getByRole('heading', { name: 'Acceptance DM', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your profile', exact: true }).first().click();
  await dialog(page, 'Your profile').getByRole('textbox', { name: 'Display name', exact: true }).fill('Acceptance Person');
  await dialog(page, 'Your profile').getByRole('textbox', { name: 'Status', exact: true }).fill('Reviewing the new chat');
  await dialog(page, 'Your profile').getByRole('button', { name: 'Save', exact: true }).click();
  await reloadDemo(page);
  await page.getByRole('button', { name: 'Your profile', exact: true }).first().click();
  await expect(dialog(page, 'Your profile').getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('Acceptance Person');
  await expect(dialog(page, 'Your profile').getByRole('textbox', { name: 'Status', exact: true })).toHaveValue('Reviewing the new chat');
  await dialog(page, 'Your profile').getByRole('button', { name: 'Close dialog', exact: true }).click();
  await sidebar(page).getByRole('button', { name: /^Acceptance space/ }).click();
  await expect(main(page).getByRole('heading', { name: 'Acceptance space', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Help and installation', exact: true }).click();
  await expect(dialog(page, 'Make yourself at home').getByText('Chrome', { exact: true })).toBeVisible();
  await expect(dialog(page, 'Make yourself at home').getByText('Install app', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('recorded voice note previews, sends, plays and survives reload', async ({ page, context }) => {
  // The parent config supplies fake microphone devices; this does not use the
  // user's real microphone or prove physical-device audio behavior.
  await context.grantPermissions(['microphone'], { origin: new URL(baseURL).origin });
  await startDemo(page);
  await openDesign(page);
  const text = 'Acceptance voice note with a playable recording';
  await main(page).getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await main(page).getByRole('button', { name: 'Record voice note', exact: true }).click();
  const recording = dialog(page, 'Record a voice note');
  await recording.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(recording.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await expect(recording.getByText(/^00:0[1-9]$/)).toBeVisible();
  await recording.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(recording.locator('audio[aria-label="Voice message preview"]')).toBeVisible();
  await recording.getByRole('button', { name: 'Use recording', exact: true }).click();
  await expect(recording).toHaveCount(0);
  await expect(main(page).locator('audio[aria-label="Voice note preview"]')).toBeVisible();
  await main(page).getByRole('button', { name: 'Send message', exact: true }).click();
  const row = main(page).getByRole('article').filter({ hasText: text });
  await expect(row.getByRole('link', { name: /Voice message\.(m4a|webm|ogg)/ })).toBeVisible();
  const audio = row.locator('audio');
  await audio.evaluate(async element => { await (element as HTMLAudioElement).play(); });
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
  await audio.evaluate(element => (element as HTMLAudioElement).pause());
  await reloadDemo(page);
  await openDesign(page);
  const saved = main(page).getByRole('article').filter({ hasText: text });
  await expect(saved.getByRole('link', { name: /Voice message\.(m4a|webm|ogg)/ })).toBeVisible();
  await expect(saved.locator('audio')).toHaveAttribute('src', /^data:audio\//);
});

test('leaving the demo clears unsent text and attachment drafts', async ({ page }) => {
  await startDemo(page);
  await openDesign(page);
  await main(page).getByRole('textbox', { name: 'Message', exact: true }).fill('Private unsent draft to clear on signout');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'private-draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Private unsent demo attachment.'),
  });
  await expect(main(page).getByRole('button', { name: 'Remove private-draft.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your profile', exact: true }).first().click();
  await dialog(page, 'Your profile').getByRole('button', { name: 'Leave demo', exact: true }).click();
  const explore = page.getByRole('button', { name: 'Explore demo', exact: true });
  await expect(explore).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('relay-drafts:')).length)).toBe(0);
  await explore.click();
  await openDesign(page);
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Remove private-draft.txt', exact: true })).toHaveCount(0);
});

test.describe('phone viewport 390 × 844 (browser emulation)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('home list, conversation back, bottom tabs and More are usable', async ({ page }) => {
    await startDemo(page);
    await expect(main(page).getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    await expect(mobileNav(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await openDesign(page, true);
    await expect(main(page).getByRole('heading', { name: 'Design team', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
    await expect(main(page).getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    await mobileNav(page).getByRole('button', { name: 'Direct messages', exact: true }).click();
    await expect(main(page).getByRole('heading', { name: 'Direct messages', exact: true })).toBeVisible();
    await mobileNav(page).getByRole('button', { name: 'Sections', exact: true }).click();
    await expect(main(page).getByRole('heading', { name: 'Sections', exact: true })).toBeVisible();
    await mobileNav(page).getByRole('button', { name: 'More', exact: true }).click();
    await dialog(page, 'More in Chat').getByRole('button', { name: 'Mentions', exact: true }).click();
    await expect(main(page).getByRole('heading', { name: 'Mentions', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('conversation drafts survive returning to the list and reloading', async ({ page }) => {
    await startDemo(page);
    await openDesign(page, true);
    const draft = 'Unsent phone draft should survive navigation';
    await main(page).getByRole('textbox', { name: 'Message', exact: true }).fill(draft);
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'unsent-phone-draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Unsent phone attachment draft.'),
    });
    await expect(main(page).getByRole('button', { name: 'Remove unsent-phone-draft.txt', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
    await main(page).getByRole('button', { name: /Maya Chen/ }).first().click();
    await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Remove unsent-phone-draft.txt', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
    await main(page).getByRole('button', { name: /Design team/ }).first().click();
    await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(draft);
    await expect(main(page).getByRole('button', { name: 'Remove unsent-phone-draft.txt', exact: true })).toBeVisible();
    await reloadDemo(page);
    await openDesign(page, true);
    await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(draft);
    await expect(main(page).getByRole('button', { name: 'Remove unsent-phone-draft.txt', exact: true })).toBeVisible();
  });

  test('focused composer fits a shortened viewport and sends a phone message', async ({ page }) => {
    await startDemo(page);
    await openDesign(page, true);
    const input = main(page).getByRole('textbox', { name: 'Message', exact: true });
    await input.fill('Phone message after a simulated viewport resize');
    await input.focus();
    // A viewport resize exercises layout handling; it is not an iOS keyboard.
    await page.setViewportSize({ width: 390, height: 460 });
    await expect(input).toBeVisible();
    const send = main(page).getByRole('button', { name: 'Send message', exact: true });
    await expect(send).toBeVisible();
    await expect.poll(async () => {
      const box = await send.boundingBox();
      return box ? box.y + box.height : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(461);
    await expectNoHorizontalOverflow(page);
    await send.click();
    await expect(main(page).getByRole('article').filter({ hasText: 'Phone message after a simulated viewport resize' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
  });

  test('phone attachment is sent, downloadable and present after reload', async ({ page }) => {
    await startDemo(page);
    await openDesign(page, true);
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'phone-note.txt', mimeType: 'text/plain', buffer: Buffer.from('A small phone attachment for acceptance testing.'),
    });
    await expect(page.getByRole('button', { name: 'Remove phone-note.txt', exact: true })).toBeVisible();
    await main(page).getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(main(page).getByRole('link', { name: /phone-note\.txt/ })).toBeVisible();
    await reloadDemo(page);
    await openDesign(page, true);
    const attachment = main(page).getByRole('link', { name: /phone-note\.txt/ });
    await expect(attachment).toBeVisible();
    await expect(attachment).toHaveAttribute('download', 'phone-note.txt');
    await expectNoHorizontalOverflow(page);
  });
});
