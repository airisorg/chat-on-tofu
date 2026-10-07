import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

// Local composed-state regressions. This is not a Google pixel oracle, hosted
// persistence test, physical keyboard test or source-wide parity certification.
const emojis = ['👍', '😂', '🙏', '❤️', '🎉', '🚀', '👀', '✅'];
const target = (page: Page) => page.getByRole('main').locator('#message-composed-own');
const peer = (page: Page) => page.getByRole('main').locator('#message-composed-peer');
const editedBody = 'Edited together with a star, eight reactions and three files.\n' + 'LongText'.repeat(50);

async function openFixture(page: Page, theme: 'light' | 'dark') {
  const state = createDemoState();
  const conversation = state.conversations.find(c => c.id === 'demo-maya-dm')!;
  const other = { ...conversation.members[1], name: 'W'.repeat(80) };
  // A profile accepts80 characters. An unbroken name is legal even if rare.
  conversation.members[1] = other;
  const audio = readFileSync(resolve(process.cwd(), 'tests/fixtures/picker-tone.m4a'));
  const image = await sharp({ create: { width: 240, height: 120, channels: 4, background: '#c2e7ff' } }).png().toBuffer();
  state.messages = state.messages.filter(m => m.conversationId !== conversation.id);
  state.messages.push(
    { id: 'composed-peer', conversationId: conversation.id, author: other, text: 'A reply from a person with a legal long display name.', createdAt: '2026-10-06T12:01:00Z', reactions: [], attachments: [], edited: true, starred: true },
    { id: 'composed-own', conversationId: conversation.id, author: state.user, text: 'Original composed message', createdAt: '2026-10-06T12:02:00Z', reactions: emojis.map(emoji => ({ emoji, userIds: [other.id] })), attachments: [
      { name: 'composed-image.png', type: 'image/png', size: image.length, url: 'data:image/png;base64,' + image.toString('base64') },
      { name: 'W'.repeat(116) + '.txt', type: 'text/plain', size: 2, url: 'data:text/plain;base64,aGk=' },
      { name: 'composed-voice.m4a', type: 'audio/mp4', size: audio.length, url: 'data:audio/mp4;base64,' + audio.toString('base64') },
    ] },
  );
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(({ key, state }) => {
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('relay-theme', 'system');
  }, { key: DEMO_STORAGE_KEY, state });
  await page.route('**/api/config', route => route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  if (page.viewportSize()!.width < 800) await page.getByRole('main').getByRole('button', { name: /^(?:W )?Maya Chen / }).first().click();
  else await page.getByRole('complementary', { name: 'Chat navigation' }).getByRole('button', { name: 'Maya Chen', exact: true }).click();
  await expect(page.getByRole('main').getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
}

async function more(page: Page) {
  await target(page).hover();
  await target(page).getByRole('button', { name: 'More actions', exact: true }).click();
  return page.getByRole('dialog', { name: 'Message actions', exact: true });
}

async function metrics(row: Locator) {
  return row.evaluate(element => {
    const box = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const meta = element.querySelector('.message-meta')!;
    const nodes = [element, meta, ...meta.children, element.querySelector('.message-text')!, element.querySelector('.reaction-list'), element.querySelector('.message-actions'),
      ...element.querySelectorAll('.reaction, .reaction > span, .message-attachments > div, .message-attachments a, .message-attachments img, .message-attachments audio')].filter(Boolean) as Element[];
    const matchedRules = (node: Element) => {
      const found: { selector: string; declaration: string; condition: string[]; href: string | null }[] = [];
      const walk = (rules: CSSRuleList, conditions: string[], href: string | null) => {
        for (const rule of [...rules]) {
          if (rule instanceof CSSMediaRule && !matchMedia(rule.conditionText).matches) continue;
          if (rule instanceof CSSStyleRule) {
            try { if (node.matches(rule.selectorText)) found.push({ selector: rule.selectorText, declaration: rule.style.cssText, condition: conditions, href }); } catch {}
          } else if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules, [...conditions, rule instanceof CSSMediaRule ? rule.conditionText : rule.cssText.split('{')[0]], href);
        }
      };
      for (const sheet of [...document.styleSheets]) { try { walk(sheet.cssRules, [], sheet.href); } catch {} }
      return found;
    };
    const computed = (node: Element) => { const style = getComputedStyle(node); return Object.fromEntries(['display', 'font-family', 'font-size', 'line-height', 'color', 'background-color', 'width', 'max-width', 'min-width', 'height', 'min-height', 'gap', 'padding', 'margin', 'flex', 'flex-wrap', 'overflow-wrap', 'white-space', 'opacity', 'pointer-events'].map(name => [name, style.getPropertyValue(name)])); };
    return { row: box(element), meta: box(meta), metadata: [...meta.children].filter(node => !node.classList.contains('dm-own-author')).map(node => ({ ...box(node), tag: node.tagName, class: node.getAttribute('class'), text: node.textContent })),
      body: box(element.querySelector('.message-body')!), bodyClientWidth: element.querySelector('.message-body')!.clientWidth, bodyScrollWidth: element.querySelector('.message-body')!.scrollWidth,
      text: box(element.querySelector('.message-text')!), more: box(element.querySelector('button[aria-label="More actions"]')!),
      reactions: [...element.querySelectorAll('.reaction')].map(node => ({ ...box(node), text: node.textContent })),
      media: [...element.querySelectorAll('.message-attachments > div')].map(node => ({ ...box(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })),
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, viewport: { width: innerWidth, height: innerHeight },
      cascade: nodes.map(node => ({ tag: node.tagName, class: node.getAttribute('class'), computed: computed(node), matchedRules: matchedRules(node) })) };
  });
}

async function capture(page: Page, info: TestInfo, label: string) {
  const dir = evidenceDirectory(info, info.project.name); mkdirSync(dir, { recursive: true });
  const prefix = `${page.viewportSize()!.width}-${await page.locator('html').getAttribute('data-theme')}-${label}`;
  const dialog=page.getByRole('dialog');
  const menu=await dialog.count()===1 ? await dialog.evaluate(element=>{const r=element.getBoundingClientRect(),style=getComputedStyle(element);return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,padding:style.padding,radius:style.borderRadius,items:[...element.querySelectorAll('.menu-list > button')].map(node=>{const b=node.getBoundingClientRect();return {label:node.textContent,x:b.x,y:b.y,width:b.width,height:b.height};})};}):null;
  writeFileSync(resolve(dir, prefix + '.json'), JSON.stringify({ own: await metrics(target(page)), peer: await metrics(peer(page)), menu }, null, 2) + '\n');
  await page.screenshot({ path: resolve(dir, prefix + '.png') });
}

function overlaps(a: { x: number; y: number; right: number; bottom: number }, b: typeof a) {
  return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
}

async function actualHit(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const hit = await control.evaluate(node => { const r = node.getBoundingClientRect(), other = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { hit: node.contains(other), label: node.getAttribute('aria-label') || node.textContent, target: { x:r.x,y:r.y,width:r.width,height:r.height }, other: other?.outerHTML.slice(0,600) }; });
  expect(hit.hit, JSON.stringify(hit)).toBe(true);
}

async function readableText(text: Locator) {
  const ratio = await text.evaluate(node => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0,3).map(Number);
    const luminance = (color: number[]) => { const [r,g,b] = color.map(value => { const c=value/255; return c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4; }); return .2126*r+.7152*g+.0722*b; };
    let parent: Element|null=node, background='';
    while(parent) { background=getComputedStyle(parent).backgroundColor; if(!/rgba\(.*?,\s*0\)$/.test(background)&&background!=='transparent')break; parent=parent.parentElement; }
    const fg=luminance(rgb(getComputedStyle(node).color)),bg=luminance(rgb(background));
    return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
  });
  expect(ratio, await text.getAttribute('class') || await text.textContent() || 'text contrast').toBeGreaterThanOrEqual(4.5);
}

