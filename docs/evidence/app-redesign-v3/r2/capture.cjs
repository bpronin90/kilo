// R2 (#1601) visual evidence: the redesigned Weight screen on the real app.
// Usage: node docs/evidence/app-redesign-v3/r2/capture.cjs <distDir> <playwrightModuleDir> [workDir] [only]
// `only` = "storage" runs just the storage-fault and date-path states (section 10-12).
// Writes PNGs only to docs/evidence/app-redesign-v3/r2/after/; manifest.json goes
// to workDir (default: a new temp dir), because the evidence folder tracks PNGs only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, FIRST_SCREEN_THEMES, STATE_THEMES, PHONE } = require('../capture.cjs');
const { withGoalHistory } = require('./fixtures.cjs');

const [dist, pw, workArg, only] = process.argv.slice(2);
const out = path.join(__dirname, 'after');
const work = workArg || fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-r2-'));
const TALL = { width: PHONE.width, height: 2600 };

// Scroll the Weight scroller so a panel's top sits just under the fixed header.
async function reveal(s, testID, offset = 0) {
  const ok = await s.page.evaluate(([id, off]) => {
    const els = [...document.querySelectorAll(`[data-testid="${id}"]`)].filter((e) => e.offsetParent !== null);
    if (!els.length) return false;
    els[0].scrollIntoView({ block: 'start' });
    let p = els[0].parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && getComputedStyle(p).overflowY !== 'visible')) p = p.parentElement;
    if (p) { p.scrollTop -= 16 - off; p.dispatchEvent(new Event('scroll')); }
    return true;
  }, [testID, offset]);
  if (!ok) throw new Error(`reveal: no visible ${testID}`);
  await s.wait(700);
}

