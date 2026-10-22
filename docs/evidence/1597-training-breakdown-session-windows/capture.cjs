// Local-only capture for #1597 (adapted from #1588's driver, read-only there). Serves a local web export of the real app,
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

// ---- synthetic history: REAL-shaped, DATE-FREE notes (#1597) ----
// Mirrors makeWorkoutNoteItem (mobile/lib/data/exerciseCatalog.js): id, title,
// raw_text, saved_at, updated_at and the null/[] metadata fields, and NO `date`.
// Each note is a growing routine notebook: recurring weekday headings with one
// logged row per weekly session under each exercise (no per-session dates).
// [day, name, sets, reps, load, sessionsPerNote]
const EX = [
  ['Monday', 'Barbell Bench Press', 4, 5, 185, 8], ['Monday', 'Barbell Row', 4, 8, 155, 8],
  ['Monday', 'Lateral Raise', 3, 15, 20, 8], ['Monday', 'Triceps Pushdown', 3, 12, 60, 6],
  ['Monday', 'Spoto Press', 3, 5, 165, 3],
  ['Wednesday', 'Back Squat', 5, 5, 245, 8], ['Wednesday', 'Romanian Deadlift', 3, 8, 205, 7],
  ['Wednesday', 'Leg Extension', 3, 12, 110, 4], ['Wednesday', 'Standing Calf Raise', 3, 15, 180, 8],
  ['Friday', 'Overhead Press', 3, 6, 115, 8], ['Friday', 'Pull Up', 3, 8, 0, 8],
  ['Friday', 'Face Pull', 3, 15, 50, 8], ['Friday', 'EZ Bar Curl', 3, 10, 70, 8],
  ['Friday', 'Kroc Row', 2, 15, 90, 2],
];
const NOTEBOOKS = ['Block 1', 'Block 2', 'Block 3'];
function buildNotes() {
  const stamp = '2026-01-01T00:00:00.000Z';
  return NOTEBOOKS.map((title, n) => {
    const lines = [];
    for (const day of ['Monday', 'Wednesday', 'Friday']) {
      lines.push(day);
      for (const [d, name, sets, reps, load, count] of EX) {
        if (d !== day) continue;
        lines.push(`-${name}: ${sets}x${reps}`);
        // Unequal set counts per session: some weeks drop one set.
        for (let s = 0; s < count; s++) {
          const k = (s + n) % 3 === 2 ? sets - 1 : sets;
          lines.push(`${load || 'BW'} ${Array(k).fill(reps).join(',')}`);
        }
      }
      if (day === 'Wednesday') lines.push('-Plank: 2x45s', ...Array(6).fill('45'));
      if (day === 'Friday') lines.push('-Bike 20 min', ...Array(6).fill('- 20 min'));
    }
    const note = {
      id: `wn_seed_${n + 1}`, title, raw_text: lines.join('\n'), saved_at: stamp, updated_at: stamp,
      tracked_exercises: [], one_k_exercises: null, isCurrent: n === NOTEBOOKS.length - 1, skip_markers: null,
      attendance_flags: null, session_checkins: null, dismissed_nudges: null, exercise_classifications: null, activeWeek: null,
    };
    // A saved legacy group choice for Face Pull in the first notebook (✎ your choice).
    if (n === 0) note.exercise_movement_groups = { version: 1, overrides: { 'face pull': 'pull' } };
    if ('date' in note) throw new Error('seed notes must not carry a date');
    return note;
  });
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'e2e-local@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', exp: now + 7200, iat: now })}.c2ln`;
const SESSION = { access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 7200, expires_at: now + 7200, user: USER };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

// [file, theme, appearance, view, actions[], options]
const SHOTS = [
  ['01-movement-last4-hard-dark', 'hard-court', 'dark', 'movement', ['training-breakdown-range-last4']],
  ['02-movement-last12-hard-dark', 'hard-court', 'dark', 'movement', []],
  ['03-movement-all-hard-dark', 'hard-court', 'dark', 'movement', ['training-breakdown-range-All']],
  ['11-movement-last4-hard-light', 'hard-court', 'light', 'movement', ['training-breakdown-range-last4']],
  ['12-movement-last12-hard-light', 'hard-court', 'light', 'movement', []],
  ['13-movement-all-hard-light', 'hard-court', 'light', 'movement', ['training-breakdown-range-All']],
  ['21-large-text-selector-last12', 'hard-court', 'dark', 'movement', [], { scale: 1.3 }],
  ['22-large-text-selector-last4', 'hard-court', 'dark', 'movement', ['training-breakdown-range-last4'], { scale: 1.3 }],
  ['30-info-methodology', 'hard-court', 'dark', 'movement', ['training-breakdown-info']],
];

async function shoot(browser, base, [file, theme, appearance, view, actions, opts = {}], notes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: appearance });
  let seededNotes = notes;
  let rec = null;
  if (opts.recovery) {
    const last = notes[notes.length - 1];
    const wk = { id: 'recovery-week-1', title: 'Recovery week 1', raw_text: 'Monday\n-Back Squat: 2x5\n135 5,5', saved_at: last.saved_at, updated_at: last.updated_at };
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
    const txt = (id) => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
    const radios = [...document.querySelectorAll('[data-testid^="training-breakdown-range-"]')].map((el) => {
      const r = el.getBoundingClientRect();
      const t = el.firstElementChild || el;
      return { id: el.dataset.testid.replace('training-breakdown-range-', ''), label: el.getAttribute('aria-label'), selected: el.getAttribute('aria-checked') ?? el.getAttribute('aria-selected'), w: Math.round(r.width), h: Math.round(r.height), clipped: t.scrollWidth > t.clientWidth + 1 };
    });
    return { overflowX: document.documentElement.scrollWidth > 390, checked, small, completedSets: txt('training-breakdown-completed-sets'), radios };
  });
  await ctx.close();
  return { file, ...info };
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {});
  const notes = buildNotes();
  if (process.env.WRITE_SEED) fs.writeFileSync(process.env.WRITE_SEED, `${JSON.stringify(notes, null, 2)}\n`);
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  for (const s of SHOTS) {
    if (only && !only.test(s[0])) continue;
    try { console.log(JSON.stringify(await shoot(browser, base, s, notes))); } catch (e) { console.log(`${s[0]} FAILED ${e.message.split('\n')[0]}`); }
  }
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
