import { expect, test, type Page } from './coverage-test';
import { readFileSync } from 'node:fs';
import data from '@emoji-mart/data/sets/15/native.json';

// App-owned UI runs on loopback. Recorder acquisition/callback failures are
// deterministic fakes; native microphone/provider acceptance is out of scope.
const main = (page: Page) => page.getByRole('main');
const composer = (page: Page) => main(page).getByRole('textbox', { name: 'Message', exact: true });
const preferenceKey = 'chat-emoji-preferences:demo-you';
function audioFixture() {
  const rate = 8000,
    count = rate * 6,
    bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++)
    bytes.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 220) / rate) * 6000), 44 + i * 2);
  return bytes;
}
async function demo(page: Page) {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  if (!(await main(page).getByRole('heading', { name: 'Design team', exact: true }).isVisible()))
    await main(page)
      .getByRole('button', { name: /Design team/ })
      .first()
      .click();
  await expect(composer(page)).toBeVisible();
}
async function emoji(page: Page) {
  await main(page).getByRole('button', { name: 'Add emoji', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add emoji', exact: true });
  await expect(picker.getByRole('textbox', { name: 'Search emoji' })).toBeVisible();
  return picker;
}
const voice = (page: Page) =>
  page.getByRole('dialog', { name: 'Record a voice note', exact: true });
async function openVoice(page: Page) {
  await main(page).getByRole('button', { name: 'Record voice note', exact: true }).click();
  await expect(
    voice(page).getByRole('button', { name: 'Start recording', exact: true }),
  ).toBeVisible();
}

test('emoji grid boundaries, category wrap and skin-tone keyboard dismissal preserve focus', async ({
  page,
}) => {
  await demo(page);
  const picker = await emoji(page);
  const nature = picker.getByRole('tab', { name: 'Animals & nature', exact: true });
  await nature.click();
  const grid = picker
    .getByRole('tabpanel', { name: 'Animals & nature', exact: true })
    .getByRole('group', { name: 'Emoji choices', exact: true });
  const buttons = grid.getByRole('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(20);
  const columns = await grid.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
  );
  expect(columns).toBe(9);
  await buttons.first().focus();
  for (const key of ['ArrowLeft', 'ArrowUp']) {
    await page.keyboard.press(key);
    await expect(buttons.first()).toBeFocused();
  }
  await page.keyboard.press('ArrowRight');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(buttons.nth(1 + columns)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(buttons.last()).toBeFocused();
  for (const key of ['ArrowRight', 'ArrowDown']) {
    await page.keyboard.press(key);
    await expect(buttons.last()).toBeFocused();
  }
  await page.keyboard.press('Home');
  await expect(buttons.first()).toBeFocused();
  expect(
    await buttons.evaluateAll((nodes) => nodes.filter((node) => node.tabIndex === 0).length),
  ).toBe(1);
  await nature.focus();
  await nature.press('End');
  const flags = picker.getByRole('tab', { name: 'Flags', exact: true });
  await expect(flags).toBeFocused();
  await expect(flags).toHaveAttribute('aria-selected', 'true');
  await flags.press('ArrowRight');
  const frequent = picker.getByRole('tab', { name: 'Frequently used', exact: true });
  await expect(frequent).toBeFocused();
  await expect(picker.getByText('Emoji you choose will appear here.')).toBeVisible();
  await frequent.press('ArrowLeft');
  await expect(flags).toBeFocused();
  await flags.press('Home');
  await expect(frequent).toBeFocused();
  const trigger = picker.getByRole('button', { name: 'Skin tone', exact: true });
  await trigger.click();
  const tone = (name: string) => picker.getByRole('menuitemradio', { name, exact: true });
  await expect(tone('Default skin tone')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(tone('Dark skin tone')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(tone('Default skin tone')).toBeFocused();
  await page.keyboard.press('End');
  await expect(tone('Dark skin tone')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tone('Default skin tone')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker.getByRole('menu', { name: 'Skin tones', exact: true })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(picker).toBeVisible();
  const search = picker.getByRole('textbox', { name: 'Search emoji' });
  await search.fill('no-such-emoji-in-this-catalog');
  await search.press('ArrowDown');
  await expect(search).toBeFocused();
  await picker.getByRole('button', { name: 'Clear emoji search' }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: 'Add emoji', exact: true })).toBeFocused();
});

for (const failure of ['malformed', 'denied'] as const) {
  test(`emoji ${failure} preferences keep selection usable without false persistence`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ failure, key }) => {
        localStorage.setItem(key, '{not-json');
        const get = Storage.prototype.getItem,
          set = Storage.prototype.setItem;
        const counts = { reads: 0, writes: 0 };
        (window as unknown as { preferencesFailure: typeof counts }).preferencesFailure = counts;
        if (failure === 'denied') {
          Storage.prototype.getItem = function (name) {
            if (name.startsWith('chat-emoji-preferences:')) {
              counts.reads++;
              throw new DOMException('Storage denied', 'SecurityError');
            }
            return get.call(this, name);
          };
          Storage.prototype.setItem = function (name, value) {
            if (name.startsWith('chat-emoji-preferences:')) {
              counts.writes++;
              throw new DOMException('Storage denied', 'SecurityError');
            }
            return set.call(this, name, value);
          };
        }
      },
      { failure, key: preferenceKey },
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await demo(page);
    let picker = await emoji(page);
    await picker.getByRole('tab', { name: 'Frequently used', exact: true }).click();
    await expect(picker.getByText('Emoji you choose will appear here.')).toBeVisible();
    await picker.getByRole('textbox', { name: 'Search emoji' }).fill('light bulb');
    await picker.getByRole('button', { name: 'Insert 💡', exact: true }).click();
    await expect(composer(page)).toHaveValue('💡');
    await expect(composer(page)).toBeFocused();
    picker = await emoji(page);
    await picker.getByRole('tab', { name: 'Frequently used', exact: true }).click();
    if (failure === 'denied') {
      await expect(picker.getByText('Emoji you choose will appear here.')).toBeVisible();
      const counts = await page.evaluate(
        () =>
          (window as unknown as { preferencesFailure: { reads: number; writes: number } })
            .preferencesFailure,
      );
      expect(counts.reads).toBeGreaterThan(0);
      expect(counts.writes).toBe(1);
    } else {
      await expect(picker.getByRole('button', { name: 'Insert 💡', exact: true })).toBeVisible();
      expect(
        await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), preferenceKey),
      ).toMatchObject({ tone: 0, recents: [{ id: 'bulb', tone: 0 }] });
    }
    expect(errors).toEqual([]);
  });
}

