// R9 (#1608) visual evidence: More grouped menu and Settings grouped panels on
// the real app Expo web export.
// Usage: node docs/evidence/app-redesign-v3/r9/capture.cjs <distDir> <playwrightModuleDir> [workDir] [only]
// Writes PNGs only to docs/evidence/app-redesign-v3/r9/after/; manifest.json goes to workDir.
//
// The shared harness is used unchanged. Three states need raw Playwright on
// `session.page` (documented in README.md): signed-out (drop the seeded mock
// session, reload), sync error (data writes answer 500, then Upload Local
// History), password recovery (boot on an #error= callback URL) and a
// failed feature-toggle save (make that one localStorage write throw). Reloads
// keep the seeded storage (the harness seeds once per session).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, FIRST_SCREEN_THEMES, STATE_THEMES } = require('../capture.cjs');
const { pendingChange, recoveryPending, remindersOn } = require('./fixtures.cjs');

const [dist, pw, workArg, onlyArg] = process.argv.slice(2);
const only = onlyArg ? onlyArg.split(',').filter(Boolean) : null;
const out = path.join(__dirname, 'after');
const work = workArg || fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-r9-'));

const reload = async (s, settle = 2500) => {
  await s.page.reload({ waitUntil: 'networkidle' });
  await s.wait(settle);
  const own = s.page.getByTestId('ownership-prompt');
  if (await own.isVisible().catch(() => false)) { await own.getByText('Not Now').click(); await s.wait(600); }
};
const toMore = async (s) => { if (s.selectedTab && (await s.selectedTab()) !== 'More') await s.tab('More'); };
const openSettings = async (s) => { await s.click({ label: 'Settings' }, { settle: 900 }); };
const back = async (s) => { await s.click({ text: '← Back', exact: true }, { settle: 900 }); };

