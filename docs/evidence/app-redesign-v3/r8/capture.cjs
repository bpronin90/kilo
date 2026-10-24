// R8 (#1607) visual evidence: Log exercise history sheet and rest-timer
// surfaces on the real app Expo web export.
// Usage: node docs/evidence/app-redesign-v3/r8/capture.cjs <distDir> <playwrightModuleDir> [workDir] [only]
// Writes PNGs only to docs/evidence/app-redesign-v3/r8/after/; manifest.json goes to workDir.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, FIRST_SCREEN_THEMES, STATE_THEMES } = require('../capture.cjs');
const { repeatedNames, degradedRows } = require('./fixtures.cjs');

const [dist, pw, workArg, onlyArg] = process.argv.slice(2);
const only = onlyArg ? onlyArg.split(',').filter(Boolean) : null;
const out = path.join(__dirname, 'after');
const work = workArg || fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-r8-'));

const openEditor = async (s) => {
  await s.click({ testID: 'log-routine-actions-button' });
  await s.click({ role: 'menuitem', name: 'Edit routine' }, { settle: 1200 });
};
const startTimer = async (s, sec = 90) => {
  await openEditor(s);
  await s.click({ label: 'Rest timer' });
  await s.click({ label: `Start ${sec} second rest timer` }, { settle: 1500 });
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const state = async (opts, file, label, steps = async () => {}) => {
    if (only && !only.some((name) => file.startsWith(`${name}-`))) return;
    const s = await h.open({ tab: 'Log', ...opts });
    s.page.setDefaultTimeout(15000);
    try {
      await s.waitFor({ testID: 'log-root-header' });
      await steps(s);
      await s.shot(file);
      manifest.push({ file, scenario: s.info.scenario, theme: s.info.theme, viewport: s.info.viewport, state: label, rendered_commit: process.env.KILO_RENDERED_COMMIT || null, theme_check: await s.verifyTheme() });
    } catch (e) {
      manifest.push({ file, theme: opts.theme, state: label, error: String(e.message || e).split('\n')[0] });
      console.error('STATE FAIL', file, e.message);
    } finally { await s.close(); }
  };
  try {
    for (const theme of FIRST_SCREEN_THEMES) {
      await state({ theme }, `log-first-${theme}.png`, 'Log first screen: history icon beside Tracked on every exercise');
      await state({ theme }, `home-timer-pill-${theme}.png`, 'Home with a running rest timer: app-shell pill above the tab bar', async (s) => {
        await startTimer(s);
        await s.tab('Home');
      });
    }
    for (const theme of STATE_THEMES) {
      await state({ theme }, `history-sheet-${theme}.png`, 'Bench Press history sheet: top-set line (session 1 → latest) and sessions newest-first', async (s) => {
        await s.click({ testID: 'log-exercise-0-0-0-history' }, { settle: 900 });
      });
      await state({ theme }, `history-point-earlier-${theme}.png`, 'Earlier point (session 1) selected: callout and marker move off the latest point', async (s) => {
        await s.click({ testID: 'log-exercise-0-0-0-history' }, { settle: 900 });
        await s.click({ testID: 'exercise-history-point-1' });
      });
      await state({ overlay: repeatedNames, theme }, `history-repeated-thursday-${theme}.png`, 'Repeated name: Thursday Strength Bench Press opens only its own sessions', async (s) => {
        await s.click({ testID: 'log-exercise-1-0-0-history' }, { settle: 900 });
      });
      await state({ overlay: repeatedNames, theme }, `history-repeated-accessories-${theme}.png`, 'Repeated name: Thursday Accessories Bench Press — BW/skip omitted from the line, single numeric point', async (s) => {
        await s.click({ testID: 'log-exercise-1-1-0-history' }, { settle: 900 });
      });
      await state({ scenario: 'routine-ab', theme }, `history-ab-week-${theme}.png`, 'A/B routine: sheet context names the selected week', async (s) => {
        await s.click({ testID: 'log-exercise-0-0-0-history' }, { settle: 900 });
      });
      await state({ overlay: degradedRows, theme }, `history-bw-only-${theme}.png`, 'Bodyweight-only + skipped: no numeric chart, text fallback, sessions listed', async (s) => {
        await s.click({ testID: 'log-exercise-0-0-0-history' }, { settle: 900 });
      });
      await state({ overlay: degradedRows, theme }, `history-unparsed-${theme}.png`, 'Unparsed and skipped rows kept verbatim; annotation tail shown', async (s) => {
        await s.click({ testID: 'log-exercise-0-0-1-history' }, { settle: 900 });
      });
      await state({ overlay: degradedRows, theme }, `history-timed-${theme}.png`, 'Timed-only exercise: no numeric chart, seconds rows listed', async (s) => {
        await s.click({ testID: 'log-exercise-0-1-0-history' }, { settle: 900 });
      });
      await state({ theme }, `editor-toolbar-idle-${theme}.png`, 'Editor toolbar: idle timer control docked in the editor header', openEditor);
      await state({ theme }, `editor-presets-idle-${theme}.png`, 'Anchored preset panel, idle: 0:30–3:00 presets', async (s) => {
        await openEditor(s);
        await s.click({ label: 'Rest timer' });
      });
      await state({ theme }, `editor-presets-running-${theme}.png`, 'Running: countdown, "of 1:30 rest", progress, active preset, Cancel timer / Dismiss', async (s) => {
        await startTimer(s);
        await s.page.getByRole('button', { name: /^Rest timer, / }).click();
        await s.wait(600);
      });
      await state({ theme }, `editor-timer-cancelled-${theme}.png`, 'After Cancel timer: control back to idle', async (s) => {
        await startTimer(s);
        await s.page.getByRole('button', { name: /^Rest timer, / }).click();
        await s.click({ label: 'Cancel rest timer' });
      });
      await state({ theme }, `editor-timer-done-${theme}.png`, 'Completed: docked control shows Done; panel offers Dismiss', async (s) => {
        await startTimer(s, 30);
        await s.wait(31500);
        await s.click({ label: 'Rest timer, rest over' });
      });
      await state({ theme }, `editor-scrolled-pill-${theme}.png`, 'Editor scrolled past the header: docked control hands off to the app-shell pill', async (s) => {
        await startTimer(s);
        await s.scrollTo(400, { settle: 1200 });
      });
      await state({ theme, insets: { top: 47, bottom: 34 } }, `editor-safe-area-${theme}.png`, 'Inset device: docked control and panel within the safe area', async (s) => {
        await startTimer(s);
        await s.page.getByRole('button', { name: /^Rest timer, / }).click();
        await s.wait(600);
      });
      for (const tab of ['Log', 'Weight', 'Analytics', 'More']) {
        await state({ theme }, `pill-${tab.toLowerCase()}-${theme}.png`, `Running pill on ${tab}${tab === 'Log' ? ' (read view)' : ''}`, async (s) => {
          await startTimer(s);
          if (tab === 'Log') await s.click({ role: 'button', name: 'Done' }, { settle: 1200 });
          else await s.tab(tab);
        });
      }
      await state({ theme }, `pill-done-home-${theme}.png`, 'Completion pill on Home with Dismiss', async (s) => {
        await startTimer(s, 30);
        await s.tab('Home');
        await s.wait(31500);
      });
    }
  } finally {
    fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('manifest', path.join(work, 'manifest.json'));
    await h.close();
  }
})();
