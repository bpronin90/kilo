// R4 (#1603) visual evidence: Analytics Bodyweight panel on the real app.
// Usage: node docs/evidence/app-redesign-v3/r4/capture.cjs <distDir> <playwrightModuleDir> [workDir]
// Writes PNGs only to docs/evidence/app-redesign-v3/r4/after/. manifest.json goes to
// workDir (default: a new temp dir). KILO_RENDERED_COMMIT records the rendered SHA.
// Optional: KILO_R4_ONLY=<substring> runs only captures whose file name contains it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, FIRST_SCREEN_THEMES, STATE_THEMES } = require('../capture.cjs');
const fx = require('./fixtures.cjs');

const [dist, pw, workArg] = process.argv.slice(2);
const out = process.env.KILO_R4_OUT || path.join(__dirname, 'after');
const work = workArg || fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-r4-'));
const only = process.env.KILO_R4_ONLY || '';
const ENTRIES_KEY = 'kilo_weight_entries';
const CHART = '[role="slider"][aria-label*="bodyweight"]';

// Index tap to the Bodyweight chapter, then settle.
const toBodyweight = async (s, settle = 1300) => {
  await s.click({ testID: 'analytics-chapter-index-bodyweight' }, { settle });
  await s.scrollTo({ by: 40 });
  await s.wait(300);
};

// Calls a prop of the first mounted React component whose props carry every
// key in `has` (depth-first from the app root): the app's own `onNavigate` on
// AnalyticsScreen, the function every in-app link calls. Used where the sticky
// index cannot be tapped (a read pending or failed); nothing is replaced.
async function callProp(s, has, prop, args = []) {
  const ok = await s.page.evaluate(([keys, name, a]) => {
    const host = document.getElementById('root') || document.body;
    const key = Object.keys(host).find((k) => k.startsWith('__reactContainer$'));
    const stack = key ? [host[key]] : [];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      const p = f.memoizedProps;
      if (p && typeof p === 'object' && keys.every((k) => k in p) && typeof p[name] === 'function') { p[name](...a); return true; }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return false;
  }, [has, prop, args]);
  if (!ok) throw new Error(`No mounted component with ${has.join(', ')} -> ${prop}`);
}
const revealBodyweight = async (s) => {
  await callProp(s, ['sectionNonce', 'onNavigate'], 'onNavigate', ['Analytics', 'weight']);
  await s.wait(1800);
};

// Keyboard traversal of the chart: the first ArrowLeft enters at the latest
// weigh-in, each further one steps to the previous point.
async function select(s, steps) {
  const chart = s.page.locator(CHART).first();
  await chart.focus();
  for (let i = 0; i < steps; i += 1) await chart.press('ArrowLeft');
  await s.wait(500);
}

// Steps back from the latest until the callout shows a weigh-in with a note
// (the fixture notes every ninth day), never stopping on the latest itself.
async function selectWithNote(s) {
  const chart = s.page.locator(CHART).first();
  await chart.focus();
  await chart.press('ArrowLeft');
  for (let i = 0; i < 40; i += 1) {
    await chart.press('ArrowLeft');
    const text = await s.page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-testid="weight-point-callout"]')].find((e) => e.offsetParent !== null);
      return el ? el.innerText : '';
    });
    if (/Morning, fasted/.test(text)) break;
  }
  await s.wait(500);
}

// Facts read from the rendered DOM, recorded with every shot.
async function facts(s) {
  return s.page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null || e.getClientRects().length > 0;
    const q = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].filter(vis);
    const panel = q('bodyweight-panel')[0];
    const text = panel ? panel.innerText.replace(/\n+/g, ' | ') : null;
    const chart = [...document.querySelectorAll('[role="slider"]')].find((e) => vis(e) && /bodyweight/.test(e.getAttribute('aria-label') || ''));
    return {
      panel_text: text,
      weigh_in_dots: q('weigh-in-point').length,
      ring: q('latest-weigh-in-ring').length,
      goal_line: q('weight-goal-line').length,
      callout: q('weight-point-callout').length,
      chart_label: chart ? chart.getAttribute('aria-label') : null,
    };
  });
}

