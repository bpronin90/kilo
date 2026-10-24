// R7 (#1606) visual evidence: the note-first Log tab on the real app.
// Usage: node docs/evidence/app-redesign-v3/r7/capture.cjs <distDir> <playwrightModuleDir> [workDir] [only]
// `only` is a comma-separated list of filename prefixes for bounded reruns.
// Writes PNGs only to docs/evidence/app-redesign-v3/r7/after/; manifest.json goes
// to workDir (default: a new temp dir), because the evidence folder tracks PNGs only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, FIRST_SCREEN_THEMES, STATE_THEMES } = require('../capture.cjs');
const { edgeRows, deloadOn, timedRows, completedRecovery, notesUnreadable } = require('./fixtures.cjs');

const [dist, pw, workArg, onlyArg] = process.argv.slice(2);
const only = onlyArg ? onlyArg.split(',').filter(Boolean) : null;
const out = path.join(__dirname, 'after');
const work = workArg || fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-r7-'));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const record = async (s, file, state) => {
    await s.shot(file);
    manifest.push({ file, scenario: s.info.scenario, theme: s.info.theme, viewport: s.info.viewport, state, rendered_commit: process.env.KILO_RENDERED_COMMIT || null, theme_check: await s.verifyTheme() });
  };
  // One state per session so a failed step never leaks into the next shot.
  const state = async (opts, file, label, steps = async () => {}) => {
    if (only && !only.some((name) => file.startsWith(`${name}-`))) return;
    const s = await h.open({ tab: 'Log', ...opts });
    s.page.setDefaultTimeout(15000);
    try {
      await s.waitFor({ testID: 'log-root-header' });
      await steps(s);
      await record(s, file, label);
    } catch (e) {
      manifest.push({ file, theme: opts.theme, state: label, error: String(e.message || e).split('\n')[0] });
      console.error('STATE FAIL', file, e.message);
    } finally { await s.close(); }
  };
  try {
    for (const theme of FIRST_SCREEN_THEMES) {
      await state({ scenario: 'populated', overlay: deloadOn, theme }, `log-first-${theme}.png`, 'Log first screen (Deload mode on): header actions, Routine/Deload, routine panel, day index, Monday');
      await state({ scenario: 'populated', theme }, `log-first-deload-off-${theme}.png`, 'Log first screen, Deload mode off (default): no segmented control');
    }
    for (const theme of STATE_THEMES) {
      await state({ scenario: 'routine-ab', theme }, `log-routine-ab-${theme}.png`, 'A/B routine: Week A/B radio group in the routine panel');
      await state({ scenario: 'populated', theme }, `log-day-tuesday-${theme}.png`, 'Day chip Tue tapped: scrolled to Tuesday, pinned day index under the header', async (s) => {
        await s.click({ role: 'tab', name: 'Tuesday — Lower' }, { settle: 1200 });
      });
      await state({ scenario: 'populated', theme }, `log-history-expanded-${theme}.png`, 'Bench Press earlier sessions expanded in place', async (s) => {
        await s.click({ testID: 'log-exercise-0-0-0-earlier' });
      });
      await state({ scenario: 'populated', theme }, `log-actions-sheet-${theme}.png`, 'Routine actions sheet from the header ⋯', async (s) => {
        await s.click({ testID: 'log-routine-actions-button' });
      });
      await state({ scenario: 'populated', theme }, `log-plates-${theme}.png`, 'Plate calculator from the header Plates button', async (s) => {
        await s.click({ testID: 'log-plate-calculator-button' }, { settle: 900 });
      });
      await state({ scenario: 'populated', theme }, `log-editor-open-${theme}.png`, 'Edit routine (from the actions sheet) opens the existing editor', async (s) => {
        await s.click({ testID: 'log-routine-actions-button' });
        await s.click({ role: 'menuitem', name: 'Edit routine' }, { settle: 1200 });
      });
      await state({ scenario: 'populated', theme }, `log-more-routines-${theme}.png`, 'Bottom of the Log: More routines list', async (s) => {
        await s.scrollTo('end', { settle: 900 });
      });
      await state({ scenario: 'populated', overlay: deloadOn, theme }, `log-deload-${theme}.png`, 'Deload tab after Generate deload: active deload panel', async (s) => {
        await s.click({ text: 'Deload', exact: true });
        await s.click({ text: 'Generate deload', exact: true }, { settle: 1500 });
      });
      await state({ scenario: 'recovery-active', theme }, `log-recovery-${theme}.png`, 'Recovery tab: active block panel', async (s) => {
        if (await s.isVisible({ text: 'Recovery', exact: true })) await s.click({ text: 'Recovery', exact: true });
      });
      await state({ scenario: 'populated', overlay: edgeRows, theme }, `log-edge-rows-${theme}.png`, 'Skipped, BW, kg, timed, annotation and unparsed warning rows (R7 overlay)');
      await state({ scenario: 'populated', overlay: edgeRows, theme }, `log-edge-rows-lower-${theme}.png`, 'Edge rows continued: unparsed warning, annotation, timed sets', async (s) => {
        await s.scrollTo(560);
      });
      await state({ scenario: 'populated', overlay: timedRows, theme }, `log-timed-valid-${theme}.png`, 'Production-valid timed-set grammar: declared 3x30 sec Plank rows render as seconds, alongside BW sessions');
      await state({ scenario: 'empty', theme }, `log-empty-${theme}.png`, 'Empty account: first-use Log (no routine actions in the header)');

      // Preserve the unchanged touch contract: a single set-line tap leaves
      // reading mode in place; a quick double-tap on its exercise name jumps
      // into the existing editor. Pair the adjacent images in the README.
      await state({ scenario: 'populated', theme }, `log-set-line-tap-${theme}.png`, 'Single tap on a set line: remains in the read view', async (s) => {
        await s.click({ testID: 'log-set-line-last' });
      });
      await state({ scenario: 'populated', theme }, `log-set-line-double-tap-editor-${theme}.png`, 'Double-tap Bench Press exercise name: source selection opens the existing editor', async (s) => {
        const name = s.page.getByText('Bench Press', { exact: true }).first();
        await name.dblclick({ delay: 60 });
        await s.waitFor({ testID: 'log-editor-surface' });
      });
      await state({ scenario: 'populated', theme }, `log-editor-syntax-help-${theme}.png`, 'Existing editor opened from the routine actions; syntax help remains reachable', async (s) => {
        await s.click({ testID: 'log-routine-actions-button' });
        await s.click({ role: 'menuitem', name: 'Edit routine' }, { settle: 1200 });
        await s.click({ label: 'Workout syntax help' });
      });
      await state({ scenario: 'recovery-active', theme }, `log-recovery-active-manage-${theme}.png`, 'Active Recovery block management remains reachable from its existing Manage block action', async (s) => {
        await s.click({ text: 'Recovery', exact: true });
        await s.click({ testID: 'recovery-manage-trigger-rb_fixture_1' });
        await s.scrollTo(500, { settle: 900 });
      });
      await state({ scenario: 'populated', overlay: completedRecovery, theme }, `log-recovery-inactive-${theme}.png`, 'No active block: compact Recovery entry opens management with completed history available', async (s) => {
        await s.click({ testID: 'log-recovery-entry' });
      });
      await state({ scenario: 'populated', overlay: completedRecovery, theme }, `log-recovery-completed-history-${theme}.png`, 'Completed block history expanded and selected in inactive management', async (s) => {
        await s.click({ testID: 'log-recovery-entry' });
        await s.click({ testID: 'recovery-history-header' });
        await s.click({ testID: 'recovery-history-row-rb_r7_done' });
        await s.click({ testID: 'recovery-manage-trigger-rb_r7_done' });
        await s.scrollTo(550, { settle: 900 });
      });
      await state({ scenario: 'empty', theme }, `log-no-current-new-routine-${theme}.png`, 'No current routine: New Routine enters the existing editor and offers Save and Import', async (s) => {
        await s.click({ role: 'button', name: 'New Routine' });
      });
      await state({ scenario: 'empty', theme }, `log-adoption-prompt-${theme}.png`, 'Saved routine offers the existing explicit Use as current / Not now adoption choice', async (s) => {
        await s.click({ role: 'button', name: 'New Routine' });
        await s.page.getByPlaceholder('Routine Name (e.g. Push Day)').fill('R7 adoption example');
        await s.page.getByTestId('log-editor-surface').locator('textarea').fill('Monday — Upper\n-Bench Press\n185 5,5,5');
        await s.click({ role: 'button', name: 'Save routine' }, { settle: 1400 });
        await s.waitFor({ testID: 'routine-adoption-prompt' });
        await s.waitFor({ role: 'button', name: 'Use R7 adoption example as your current routine' });
        await s.waitFor({ role: 'button', name: 'Not now. Keep R7 adoption example saved without making it current' });
      });
      await state({ scenario: 'populated', overlay: notesUnreadable, theme }, `log-notes-error-${theme}.png`, 'Unreadable persisted workout notes: error banner and retry affordance remain visible', async (s) => {
        await s.waitFor({ text: 'Could not load workout notes.' });
        await s.waitFor({ role: 'button', name: 'Retry' });
      });
    }

    // The app shell waits for notes hydration. Capture the actual initial Log
    // skeleton during a fresh app boot rather than treating a later static
    // screen as a loading state.
    const shouldCaptureLoading = !only || only.includes('log-loading');
    if (shouldCaptureLoading) for (const theme of STATE_THEMES) {
      const loading = await h.open({ scenario: 'populated', theme, tab: 'Log' });
      loading.page.setDefaultTimeout(15000);
      try {
        await loading.ctx.addInitScript((key) => {
          const orig = Storage.prototype.getItem;
          window.__r7OrigGetItem = orig;
          window.__r7Held = [];
          window.__r7Released = false;
          Storage.prototype.getItem = function getItem(k) {
            if (k === key && !window.__r7Released) {
              const store = this;
              return { then(resolve) { window.__r7Held.push(() => resolve(orig.call(store, k))); } };
            }
            return orig.call(this, k);
          };
        }, 'kilo_workout_notes');
        await loading.page.reload({ waitUntil: 'load' });
        await loading.wait(700);
        const held = await loading.page.evaluate(() => (window.__r7Held || []).length);
        if (held < 1) throw new Error('Fresh Log load did not hold a workout-notes storage read');
        await loading.waitFor({ testID: 'app-startup-overlay', timeout: 10000 });
        await record(loading, `log-loading-overlay-${theme}.png`, `Fresh app boot while workout-note hydration is held; app startup overlay remains visible (${held} held reads)`);
        await loading.page.addStyleTag({ content: '[data-testid="app-startup-overlay"]{display:none!important}' });
        await loading.tab('Log');
        await loading.waitFor({ testID: 'log-skeleton', timeout: 10000 });
        await record(loading, `log-loading-${theme}.png`, 'Same held read, with only the startup overlay hidden by the capture runner: Log first-load skeleton');
        await loading.page.evaluate(() => {
          window.__r7Released = true;
          if (window.__r7OrigGetItem) Storage.prototype.getItem = window.__r7OrigGetItem;
          (window.__r7Held || []).splice(0).forEach((resolve) => resolve());
        });
      } finally { await loading.close(); }
    }
  } finally {
    await h.close();
  }
  fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const failed = manifest.filter((m) => m.error || (m.theme_check && !m.theme_check.ok));
  console.log(`r7 capture: ${manifest.length} states, ${failed.length} failed; manifest ${path.join(work, 'manifest.json')}`);
  process.exit(failed.length ? 1 : 0);
})();
