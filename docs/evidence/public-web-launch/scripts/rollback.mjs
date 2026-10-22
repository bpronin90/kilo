import { chromium } from 'playwright-core';
const [mode, url, profile, shot] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', viewport: { width: 390, height: 844 } });
const p = ctx.pages()[0] || await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
const bundle = await p.evaluate(() => [...document.scripts].map(s => s.src).find(s => s.includes('_expo')));
if (mode === 'seed') {
  await p.getByText('Log Weight', { exact: true }).first().click(); await p.waitForTimeout(800);
  await p.getByLabel('Weight (lb)', { exact: true }).last().fill('177.7');
  await p.getByText('Save weigh-in', { exact: true }).click(); await p.waitForTimeout(900);
  await p.getByText('Home', { exact: true }).last().click(); await p.waitForTimeout(800);
}
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
const t = await p.locator('body').innerText();
await p.screenshot({ path: shot });
console.log(mode, 'bundle', bundle?.split('/').pop(), 'weight 177.7 present:', /177\.7/.test(t), 'errors', errs.length);
await ctx.close();