const DESTINATIONS = [
  ['settings', 'Settings'],
  ['profile', 'User Profile'],
  ['account', 'Account'],
  ['backup', 'Data and Backup'],
  ['import', 'Import Routine'],
  ['prompts', 'Routine prompt tools'],
  ['guide', 'App Guide'],
  ['about', 'About Kilo'],
];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const state = async (opts, file, label, steps = async () => {}, shotOpts = {}) => {
    if (only && !only.some((name) => file.startsWith(`${name}-`))) return;
    const s = await h.open({ tab: 'More', ...opts });
    s.page.setDefaultTimeout(15000);
    const checks = {};
    try {
      await s.wait(1500);
      await steps(s, checks);
      await s.shot(file, shotOpts);
      manifest.push({ file, scenario: s.info.scenario, theme: s.info.theme, viewport: s.info.viewport, state: label, rendered_commit: process.env.KILO_RENDERED_COMMIT || null, theme_check: await s.verifyTheme(), ...checks });
    } catch (e) {
      manifest.push({ file, theme: opts.theme, state: label, error: String(e.message || e).split('\n')[0] });
      console.error('STATE FAIL', file, e.message);
    } finally { await s.close(); }
  };
  try {
    for (const theme of FIRST_SCREEN_THEMES) {
      await state({ theme }, `more-first-${theme}.png`, 'More first screen: account row, Preferences / Account & data / Tools & help panels', async () => {}, { fullPage: true });
      await state({ theme }, `settings-first-${theme}.png`, 'Settings first screen (full page): Features, Reminders, Appearance, Units, Advanced', openSettings, { fullPage: true });
    }
    for (const theme of STATE_THEMES) {
      await state({ theme }, `more-signed-in-${theme}.png`, 'Signed in: real session email + shell sync status (no sync pass yet: "Ready to sync")');
      await state({ theme }, `more-signed-out-${theme}.png`, 'Signed out: "Not signed in", no sync claim; Account row kept', async (s) => {
        await s.page.evaluate(() => localStorage.removeItem('sb-mockproj-auth-token'));
        await reload(s);
        await toMore(s);
      });
      await state({ theme, overlay: pendingChange }, `more-sync-pending-${theme}.png`, 'Queued local change: status from the shell dirty-queue scan', async () => {});
      await state({ theme, overlay: pendingChange }, `more-sync-error-${theme}.png`, 'Sync error: Upload Local History with mockproj data writes answering 500 (preflight passes); status reads the recorded failure', async (s) => {
        await s.click({ label: 'Data and Backup' }, { settle: 1500 });
        await s.ctx.route('**/rest/v1/**', (route) => (route.request().method() === 'OPTIONS' || route.request().url().includes('/rpc/health_sync_preflight') ? route.fallback() : route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"message":"boom"}' })));
        await s.page.evaluate(() => { const b = [...document.querySelectorAll('[role=button]')].find((x) => x.innerText.trim() === 'Upload Local History'); b.scrollIntoView(); b.click(); });
        await s.wait(5000);
        await back(s);
      });
      for (const [key, label] of DESTINATIONS) {
        await state({ theme }, `dest-${key}-${theme}.png`, `Destination: ${label} (sub-screen content unchanged)`, async (s) => {
          await s.click({ label }, { settle: 1000 });
        });
      }
      await state({ theme }, `back-to-menu-${theme}.png`, 'Back from a destination returns to the grouped menu', async (s, checks) => {
        for (const [, label] of DESTINATIONS) {
          await s.click({ label }, { settle: 700 });
          await back(s);
          if (!(await s.isVisible({ testID: 'more-account-summary' }))) throw new Error(`back from ${label} did not return to the menu`);
        }
        checks.back_routes_checked = DESTINATIONS.map(([, l]) => l);
      });
      await state({ theme }, `settings-toggles-on-${theme}.png`, 'Feature toggles switched on', async (s) => {
        await openSettings(s);
        for (const l of ['Fatigue tracking', 'Deload mode', 'Progression suggestions']) await s.click({ label: l }, { settle: 400 });
      });
      await state({ theme }, `settings-reminder-web-${theme}.png`, 'Switching a reminder on in the web build: production inline notice', async (s) => {
        await openSettings(s);
        await s.click({ label: 'Daily weigh-in reminder' }, { settle: 900 });
        await s.page.getByText('REMINDERS', { exact: true }).scrollIntoViewIfNeeded();
      });
      await state({ theme }, `settings-toggle-failed-${theme}.png`, 'Failed Fatigue tracking save: banner with Retry, switch keeps the stored value', async (s) => {
        await openSettings(s);
        await s.page.evaluate(() => {
          const real = Storage.prototype.setItem;
          Storage.prototype.setItem = function setItem(k, v) {
            if (k === 'kilo_fatigue_tracking_enabled') throw new Error('quota');
            return real.call(this, k, v);
          };
        });
        await s.click({ label: 'Fatigue tracking' }, { settle: 900 });
      });
      await state({ theme, overlay: remindersOn }, `settings-reminder-times-${theme}.png`, 'Reminders stored on: weigh-in and nudge time rows', async (s) => {
        await openSettings(s);
        await s.page.getByText('REMINDERS', { exact: true }).locator('visible=true').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await s.wait(500);
      });
      for (const [court, l] of [['hard', 'Use Hard Court'], ['clay', 'Use Clay Court'], ['grass', 'Use Grass Court']]) {
        await state({ theme }, `settings-court-${court}-${theme}.png`, `Appearance: ${court} court selected`, async (s) => {
          await openSettings(s);
          await s.click({ label: l }, { settle: 700 });
          await s.page.getByText('APPEARANCE', { exact: true }).scrollIntoViewIfNeeded();
        });
      }
      for (const [mode, l] of [['light', 'Use the light appearance'], ['dark', 'Use the dark appearance'], ['system', 'Follow the device appearance']]) {
        await state({ theme }, `settings-mode-${mode}-${theme}.png`, `Appearance: ${mode} mode selected`, async (s) => {
          await openSettings(s);
          await s.click({ label: l }, { settle: 700 });
          await s.page.getByText('APPEARANCE', { exact: true }).scrollIntoViewIfNeeded();
        });
      }
      await state({ theme }, `settings-units-kg-${theme}.png`, 'Units: kg selected (then lb is the other option)', async (s) => {
        await openSettings(s);
        await s.click({ label: 'Show weights in kilograms' }, { settle: 700 });
        await s.page.getByText('UNITS', { exact: true }).scrollIntoViewIfNeeded();
      });
      await state({ theme }, `settings-multiplier-${theme}.png`, 'Advanced: multiplier stepped to 1.09', async (s) => {
        await openSettings(s);
        await s.click({ label: 'Increase fatigue multiplier' }, { settle: 300 });
        await s.click({ label: 'Increase fatigue multiplier' }, { settle: 300 });
        await s.scrollTo('end', { settle: 600 });
      });
      await state({ theme }, `settings-multiplier-reset-${theme}.png`, 'Advanced: Reset to default restores 1.07', async (s) => {
        await openSettings(s);
        await s.click({ label: 'Increase fatigue multiplier' }, { settle: 300 });
        await s.click({ text: 'Reset to default (1.07)', exact: true }, { settle: 500 });
        await s.scrollTo('end', { settle: 600 });
      });
      await state({ theme, overlay: recoveryPending, tab: null }, `recovery-error-${theme}.png`, 'Expired password-recovery link routes to the Account set-password surface with its error', async (s) => {
        // A hash-only goto is a same-document navigation; reload so the app
        // boots on the callback URL, as a tapped email link would.
        await s.page.goto(`${new URL(s.page.url()).origin}/#error=access_denied&error_description=Email+link+is+invalid+or+has+expired`);
        await reload(s, 3000);
      });
      await state({ theme, tab: null }, `cloud-sync-anchor-${theme}.png`, 'Home sync chip opens Data and backup at the Cloud Sync panel (typed subview + anchor)', async (s) => {
        await s.click({ testID: 'home-sync-status' }, { settle: 1500 });
      });
    }
  } finally {
    fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('manifest', path.join(work, 'manifest.json'));
    await h.close();
  }
})();
