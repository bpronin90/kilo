// Local-only capture for #1588. Serves a local web export of the real app,
// seeds synthetic workout notes into the browser's local storage, injects a fake
// session for the mock project `mockproj`, answers every Supabase call with empty
// synthetic data, and blocks all other non-local traffic. No production access.
// Usage: node capture.cjs <distDir> <outDir> [playwrightModuleDir] [chromePath]
const http = require('http');
const fs = require('fs');
const path = require('path');

const [dist, out, pwDir, chromePath] = process.argv.slice(2);
const { chromium } = require(pwDir ? path.join(pwDir, 'playwright') : 'playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

// ---- synthetic history (one note per training day, ~200 days) ----
// [name, everyNDays, offset, sets, reps, load, firstDayAgo]
const EX = [
  ['Barbell Bench Press', 7, 0, 4, 5, 185, 200], ['Incline Dumbbell Press', 7, 3, 3, 10, 60, 150],
  ['Dip', 14, 3, 3, 10, 0, 120], ['Overhead Press', 7, 3, 3, 6, 115, 200],
  ['Barbell Row', 7, 1, 4, 8, 155, 200], ['Seated Cable Row', 7, 4, 3, 12, 120, 90],
  ['Pull Up', 7, 4, 3, 8, 0, 200], ['Lat Pulldown', 14, 1, 3, 12, 140, 200],
  ['Back Squat', 7, 2, 5, 5, 245, 200], ['Romanian Deadlift', 7, 5, 3, 8, 205, 100],
  ['Deadlift', 14, 5, 3, 3, 315, 200], ['Walking Lunge', 7, 5, 3, 10, 40, 80],
  ['Leg Extension', 7, 2, 3, 12, 110, 45], ['Hip Thrust', 7, 5, 3, 12, 90, 120],
  ['Standing Calf Raise', 7, 2, 3, 15, 180, 120], ['Lateral Raise', 7, 3, 4, 15, 20, 200],
  ['Face Pull', 7, 1, 3, 15, 50, 200], ['EZ Bar Curl', 7, 4, 3, 10, 70, 200],
  ['Triceps Pushdown', 7, 0, 3, 12, 60, 200], ['Cable Crunch', 7, 4, 3, 12, 0, 150],
  ['Leg Press', 7, 6, 3, 10, 360, 200], ['Chin Up', 14, 6, 3, 8, 0, 200], ['Barbell Curl', 14, 2, 3, 10, 75, 120], ['Pallof Press', 14, 2, 3, 12, 40, 120], ['Cable Lateral Raise', 7, 6, 3, 15, 15, 90],
  ['Spoto Press', 14, 0, 3, 5, 165, 70], ['Kroc Row', 14, 1, 2, 15, 90, 50],
];
const DAY = 86400000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function buildNotes() {
  const today = new Date();
  const notes = [];
  for (let ago = 200; ago >= 0; ago--) {
    const lines = [];
    for (const [name, every, offset, sets, reps, load, first] of EX) {
      if (ago > first || (ago + offset) % every !== 0) continue;
      lines.push(`-${name}: ${sets}x${reps}`, `${load || 'BW'} ${Array(sets).fill(reps).join(',')}`);
    }
    if (ago % 7 === 2) lines.push('-Plank: 2x45s', '45', '45');
    if (ago % 7 === 6) lines.push('-Bike 20 min', '- 20 min');
    if (!lines.length) continue;
    const d = new Date(today.getTime() - ago * DAY);
    const note = {
      id: `seed-${ago}`, title: `Session ${iso(d)}`, date: iso(d),
      raw_text: [d.toLocaleDateString('en-US', { weekday: 'long' }), ...lines].join('\n'),
      created_at: d.toISOString(), updated_at: d.toISOString(),
    };
    // A saved legacy group choice for Face Pull in older notes (✎ your choice).
    if (ago > 60 && lines.some((l) => l.startsWith('-Face Pull'))) note.exercise_movement_groups = { version: 1, overrides: { 'face pull': 'pull' } };
    notes.push(note);
  }
  return notes.reverse();
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'e2e-local@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', exp: now + 7200, iat: now })}.c2ln`;
const SESSION = { access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 7200, expires_at: now + 7200, user: USER };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

// [file, theme, appearance, view, actions[], options]
const SHOTS = [
  ['01-movement-hard-dark', 'hard-court', 'dark', 'movement', []],
  ['02-muscles-hard-dark', 'hard-court', 'dark', 'muscles', []],
  ['03-equipment-hard-dark', 'hard-court', 'dark', 'equipment', []],
  ['04-movement-30d-hard-dark', 'hard-court', 'dark', 'movement', ['training-breakdown-range-30D']],
  ['05-movement-all-hard-dark', 'hard-court', 'dark', 'movement', ['training-breakdown-range-All']],
  ['10-drill-group', 'hard-court', 'dark', 'movement', ['training-breakdown-group-*']],
  ['11-drill-allgroups', 'hard-court', 'dark', 'movement', ['training-breakdown-more-groups']],
  ['12-drill-override', 'hard-court', 'dark', 'movement', ['training-breakdown-more-groups', 'training-breakdown-all-group-legacy:pull']],
  ['13-drill-unclassified', 'hard-court', 'dark', 'movement', ['training-breakdown-more-groups', 'training-breakdown-all-group-unclassified']],
  ['14-drill-region', 'hard-court', 'dark', 'muscles', ['training-breakdown-region-legs']],
  ['15-drill-muscle-back', 'hard-court', 'dark', 'muscles', ['training-breakdown-region-legs', 'training-breakdown-region-muscle-gluteus_maximus']],
  ['16-drill-unknown-muscles', 'hard-court', 'dark', 'muscles', ['training-breakdown-unknown-muscles']],
  ['17-drill-equipment', 'hard-court', 'dark', 'equipment', ['training-breakdown-equipment-barbell']],
  ['18-drill-unknown-equipment', 'hard-court', 'dark', 'equipment', ['training-breakdown-equipment-unknown']],
  ['19-drill-allequipment', 'hard-court', 'dark', 'equipment', ['training-breakdown-all-equipment']],
  ['20-drill-timed', 'hard-court', 'dark', 'movement', ['training-breakdown-timed-stat']],
  ['21-drill-info', 'hard-court', 'dark', 'movement', ['training-breakdown-info']],
  ['30-movement-hard-light', 'hard-court', 'light', 'movement', []],
  ['31-muscles-hard-light', 'hard-court', 'light', 'muscles', []],
  ['32-movement-clay-light', 'clay-court', 'light', 'movement', []],
  ['33-muscles-clay-dark', 'clay-court', 'dark', 'muscles', []],
  ['34-equipment-clay-dark', 'clay-court', 'dark', 'equipment', []],
  ['35-movement-grass-light', 'grass-court', 'light', 'movement', []],
  ['36-muscles-grass-dark', 'grass-court', 'dark', 'muscles', []],
  ['37-equipment-grass-light', 'grass-court', 'light', 'equipment', []],
  ['38-drill-region-clay-light', 'clay-court', 'light', 'muscles', ['training-breakdown-region-back']],
  ['40-integration-strength-above', 'hard-court', 'dark', 'movement', [], { integration: true }],
  ['41-large-text-movement', 'hard-court', 'dark', 'movement', [], { scale: 1.3 }],
  ['42-large-text-muscles', 'hard-court', 'dark', 'muscles', [], { scale: 1.3 }],
  ['43-recovery-disclosure-collapsed', 'hard-court', 'dark', 'movement', [], { recovery: 'collapsed' }],
  ['44-recovery-paused-expanded', 'hard-court', 'dark', 'movement', [], { recovery: 'expanded' }],
];

async function shoot(browser, base, [file, theme, appearance, view, actions, opts = {}], notes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: appearance });
  let seededNotes = notes;
  let rec = null;
  if (opts.recovery) {
    const last = notes[notes.length - 1];
    const wk = { id: 'recovery-week-1', title: 'Recovery week 1', date: last.date, raw_text: 'Monday\n-Back Squat: 2x5\n135 5,5', created_at: last.created_at, updated_at: last.updated_at };
    seededNotes = [...notes, wk];
    rec = {
      blocks: [{ id: 'rb1', baseline_note_id: last.id, baseline_note_title: last.title, baseline: { version: 1, exercises: [] }, include_in_normal_analytics: false, started_at: new Date().toISOString(), completed_at: null, deleted_at: null }],
      weeks: [{ id: 'rw1', block_id: 'rb1', note_id: wk.id, week_number: 1, completed_at: null, deleted_at: null }],
      current: wk.id,
    };
  }
  await ctx.addInitScript(([s, n, th, ap, r]) => {
    if (sessionStorage.getItem('injected')) return;
    if (r) {
      localStorage.setItem('kilo_recovery_blocks', JSON.stringify(r.blocks));
      localStorage.setItem('kilo_recovery_block_weeks', JSON.stringify(r.weeks));
      localStorage.setItem('kilo_current_workout_id', JSON.stringify(r.current));
    }
    localStorage.setItem('sb-mockproj-auth-token', s);
    localStorage.setItem('kilo_workout_notes', n);
    localStorage.setItem('kilo.theme_selection', th);
    localStorage.setItem('kilo.appearance_preference', ap);
    localStorage.setItem('kilo:welcome-walkthrough:v1', JSON.stringify({ completed: true }));
    sessionStorage.setItem('injected', '1');
  }, [JSON.stringify(SESSION), JSON.stringify(seededNotes), theme, appearance, rec]);
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname !== 'mockproj.supabase.co') return route.abort();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (body) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const p = u.pathname;
    if (p.endsWith('/auth/v1/user')) return json(USER);
    if (p.endsWith('/auth/v1/token')) return json(SESSION);
    if (p.endsWith('/rpc/health_sync_preflight')) return json({ allowed: true, code: 'OK' });
    if (p.includes('/rest/v1/')) return json(/vnd\.pgrst\.object/.test(req.headers().accept || '') ? null : []);
    return json({});
  });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 8; i++) {
    const w = page.getByTestId('welcome-walkthrough');
    if (!(await w.isVisible().catch(() => false))) break;
    const btn = w.getByText(/^(Skip|Get started|Done|Close)$/i).last();
    if (!(await btn.count())) break;
    await btn.click(); await page.waitForTimeout(400);
  }
  const own = page.getByTestId('ownership-prompt');
  if (await own.isVisible().catch(() => false)) { await own.getByText('Not Now').click(); await page.waitForTimeout(600); }
  await page.getByText('Analytics', { exact: true }).last().click();
  await page.waitForTimeout(1500);
  if (opts.scale) await page.addStyleTag({ content: `html { font-size: ${opts.scale * 100}% } div[dir], div { } *{ }` }).catch(() => {});
  if (opts.scale) await page.evaluate((s) => { document.querySelectorAll('div[dir="auto"], span').forEach((el) => { const fs = parseFloat(getComputedStyle(el).fontSize); if (fs && !el.dataset.scaled) { el.style.fontSize = `${fs * s}px`; el.dataset.scaled = '1'; } }); }, opts.scale);
  if (opts.recovery) {
    const disc = page.getByText('Baseline training · paused during Recovery').first();
    await disc.scrollIntoViewIfNeeded();
    if (opts.recovery === 'expanded') { await disc.click(); await page.waitForTimeout(800); }
    else {
      await page.evaluate(() => { const el = [...document.querySelectorAll('div')].find((d) => d.textContent === 'Baseline training · paused during Recovery'); let n = el.parentElement; while (n && n.scrollHeight <= n.clientHeight) n = n.parentElement; if (n) n.scrollTop += el.getBoundingClientRect().top - 500; });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `${file}.png`) });
      await ctx.close();
      return { file };
    }
  }
  const section = page.getByTestId('training-breakdown-section');
  await section.scrollIntoViewIfNeeded();
  if (opts.integration) {
    await page.evaluate(() => { const el = document.querySelector('[data-testid="training-breakdown-section"]'); let n = el.parentElement; while (n && n.scrollHeight <= n.clientHeight) n = n.parentElement; if (n) n.scrollTop = Math.max(0, n.scrollTop - 420); });
  } else {
    await page.evaluate(() => { const el = document.querySelector('[data-testid="training-breakdown-section"]'); let n = el.parentElement; while (n && n.scrollHeight <= n.clientHeight) n = n.parentElement; if (n) n.scrollTop += el.getBoundingClientRect().top - 64; });
  }
  if (view !== 'movement') await page.getByTestId(`training-breakdown-view-${view}`).click();
  for (const a of actions) {
    const loc = a.endsWith('*') ? page.locator(`[data-testid^="${a.slice(0, -1)}"]`).first() : page.getByTestId(a).last();
    await loc.click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(600);
  const target = path.join(out, `${file}.png`);
  await page.screenshot({ path: target });
  const info = await page.evaluate(() => {
    const small = [];
    let checked = 0;
    document.querySelectorAll('[data-testid^="training-breakdown"][role="button"], [data-testid^="training-breakdown"][role="tab"], [data-testid^="training-breakdown"][role="radio"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width) checked += 1;
      if (r.width && (r.width < 44 || r.height < 44)) small.push(`${el.dataset.testid} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return { overflowX: document.documentElement.scrollWidth > 390, checked, small };
  });
  await ctx.close();
  return { file, ...info };
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {});
  const notes = buildNotes();
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  for (const s of SHOTS) {
    if (only && !only.test(s[0])) continue;
    try { console.log(JSON.stringify(await shoot(browser, base, s, notes))); } catch (e) { console.log(`${s[0]} FAILED ${e.message.split('\n')[0]}`); }
  }
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