// The web AsyncStorage shim reads synchronously: getItem(key) is
// `new Promise((resolve) => resolve(window.localStorage.getItem(key)))`. So a
// patched Storage.prototype.getItem for the entries key controls the read with
// no product change: throwing rejects it, and returning a never-settling
// thenable keeps it pending (resolve() adopts the thenable). The seeded
// localStorage is untouched; only reads of that one key are faulted.
const ENTRIES_KEY = 'kilo_weight_entries';
async function faultEntriesRead(s, mode) {
  await s.ctx.addInitScript(([key, m]) => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(k) {
      if (k !== key) return real.call(this, k);
      if (m === 'reject') throw new Error('capture: weight entries read failed');
      return { then() {} };
    };
  }, [ENTRIES_KEY, mode]);
  // The harness seeds once per tab (sessionStorage flag), so the reload keeps
  // the fixture and only adds the fault.
  await s.page.reload({ waitUntil: 'load' });
  await s.wait(1800);
  if (mode === 'pending') return;
  const own = s.page.getByTestId('ownership-prompt');
  if (await own.isVisible().catch(() => false)) { await own.getByText('Not Now').click(); await s.wait(600); }
  await s.tab('Weight');
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const record = async (s, file, state) => {
    await s.shot(file);
    manifest.push({ file, scenario: s.info.scenario, theme: s.info.theme, viewport: s.info.viewport, state, theme_check: await s.verifyTheme() });
  };
  const open = (opts) => h.open({ tab: 'Weight', ...opts });
  try {
    // 1. Weight first screen in the four first-screen themes.
    for (const theme of (only === 'storage' ? [] : FIRST_SCREEN_THEMES)) {
      const s = await open({ scenario: 'populated', theme });
      await record(s, `first-weight-${theme}.png`, 'Weight first screen: header, Log weigh-in, Latest, Goal top');
      await s.close();
    }

    for (const theme of (only === 'storage' ? [] : STATE_THEMES)) {
      // 2. Full vertical order on a tall viewport (no scrolling), with goal history.
      let s = await open({ scenario: 'populated', overlay: withGoalHistory, theme, viewport: TALL });
      await record(s, `full-weight-${theme}.png`, 'Full vertical order: Log weigh-in > Latest > Goal > History > Goal history');
      await s.close();

      // 3. Goal states.
      s = await open({ scenario: 'populated', theme });
      await reveal(s, 'weight-goal-panel');
      await record(s, `goal-active-${theme}.png`, 'Active goal with stored start_weight: mode, to go / weeks left, progress, splits, Edit / Clear');
      await s.click({ role: 'button', name: 'Edit' });
      await reveal(s, 'weight-goal-panel');
      await record(s, `goal-edit-form-${theme}.png`, 'Goal Edit: inline existing form with derived preview, Save goal, Cancel');
      await s.close();

      s = await open({ scenario: 'goal-no-start', theme });
      await reveal(s, 'weight-goal-panel');
      await record(s, `goal-no-start-${theme}.png`, 'Active goal without start_weight: no progress bar');
      await s.close();

      s = await open({ scenario: 'goal-ended', theme });
      await reveal(s, 'weight-goal-panel');
      await record(s, `goal-ended-${theme}.png`, 'Goal ended (target date passed): production state, Edit / Archive / Clear');
      await s.close();

      s = await open({ scenario: 'no-goal', theme });
      await reveal(s, 'weight-goal-panel');
      await record(s, `no-goal-${theme}.png`, 'No goal: compact Set a goal, no progress / pace / deficit');
      await s.click({ role: 'button', name: 'Set a goal' });
      await reveal(s, 'weight-goal-panel');
      await record(s, `no-goal-form-open-${theme}.png`, 'No goal after Set a goal: existing goal form');
      await s.close();

      // 4. Empty and one-entry states.
      s = await open({ scenario: 'weigh-in-empty', theme });
      await record(s, `weigh-in-empty-${theme}.png`, 'No weigh-ins: production empty copy, restyled');
      await s.close();
      s = await open({ scenario: 'weigh-in-one', theme });
      await record(s, `weigh-in-one-${theme}.png`, 'One weigh-in: insufficient-data copy');
      await s.close();

      // 5. Entry with weight + note typed.
      s = await open({ scenario: 'populated', theme });
      await s.locator({ label: 'Weight (lb)' }).fill('186.4');
      await s.locator({ label: 'Note' }).fill('Morning, fasted');
      await s.wait(400);
      await record(s, `entry-note-${theme}.png`, 'Log weigh-in with weight and note typed; date button reads Today');
      await s.close();

      // 6. History: filter open, row edit, show more.
      s = await open({ scenario: 'populated', theme });
      await reveal(s, 'weight-history-panel');
      await record(s, `history-${theme}.png`, 'History: HISTORY · N, filter + expand, Weight / Change / Date / delete, Show more');
      await s.click({ testID: 'weight-history-date-filter-header' });
      await reveal(s, 'weight-history-panel');
      await record(s, `history-filter-open-${theme}.png`, 'History date filter open (From / To)');
      await s.close();

      s = await open({ scenario: 'populated', theme });
      await reveal(s, 'weight-history-panel');
      await s.click({ testID: 'weight-history-show-more' });
      // All 43 fixture rows fit the 50-row window, so Show more expands to the end.
      await s.scrollTo('end');
      await record(s, `history-show-more-${theme}.png`, 'History after Show more: expanded to the end of the list (43 < 50-row window)');
      await s.close();

      s = await open({ scenario: 'populated', theme });
      await reveal(s, 'weight-history-panel');
      await s.page.locator('[aria-label^="Edit weigh-in"]').locator('visible=true').first().click();
      await s.wait(900);
      await s.scrollTo('top');
      await record(s, `history-row-edit-${theme}.png`, 'History row tapped: Editing entry + Cancel, Update, row highlighted');
      await s.close();

      // 7. Goal history open.
      s = await open({ scenario: 'populated', overlay: withGoalHistory, theme });
      await s.click({ role: 'button', name: 'Expand goal history' });
      await reveal(s, 'weight-goal-history');
      await record(s, `goal-history-open-${theme}.png`, 'Goal history disclosure open: Target / End Weight / Target Date, outcome colors');
      await s.close();

      // 8. Failed goal read with Retry.
      s = await open({ scenario: 'goal-unreadable', theme });
      await record(s, `goal-unreadable-${theme}.png`, 'Goal read failure: named banner with Retry; derived panels withheld');
      await s.close();

      // 9. Analytics deep link destination.
      s = await open({ scenario: 'populated', theme });
      await s.click({ role: 'button', name: 'Full trend in Analytics' }, { settle: 1500 });
      await record(s, `analytics-deeplink-${theme}.png`, 'After Full trend in Analytics: Analytics tab at the weight section');
      await s.close();
    }

    for (const theme of STATE_THEMES) {
      // 10. Initial entries read still pending. Every tab mounts at launch and
      // shares that one coalesced read, and the app startup overlay (#1372)
      // covers the app until Home's reads settle, so what a user sees is the
      // overlay. The second capture hides only that overlay with injected CSS
      // (no product change) to show the Weight tree rendered in that state.
      let s = await open({ scenario: 'populated', theme });
      await faultEntriesRead(s, 'pending');
      if (!(await s.isVisible({ testID: 'app-startup-overlay' }))) throw new Error('loading: no startup overlay');
      await record(s, `entries-loading-overlay-${theme}.png`, 'Initial entries read pending, user-visible: app startup overlay covers every tab');
      await s.page.addStyleTag({ content: '[data-testid="app-startup-overlay"]{display:none!important}' });
      await s.tab('Weight');
      if (!(await s.isVisible({ testID: 'weight-skeleton' }))) throw new Error('loading: no weight-skeleton');
      await record(s, `entries-loading-${theme}.png`, 'Initial entries read pending, startup overlay hidden by capture CSS: Log weigh-in + loading skeleton, derived panels withheld');
      await s.close();

      // 11. Entries read rejects, nothing cached; the goal read succeeds.
      s = await open({ scenario: 'populated', theme });
      await faultEntriesRead(s, 'reject');
      if (!(await s.isVisible({ role: 'button', name: 'Retry' }))) throw new Error('entries error: no Retry');
      await record(s, `entries-error-${theme}.png`, 'Entries read rejected, no cached entries, goal read OK: entry-error banner with Retry; derived panels withheld');
      await s.close();

      // 12. Weigh-in date path: a non-today date chosen in the date control.
      // The browser-native picker popup is not part of the page and is not
      // in a page screenshot, so this captures the control after selection.
      s = await open({ scenario: 'populated', theme });
      const date = s.locator({ label: 'Weigh-in date' });
      await date.click();
      await s.page.keyboard.press('Escape');
      await date.fill('2026-10-20');
      await s.locator({ label: 'Weight (lb)' }).fill('186.4');
      await s.wait(500);
      await record(s, `entry-date-picked-${theme}.png`, 'Weigh-in date set to 10-20-2026 (non-today) via the date control; button shows the date');
      await s.close();
    }
  } finally {
    await h.close();
  }
  fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const bad = manifest.filter((m) => !m.theme_check.ok);
  console.log(`manifest in ${work}`);
  console.log(`r2: ${manifest.length} captures (${bad.length} theme mismatches)`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
