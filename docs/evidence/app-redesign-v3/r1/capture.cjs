// R1 (#1600) visual evidence: docked tab bar and shell states on the real app.
// Usage: node docs/evidence/app-redesign-v3/r1/capture.cjs <distDir> <playwrightModuleDir> [workDir]
// Writes PNGs only to docs/evidence/app-redesign-v3/r1/after/ (the smoke shots as
// smoke-*.png). manifest.json and smoke-manifest.json go to workDir (default: a
// new temp dir), because the evidence folder tracks PNGs only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, smoke, TABS, FIRST_SCREEN_THEMES, STATE_THEMES } = require('../capture.cjs');
const { timerOnEmpty } = require('./fixtures.cjs');

const [dist, pw, workArg] = process.argv.slice(2);
const out = path.join(__dirname, 'after');
const work = workArg || fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-r1-'));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const record = async (s, file, state, extra = {}) => {
    await s.shot(file);
    manifest.push({ file, scenario: s.info.scenario, theme: s.info.theme, viewport: s.info.viewport, state, theme_check: await s.verifyTheme(), tab_bar: await s.tabBar(), ...extra });
  };
  try {
    // 1. Five tab first screens in the four required themes (dock at top, bar shown).
    for (const theme of FIRST_SCREEN_THEMES) {
      const s = await h.open({ scenario: 'populated', theme });
      for (const tab of TABS) {
        if (tab !== 'Home') await s.tab(tab);
        await record(s, `first-${tab.toLowerCase()}-${theme}.png`, `${tab} first screen, dock shown at scroll top`);
      }
      await s.close();
    }
    // 2. Tab-bar behaviour states (hard-dark + clay-light).
    for (const theme of STATE_THEMES) {
      let s = await h.open({ scenario: 'populated', theme, tab: 'Log' });
      await s.wheel(700);
      await record(s, `bar-hidden-downscroll-log-${theme}.png`, 'Log after a user down-scroll: bar slid off, untouchable');
      await s.wheel(-240);
      await record(s, `bar-reveal-upscroll-log-${theme}.png`, 'Log after a user up-scroll: bar revealed');
      await s.wheel(4000, { steps: 10 });
      await s.wheel(40000, { steps: 20 });
      await record(s, `bar-reveal-bottom-log-${theme}.png`, 'Log scrolled to the end: bar revealed, final rows clear it');
      // A hidden bar cannot be tapped, so the switch starts from the revealed
      // bar on a scrolled Log; the new tab must open with the bar shown.
      await s.tab('Analytics');
      await record(s, `bar-tab-switch-analytics-${theme}.png`, 'Switched from a scrolled Log to Analytics: bar shown, Analytics active');
      await s.close();

      s = await h.open({ scenario: 'populated', theme, tab: 'More' });
      await record(s, `back-root-more-${theme}.png`, 'More root: web back bar (root tabs have no in-header chevron)');
      await s.click({ text: 'Settings', exact: true });
      await record(s, `back-subscreen-settings-${theme}.png`, 'More > Settings sub-screen: existing Back bar');
      await s.close();

      s = await h.open({ scenario: 'timer-running', theme });
      await record(s, `timer-clearance-home-${theme}.png`, 'Rest timer running on Home: pill sits above the docked bar');
      await s.tab('Weight');
      await record(s, `timer-clearance-weight-${theme}.png`, 'Rest timer running on Weight: pill above the bar on another tab');
      await s.close();

      s = await h.open({ scenario: 'empty', overlay: timerOnEmpty, theme });
      await record(s, `timer-clearance-empty-${theme}.png`, 'Empty account + running timer (R1 overlay): pill clears the bar without scroll');
      await s.close();
    }
    // 3. Bounded alignment checks (hard-dark only).
    let s = await h.open({ scenario: 'populated', theme: 'hard-dark', viewport: { width: 1024, height: 768 } });
    await record(s, 'wide-1024-home-hard-dark.png', 'Wide window 1024x768: tabs share the centered 608dp content column; band spans the window');
    await s.close();
    s = await h.open({ scenario: 'populated', theme: 'hard-dark', insets: { top: 47, bottom: 34, left: 0, right: 0 }, tab: 'Weight' });
    await record(s, 'safe-area-34-weight-hard-dark.png', 'Emulated 47/34 safe area: bar rides on the 34dp inset, band fills beneath to the edge', { insets: { top: 47, bottom: 34 } });
    await s.close();
  } finally {
    await h.close();
  }
  fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // 4. Shared-harness smoke: every scenario reaches its marker state (hard-dark).
  const smokeDir = path.join(work, 'smoke');
  const res = await smoke({ dist, pw, out: smokeDir, scenarios: Object.keys(require('../fixtures.cjs').SCENARIOS), themes: ['hard-dark'], tabs: 'marker' });
  for (const r of res.results) if (r.file) fs.copyFileSync(path.join(smokeDir, r.file), path.join(out, `smoke-${r.file}`));
  const bad = manifest.filter((m) => !m.theme_check.ok);
  console.log(`manifests in ${work}`);
  console.log(`r1: ${manifest.length} captures (${bad.length} theme mismatches); smoke ${res.results.length} (${res.failed.length} failed)`);
  process.exit(bad.length || res.failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
