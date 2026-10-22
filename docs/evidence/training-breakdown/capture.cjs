// Local-only capture for #1580. Serves a local web export of the app, seeds a
// synthetic workout notebook into localStorage (mock project `mockproj`, fake
// session, all non-local traffic blocked), opens Analytics at 390x844 and
// screenshots it. Usage: node capture.cjs <distDir> <label> <outDir>
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/benpronin/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const [dist, label, out] = process.argv.slice(2);
const RECOVERY = process.env.RECOVERY ? JSON.parse(fs.readFileSync(path.join(__dirname, 'recovery-seed.json'), 'utf8')) : null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'e2e-local@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp: now + 7200, iat: now })}.c2ln`;
const SESSION = { access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 7200, expires_at: now + 7200, user: USER };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

const TEXT1 = `Monday
-Barbell Bench Press: 3x5
135 5,5,5
145 5,5,5
-Pull-ups: 3x8
8,8,7
-Plank: 3x30s
30
30
30
-Mystery Machine Thing: 3x10
50 10,10,10
-Bike 20 min
- 20 min
+Warmup
-Barbell Bench Press
45 10
Wednesday
-Barbell Back Squat: 3x5
185 5,5,5
195 5,5,5
-Romanian Deadlift: 3x8
135 8,8,8
-Barbell Curl: 3x10
25 10,10,10`;
const TEXT2 = `Monday
-Barbell Bench Press: 3x5
150 5,5,5
-Cable Row: 3x10
100 10,10,10`;
const iso = '2026-10-01T10:00:00.000Z';
const NOTES = [
  { id: 'wn_a', title: 'Routine 1', raw_text: TEXT1, saved_at: iso, updated_at: iso, tracked_exercises: [], one_k_exercises: null, isCurrent: true,
    exercise_movement_groups: { version: 1, overrides: { 'barbell curl': 'pull' } } },
  { id: 'wn_b', title: 'Routine 0', raw_text: TEXT2, saved_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-01T10:00:00.000Z', tracked_exercises: [], one_k_exercises: null, isCurrent: false },
];

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(([k, v, nk, nv, ck, cv, rb, rw]) => {
    if (!sessionStorage.getItem('injected')) {
      localStorage.setItem(k, v); localStorage.setItem(nk, nv); localStorage.setItem(ck, cv);
      if (rb) { localStorage.setItem('kilo_recovery_blocks', rb); localStorage.setItem('kilo_recovery_block_weeks', rw); }
      sessionStorage.setItem('injected', '1');
    }
  }, ['sb-mockproj-auth-token', JSON.stringify(SESSION), 'kilo_workout_notes', JSON.stringify(NOTES), 'kilo_current_workout_id', JSON.stringify('wn_a'), RECOVERY ? JSON.stringify(RECOVERY.b) : null, RECOVERY ? JSON.stringify(RECOVERY.w) : null]);
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname !== 'mockproj.supabase.co') return route.abort();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (body) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (u.pathname.endsWith('/auth/v1/user')) return json(USER);
    if (u.pathname.endsWith('/auth/v1/token')) return json(SESSION);
    if (u.pathname.includes('/rest/v1/')) return json(/vnd\.pgrst\.object/.test(route.request().headers().accept || '') ? null : []);
    return json({});
  });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const w = page.getByTestId('welcome-walkthrough');
  for (let i = 0; i < 8 && await w.isVisible().catch(() => false); i++) {
    const btn = w.getByText(/^(Skip|Get started|Done|Close)$/i).last();
    if (!(await btn.count())) break;
    await btn.click(); await page.waitForTimeout(400);
  }
  const own = page.getByTestId('ownership-prompt');
  if (await own.isVisible().catch(() => false)) { await own.getByText('Not Now').click(); await page.waitForTimeout(600); }
  await page.getByText('Analytics', { exact: true }).last().click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${label}-01-analytics-top.png` });
  if (RECOVERY) {
    console.log('collapsed: training-breakdown-section count =', await page.getByTestId('training-breakdown-section').count());
    await page.screenshot({ path: `${out}/${label}-recovery-01-collapsed.png` });
    await page.getByTestId('baseline-disclosure-toggle').click(); await page.waitForTimeout(800);
    await page.getByTestId('training-breakdown-section').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${label}-recovery-02-expanded.png` });
    console.log((await page.locator('body').innerText()).slice(0, 1500));
    await browser.close(); server.close(); return;
  }
  const tb = page.getByTestId('training-breakdown-section');
  if (await tb.count()) {
    await tb.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${label}-02-breakdown-movement.png` });
    for (const v of ['muscles', 'equipment']) {
      await page.getByTestId(`training-breakdown-view-${v}`).click(); await page.waitForTimeout(500);
      await tb.scrollIntoViewIfNeeded();
      if (v === 'equipment') {
        await page.screenshot({ path: `${out}/${label}-03-breakdown-equipment-collapsed-names.png` });
        await page.getByTestId('training-breakdown-equipment-unknown-names-toggle').click(); await page.waitForTimeout(400);
      }
      await page.screenshot({ path: `${out}/${label}-03-breakdown-${v}.png` });
    }
  } else {
    await page.mouse.wheel(0, 700); await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${label}-02-analytics-scrolled.png` });
  }
  console.log((await page.locator('body').innerText()).slice(0, 3000));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