// Reads of one storage key fail (reject) or never settle (pending), with no
// product change: the web AsyncStorage shim reads synchronously through
// Storage.prototype.getItem. The seeded localStorage is untouched.
async function faultRead(s, key, mode) {
  await s.ctx.addInitScript(([k, m]) => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(name) {
      if (name !== k || window.__kiloFaultOff) return real.call(this, name);
      if (m === 'reject') throw new Error('capture: read failed');
      return { then() {} };
    };
  }, [key, mode]);
  await s.page.reload({ waitUntil: 'load' });
  await s.wait(2000);
  const own = s.page.getByTestId('ownership-prompt');
  if (await own.isVisible().catch(() => false)) { await own.getByText('Not Now').click(); await s.wait(600); }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const record = async (s, file, state, extra = {}) => {
    if (only && !file.includes(only)) return;
    await s.shot(file);
    manifest.push({ file, scenario: s.info.scenario, overlay: extra.overlay || null, theme: s.info.theme, viewport: s.info.viewport, state, theme_check: await s.verifyTheme(), facts: await facts(s), rendered_commit: process.env.KILO_RENDERED_COMMIT || null });
  };
  const open = (o) => h.open({ tab: 'Analytics', ...o });
  const stateShot = async (theme, name, state, opts = {}, act = null) => {
    if (only && !`${name}-${theme}.png`.includes(only)) return;
    const s = await open({ theme, ...opts });
    await toBodyweight(s);
    if (act) await act(s);
    await record(s, `${name}-${theme}.png`, state, { overlay: opts.overlayName });
    await s.close();
  };
  try {
    // First screens of the Analytics tab in the four first-screen themes, and
    // the Bodyweight chapter in the same four.
    for (const theme of FIRST_SCREEN_THEMES) {
      const s = await open({ scenario: 'populated', theme });
      await record(s, `first-analytics-${theme}.png`, 'Analytics first screen (Progress chapter), unchanged by this issue');
      await s.close();
      await stateShot(theme, 'bodyweight-first', 'Bodyweight chapter, normal training: Latest weigh-in, 7D AVG, ring, GOAL line, split cells', { scenario: 'populated' });
    }

    for (const theme of STATE_THEMES) {
      const base = { scenario: 'populated' };
      await stateShot(theme, 'bodyweight', 'Normal training Bodyweight: fixed Latest, 7D AVG line over every weigh-in, latest ring, GOAL line, active cutting goal', base);
      await stateShot(theme, 'bodyweight-30d', '30D AVG selected: same weigh-ins and date range, 30-day line', base, async (s) => {
        await s.click({ testID: 'weight-trends-window-30' }, { settle: 700 });
      });
      await stateShot(theme, 'point-selected', 'Earlier weigh-in selected by keyboard: callout with value, date, 7-day average and note; Latest header and ring unchanged', base, (s) => selectWithNote(s));
      await stateShot(theme, 'point-selected-30d', 'Earlier weigh-in selected in the 30D view: callout reads the 30-day average', base, async (s) => {
        await s.click({ testID: 'weight-trends-window-30' }, { settle: 700 });
        await selectWithNote(s);
      });
      await stateShot(theme, 'window-clears-selection', 'Selection made, then 30D chosen: selection cleared, callout gone, Latest unchanged', base, async (s) => {
        await selectWithNote(s);
        await s.click({ testID: 'weight-trends-window-30' }, { settle: 700 });
      });
      await stateShot(theme, 'goal-no-start', 'Active goal without a stored start weight: goal line, mode, target, to-go and pace still shown', { scenario: 'goal-no-start' });
      await stateShot(theme, 'goal-none', 'No goal: no GOAL line, goal split or target pace', { scenario: 'no-goal' });
      await stateShot(theme, 'goal-ended', 'Ended goal (target date passed): no goal decorations', { scenario: 'goal-ended' });
      await stateShot(theme, 'goal-unreadable', 'Goal record unreadable: unverified, no goal decorations', { scenario: 'goal-unreadable' });
      await stateShot(theme, 'goal-bulking', 'Bulking goal: falling weights are away from the goal (negative tone)', { scenario: 'populated', overlay: fx.bulking, overlayName: 'bulking' });
      await stateShot(theme, 'goal-maintain', 'Maintain goal: Goal MAINTAINING, Target pace Maintain', { scenario: 'populated', overlay: fx.maintain, overlayName: 'maintain' });
      await stateShot(theme, 'change-zero', 'Zero change over the last 14 days: neutral 0.0, no arrow', { scenario: 'populated', overlay: fx.zeroChange, overlayName: 'zeroChange' });
      await stateShot(theme, 'pace-spike', 'Spike pace badge kept in the header', { scenario: 'populated', overlay: fx.spike, overlayName: 'spike' });
      await stateShot(theme, 'pace-notable', 'Notable pace badge kept in the header', { scenario: 'populated', overlay: fx.notable, overlayName: 'notable' });
      await stateShot(theme, 'unit-kg', 'Metric display: kg values, one decimal, GOAL in kg', { scenario: 'populated', overlay: fx.metric, overlayName: 'metric' });
      await stateShot(theme, 'unit-lb', 'Imperial display (default): lb values', base);
      await stateShot(theme, 'long-history', '400 daily weigh-ins: every one plotted at its date, one line', { scenario: 'populated', overlay: fx.longHistory, overlayName: 'longHistory' });
      await stateShot(theme, 'empty', 'No weigh-ins: N/A Latest, insufficient-data copy with Log a weigh-in, no goal decorations', { scenario: 'weigh-in-empty' });
      await stateShot(theme, 'one-entry', 'One weigh-in: Latest header, no chart, insufficient-data copy', { scenario: 'weigh-in-one' });
      await stateShot(theme, 'one-date', 'Two weigh-ins on one date: one date is not a chart, insufficient-data copy', { scenario: 'populated', overlay: fx.oneDate, overlayName: 'oneDate' });
      await stateShot(theme, 'active-recovery', 'Active Recovery: the same Bodyweight panel, no duplicate chart', { scenario: 'recovery-active' });

      // Log or manage weight opens Weight.
      let s = await open({ scenario: 'populated', theme });
      await toBodyweight(s);
      await s.click({ testID: 'bodyweight-log-weight' }, { settle: 1200 });
      await record(s, `log-or-manage-${theme}.png`, 'Log or manage weight tapped: the Weight tab opens');
      await s.close();

      // Selection after removal: select an earlier weigh-in, delete exactly that
      // entry on the Weight tab, return: the callout is gone, the ring remains.
      s = await open({ scenario: 'populated', theme });
      await toBodyweight(s);
      await select(s, 4);
      const before = await facts(s);
      s.page.on('dialog', (d) => d.accept().catch(() => {}));
      await s.tab('Weight');
      await s.wait(600);
      await s.page.getByRole('button', { name: 'Delete weight entry' }).nth(3).click();
      await s.wait(900);
      const confirm = s.page.getByRole('button', { name: /^(Delete|Remove)$/ });
      if (await confirm.first().isVisible().catch(() => false)) { await confirm.first().click(); await s.wait(900); }
      await s.tab('Analytics');
      await toBodyweight(s);
      await record(s, `selection-removed-${theme}.png`, `Selected entry deleted on Weight: stale selection cleared (callout before: ${before.callout}), latest ring kept`);
      await s.close();

      // Loading: the entries read never settles. The startup overlay is hidden by
      // capture CSS only, to show the Analytics tree beneath it.
      s = await open({ scenario: 'populated', theme });
      await faultRead(s, ENTRIES_KEY, 'pending');
      await s.page.addStyleTag({ content: '[data-testid="app-startup-overlay"]{display:none!important}' });
      await s.tab('Analytics');
      await revealBodyweight(s);
      await record(s, `loading-${theme}.png`, 'Entries read pending: spinner in place of the chart, Latest N/A');
      await s.close();

      // Read failure with retry: the entries read rejects.
      s = await open({ scenario: 'populated', theme });
      await faultRead(s, ENTRIES_KEY, 'reject');
      await s.tab('Analytics');
      await s.scrollTo('top');
      await record(s, `read-error-${theme}.png`, 'Entries read rejected: error banner with Retry above the chapters');
      await revealBodyweight(s);
      await record(s, `read-error-bodyweight-${theme}.png`, 'Entries read rejected: Bodyweight shows N/A and the insufficient-data copy, no chart');
      // The read heals; the banner's Retry reloads the entries and the chart returns.
      await s.page.evaluate(() => { window.__kiloFaultOff = true; });
      await s.scrollTo('top');
      await s.click({ role: 'button', name: 'Retry' }, { settle: 1500 });
      await revealBodyweight(s);
      await record(s, `read-error-retried-${theme}.png`, 'Retry after the read recovers: banner gone, Bodyweight chart and Latest restored');
      await s.close();

      // Compatibility: charts that do not opt in are unchanged.
      s = await h.open({ scenario: 'populated', theme });
      await record(s, `compat-home-sparkline-${theme}.png`, 'Home weight sparkline (no weightPlot): unchanged');
      await s.close();
      s = await open({ scenario: 'populated', theme });
      await s.click({ testID: 'analytics-chapter-index-progress' }, { settle: 1300 });
      await record(s, `compat-1k-chart-${theme}.png`, 'Progress chapter 1K session chart (no weightPlot): unchanged');
      await s.close();
    }
  } finally {
    await h.close();
  }
  fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const bad = manifest.filter((m) => !m.theme_check.ok);
  console.log(`manifest in ${work}`);
  console.log(`r4: ${manifest.length} captures (${bad.length} theme mismatches)`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
