// Local-only capture for #1580. Serves a local web export of the app, seeds a
// synthetic workout notebook into localStorage (mock project `mockproj`, fake
// session, all non-local traffic blocked), opens Analytics at 390x844 and
// screenshots it. Usage: node capture.cjs <distDir> <label> <outDir>
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PWC || '/home/benpronin/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const [dist, label, out] = process.argv.slice(2);
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

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-base.json'), 'utf8'));
const MAP = process.env.MAP === 'v2'
  ? { version: 2, overrides: { 'barbell curl': 'pull', 'lat pulldown': 'horizontal_pull' } }
  : { version: 1, overrides: { 'barbell curl': 'pull' } };
const iso = '2026-10-01T10:00:00.000Z';
const NOTES = [
  { id: 'wn_a', title: 'Recovery Week 1', raw_text: SEED.W, saved_at: '2026-10-06T10:00:00.000Z', updated_at: '2026-10-06T10:00:00.000Z', tracked_exercises: [], one_k_exercises: null, isCurrent: true },
  { id: 'wn_b', title: 'Routine 0', raw_text: SEED.B, saved_at: iso, updated_at: iso, tracked_exercises: [], one_k_exercises: null, isCurrent: false, exercise_movement_groups: MAP },
];
const RB = [{ id: 'rb_1', baseline_note_id: 'wn_b', baseline_note_title: 'Routine 0', baseline: SEED.baseline, include_in_normal_analytics: false, reason: null, started_at: '2026-10-05T10:00:00.000Z', completed_at: null, saved_at: '2026-10-05T10:00:00.000Z', updated_at: '2026-10-05T10:00:00.000Z', deleted_at: null }];
const RW = [{ id: 'rw_1', block_id: 'rb_1', note_id: 'wn_a', week_number: 1, completed_at: null, saved_at: '2026-10-06T10:00:00.000Z', updated_at: '2026-10-06T10:00:00.000Z', deleted_at: null }];
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
  }, ['sb-mockproj-auth-token', JSON.stringify(SESSION), 'kilo_workout_notes', JSON.stringify(NOTES), 'kilo_current_workout_id', JSON.stringify('wn_a'), JSON.stringify(RB), JSON.stringify(RW)]);
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
  const shot = (n) => page.screenshot({ path: `${out}/${label}-${n}.png` });
  const mg = page.getByTestId('recovery-movement-groups');
  await mg.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
  await page.getByTestId('recovery-movement-groups-header').click(); await page.waitForTimeout(600);
  for (const id of (process.env.OPEN || '').split(',').filter(Boolean)) {
    await page.getByTestId(`movement-group-row-${id}`).click(); await page.waitForTimeout(300);
  }
  await mg.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
  await shot('01-analytics-groups');
  console.log(await mg.innerText());
  await page.getByText('Log', { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByTestId('recovery-manage-trigger-rb_1').click(); await page.waitForTimeout(800);
  await page.getByTestId('recovery-manage-groups-header').click(); await page.waitForTimeout(800);
  await page.getByTestId('recovery-manage-groups').scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
  await shot('02-log-groups');
  console.log(await page.getByTestId('recovery-manage-groups').innerText());
  for (const k of (process.env.EDIT || 'lat pulldown').split(',')) {
    await page.getByTestId(`movement-group-edit-${k}`).click(); await page.waitForTimeout(600);
    const ed = page.getByTestId(`movement-group-editor-${k}`);
    await ed.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    await shot(`03-editor-${k.replace(/ /g, '-')}-viewport`);
    await page.getByTestId(`movement-group-reset-${k}`).scrollIntoViewIfNeeded(); await page.mouse.wheel(0, 150); await page.waitForTimeout(400);
    await shot(`04-editor-${k.replace(/ /g, '-')}-reset`);
    console.log(await ed.innerText());
    await page.getByTestId(`movement-group-edit-${k}`).click(); await page.waitForTimeout(300);
  }
  console.log((await page.locator('body').innerText()).slice(0, 3000));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