test('restored emoji recents are bounded and choosing one again does not duplicate it', async ({
  page,
}) => {
  const ids = (Object.keys(data.emojis) as (keyof typeof data.emojis)[]).slice(0, 30);
  const native = data.emojis[ids[0]].skins[0].native;
  await page.addInitScript(
    ({ key, ids }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ tone: 0, recents: ids.map((id) => ({ id, tone: 0 })) }),
      ),
    { key: preferenceKey, ids },
  );
  await demo(page);
  const picker = await emoji(page);
  await picker.getByRole('tab', { name: 'Frequently used', exact: true }).click();
  const recents = picker
    .getByRole('tabpanel', { name: 'Frequently used', exact: true })
    .locator('[data-emoji-id]');
  await expect(recents).toHaveCount(24);
  await recents.first().click();
  await expect(composer(page)).toHaveValue(native);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!) as { recents: { id: string; tone: number }[] },
    preferenceKey,
  );
  expect(saved.recents).toHaveLength(24);
  expect(saved.recents[0]).toEqual({ id: ids[0], tone: 0 });
  expect(saved.recents.filter((entry) => entry.id === ids[0])).toHaveLength(1);
});

type RecorderMode =
  'unavailable' | 'permission' | 'device' | 'codec' | 'error' | 'read' | 'oversize' | 'empty';
async function recorderFixture(page: Page, mode: RecorderMode) {
  const payload = readFileSync('tests/fixtures/picker-tone.m4a').toString('base64');
  await page.addInitScript(
    ({ mode, payload }) => {
      const controls = {
        acquired: 0,
        stopped: 0,
        reads: 0,
        emitError: () => {},
        emitOversize: () => {},
      };
      (window as unknown as { recordingFailure: typeof controls }).recordingFailure = controls;
      const stream = {
        getTracks: () => [{ stop: () => controls.stopped++ }],
      } as unknown as MediaStream;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            controls.acquired++;
            if (mode === 'permission') throw new DOMException('Denied', 'NotAllowedError');
            if (mode === 'device') throw new DOMException('Unavailable', 'NotFoundError');
            return stream;
          },
        },
      });
      if (mode === 'unavailable') {
        Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: undefined });
        return;
      }
      class Recorder {
        static isTypeSupported(type: string) {
          return mode !== 'codec' && type === 'audio/mp4';
        }
        state = 'inactive';
        mimeType = 'audio/mp4';
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        start() {
          this.state = 'recording';
          controls.emitError = () => {
            this.state = 'inactive';
            this.onerror?.();
          };
          controls.emitOversize = () =>
            this.ondataavailable?.({
              data: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'audio/mp4' }),
            });
        }
        stop() {
          if (this.state !== 'recording') return;
          this.state = 'inactive';
          queueMicrotask(() => {
            if (mode !== 'empty' && mode !== 'oversize')
              this.ondataavailable?.({
                data: new Blob([Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))], {
                  type: 'audio/mp4',
                }),
              });
            this.onstop?.();
          });
        }
      }
      Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: Recorder });
      if (mode === 'read') {
        const original = FileReader.prototype.readAsDataURL;
        FileReader.prototype.readAsDataURL = function (blob) {
          if (blob.type === 'audio/mp4' && controls.reads++ === 0)
            queueMicrotask(() => this.dispatchEvent(new ProgressEvent('error')));
          else original.call(this, blob);
        };
      }
    },
    { mode, payload },
  );
}

