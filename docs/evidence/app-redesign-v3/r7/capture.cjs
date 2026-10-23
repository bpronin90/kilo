// R7 (#1606) visual evidence: the note-first Log tab on the real app.
// Usage: node docs/evidence/app-redesign-v3/r7/capture.cjs <distDir> <playwrightModuleDir> [workDir]
// Writes PNGs only to docs/evidence/app-redesign-v3/r7/after/; manifest.json goes
// to workDir (default: a new temp dir), because the evidence folder tracks PNGs only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, FIRST_SCREEN_THEMES, STATE_THEMES } = require('../capture.cjs');
const { edgeRows, deloadOn } = require('./fixtures.cjs');

const [dist, pw, workArg] = process.argv.slice(2);
const out = path.join(__dirname, 'after');
const work = workArg || fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-r7-'));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const record = async (s, file, state) => {
    await s.shot(file);
    manifest.push({ file, scenario: s.info.scenario, theme: s.info.theme, viewport: s.info.viewport, state, theme_check: await s.verifyTheme() });
  };
  // One state per session so a failed step never leaks into the next shot.
  const state = async (opts, file, label, steps = async () => {}) => {
    const s = await h.open({ tab: 'Log', ...opts });
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
      await state({ scenario: 'empty', theme }, `log-empty-${theme}.png`, 'Empty account: first-use Log (no routine actions in the header)');
    }
  } finally {
    await h.close();
  }
  fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const failed = manifest.filter((m) => m.error || (m.theme_check && !m.theme_check.ok));
  console.log(`r7 capture: ${manifest.length} states, ${failed.length} failed; manifest ${path.join(work, 'manifest.json')}`);
  process.exit(failed.length ? 1 : 0);
})();
