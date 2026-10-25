// Start Expo web on 8097; see README.md. Uses a fresh local-only browser context.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const phase = process.env.PHASE || 'after';
const stress = process.env.STRESS === '1';
const measurements = [];
const out = fileURLToPath(new URL('./', import.meta.url));
let fixture = '-Squat 3x8\n95 10, 165 8,8,8\n95 10, 175 8,8,8\n-\n95 10, 185 8,8,8\n95 10, 195 6,6 185 8';
if (stress) fixture += '\n85kg ' + Array(16).fill('8').join(',');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const errors = [];
for (const width of (stress ? [320] : [320, 390])) {
  for (const mode of (stress ? ['dark'] : ['light', 'dark'])) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: mode,
      isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await context.addInitScript(({ fixture, mode }) => {
      localStorage.setItem('kilo:welcome-walkthrough:v1', '{"version":1,"dismissed":true}');
      localStorage.setItem('kilo.appearance_preference', mode);
      localStorage.setItem('kilo_workout_notes', JSON.stringify([{ id: 'squat-fixture', title: 'Squat layout',
        raw_text: fixture, isCurrent: true, saved_at: '2026-10-25T12:00:00.000Z', updated_at: '2026-10-25T12:00:00.000Z' }]));
      localStorage.setItem('kilo_current_workout_id', JSON.stringify('squat-fixture'));
    }, { fixture, mode });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.CAPTURE_URL || 'http://localhost:8097', { timeout: 120000 });
    await page.getByRole('tab', { name: 'Log', exact: true }).click();
    await page.getByTestId('log-exercise-0-0-0-earlier').click();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await inspect(page, 'log', width, mode);
    if (stress) await page.getByTestId('log-set-line-last').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${phase}-log-${width}-${mode}.png` });
    await page.getByRole('button', { name: 'Squat history', exact: true }).click();
    await page.getByTestId('exercise-history-sheet').waitFor();
    await page.waitForTimeout(400);
    await inspect(page, 'history', width, mode);
    await page.screenshot({ path: `${out}/${phase}-history-${width}-${mode}.png` });
    console.log(`${phase} ${width} ${mode}: Log + history captured`);
    await context.close();
  }
}
await browser.close();
writeFileSync(`${out}/${phase}-results.json`, JSON.stringify({ errors, measurements }, null, 2));
if (errors.length) throw new Error(errors.join('\n'));

async function inspect(page, screen, width, mode) {
  const scope = screen === 'history' ? page.getByTestId('exercise-history-sheet') : page;
  const line = scope.getByTestId('log-set-line-last');
  if (stress) {
    // Web has no OS font scaling. Double the actual session text's font and
    // line-height to exercise the same layout constraints at 200% size.
    await scope.locator('[data-testid^="log-set-line"] [dir="auto"]').evaluateAll(nodes => {
      for (const n of nodes) {
        const s = getComputedStyle(n);
        n.style.fontSize = `${parseFloat(s.fontSize) * 2}px`;
        n.style.lineHeight = `${parseFloat(s.lineHeight) * 2}px`;
      }
    });
  }
  const layout = await line.evaluate(line => {
    const rect = n => { const r = n.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right }; };
    const rail = line.firstElementChild;
    return { rail:rect(rail), scrollWidth:rail.scrollWidth, groups:[...rail.children].map(group => ({
      text:group.textContent, ...rect(group), children:[...group.children].map(n => ({text:n.textContent, ...rect(n)}))
    })) };
  });
  measurements.push({screen,width,mode,stress,...layout});
  if (phase === 'before') return;
  for (const group of layout.groups) {
    if (group.right > layout.rail.right + 1 || group.x < layout.rail.x - 1) throw new Error('Group overflows session');
    if (group.children.some(c => c.right > layout.rail.right + 1)) throw new Error('Text overflows session');
    if (group.children.length === 2 && group.children[0].y === group.children[1].y) {
      const gap = group.children[1].x - group.children[0].right;
      if (Math.abs(gap - 4) > 1) throw new Error(`Internal gap ${gap}`);
    }
    if (!stress && group.children.length === 2 && group.height > 25) throw new Error('Normal group split internally');
  }
  for (let i = 1; i < layout.groups.length; i++) {
    const a = layout.groups[i - 1], b = layout.groups[i];
    if (a.y === b.y && Math.abs(b.x - a.right - 16) > 1) throw new Error('Between-group gap');
  }
  if (layout.scrollWidth > layout.rail.width + 1) throw new Error('Session scroll overflow');
}
