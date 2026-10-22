// Run against the real Expo web app with a fresh browser context.
// PLAYWRIGHT_MODULE may point to an existing playwright-core/index.mjs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const dir = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const url = process.env.CAPTURE_URL || 'http://localhost:8093';
const overlay = page.getByTestId('welcome-walkthrough');
const waitStep = async (name, number) => {
  await overlay.getByRole('heading', { name: `${name}, ${number} of 5`, exact: true }).waitFor();
  await page.waitForTimeout(300);
  if (await page.getByRole('tab').count()) throw new Error('Background tabs exposed while tour is modal');
};
const shot = (name) => page.screenshot({ path: `${dir}/${name}.png` });
const storage = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])));
await page.goto(url);
await waitStep('Home', 1);
await page.waitForTimeout(1000);
const before = await storage();
const geometry = [];
for (const [index, tab] of ['Home', 'Log', 'Weight', 'Analytics', 'More'].entries()) {
  await waitStep(tab, index + 1);
  // The application remains mounted behind a modal. DOM bounds let the
  // reviewer compare the real tab, highlighted ring and unobstructed panel.
  geometry.push(await page.evaluate((tab) => {
    const root = document.querySelector('[data-testid="welcome-walkthrough"]');
    const ring = root.firstElementChild;
    const panel = root.lastElementChild;
    const target = document.querySelector(`[role="tab"][aria-label="${tab}"]`);
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
    return { tab, ring:rect(ring), anchor:rect(target), panel:rect(panel) };
  }, tab));
  await shot(`step-${index + 1}-${tab.toLowerCase()}`);
  if (index === 0) {
    await overlay.getByRole('button', { name: 'Next', exact: true }).click();
    await waitStep('Log', 2);
    await overlay.getByRole('button', { name: 'Back', exact: true }).click();
    await waitStep('Home', 1);
  }
  if (index < 4) await overlay.getByRole('button', { name: 'Next', exact: true }).click();
}
await overlay.getByRole('button', { name: 'Done', exact: true }).click();
await overlay.waitFor({ state: 'detached' });
await page.getByTestId('tab-content-Home').waitFor({state:'visible'});
await page.reload();
await page.getByText('Welcome to Kilo', { exact: true }).waitFor();
await page.waitForTimeout(700);
if (await overlay.count()) throw new Error('Tour restarted after completion/reload');
await page.getByRole('tab', { name: 'More', exact: true }).click();
await page.getByText('Help', { exact: true }).click();
await page.getByRole('button', { name: 'Replay walkthrough', exact: true }).click();
await waitStep('Home', 1);
await shot('replay-home');
await overlay.getByRole('button', { name: 'Next', exact: true }).click();
await waitStep('Log', 2);
// Web has fixed CSS pixel text. Simulate 200% accessibility text scaling on
// the actual rendered tip (font + line height), without changing panel bounds.
await overlay.locator('[dir="auto"]').evaluateAll((nodes) => {
  for (const node of nodes) {
    const style = getComputedStyle(node);
    node.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
    node.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
  }
});
await shot('log-large-text');
await overlay.getByRole('button', { name: 'Skip', exact: true }).click();
await overlay.waitFor({ state: 'detached' });
await page.getByTestId('tab-content-Log').waitFor({state:'visible'});
const after = await storage();
const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => before[key] !== after[key]);
await page.reload();
await page.getByText('Welcome to Kilo', { exact: true }).waitFor();
await page.waitForTimeout(700);
if (await overlay.count()) throw new Error('Tour restarted after Skip/reload');
const result = { renderedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding:'utf8' }).trim(), viewport:{ width:390, height:844 },
  geometry, changedKeys, errors, interactions:'Next, Back, Done → Home, relaunch suppression, Help replay → Home, 200% text, Skip → Log, relaunch suppression' };
writeFileSync(`${dir}/capture-result.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
await browser.close();
