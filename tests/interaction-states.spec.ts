import { evidenceDirectory } from "./browser-config";
import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Explore demo',exact:true}).click();
});

test('hover, press and keyboard focus preserve geometry and distinguish focus',async({page},info)=>{
  const nav=page.getByRole('complementary',{name:'Chat navigation'});
  const home=nav.getByRole('button',{name:'Home',exact:true});
  const before=await home.boundingBox();
  await home.hover();
  expect(await home.boundingBox()).toEqual(before);
  const dir=evidenceDirectory(info, 'interaction-states');
  await mkdir(dir,{recursive:true});
  await home.screenshot({path:resolve(dir,`${info.project.name}-home-hover.png`)});
  await page.mouse.down();
  expect(await home.boundingBox()).toEqual(before);
  await home.screenshot({path:resolve(dir,`${info.project.name}-home-pressed.png`)});
  await page.mouse.up();
  await expect(page.getByRole('main').getByRole('heading',{name:'Home',exact:true})).toBeVisible();
  // Establish actual keyboard modality, then focus the same control.
  await page.keyboard.press('Tab');
  await home.focus();
  await expect(home).toBeFocused();
  expect(await home.evaluate(el=>el.matches(':focus-visible'))).toBe(true);
  await home.screenshot({path:resolve(dir,`${info.project.name}-home-keyboard-focus.png`)});
  expect(await home.boundingBox()).toEqual(before);
});

test('repeated new-chat open and Escape leave no overlays or lost composer draft',async({page})=>{
  await page.getByRole('complementary',{name:'Chat navigation'}).getByRole('button',{name:'Design team',exact:true}).click();
  const input=page.getByRole('main').getByRole('textbox',{name:'Message',exact:true});
  await input.fill('Unsent draft survives repeated menus');
  const opener=page.getByRole('complementary',{name:'Chat navigation'}).getByRole('button',{name:'New chat',exact:true});
  for(let i=0;i<20;i++) {
    await opener.click();
    await expect(page.getByRole('dialog',{name:'Start a conversation',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(input).toHaveValue('Unsent draft survives repeated menus');
  await expect(opener).toBeFocused();
  await expect(page.locator('.dialog-backdrop')).toHaveCount(0);
});

test('desktop compact menu supports quick reactions and Escape focus restoration',async({page})=>{
  await page.getByRole('complementary',{name:'Chat navigation'}).getByRole('button',{name:'Design team',exact:true}).click();
  const row=page.getByRole('main').getByRole('article').filter({hasText:'Good morning, team!'});
  await row.hover();
  await row.getByRole('button',{name:'React 👍',exact:true}).click();
  await expect(row.getByRole('button',{name:/👍, .*reaction/})).toBeVisible();
  const opener=row.getByRole('button',{name:'More actions',exact:true});
  await opener.click();
  const menu=page.getByRole('dialog',{name:'Message actions',exact:true});
  expect(Math.round((await menu.boundingBox())!.width)).toBe(178);
  for(const button of await menu.getByRole('button').all()) expect((await button.boundingBox())!.height).toBe(32);
  await expect(menu.getByRole('button',{name:'Close dialog',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('dark phone action rows retain44px targets and dismissal in a short viewport',async({page})=>{
  await page.getByRole('complementary',{name:'Chat navigation'}).getByRole('button',{name:'Design team',exact:true}).click();
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await page.setViewportSize({width:390,height:460});
  await expect(page.getByRole('main').getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
  const row=page.getByRole('main').getByRole('article').filter({hasText:'Can we do a quick review'});
  await row.getByRole('button',{name:'More actions',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'Message actions',exact:true});
  for(const button of await menu.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const box=(await menu.boundingBox())!;
  expect(box.y+box.height).toBeLessThanOrEqual(448);
  await menu.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