for (const mode of ['unavailable', 'permission', 'device', 'codec'] as const) {
  test(`voice ${mode} acquisition failure keeps the draft and microphone retry usable`, async ({
    page,
  }) => {
    await recorderFixture(page, mode);
    await demo(page);
    await composer(page).fill('Keep this unrelated message draft');
    await openVoice(page);
    await voice(page).getByRole('button', { name: 'Start recording', exact: true }).click();
    const copy = {
      unavailable: 'Voice recording is unavailable in this browser.',
      permission: 'Microphone access was denied.',
      device: 'Unable to open the microphone.',
      codec: 'This browser cannot record a supported audio format.',
    }[mode];
    await expect(voice(page).getByRole('alert')).toContainText(copy);
    await expect(
      voice(page).getByRole('button', { name: 'Start recording', exact: true }),
    ).toBeEnabled();
    await expect(
      voice(page).getByRole('button', { name: 'Use recording', exact: true }),
    ).toHaveCount(0);
    await expect(composer(page)).toHaveValue('Keep this unrelated message draft');
    const controls = await page.evaluate(
      () =>
        (window as unknown as { recordingFailure: { acquired: number; stopped: number } })
          .recordingFailure,
    );
    expect(controls.acquired).toBe(mode === 'unavailable' ? 0 : 1);
    expect(controls.stopped).toBe(mode === 'codec' ? 1 : 0);
    await voice(page).getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(main(page).locator('.draft-attachments audio')).toHaveCount(0);
  });
}

for (const mode of ['error', 'read', 'oversize', 'empty'] as const) {
  test(`voice ${mode} callback releases capture without attaching invalid bytes`, async ({
    page,
  }) => {
    await recorderFixture(page, mode);
    await demo(page);
    await openVoice(page);
    await voice(page).getByRole('button', { name: 'Start recording', exact: true }).click();
    await expect(
      voice(page).getByRole('button', { name: 'Stop recording', exact: true }),
    ).toBeVisible();
    if (mode === 'error')
      await page.evaluate(() =>
        (
          window as unknown as { recordingFailure: { emitError: () => void } }
        ).recordingFailure.emitError(),
      );
    else if (mode === 'oversize')
      await page.evaluate(() =>
        (
          window as unknown as { recordingFailure: { emitOversize: () => void } }
        ).recordingFailure.emitOversize(),
      );
    else await voice(page).getByRole('button', { name: 'Stop recording', exact: true }).click();
    await expect(voice(page).getByRole('alert')).toContainText(
      mode === 'error'
        ? 'Recording stopped.'
        : mode === 'read'
          ? 'Unable to save this recording.'
          : '5 MB limit',
    );
    await expect(
      voice(page).getByRole('button', { name: 'Start recording', exact: true }),
    ).toBeEnabled();
    await expect(voice(page).getByLabel('Voice message preview', { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { recordingFailure: { stopped: number } }).recordingFailure.stopped,
      ),
    ).toBeGreaterThan(0);
    if (mode === 'read') {
      await voice(page).getByRole('button', { name: 'Start recording', exact: true }).click();
      await voice(page).getByRole('button', { name: 'Stop recording', exact: true }).click();
      await expect(voice(page).getByLabel('Voice message preview', { exact: true })).toBeVisible();
      await expect(voice(page).getByRole('alert')).toHaveCount(0);
      await voice(page).getByRole('button', { name: 'Record again', exact: true }).click();
      await expect(voice(page).getByLabel('Voice message preview', { exact: true })).toHaveCount(0);
      await expect(
        voice(page).getByRole('button', { name: 'Start recording', exact: true }),
      ).toBeEnabled();
    }
    await voice(page).getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(main(page).locator('.draft-attachments audio')).toHaveCount(0);
  });
}

