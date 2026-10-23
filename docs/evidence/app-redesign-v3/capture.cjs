// Shared real-app capture harness for the app-redesign-v3 issues (#1600).
//
// FROZEN SHARED API (see README.md next to this file). Downstream issues write
// docs/evidence/app-redesign-v3/<rid>/capture.cjs that require()s this module;
// they never edit it.
//
// Serves a local Expo web export, seeds deterministic fixtures (fixtures.cjs)
// into localStorage, injects a mock Supabase session for `mockproj`, answers
// mockproj.supabase.co with empty data, and aborts every other non-local
// request: no production access. The page clock is installed at FIXED_NOW so
// every relative date renders identically on every run.
const http = require('http');
const fs = require('fs');
const path = require('path');
const fixtures = require('./fixtures.cjs');

const TABS = ['Home', 'Log', 'Weight', 'Analytics', 'More'];
// theme key -> [court selection stored in kilo.theme_selection, mode, expected canvas colour]
const THEMES = {
  'hard-dark': ['hard-court', 'dark', '#080D18'],
  'hard-light': ['hard-court', 'light', '#EEF3F9'],
  'clay-dark': ['clay-court', 'dark', '#141211'],
  'clay-light': ['clay-court', 'light', '#F8F5EE'],
  'grass-dark': ['grass-court', 'dark', '#0C130F'],
  'grass-light': ['grass-court', 'light', '#F4F8F5'],
};
// Coverage the redesign issues require: every state in these two...
const STATE_THEMES = ['hard-dark', 'clay-light'];
// ...plus these two for each affected tab's first screen.
const FIRST_SCREEN_THEMES = ['hard-dark', 'clay-light', 'grass-light', 'clay-dark'];
const PHONE = { width: 390, height: 844 };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'e2e-local@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} };

function mockSession(nowMs) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ts = Math.floor(nowMs / 1000);
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', exp: ts + 86400, iat: ts })}.c2ln`;
  return { access_token: jwt, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 86400, expires_at: ts + 86400, user: USER };
}

