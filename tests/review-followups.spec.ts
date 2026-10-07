import { expect, test, type Page } from '@playwright/test';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { MAX_CONVERSATION_MEMBERS } from '../src/lib/chat-limits';

const nav = (page: Page) => page.getByRole('complementary', { name: 'Chat navigation' });
const main = (page: Page) => page.getByRole('main');
async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Design team', exact: true }).click();
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
}

for (const kind of ['group', 'space'] as const) {
  test(`${kind} rejects thirty invitees without creating, then creates with twenty-nine plus its owner`, async ({
    page,
  }) => {
    await demo(page);
    await nav(page).getByRole('button', { name: 'New chat', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Start a conversation' });
    await dialog
      .getByRole('button', {
        name: kind === 'group' ? 'Start a group' : 'Create a space',
        exact: true,
      })
      .click();
    const name = `Review ${kind} boundary`;
    await dialog
      .getByRole('textbox', { name: kind === 'group' ? 'Group name' : 'Space name' })
      .fill(name);
    const emails = Array.from(
      { length: MAX_CONVERSATION_MEMBERS },
      (_, index) => `boundary${index}@example.com`,
    );
    const people = dialog.getByRole('combobox', { name: /^Add people/ });
    await people.fill(emails.join(', '));
    await dialog
      .getByRole('button', { name: kind === 'group' ? 'Start chat' : 'Create space', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'A conversation can have up to 30 people, including you. Add up to 29 others.',
    );
    await expect(dialog).toBeVisible();
    const rejected = await page.evaluate(
      ({ key, name }) =>
        Boolean(
          localStorage.getItem(key) &&
          JSON.parse(localStorage.getItem(key)!).conversations.some(
            (conversation: { name: string }) => conversation.name === name,
          ),
        ),
      { key: DEMO_STORAGE_KEY, name },
    );
    expect(rejected).toBe(false);
    await people.fill(emails.slice(0, -1).join(', '));
    await dialog
      .getByRole('button', { name: kind === 'group' ? 'Start chat' : 'Create space', exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(main(page).getByRole('heading', { name, exact: true })).toBeVisible();
    const created = await page.evaluate(
      ({ key, name }) =>
        JSON.parse(localStorage.getItem(key)!).conversations.find(
          (conversation: { name: string }) => conversation.name === name,
        ),
      { key: DEMO_STORAGE_KEY, name },
    );
    expect(created.members).toHaveLength(MAX_CONVERSATION_MEMBERS);
    expect(
      created.members.filter((member: { email: string }) => member.email.startsWith('boundary')),
    ).toHaveLength(MAX_CONVERSATION_MEMBERS - 1);
  });
}

test('damaged saved drafts recover valid text and media without crashing another conversation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('review-draft-seeded')) return;
    sessionStorage.setItem('review-draft-seeded', 'yes');
    localStorage.setItem(
      'relay-drafts:demo-you',
      JSON.stringify({
        'demo-design': {
          text: 'Recovered thought',
          attachments: [
            null,
            {
              name: 'restored-notes.txt',
              type: 'text/plain',
              size: 5,
              url: 'data:text/plain;base64,aGVsbG8=',
            },
            {
              name: { broken: true },
              type: 'text/plain',
              size: 5,
              url: 'data:text/plain;base64,aGVsbG8=',
            },
          ],
        },
        'demo-maya-dm': { text: 'Maya draft stays separate', attachments: { broken: true } },
        'demo-jordan-dm': {
          text: { broken: true },
          attachments: [
            false,
            'broken',
            {
              name: 'unsafe.svg',
              type: 'image/svg+xml',
              size: 5,
              url: 'data:image/svg+xml;base64,aGVsbG8=',
            },
          ],
        },
      }),
    );
  });
  await demo(page);
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Recovered thought',
  );
  await expect(
    main(page).getByRole('button', { name: 'Remove restored-notes.txt', exact: true }),
  ).toBeVisible();
  await nav(page).getByRole('button', { name: 'Maya Chen', exact: true }).click();
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Maya draft stays separate',
  );
  await expect(main(page).locator('.draft-attachments')).toHaveCount(0);
  await nav(page).getByRole('button', { name: 'Jordan Lee', exact: true }).click();
  const composer = main(page).getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toHaveValue('');
  await expect(main(page).locator('.draft-attachments')).toHaveCount(0);
  await composer.fill('Fresh thought after recovery');
  await page.reload();
  await nav(page).getByRole('button', { name: 'Jordan Lee', exact: true }).click();
  await expect(composer).toHaveValue('Fresh thought after recovery');
  expect(errors).toEqual([]);
});

test('Mentions uses complete names and emails, allowing punctuation but excluding longer identities', async ({
  page,
}) => {
  const state = createDemoState();
  const texts = [
    'Mentiongood @Alex.',
    'Mentiongood @Alex Morgan!',
    'Mentiongood @alex@example.com',
    'Mentiongood @all.',
    'Mentionbad @Alexander',
    'Mentionbad @alloy',
    'Mentionbad @alex@example.com.evil',
    'Mentionbad @alex+other@example.com',
    'Mentionbad user@alex@example.com',
  ];
  state.messages = texts.map((text, index) => ({
    id: `mention-${index}`,
    text,
    conversationId: 'demo-design',
    author: state.conversations[0].members[1],
    createdAt: new Date(Date.now() + index).toISOString(),
    attachments: [],
    reactions: [],
  }));
  await page.addInitScript(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), {
    key: DEMO_STORAGE_KEY,
    state,
  });
  await demo(page);
  await nav(page).getByRole('button', { name: 'Mentions', exact: true }).click();
  const results = main(page).locator('button.search-result');
  await expect(results).toHaveCount(4);
  await expect(results.filter({ hasText: 'Mentionbad' })).toHaveCount(0);
  for (const text of texts.slice(0, 4))
    await expect(results.filter({ hasText: text })).toHaveCount(1);
});