test('audio play rejection is honest, retry plays actual bytes and speed returns to one', async ({
  page,
}) => {
  await demo(page);
  await main(page).locator('.composer-wrap input[type=file]').setInputFiles({
    name: 'Coverage-tone.wav',
    mimeType: 'audio/wav',
    buffer: audioFixture(),
  });
  await composer(page).fill('Audio rejection and explicit retry');
  await main(page).getByRole('button', { name: 'Send message', exact: true }).click();
  const row = main(page)
    .getByRole('article')
    .filter({ hasText: 'Audio rejection and explicit retry' });
  await expect(row).toHaveCount(1);
  const audio = row.locator('audio');
  await expect
    .poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState))
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => audio.evaluate((node: HTMLAudioElement) => node.duration))
    .toBeCloseTo(6, 1);
  await audio.evaluate((node: HTMLAudioElement) => {
    const original = node.play.bind(node);
    let attempts = 0;
    node.play = () =>
      ++attempts === 1
        ? Promise.reject(new DOMException('Denied once', 'NotAllowedError'))
        : original();
  });
  const player = row.getByRole('group', { name: 'Voice message: Coverage-tone.wav', exact: true });
  await player.getByRole('button', { name: 'Play voice message', exact: true }).click();
  await expect(row.getByRole('alert')).toContainText('Download it to listen');
  await expect(
    player.getByRole('link', { name: 'Download Coverage-tone.wav', exact: true }),
  ).toBeVisible();
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  await player.getByRole('button', { name: 'Play voice message', exact: true }).click();
  await expect
    .poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeGreaterThan(0);
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
  await expect(row.getByRole('alert')).toHaveCount(0);
  await player.getByRole('button', { name: 'Pause voice message', exact: true }).click();
  for (const [before, after] of [
    [1, 1.5],
    [1.5, 2],
    [2, 1],
  ]) {
    await player.getByRole('button', { name: `Playback speed ${before}×`, exact: true }).click();
    expect(await audio.evaluate((node: HTMLAudioElement) => node.playbackRate)).toBe(after);
  }
  const slider = player.getByRole('slider', { name: 'Seek Coverage-tone.wav', exact: true });
  await slider.focus();
  await slider.press('End');
  await expect
    .poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeGreaterThan(0.5);
  await slider.press('Home');
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBe(0);
});

test('installation state changes update the open help and cleanup removes its listener', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    const mode = new EventTarget();
    const controls = {
      installed: false,
      listeners: 0,
      prompts: 0,
      update: () => mode.dispatchEvent(new Event('change')),
    };
    (window as unknown as { installationFixture: typeof controls }).installationFixture = controls;
    Object.assign(mode, {
      media: '(display-mode: standalone)',
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
    });
    Object.defineProperty(mode, 'matches', { get: () => controls.installed });
    const add = mode.addEventListener.bind(mode),
      remove = mode.removeEventListener.bind(mode);
    mode.addEventListener = (type, listener, options) => {
      controls.listeners++;
      add(type, listener, options);
    };
    mode.removeEventListener = (type, listener, options) => {
      controls.listeners--;
      remove(type, listener, options);
    };
    window.matchMedia = (query) =>
      query === '(display-mode: standalone)' ? (mode as MediaQueryList) : original(query);
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
  });
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add to Home Screen', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        (window as unknown as { installationFixture: { prompts: number } }).installationFixture
          .prompts++;
        throw new Error('Synthetic native install rejection');
      },
    });
    window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: 'Add to Home Screen', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Make yourself at home', exact: true });
  await expect(
    help.getByRole('heading', { name: 'Your conversations. One tap away.', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { installationFixture: { listeners: number } }).installationFixture
          .listeners,
    ),
  ).toBe(1);
  await help.getByRole('button', { name: 'Install Chat', exact: true }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    'Installation did not complete.',
  );
  await expect(help.getByRole('button', { name: 'Install Chat', exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { installationFixture: { prompts: number } }).installationFixture
          .prompts,
    ),
  ).toBe(1);
  await page.evaluate(() => {
    const controls = (
      window as unknown as { installationFixture: { installed: boolean; update: () => void } }
    ).installationFixture;
    controls.installed = true;
    controls.update();
    window.dispatchEvent(new Event('appinstalled'));
  });
  await expect(
    help.getByRole('heading', { name: 'You’re using the installed app', exact: true }),
  ).toBeVisible();
  await expect(help.locator('ol')).toHaveCount(0);
  await help.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(help).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { installationFixture: { listeners: number } }).installationFixture
          .listeners,
    ),
  ).toBe(0);
});