function serve(dist) {
  const server = http.createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The visible ScreenShell ScrollView of the active tab (largest visible vertical scroller).
const MAIN_SCROLLER = `(() => {
  const els = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 4 && d.clientHeight > 200 && d.offsetParent !== null && getComputedStyle(d).overflowY !== 'visible');
  els.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
  return els[0] || null;
})()`;

class Session {
  constructor(page, ctx, info) { this.page = page; this.ctx = ctx; this.info = info; }

  locator(target) {
    const t = typeof target === 'string' ? { text: target } : target;
    let loc;
    if (t.testID) loc = this.page.getByTestId(t.testID);
    else if (t.role) loc = this.page.getByRole(t.role, { name: t.name, exact: t.exact !== false });
    else if (t.label) loc = this.page.getByLabel(t.label, { exact: t.exact !== false });
    else if (t.text) loc = this.page.getByText(t.text, { exact: t.exact !== false });
    else if (t.selector) loc = this.page.locator(t.selector);
    else throw new Error(`Bad target ${JSON.stringify(target)}`);
    // Inactive tabs stay mounted (display:none); prefer the visible match.
    return t.nth != null ? loc.nth(t.nth) : loc.locator('visible=true').first();
  }

  // Selects a tab and verifies it is the selected tab of the app tab bar; throws
  // if it is not. A no-op when the tab is already selected (so a blocked bar,
  // e.g. under the first-use walkthrough, still allows the current tab).
  async tab(name) {
    if ((await this.selectedTab()) === name) return;
    await this.page.getByRole('tab', { name, exact: true }).click({ timeout: 5000 });
    await sleep(900);
    const selected = await this.selectedTab();
    if (selected !== name) throw new Error(`Tab ${name} not selected (selected: ${selected})`);
  }

  // Accessible name of the selected tab in the app tab bar, or null. The web
  // build does not emit aria-selected, so the selected tab is the one tab that
  // renders the active indicator (testID tab-bar-indicator).
  async selectedTab() {
    return this.page.evaluate(() => {
      const band = document.querySelector('[data-testid="tab-bar-band"]');
      const bar = band ? band.closest('[role="tablist"]') : null;
      const marks = bar ? bar.querySelectorAll('[data-testid="tab-bar-indicator"]') : [];
      if (marks.length !== 1) return null;
      const tab = marks[0].closest('[role="tab"]');
      return tab ? (tab.getAttribute('aria-label') || tab.textContent.trim()) : null;
    });
  }
  async click(target, { settle = 600 } = {}) { await this.locator(target).click(); await sleep(settle); }
  async waitFor(target, { timeout = 8000 } = {}) { await this.locator(target).waitFor({ state: 'visible', timeout }); }
  async isVisible(target) { return this.locator(target).isVisible().catch(() => false); }
  async wait(ms) { await sleep(ms); }

  // User-driven scroll: real mouse-wheel input over the content, so the app treats
  // it as user scrolling (tab bar auto-hide reacts). `by` is in CSS px; positive = down.
  async wheel(by, { settle = 700, steps = 4 } = {}) {
    await this.page.mouse.move(this.info.viewport.width / 2, this.info.viewport.height / 2);
    for (let i = 0; i < steps; i += 1) { await this.page.mouse.wheel(0, by / steps); await sleep(60); }
    await sleep(settle);
  }
  // Programmatic scroll of the main scroller (or `selector`): 'top', 'end', a y, or { by }.
  // No input events, so the app treats it as a programmatic jump.
  async scrollTo(to, { selector = null, settle = 600 } = {}) {
    const moved = await this.page.evaluate(([sel, target, main]) => {
      // eslint-disable-next-line no-eval
      const el = sel ? document.querySelector(sel) : (0, eval)(main);
      if (!el) return false;
      const before = el.scrollTop;
      if (target === 'top') el.scrollTop = 0;
      else if (target === 'end') el.scrollTop = el.scrollHeight;
      else if (typeof target === 'number') el.scrollTop = target;
      else if (target && typeof target.by === 'number') el.scrollTop += target.by;
      el.dispatchEvent(new Event('scroll'));
      return el.scrollTop !== before;
    }, [selector, to, MAIN_SCROLLER]);
    await sleep(settle);
    return moved;
  }

  // Docked tab bar geometry in CSS px: { top, bottom, height, visible } where
  // visible means on-screen and touchable (hidden bars slide below the viewport).
  async tabBar() {
    return this.page.evaluate((vh) => {
      // The app tab bar is the tablist holding the docked band; screens may
      // render their own tablists (e.g. Analytics chapters).
      const band = document.querySelector('[data-testid="tab-bar-band"]');
      const el = band ? band.closest('[role="tablist"]') : null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const hidden = el.getAttribute('aria-hidden') === 'true' || getComputedStyle(el).pointerEvents === 'none';
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), visible: r.top < vh - 1 && !hidden };
    }, this.info.viewport.height);
  }

  async verifyTheme() {
    const [, , canvas] = THEMES[this.info.theme];
    const bg = await this.page.evaluate(() => {
      const el = document.querySelector('[data-testid="top-safe-area"]');
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    return { ok: bg === hexToRgb(canvas), expected: hexToRgb(canvas), actual: bg };
  }

  async shot(file, { fullPage = false } = {}) {
    const f = path.isAbsolute(file) ? file : path.join(this.info.out, file);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    await this.page.screenshot({ path: f, fullPage });
    return f;
  }

  async close() { await this.ctx.close(); }
}

// Run a declarative action list against a session. Actions:
//   { tab: 'Log' } | { click: target } | { waitFor: target } | { wait: ms }
//   { wheel: px } | { scrollTo: 'top'|'end'|y|{by}, selector? } | { shot: 'file.png' }
//   { run: async (session) => {} }
// target: { testID } | { text, exact? } | { role, name } | { label } | { selector } (+ nth).
async function runActions(session, actions = []) {
  const shots = [];
  for (const a of actions) {
    if (a.tab) await session.tab(a.tab);
    else if (a.click) await session.click(a.click, a);
    else if (a.waitFor) await session.waitFor(a.waitFor, a);
    else if (a.wait != null) await session.wait(a.wait);
    else if (a.wheel != null) await session.wheel(a.wheel, a);
    else if (a.scrollTo != null) await session.scrollTo(a.scrollTo, a);
    else if (a.shot) shots.push(await session.shot(a.shot, a));
    else if (a.run) await a.run(session);
    else throw new Error(`Unknown action ${JSON.stringify(a)}`);
  }
  return shots;
}

// launch({ dist, pw, out }) -> harness. `pw` is the directory that contains the
// `playwright` package (node_modules dir). Call harness.close() when done.
async function launch({ dist, pw, out }) {
  if (!dist || !fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`No Expo web export at ${dist}`);
  const { chromium } = require(path.join(pw, 'playwright'));
  const server = await serve(path.resolve(dist));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  fs.mkdirSync(out, { recursive: true });

  // open({ scenario, overlay, theme, viewport, insets, tab, now }) -> Session at the
  // scenario's first screen (Home unless `tab` is given). `insets` emulates the
  // device safe area ({ top, bottom, left, right } in CSS px).
  async function open({ scenario = 'populated', overlay = null, theme = 'hard-dark', viewport = PHONE, insets = null, tab = null, now = fixtures.FIXED_NOW } = {}) {
    if (!THEMES[theme]) throw new Error(`Unknown theme ${theme}. Known: ${Object.keys(THEMES).join(', ')}`);
    const [court, mode] = THEMES[theme];
    const storage = fixtures.scenarioStorage(scenario, { overlay, now });
    const session = mockSession(now);
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: mode, timezoneId: 'UTC', locale: 'en-US' });
    await ctx.clock.install({ time: now });
    await ctx.addInitScript(([s, store, court, mode, insets]) => {
      if (insets) {
        const real = window.getComputedStyle.bind(window);
        window.getComputedStyle = (el, pseudo) => {
          const cs = real(el, pseudo);
          if (!el || !el.style || !String(el.style.paddingBottom).includes('safe-area-inset')) return cs;
          const px = { paddingTop: insets.top || 0, paddingBottom: insets.bottom || 0, paddingLeft: insets.left || 0, paddingRight: insets.right || 0 };
          return new Proxy(cs, { get: (t, k) => (k in px ? `${px[k]}px` : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
        };
      }
      if (sessionStorage.getItem('kilo-capture-seeded')) return;
      localStorage.setItem('sb-mockproj-auth-token', s);
      localStorage.setItem('kilo.theme_selection', court);
      localStorage.setItem('kilo.appearance_preference', mode);
      for (const [k, v] of Object.entries(store)) {
        if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      }
      sessionStorage.setItem('kilo-capture-seeded', '1');
    }, [JSON.stringify(session), storage, court, mode, insets]);
    await ctx.route('**/*', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.hostname === '127.0.0.1') return route.continue();
      if (u.hostname !== 'mockproj.supabase.co') return route.abort();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const json = (body) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const p = u.pathname;
      if (p.endsWith('/auth/v1/user')) return json(USER);
      if (p.endsWith('/auth/v1/token')) return json(session);
      if (p.endsWith('/rpc/health_sync_preflight')) return json({ allowed: true, code: 'OK' });
      if (p.includes('/rest/v1/')) return json(/vnd\.pgrst\.object/.test(req.headers().accept || '') ? null : []);
      return json({});
    });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await sleep(1800);
    const own = page.getByTestId('ownership-prompt');
    if (await own.isVisible().catch(() => false)) { await own.getByText('Not Now').click(); await sleep(600); }
    const s = new Session(page, ctx, { scenario: typeof scenario === 'string' ? scenario : 'custom', theme, viewport, out });
    if (tab && tab !== 'Home') await s.tab(tab);
    return s;
  }

  // capture({ name, scenario, overlay, themes, tab, viewport, insets, actions })
  // Opens one session per theme, runs `actions`, and (unless actions contain a
  // { shot }) writes `${name}-${theme}.png`. Returns the written paths.
  async function capture({ name, themes = STATE_THEMES, actions = [], ...opts }) {
    const written = [];
    for (const theme of themes) {
      const s = await open({ ...opts, theme });
      try {
        const themed = actions.map((a) => (a.shot ? { ...a, shot: a.shot.replace('{theme}', theme) } : a));
        const shots = await runActions(s, themed);
        if (!shots.length) shots.push(await s.shot(`${name}-${theme}.png`));
        written.push(...shots);
      } finally { await s.close(); }
    }
    return written;
  }

  async function close() { await browser.close(); server.close(); }
  return { open, capture, close, base };
}

