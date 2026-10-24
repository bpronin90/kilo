// R6 (#1605) visual evidence: the redesigned Home on the real app (Expo web export).
// Usage: node docs/evidence/app-redesign-v3/r6/capture.cjs <distDir> <playwrightModuleDir> [workDir]
// Writes PNGs only to docs/evidence/app-redesign-v3/r6/after/; manifest.json goes to
// workDir (default: a new temp dir), because the evidence folder tracks PNGs only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, FIRST_SCREEN_THEMES, STATE_THEMES } = require('../capture.cjs');
const o = require('./fixtures.cjs');

const [dist, pw, workArg] = process.argv.slice(2);
const out = path.join(__dirname, 'after');
const work = workArg || fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-r6-'));
const only = process.env.R6_ONLY ? process.env.R6_ONLY.split(',') : null;

// name -> { scenario, overlay, state, steps(session) }. Each is shot in hard-dark
// and clay-light; `steps` may navigate (deep-link targets) before the shot.
const id = (testID) => ({ testID });
const STATES = {
  populated: { scenario: 'populated', overlay: o.oneKSelected, state: 'Populated: routine hero with ring + legend, 1K stacked bar + split, body weight with goal + sparkline' },
  'populated-scrolled': { scenario: 'populated', overlay: o.oneKSelected, state: 'Populated, scrolled to the end: last card clears the docked bar', steps: async (s) => { await s.scrollTo('end'); } },
  'one-k-setup': { scenario: 'populated', state: 'Production fixture without a complete Big 3 cycle: 1K setup line + logged lifts only, no remaining caption' },
  'no-goal': { scenario: 'no-goal', overlay: o.oneKSelected, state: 'No goal: latest weight + sparkline only, no goal context or goal line' },
  'goal-review': { scenario: 'populated', overlay: o.aggressiveGoal, state: 'Active goal with a pace warning: goal context + goal line + Review goal attention' },
  'goal-ended': { scenario: 'goal-ended', overlay: o.oneKSelected, state: 'Goal ended: "Goal ended" caption, no goal line, Review goal attention' },
  'weigh-in-empty': { scenario: 'weigh-in-empty', overlay: o.oneKSelected, state: 'No weigh-ins: "No weigh-in yet", no sparkline, body not a link' },
  'weigh-in-one': { scenario: 'weigh-in-one', overlay: o.oneKSelected, state: 'One weigh-in: latest value, no sparkline (needs two points)' },
  'no-routine': { scenario: 'populated', overlay: o.noCurrentRoutine, state: 'No current routine: "No current routine" label, message, "Choose routine" action' },
  'empty-routine': { scenario: 'populated', overlay: o.emptyRoutine, state: 'Empty current routine: title + "Add exercises" message, no ring' },
  'recovery-open-week': { scenario: 'recovery-active', state: 'Active Recovery, open week: Recovery panel replaces hero, 1K hidden' },
  'recovery-between-weeks': { scenario: 'recovery-active', overlay: o.recoveryBetweenWeeks, state: 'Active Recovery between weeks: Recovery panel, 1K hidden' },
  'recovery-note-missing': { scenario: 'recovery-active', overlay: o.recoveryNoteMissing, state: 'Active Recovery whose week note is missing: fallback line kept' },
  'recovery-retry': { scenario: 'recovery-active', overlay: o.recoveryUnreadable, state: 'Unreadable Recovery record: unverified message + Retry recovery, hero and 1K held, body weight kept' },
  'error-retry': { scenario: 'goal-unreadable', overlay: o.oneKSelected, state: 'Failed goal read: error banner with Retry above the cached dashboard' },
  'sync-notice': { scenario: 'populated', overlay: o.pendingSync, state: 'Queued local change: Cloud Sync notice (pending, or failed + Retry sync) under the header' },
  'timer-home': { scenario: 'timer-running', overlay: o.timerWithOneK, state: 'Rest timer running on Home: app-shell pill above the docked bar', steps: async (s) => { await s.scrollTo('end'); } },
  'timer-log': { scenario: 'timer-running', overlay: o.timerWithOneK, state: 'Rest timer still running after switching to Log', steps: async (s) => { await s.tab('Log'); } },
  'timer-back-home': { scenario: 'timer-running', overlay: o.timerWithOneK, state: 'Rest timer still running back on Home after Weight', steps: async (s) => { await s.tab('Weight'); await s.tab('Home'); } },
  empty: { scenario: 'empty', state: 'Empty account: Welcome panel with Log Workout / Log Weight' },
  'first-use': { scenario: 'first-use', state: 'First use: walkthrough over the Welcome panel' },
  // Cold-start loading (#1372): the shell's startup overlay covers Home until Home's local reads
  // settle. That window is a few ms on the fixture, so it is held by CPU throttling (CDP) after a
  // reload; the shot happens inside `hold` and the overlay's presence is asserted before AND after.
  'loading-cold-start': { scenario: 'populated', overlay: o.oneKSelected, state: 'Cold-start loading: reload with the CPU throttled 200x and shoot while the startup overlay ("Loading your training") is verified present', hold: true },
  'link-ring-analytics': { scenario: 'populated', overlay: o.oneKSelected, state: 'Tapped the ring row: Analytics at Progressive Overload', steps: async (s) => { await s.click(id('home-exercise-progress-link')); await s.wait(1200); } },
  'link-onek-analytics': { scenario: 'populated', overlay: o.oneKSelected, state: 'Tapped 1K Progress title: Analytics at Strength', steps: async (s) => { await s.click(id('home-one-k-link')); await s.wait(1200); } },
  'link-sparkline-analytics': { scenario: 'populated', overlay: o.oneKSelected, state: 'Tapped the body-weight card body / sparkline: Analytics at the weight (Bodyweight) section', steps: async (s) => { await s.click(id('home-weight-trend')); await s.wait(1200); } },
  'link-weight-title': { scenario: 'populated', overlay: o.oneKSelected, state: 'Tapped Body weight title: Weight tab', steps: async (s) => { await s.click(id('home-weight-link')); await s.wait(1000); } },
  'link-review-goal': { scenario: 'goal-ended', overlay: o.oneKSelected, state: 'Tapped Review goal: Weight tab', steps: async (s) => { await s.click(id('home-goal-attention-action')); await s.wait(1000); } },
  'link-recovery-evidence': { scenario: 'recovery-active', state: 'Tapped Recovery Evidence: Analytics at Recovery', steps: async (s) => { await s.click(id('home-recovery-link')); await s.wait(1200); } },
  'link-sync-icon': { scenario: 'populated', overlay: o.oneKSelected, state: 'Tapped the Cloud Sync icon: More > Cloud Sync', steps: async (s) => { await s.click(id('home-sync-status')); await s.wait(1200); } },
  'link-log-workout': { scenario: 'populated', overlay: o.oneKSelected, state: 'Tapped + Log workout: Log tab', steps: async (s) => { await s.click(id('home-current-routine-link')); await s.wait(1000); } },
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const record = async (s, file, state, extra = {}) => {
    await s.shot(file);
    manifest.push({ file, scenario: s.info.scenario, theme: s.info.theme, state, selected_tab: await s.selectedTab().catch(() => null), theme_check: await s.verifyTheme().catch(() => null), ...extra });
  };
  const OVERLAY = '[data-testid="app-startup-overlay"]';
  const holdLoading = async (s, file, state) => {
    const cdp = await s.ctx.newCDPSession(s.page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 200 });
    const count = () => s.page.locator(OVERLAY).count().catch(() => 0);
    try {
      // Throttling makes the window wide but not deterministic, so retry until the overlay is
      // present both before and after the shot (a frame that never saw it is never kept).
      for (let attempt = 1; attempt <= 8; attempt++) {
        await s.page.reload({ waitUntil: 'commit' });
        let before = 0;
        for (let i = 0; i < 400 && !before; i++) { before = await count(); if (!before) await new Promise(r => setTimeout(r, 25)); }
        if (!before) continue;
        const f = path.join(out, file);
        await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 390, height: 844, scale: 2 } }).then(r => fs.writeFileSync(f, Buffer.from(r.data, 'base64')));
        const after = await count();
        if (!after) continue;
        manifest.push({ file, scenario: s.info.scenario, theme: s.info.theme, state, selected_tab: null, theme_check: await s.verifyTheme().catch(() => null), overlay_present_before: true, overlay_present_after: true, attempts: attempt });
        return;
      }
      throw new Error('startup overlay could not be held for a shot after 8 attempts');
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    }
  };
  try {
    if (!only || only.includes('first')) {
      for (const theme of FIRST_SCREEN_THEMES) {
        const s = await h.open({ scenario: 'populated', overlay: o.oneKSelected, theme });
        await record(s, `first-home-${theme}.png`, 'Home first screen');
        await s.close();
      }
    }
    for (const [name, def] of Object.entries(STATES)) {
      if (only && !only.includes(name)) continue;
      for (const theme of STATE_THEMES) {
        const s = await h.open({ scenario: def.scenario, overlay: def.overlay || null, theme });
        try {
          if (def.hold) await holdLoading(s, `${name}-${theme}.png`, def.state);
          else {
            if (def.steps) await def.steps(s);
            await record(s, `${name}-${theme}.png`, def.state);
          }
        } catch (e) {
          manifest.push({ file: `${name}-${theme}.png`, state: def.state, error: String(e && e.message || e) });
        } finally { await s.close(); }
      }
    }
  } finally {
    await h.close();
  }
  fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const errors = manifest.filter(m => m.error);
  console.log(`r6: ${manifest.length} entries, ${errors.length} errors; manifest ${path.join(work, 'manifest.json')}`);
  if (errors.length) { console.log(JSON.stringify(errors, null, 2)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
