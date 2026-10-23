// R3 (#1602) visual evidence: Analytics chapters, chapter index, scroll-spy,
// Active Recovery hierarchy and deep links, rendered on the real app.
// Usage: node docs/evidence/app-redesign-v3/r3/capture.cjs <distDir> <playwrightModuleDir> [workDir]
// Writes PNGs only to docs/evidence/app-redesign-v3/r3/after/. manifest.json and
// the smoke manifest go to workDir (default: a new temp dir).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, smoke, FIRST_SCREEN_THEMES, STATE_THEMES } = require('../capture.cjs');
const { routineHealthOn, completedRecovery, recoveryBetweenWeeks, recoveryUnreadable } = require('./fixtures.cjs');

const [dist, pw, workArg] = process.argv.slice(2);
const out = path.join(__dirname, 'after');
const work = workArg || fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-r3-'));

// The chapter index item that currently carries aria-current, and the visible
// chapter headers' top edges (CSS px), so every shot records what it shows.
async function indexState(s) {
  return s.page.evaluate(() => {
    const idx = [...document.querySelectorAll('[data-testid="analytics-chapter-index"]')].find((e) => e.offsetParent);
    const cur = idx ? idx.querySelector('[aria-current="true"]') : null;
    return cur ? cur.getAttribute('data-testid').replace('analytics-chapter-index-', '') : null;
  });
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const record = async (s, file, state, extra = {}) => {
    await s.shot(file);
    manifest.push({ file, scenario: s.info.scenario, theme: s.info.theme, viewport: s.info.viewport, state, active_chapter: await indexState(s), theme_check: await s.verifyTheme(), ...extra });
  };
  try {
    // 1. Normal-training first screen in the four first-screen themes.
    for (const theme of FIRST_SCREEN_THEMES) {
      const s = await h.open({ scenario: 'populated', overlay: routineHealthOn, theme, tab: 'Analytics' });
      await record(s, `first-analytics-${theme}.png`, 'Analytics first screen: root header, chapter index (PROGRESS current), 01 Progress');
      await s.close();
    }
    for (const theme of STATE_THEMES) {
      // 2. Each chapter via an index tap, then scroll-spy after user scrolling.
      let s = await h.open({ scenario: 'populated', overlay: routineHealthOn, theme, tab: 'Analytics' });
      for (const id of ['training', 'bodyweight', 'recovery', 'progress']) {
        await s.click({ testID: `analytics-chapter-index-${id}` }, { settle: 1200 });
        await record(s, `chapter-${id}-${theme}.png`, `Index tap ${id.toUpperCase()}: scrolled to its chapter header, item current`);
      }
      await s.wheel(1400, { steps: 7 });
      await record(s, `spy-midscroll-${theme}.png`, 'User wheel mid-scroll: 02 Training approaching, PROGRESS still current');
      await s.wheel(260, { steps: 2 });
      await record(s, `spy-crossed-${theme}.png`, 'User wheel on: 02 Training reached the top, index switched to TRAINING');
      await s.wheel(40000, { steps: 20 });
      await record(s, `spy-end-${theme}.png`, 'Scrolled to the end: last chapter (RECOVERY) current');
      await s.close();

      // 3. Routine Health with deload + check-ins off (production defaults).
      s = await h.open({ scenario: 'populated', theme, tab: 'Analytics' });
      await s.click({ testID: 'analytics-chapter-index-training' }, { settle: 1200 });
      await s.scrollTo({ by: 780 });
      await record(s, `routine-health-off-${theme}.png`, 'Routine Health, deload + check-ins off: Total gauge only');
      await s.close();
      s = await h.open({ scenario: 'populated', overlay: routineHealthOn, theme, tab: 'Analytics' });
      await s.click({ testID: 'analytics-chapter-index-training' }, { settle: 1200 });
      await s.scrollTo({ by: 780 });
      await record(s, `routine-health-on-${theme}.png`, 'Routine Health, deload + check-ins on: one panel, gauge + Deload row + check-in strip');
      await s.close();

      // 4. Recovery chapter with one completed block in history.
      s = await h.open({ scenario: 'populated', overlay: completedRecovery, theme, tab: 'Analytics' });
      await s.click({ testID: 'analytics-chapter-index-recovery' }, { settle: 1200 });
      await record(s, `recovery-history-${theme}.png`, 'Normal training, 1 completed block: Recovery chapter history entry');
      await s.close();

      // 5. Active Recovery: collapsed, then baseline open.
      s = await h.open({ scenario: 'recovery-active', theme, tab: 'Analytics' });
      await record(s, `active-recovery-${theme}.png`, 'Active Recovery first screen: RECOVERY / BODYWEIGHT / PAUSED, 01 Recovery Active');
      await s.click({ testID: 'analytics-chapter-index-baseline' }, { settle: 1200 });
      await record(s, `active-recovery-paused-${theme}.png`, 'Active Recovery, index tap PAUSED: collapsed dashed baseline toggle');
      await s.click({ testID: 'baseline-disclosure-toggle' }, { settle: 1000 });
      await s.click({ testID: 'analytics-chapter-index-baseline' }, { settle: 1200 });
      await record(s, `active-recovery-baseline-open-${theme}.png`, 'Baseline toggle opened, index tap PAUSED again: chapter header at top, paused body behind the dashed rule');
      await s.close();

      s = await h.open({ scenario: 'recovery-active', overlay: recoveryBetweenWeeks, theme, tab: 'Analytics' });
      await record(s, `active-recovery-between-weeks-${theme}.png`, 'Active Recovery between weeks (week 1 complete)');
      await s.close();
      s = await h.open({ scenario: 'populated', overlay: recoveryUnreadable, theme, tab: 'Analytics' });
      await s.click({ testID: 'analytics-chapter-index-recovery' }, { settle: 1200 });
      await record(s, `recovery-unreadable-${theme}.png`, 'Recovery store unreadable: condition stated, history entry without a count');
      await s.close();

      // 6. Deep links from other tabs.
      s = await h.open({ scenario: 'populated', theme, tab: 'Weight' });
      await s.click({ testID: 'weight-see-full-trends' }, { settle: 1800 });
      await record(s, `deeplink-weight-${theme}.png`, 'Weight "See full trends" -> Analytics weight anchor (Bodyweight chapter)');
      await s.close();
      s = await h.open({ scenario: 'populated', theme });
      await s.click({ label: 'Exercise Progress' }, { settle: 1800 });
      await record(s, `deeplink-overload-${theme}.png`, 'Home Exercise Progress -> Analytics progressive-overload anchor');
      await s.close();
      s = await h.open({ scenario: 'recovery-active', theme });
      await s.click({ testID: 'home-recovery-link' }, { settle: 1800 });
      await record(s, `deeplink-recovery-${theme}.png`, 'Home Recovery link (Recovery active) -> Analytics recovery anchor');
      await s.close();
      // No Home surface links into a paused baseline section during Recovery
      // (the hero drops Exercise Progress and the 1K card), so the auto-expand
      // deep link is covered by tests/analytics-chapter-navigation.test.js.
    }
  } finally {
    await h.close();
  }
  fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const smokeDir = path.join(work, 'smoke');
  const res = await smoke({ dist, pw, out: smokeDir, scenarios: Object.keys(require('../fixtures.cjs').SCENARIOS), themes: ['hard-dark'], tabs: 'marker' });
  const bad = manifest.filter((m) => !m.theme_check.ok);
  console.log(`manifests in ${work}`);
  for (const m of manifest) console.log(`${m.file}\tactive=${m.active_chapter}`);
  console.log(`r3: ${manifest.length} captures (${bad.length} theme mismatches); smoke ${res.results.length} (${res.failed.length} failed)`);
  process.exit(bad.length || res.failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
