// R2 (#1601) visual evidence: the redesigned Weight screen on the real app.
// Usage: node docs/evidence/app-redesign-v3/r2/capture.cjs <distDir> <playwrightModuleDir> [workDir]
// Writes PNGs only to docs/evidence/app-redesign-v3/r2/after/; manifest.json goes
// to workDir (default: a new temp dir), because the evidence folder tracks PNGs only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, FIRST_SCREEN_THEMES, STATE_THEMES, PHONE } = require('../capture.cjs');
const { withGoalHistory } = require('./fixtures.cjs');

const [dist, pw, workArg] = process.argv.slice(2);
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
    for (const theme of FIRST_SCREEN_THEMES) {
      const s = await open({ scenario: 'populated', theme });
      await record(s, `first-weight-${theme}.png`, 'Weight first screen: header, Log weigh-in, Latest, Goal top');
      await s.close();
    }

    for (const theme of STATE_THEMES) {
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
  } finally {
    await h.close();
  }
  fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const bad = manifest.filter((m) => !m.theme_check.ok);
  console.log(`manifest in ${work}`);
  console.log(`r2: ${manifest.length} captures (${bad.length} theme mismatches)`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