// Smoke: every requested scenario x theme x tab first screen, plus theme and
// marker checks, recorded in <out>/smoke-manifest.json. tabs: 'marker' captures
// only each scenario's marker tab. Exit code 1 on any failure.
async function smoke({ dist, pw, out, scenarios = ['populated'], themes = STATE_THEMES, tabs = TABS }) {
  const h = await launch({ dist, pw, out });
  const results = [];
  try {
    for (const scenario of scenarios) {
      const marker = fixtures.SCENARIOS[scenario] && fixtures.SCENARIOS[scenario].marker;
      for (const theme of themes) {
        const s = await h.open({ scenario, theme });
        try {
          const wanted = tabs === 'marker' ? [marker ? marker.tab : 'Home'] : tabs;
          for (const tab of wanted) {
            // Select every requested tab (the session is reused across tabs) and
            // record nothing unless the bar confirms that tab is selected.
            const reached = await s.tab(tab).then(() => true, (e) => { results.push({ scenario, theme, tab, error: String(e.message || e).split('\n')[0] }); return false; });
            if (!reached) continue;
            const selected = await s.selectedTab();
            if (selected !== tab) { results.push({ scenario, theme, tab, error: `selected tab is ${selected}` }); continue; }
            const file = await s.shot(`${scenario}--${tab.toLowerCase()}--${theme}.png`);
            const themeCheck = await s.verifyTheme();
            // The marker belongs to one tab and is checked only on that tab, after
            // the selection check above, against visible text (inactive tabs are hidden).
            const mine = marker && marker.tab === tab ? marker : null;
            let markerCheck = null;
            if (mine && mine.text) markerCheck = await s.isVisible({ text: mine.text, exact: false });
            if (mine && mine.absent) markerCheck = !(await s.isVisible({ text: mine.absent, exact: false }));
            results.push({ scenario, theme, tab, selected_tab: selected, file: path.basename(file), theme_ok: themeCheck.ok, theme_actual: themeCheck.actual, marker: mine, marker_ok: markerCheck });
          }
        } finally { await s.close(); }
      }
    }
  } finally { await h.close(); }
  fs.writeFileSync(path.join(out, 'smoke-manifest.json'), `${JSON.stringify({ fixed_now: fixtures.FIXED_NOW_ISO, results }, null, 2)}\n`);
  const failed = results.filter((r) => r.error || !r.theme_ok || r.marker_ok === false);
  failed.forEach((r) => console.error('SMOKE FAIL', JSON.stringify(r)));
  return { results, failed };
}

module.exports = { TABS, THEMES, STATE_THEMES, FIRST_SCREEN_THEMES, PHONE, launch, runActions, smoke, Session, fixtures };

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
  const list = (v) => (v ? v.split(',').filter(Boolean) : undefined);
  smoke({
    dist: arg('dist'), pw: arg('pw'), out: arg('out'),
    scenarios: arg('scenarios') === 'all' ? Object.keys(fixtures.SCENARIOS) : (list(arg('scenarios')) || ['populated']),
    themes: list(arg('themes')) || STATE_THEMES,
    tabs: arg('tabs') === 'marker' ? 'marker' : (list(arg('tabs')) || TABS),
  }).then(({ results, failed }) => {
    console.log(`smoke: ${results.length} captures, ${failed.length} failed`);
    process.exit(failed.length ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