for (const width of [390, 1440]) for (const theme of ['light', 'dark'] as const) test.describe(`${width}px ${theme}`, () => {
  test.use({ viewport: { width, height: width < 800 ? 844 : 960 }, hasTouch: width < 800, isMobile: width < 800 });
  test('edited, starred, reaction-rich media DM remains bounded and actionable', async ({ page }, info) => {
    await openFixture(page, theme);
    await expect(target(page)).toHaveCount(1); await expect(peer(page)).toHaveCount(1);
    await (await more(page)).getByRole('button', { name: 'Edit message', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit message', exact: true }).getByRole('textbox', { name: 'Message', exact: true }).fill(editedBody);
    await page.getByRole('dialog', { name: 'Edit message', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(target(page).locator('.message-text')).toHaveText(editedBody);
    await (await more(page)).getByRole('button', { name: 'Star message', exact: true }).click();
    await expect(target(page).locator('.message-meta > .edited')).toHaveCount(1);
    await expect(target(page).locator('.message-meta > .star-fill')).toHaveCount(1);
    await expect(target(page).locator('.reaction')).toHaveCount(emojis.length);
    await expect(target(page).locator('.message-attachments > div')).toHaveCount(3);
    await peer(page).scrollIntoViewIfNeeded();
    await capture(page, info, 'composed');
    const incoming = await metrics(peer(page));
    // The44px More target intentionally projects5px beyond the row but stays
    // inside the pane. The text-bearing body itself must never overflow.
    expect(incoming.bodyScrollWidth, 'legal long metadata must not create horizontal overflow').toBeLessThanOrEqual(incoming.bodyClientWidth + 1);
    expect(incoming.more.right).toBeLessThanOrEqual(width);
    for (const child of incoming.metadata) {
      expect(child.x, 'metadata starts within its body').toBeGreaterThanOrEqual(incoming.body.x - 1);
      expect(child.right, 'metadata ends within its body').toBeLessThanOrEqual(incoming.body.right + 1);
    }
    for(const label of await peer(page).locator('.message-meta strong, .message-meta time, .edited').all()) await readableText(label);
    if(width>=800) {
      // The first loaded row has intro/date space above it. Exercise the real
      // top-of-history position, rather than screenshot auto-scrolling a bar.
      await page.getByRole('main').locator('.messages-scroll').evaluate(node=>{node.scrollTop=0;});
      await peer(page).hover();
      const toolbar=(await peer(page).locator('.message-actions').boundingBox())!,history=(await page.getByRole('main').locator('.messages-scroll').boundingBox())!;
      expect(toolbar.y).toBeGreaterThanOrEqual(history.y);
      expect(toolbar.x).toBeGreaterThanOrEqual(history.x); expect(toolbar.x+toolbar.width).toBeLessThanOrEqual(history.x+history.width);
      await actualHit(peer(page).getByRole('button',{name:'More actions',exact:true}));
    }
    await target(page).getByRole('button', { name: 'More actions', exact: true }).scrollIntoViewIfNeeded();
    const own = await metrics(target(page));
    expect(own.bodyScrollWidth).toBeLessThanOrEqual(own.bodyClientWidth + 1);
    expect(own.more.right).toBeLessThanOrEqual(width);
    for (const child of own.metadata) expect(overlaps(own.more, child), 'More must not cover timestamp, Edited or star').toBe(false);
    if (width < 800) {
      expect(own.more.width).toBeGreaterThanOrEqual(44); expect(own.more.height).toBeGreaterThanOrEqual(44);
      expect(overlaps(own.more, own.text)).toBe(false);
    }
    for (const reaction of own.reactions) {
      expect(reaction.x).toBeGreaterThanOrEqual(own.body.x - 1); expect(reaction.right).toBeLessThanOrEqual(own.body.right + 1);
      if (width < 800) expect(reaction.height).toBeGreaterThanOrEqual(44);
    }
    for (const media of own.media) { expect(media.x).toBeGreaterThanOrEqual(own.body.x - 1); expect(media.right).toBeLessThanOrEqual(own.body.right + 1); expect(media.scrollWidth).toBeLessThanOrEqual(media.clientWidth + 1); }
    for(const label of await target(page).locator('.message-meta time, .edited, .reaction > span, .message-text').all()) await readableText(label);
    await target(page).getByRole('button', { name: '👍, 1 reaction. Toggle your reaction.', exact: true }).click();
    await expect(target(page).getByRole('button', { name: '👍, 2 reactions. Toggle your reaction.', exact: true })).toBeVisible();
    await readableText(target(page).getByRole('button', { name: '👍, 2 reactions. Toggle your reaction.', exact: true }).locator('span'));
    if(width<800) {
      const rocket=target(page).getByRole('button',{name:'🚀, 1 reaction. Toggle your reaction.',exact:true});
      await rocket.scrollIntoViewIfNeeded();
      const toast=page.locator('.toast'); await expect(toast).toBeVisible();
      const toastBounds=(await toast.boundingBox())!,reactionBounds=(await rocket.boundingBox())!;
      // Preserve the reproduced overlap rather than merely testing a hit when
      // the floating notification has gone. Its decorative body passes taps.
      expect(overlaps({ ...toastBounds,right:toastBounds.x+toastBounds.width,bottom:toastBounds.y+toastBounds.height },{ ...reactionBounds,right:reactionBounds.x+reactionBounds.width,bottom:reactionBounds.y+reactionBounds.height })).toBe(true);
      await actualHit(rocket);
      await rocket.click();
      await expect(target(page).getByRole('button',{name:'🚀, 2 reactions. Toggle your reaction.',exact:true})).toBeVisible();
      await expect(toast).toBeVisible();
      await actualHit(toast.getByRole('button',{name:'Dismiss notification',exact:true}));
      await toast.getByRole('button',{name:'Dismiss notification',exact:true}).click();
      await expect(toast).toHaveCount(0);
    }
    for (const emoji of emojis) await actualHit(target(page).getByRole('button', { name: `${emoji}, ${emoji === '👍' || (emoji==='🚀'&&width<800) ? '2 reactions' : '1 reaction'}. Toggle your reaction.`, exact: true }));
    await expect(target(page).locator('img')).toHaveJSProperty('naturalWidth', 240);
    await actualHit(target(page).getByRole('button', { name: 'Play voice message', exact: true }));
    await target(page).getByRole('button', { name: 'Play voice message', exact: true }).click();
    await expect.poll(() => target(page).locator('audio').evaluate(node => (node as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
    await expect(target(page).locator('audio')).toHaveJSProperty('error', null);
    await capture(page, info, 'media');
    await target(page).getByRole('link', { name: 'Preview composed-image.png', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Image preview', exact: true }).locator('img')).toHaveJSProperty('naturalWidth', 240);
    await page.getByRole('dialog', { name: 'Image preview', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(target(page).getByRole('link', { name: /W{30}/ })).toHaveAttribute('download', 'W'.repeat(116) + '.txt');
    if (width < 800) { await page.setViewportSize({ width, height: 460 }); await expect.poll(() => page.locator('.app-shell').evaluate(node => Math.round(node.getBoundingClientRect().height))).toBe(460); }
    const menu = await more(page);
    await expect(menu.locator('.menu-list > button')).toHaveCount(6);
    const bounds = await menu.boundingBox(); expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(11); expect(bounds!.y).toBeGreaterThanOrEqual(11);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 11); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 11);
    for (const item of await menu.locator('.menu-list > button').all()) { if (width < 800) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44); await actualHit(item); await readableText(item); }
    await capture(page, info, 'menu');
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
    await expect(target(page).locator('.message-meta > .edited')).toHaveCount(1); await expect(target(page).locator('.message-meta > .star-fill')).toHaveCount(1);
    if(width>=800) {
      await page.getByRole('textbox',{name:'Search in chat',exact:true}).focus();
      await page.getByRole('banner').hover();
      await expect(target(page).locator('.message-actions')).toHaveCSS('opacity','0');
      await expect(target(page).locator('.message-actions')).toHaveCSS('pointer-events','none');
      await expect(peer(page).locator('.message-text')).toHaveText('A reply from a person with a legal long display name.');
      await peer(page).locator('.message-text').scrollIntoViewIfNeeded();
      expect(await peer(page).locator('.message-text').evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    }
  });
});
