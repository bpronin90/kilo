// Start Expo web on 8097; see README.md. Uses a fresh local-only browser context.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const phase = process.env.PHASE || 'after';
const out = fileURLToPath(new URL('./', import.meta.url));
const fixture = '-Squat 3x8\n225 5,5,5\n-Bench\n135 8,8,8';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const errors = [];
const measurements = [];
for (const width of [320, 390]) {
  for (const mode of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: mode,
      isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await context.addInitScript(({ fixture, mode }) => {
      localStorage.setItem('kilo:welcome-walkthrough:v1', '{"version":1,"dismissed":true}');
      localStorage.setItem('kilo.appearance_preference', mode);
      localStorage.setItem('kilo_workout_notes', JSON.stringify([{ id: 'plates-fixture', title: 'Plates',
        raw_text: fixture, isCurrent: true, saved_at: '2026-10-25T12:00:00.000Z', updated_at: '2026-10-25T12:00:00.000Z' }]));
      localStorage.setItem('kilo_current_workout_id', JSON.stringify('plates-fixture'));
    }, { fixture, mode });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.CAPTURE_URL || 'http://localhost:8097', { timeout: 120000 });
    await page.getByRole('tab', { name: 'Log', exact: true }).click();
    await page.getByRole('button', { name: 'Routine actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit routine', exact: true }).click();
    const plates = page.getByTestId('editor-plate-calculator-button');
    await plates.waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Unsaved change + caret in the middle of the note.
    const input = page.locator('textarea').first();
    await input.click();
    await input.press('Control+End');
    await input.type('\n-Row 3x8');
    await page.waitForTimeout(300);
    const before = await input.inputValue();
    const box = await plates.boundingBox();
    const done = await page.getByRole('button', { name: 'Done', exact: true }).boundingBox();
    measurements.push({ width, mode, plates: box, done, rightEdge: width });
    if (box.height < 44 || box.width < 44) throw new Error('Plates target < 44dp');
    if (box.x + box.width > width + 1 || box.x < 0) throw new Error('Plates overflows viewport');
    await page.screenshot({ path: `${out}/${phase}-editor-${width}-${mode}.png` });
    await plates.click();
    await page.getByRole('button', { name: 'Close plate calculator' }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${phase}-calculator-${width}-${mode}.png` });
    await page.getByRole('button', { name: 'Close plate calculator' }).click();
    await page.waitForTimeout(300);
    const after = await page.locator('textarea').first().inputValue();
    if (after !== before) throw new Error('Draft changed across calculator');
    await page.locator('textarea').first().type(' ok');
    if (!(await page.locator('textarea').first().inputValue()).endsWith('3x8 ok')) throw new Error('Typing after close failed');
    console.log(`${phase} ${width} ${mode}: ok`);
    await context.close();
  }
}
// Enlarged text: double the header chips' font size at 320 (web has no OS text scale).
{
  const context = await browser.newContext({ viewport: { width: 320, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(({ fixture }) => {
    localStorage.setItem('kilo:welcome-walkthrough:v1', '{"version":1,"dismissed":true}');
    localStorage.setItem('kilo.appearance_preference', 'dark');
    localStorage.setItem('kilo_workout_notes', JSON.stringify([{ id: 'plates-fixture', title: 'Plates', raw_text: fixture, isCurrent: true,
      saved_at: '2026-10-25T12:00:00.000Z', updated_at: '2026-10-25T12:00:00.000Z' }]));
    localStorage.setItem('kilo_current_workout_id', JSON.stringify('plates-fixture'));
  }, { fixture });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.CAPTURE_URL || 'http://localhost:8097', { timeout: 120000 });
  await page.getByRole('tab', { name: 'Log', exact: true }).click();
  await page.getByRole('button', { name: 'Routine actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit routine', exact: true }).click();
  const plates = page.getByTestId('editor-plate-calculator-button');
  await plates.waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).evaluate(n => n.parentElement.querySelectorAll('[dir="auto"]').forEach(t => { t.style.fontSize = `${parseFloat(getComputedStyle(t).fontSize) * 2}px`; }));
  await page.waitForTimeout(300);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  measurements.push({ enlarged: true, scrollWidth: sw });
  if (sw > 321) throw new Error('Horizontal overflow at enlarged text');
  await page.screenshot({ path: `${out}/${phase}-editor-320-dark-enlarged.png` });
  await context.close();
}
await browser.close();
writeFileSync(`${out}/${phase}-results.json`, JSON.stringify({ errors, measurements }, null, 2));
if (errors.length) throw new Error(errors.join('\n'));
