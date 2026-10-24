// R3 (#1602) visual evidence: Analytics chapters, chapter index, scroll-spy,
// Active Recovery hierarchy and deep links, rendered on the real app.
// Usage: node docs/evidence/app-redesign-v3/r3/capture.cjs <distDir> <playwrightModuleDir> [workDir]
// Writes PNGs only to docs/evidence/app-redesign-v3/r3/after/. manifest.json and
// the smoke manifest go to workDir (default: a new temp dir).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, smoke, FIRST_SCREEN_THEMES, STATE_THEMES } = require('../capture.cjs');
const { routineHealthOn, completedRecovery, recoveryBetweenWeeks, recoveryUnreadable, newBlockStorage } = require('./fixtures.cjs');

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


// Calls a prop of the first mounted React component whose props carry every
// key in `has` (depth-first from the app root). Drives the app's own existing
// paths: `onNavigate` on AnalyticsScreen (App's handleTabPress, the same
// function every in-app link calls) and the Recovery section's `onRetry`
// (the shared Recovery refresh). Nothing in the app is replaced.
async function callProp(s, has, prop, args = []) {
  const ok = await s.page.evaluate(([has, prop, args]) => {
    const host = document.getElementById('root') || document.body;
    const key = Object.keys(host).find((k) => k.startsWith('__reactContainer$'));
    const stack = key ? [host[key]] : [];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      const p = f.memoizedProps;
      if (p && typeof p === 'object' && has.every((k) => k in p) && typeof p[prop] === 'function') {
        p[prop](...args);
        return true;
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return false;
  }, [has, prop, args]);
  if (!ok) throw new Error(`No mounted component with ${has.join(', ')} -> ${prop}`);
}
const navigateTo = async (s, section, settle = 1800) => {
  await callProp(s, ['sectionNonce', 'onNavigate'], 'onNavigate', ['Analytics', section]);
  await s.wait(settle);
};
const refreshRecovery = async (s, settle = 1200) => {
  await callProp(s, ['onRetry', 'stateReady'], 'onRetry');
  await s.wait(settle);
};
const setStorage = (s, entries) => s.page.evaluate((e) => {
  for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
}, entries);

// Slow storage read: until released, AsyncStorage reads of `keys` stay pending
// (getItem returns a pending thenable, which AsyncStorage's promise adopts), so
// the Recovery read sits in LOADING / REFRESHING the way a slow device does.
// Used in-page (holdReads) or from boot (holdReadsFromBoot: init script + reload).
const HOLD_SRC = (keys) => `(() => {
  const keys = ${JSON.stringify(keys)};
  window.__kiloHeld = [];
  const orig = window.__kiloOrigGetItem || Storage.prototype.getItem;
  window.__kiloOrigGetItem = orig;
  Storage.prototype.getItem = function getItem(k) {
    if (keys.includes(k) && !window.__kiloReleased) {
      const store = this;
      return { then(res) { window.__kiloHeld.push(() => res(orig.call(store, k))); } };
    }
    return orig.call(this, k);
  };
})();`;
async function holdReads(s, keys) {
  await s.page.evaluate((src) => { window.__kiloReleased = false; (0, eval)(src); }, HOLD_SRC(keys));
}
async function holdReadsFromBoot(s, keys) {
  await s.ctx.addInitScript(HOLD_SRC(keys));
  await s.page.reload({ waitUntil: 'networkidle' });
  await s.wait(2000);
}
const heldCount = (s) => s.page.evaluate(() => (window.__kiloHeld || []).length);
const releaseReads = (s) => s.page.evaluate(() => {
  window.__kiloReleased = true;
  if (window.__kiloOrigGetItem) Storage.prototype.getItem = window.__kiloOrigGetItem;
  (window.__kiloHeld || []).splice(0).forEach((r) => r());
});
// The startup overlay covers the whole app until Home's local reads settle,
// which include the Recovery read. To show what Analytics renders beneath it
// while the Recovery read is still loading, the runner hides the overlay.
const hideStartupOverlay = (s) => s.page.addStyleTag({ content: '[data-testid="app-startup-overlay"]{display:none!important}' });
(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const record = async (s, file, state, extra = {}) => {
    await s.shot(file);
    manifest.push({ file, scenario: s.info.scenario, theme: s.info.theme, viewport: s.info.viewport, state, active_chapter: await indexState(s), theme_check: await s.verifyTheme(), rendered_commit: process.env.KILO_RENDERED_COMMIT || null, ...extra });
  };
  try {
    if (process.env.KILO_R3_STALE_BASELINE_ONLY === '1') {
      if (!/^[0-9a-f]{40}$/.test(process.env.KILO_RENDERED_COMMIT || '')) {
        throw new Error('KILO_R3_STALE_BASELINE_ONLY requires KILO_RENDERED_COMMIT with the full rendered commit SHA');
      }
      for (const theme of STATE_THEMES) {
        const s = await h.open({ scenario: 'recovery-active', theme, tab: 'Analytics' });
        await s.click({ testID: 'analytics-chapter-index-baseline' }, { settle: 1000 });
        await s.click({ testID: 'baseline-disclosure-toggle' }, { settle: 700 });
        await s.click({ testID: 'analytics-chapter-index-baseline' }, { settle: 800 });
        await s.click({ testID: 'baseline-disclosure-toggle' }, { settle: 700 });
        const collapsed = await s.page.locator('[data-testid="baseline-paused-body"]').count() === 0;
        if (!collapsed) throw new Error('Paused body remained mounted after collapse');

        // Model content above the unmounted disclosure changing height without
        // changing fixtures or product data, then use the real deep-link path.
        await s.page.evaluate(() => {
          const recovery = document.querySelector('[data-testid="recovery-section-anchor"]');
          if (!recovery) throw new Error('Recovery anchor unavailable');
          recovery.style.marginBottom = '1000px';
        });
        await s.wait(400);
        await navigateTo(s, 'strength', 2200);
        const layout = await s.page.evaluate(() => {
          const index = [...document.querySelectorAll('[data-testid="analytics-chapter-index"]')].find((e) => e.offsetParent);
          const body = document.querySelector('[data-testid="baseline-paused-body"]');
          const strength = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent?.trim() === 'Strength');
          const indexRect = index?.getBoundingClientRect();
          const bodyRect = body?.getBoundingClientRect();
          const strengthRect = strength?.getBoundingClientRect();
          return {
            indexBottom: indexRect ? Math.round(indexRect.bottom) : null,
            bodyTop: bodyRect ? Math.round(bodyRect.top) : null,
            strengthTop: strengthRect ? Math.round(strengthRect.top) : null,
          };
        });
        if (layout.indexBottom == null || layout.bodyTop == null || layout.strengthTop == null
          || Math.abs(layout.strengthTop - layout.indexBottom) > 40) {
          throw new Error(`Fresh Strength layout did not land below the sticky index: ${JSON.stringify(layout)}`);
        }
        await record(s, `stale-baseline-remount-${theme}.png`, 'Previously measured paused body collapsed; Recovery content above it grows while unmounted; strength deep link reopens and lands on the fresh Strength layout', { layout });
        await s.close();
      }
      fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`stale-baseline-remount: ${manifest.length} captures from ${process.env.KILO_RENDERED_COMMIT}; manifest in ${work}`);
      return;
    }

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

      // 7. Deep-link auto-expand during Recovery: baseline collapsed, then an
      // incoming `strength` / `progressive-overload` request through App's
      // own navigate function (no Home surface links there during Recovery).
      for (const section of ['strength', 'progressive-overload']) {
        s = await h.open({ scenario: 'recovery-active', theme, tab: 'Analytics' });
        await navigateTo(s, section, 2200);
        await record(s, `deeplink-${section}-auto-expand-${theme}.png`, `Recovery active, baseline collapsed, incoming section=${section}: baseline auto-expands, lands on the section`);
        await s.close();
      }

      // 8. Repeated old section ids and the bodyweight alias (normal training).
      s = await h.open({ scenario: 'populated', theme, tab: 'Analytics' });
      await navigateTo(s, 'weight');
      await record(s, `ids-weight-${theme}.png`, 'section=weight lands on Weight Trends (03 Bodyweight)');
      await s.scrollTo('top');
      await navigateTo(s, 'weight');
      await record(s, `ids-weight-repeat-${theme}.png`, 'section=weight repeated after scrolling to top: lands again (nonce)');
      await s.scrollTo('top');
      await navigateTo(s, 'bodyweight');
      await record(s, `ids-bodyweight-alias-${theme}.png`, 'section=bodyweight (alias) lands on the same weight anchor');
      await navigateTo(s, 'strength');
      await record(s, `ids-strength-${theme}.png`, 'section=strength lands on Strength (01 Progress)');
      await navigateTo(s, 'recovery');
      await record(s, `ids-recovery-${theme}.png`, 'section=recovery lands on the Recovery chapter body (anchor always present)');
      await navigateTo(s, 'overview');
      await record(s, `ids-overview-${theme}.png`, 'section=overview returns to the top of Analytics');
      await s.close();

      // 9. Session Check-ins: details expanded, then the edit sheet.
      s = await h.open({ scenario: 'populated', overlay: routineHealthOn, theme, tab: 'Analytics' });
      await s.click({ testID: 'analytics-chapter-index-training' }, { settle: 1200 });
      await s.scrollTo({ by: 780 });
      await s.click({ label: 'Expand session check-in details' }, { settle: 900 });
      await record(s, `checkins-expanded-${theme}.png`, 'Check-ins enabled, details expanded: flagged sessions listed with edit targets');
      await s.click({ selector: '[aria-label^="Edit check-in for"]' }, { settle: 1200 });
      await record(s, `checkins-edit-${theme}.png`, 'Check-in edit: tapping a flagged session opens the edit sheet');
      await s.close();

      // 10. New Recovery block resets the baseline disclosure to collapsed.
      s = await h.open({ scenario: 'recovery-active', theme, tab: 'Analytics' });
      await s.click({ testID: 'analytics-chapter-index-baseline' }, { settle: 1200 });
      await s.click({ testID: 'baseline-disclosure-toggle' }, { settle: 1000 });
      await record(s, `newblock-before-open-${theme}.png`, 'Block 1 active, baseline disclosure opened');
      await setStorage(s, newBlockStorage(await s.page.evaluate(() => ({ b: localStorage.getItem('kilo_recovery_blocks'), w: localStorage.getItem('kilo_recovery_block_weeks') }))));
      await refreshRecovery(s, 1600);
      await s.click({ testID: 'analytics-chapter-index-baseline' }, { settle: 1200 });
      await record(s, `newblock-reset-${theme}.png`, 'Block 1 completed and block 2 started (storage + shared Recovery refresh): disclosure back to collapsed');
      await s.click({ testID: 'analytics-chapter-index-recovery' }, { settle: 1200 });
      await record(s, `newblock-recovery-${theme}.png`, 'Same session, Recovery chapter: the new block (Travel, started today) is the active one');
      await s.close();

      // 11. Recovery read states over verified data: refreshing, stale, retry.
      s = await h.open({ scenario: 'recovery-active', theme, tab: 'Analytics' });
      const goodBlocks = await s.page.evaluate(() => localStorage.getItem('kilo_recovery_blocks'));
      await holdReads(s, ['kilo_recovery_blocks']);
      await refreshRecovery(s, 900);
      await record(s, `state-refreshing-${theme}.png`, 'Refresh in flight over verified data (read held): evidence stays as last verified, no banner (production behaviour)', { held_reads: await heldCount(s) });
      await releaseReads(s);
      await s.wait(900);
      await setStorage(s, { kilo_recovery_blocks: '{not json' });
      await refreshRecovery(s, 1200);
      await record(s, `state-stale-${theme}.png`, 'Refresh failed after a verified read: stale banner, last-known-good kept, Retry recovery');
      await setStorage(s, { kilo_recovery_blocks: goodBlocks });
      await holdReads(s, ['kilo_recovery_blocks']);
      await s.click({ text: 'Retry recovery' }, { settle: 900 });
      await record(s, `state-stale-retrying-${theme}.png`, 'Retry tapped while the read is slow: stale banner stays, Retry disabled while refreshing', { held_reads: await heldCount(s) });
      await releaseReads(s);
      await s.wait(1400);
      await record(s, `state-stale-retried-${theme}.png`, 'Read completes: verified Recovery restored, banner gone');
      await s.close();

      // 12. Unverified read states (normal training): error -> retrying -> ready.
      s = await h.open({ scenario: 'populated', overlay: recoveryUnreadable, theme, tab: 'Analytics' });
      await s.click({ testID: 'analytics-chapter-index-recovery' }, { settle: 1200 });
      await record(s, `state-error-${theme}.png`, 'Recovery store unreadable on first read: error banner with Retry recovery, history row without a count');
      await holdReads(s, ['kilo_recovery_blocks']);
      await setStorage(s, { kilo_recovery_blocks: '[]' });
      await s.click({ text: 'Retry recovery' }, { settle: 900 });
      await record(s, `state-error-retrying-${theme}.png`, 'Retry tapped while the read is slow: the error stays stated until a read succeeds', { held_reads: await heldCount(s) });
      await releaseReads(s);
      await s.wait(1400);
      await record(s, `state-error-retried-${theme}.png`, 'Read completes: verified, "No completed recovery blocks yet"');
      await s.close();

      // 12b. Initial loading: the Recovery read held from boot.
      s = await h.open({ scenario: 'populated', overlay: completedRecovery, theme, tab: 'Analytics' });
      await holdReadsFromBoot(s, ['kilo_recovery_blocks']);
      await callProp(s, ['onTabPress'], 'onTabPress', ['Analytics', 'recovery']);
      await s.wait(1500);
      await record(s, `state-loading-overlay-${theme}.png`, 'Recovery read held from boot: the app startup overlay covers every tab (production)', { held_reads: await heldCount(s) });
      await hideStartupOverlay(s);
      await s.wait(500);
      await record(s, `state-loading-${theme}.png`, 'Same moment with the startup overlay hidden by the runner: Analytics Recovery chapter states loading, history row has no count');
      await releaseReads(s);
      await s.wait(1600);
      // The reload re-raises the first-sign-in ownership prompt (open() dismisses it once).
      if (await s.isVisible({ testID: 'ownership-prompt' })) await s.click({ text: 'Not Now' }, { settle: 800 });
      await record(s, `state-loading-done-${theme}.png`, 'Read released: verified history, "1 completed block"');
      await s.close();

      // 13. Missing data.
      s = await h.open({ scenario: 'empty', theme, tab: 'Analytics' });
      await record(s, `missing-empty-${theme}.png`, 'Empty account: Analytics first screen without routine or weigh-ins');
      await s.close();
      s = await h.open({ scenario: 'weigh-in-empty', theme, tab: 'Analytics' });
      await s.click({ testID: 'analytics-chapter-index-bodyweight' }, { settle: 1200 });
      await record(s, `missing-weighins-${theme}.png`, 'No weigh-ins: Bodyweight chapter empty state');
      await s.close();
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
