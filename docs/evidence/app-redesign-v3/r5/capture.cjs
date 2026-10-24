// R5 (#1604) visual evidence: Analytics Progress (1K panel, Progressive Overload) on the real app.
// Usage: node docs/evidence/app-redesign-v3/r5/capture.cjs <distDir> <playwrightModuleDir> [workDir]
// Writes PNGs only to docs/evidence/app-redesign-v3/r5/after/ (KILO_R5_OUT overrides). manifest.json
// goes to workDir (default: a new temp dir). KILO_RENDERED_COMMIT records the rendered SHA.
// Optional: KILO_R5_ONLY=<substring> runs only captures whose file name contains it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, FIRST_SCREEN_THEMES, STATE_THEMES } = require('../capture.cjs');
const fx = require('./fixtures.cjs');

const [dist, pw, workArg] = process.argv.slice(2);
const out = process.env.KILO_R5_OUT || path.join(__dirname, 'after');
const work = workArg || fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-r5-'));
const only = process.env.KILO_R5_ONLY || '';
const NOTES_KEY = 'kilo_workout_notes';

// Scrolls the element to just under the sticky header + chapter index.
async function reveal(s, testID, offset = -150) {
  await s.page.evaluate((id) => {
    const el = [...document.querySelectorAll(`[data-testid="${id}"]`)].find((e) => e.getClientRects().length > 0);
    if (el) el.scrollIntoView({ block: 'start' });
  }, testID);
  await s.wait(200);
  await s.scrollTo({ by: offset });
  await s.wait(500);
}
const toStrength = (s) => reveal(s, 'onek-panel', -230);
const toOverload = (s) => reveal(s, 'progressive-overload-section', -170);
const toTable = (s) => reveal(s, 'po-header', -170);

// Facts read from the rendered DOM, recorded with every shot.
async function facts(s) {
  return s.page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0;
    const q = (sel) => [...document.querySelectorAll(sel)].filter(vis);
    const tid = (id) => q(`[data-testid="${id}"]`);
    const rows = q('[data-testid^="po-row-"]');
    const chip = (k) => tid(`po-filter-${k}`)[0];
    const onek = tid('onek-panel')[0];
    return {
      onek_text: onek ? onek.innerText.replace(/\n+/g, ' | ').slice(0, 220) : null,
      rows: rows.length,
      row_min_height: rows.length ? Math.min(...rows.map((r) => Math.round(r.getBoundingClientRect().height))) : null,
      row_names: rows.slice(0, 12).map((r) => (r.innerText.split('\n')[0] || '').trim()),
      chips: ['all', 'progressing', 'stalled', 'regressing'].map((k) => { const c = chip(k); return c ? `${k}:${c.getAttribute('aria-checked') === 'true' ? 'on' : 'off'}:${c.innerText.replace(/\n+/g, ' ')}` : null; }).filter(Boolean),
      sheet: tid('po-exercise-sheet').length > 0 || document.querySelectorAll('[data-testid="po-exercise-sheet"]').length > 0,
      group_headers: q('[data-testid^="po-group-header-"]').map((g) => g.innerText.replace(/\n+/g, ' ')),
    };
  });
}

// Reads of one storage key fail (reject) or never settle (pending), with no
// product change: the web AsyncStorage shim reads synchronously through
// Storage.prototype.getItem. The seeded localStorage is untouched.
async function faultRead(s, key, mode) {
  await s.ctx.addInitScript(([k, m]) => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(name) {
      if (name !== k || window.__kiloFaultOff) return real.call(this, name);
      if (m === 'reject') throw new Error('capture: read failed');
      return { then() {} };
    };
  }, [key, mode]);
  await s.page.reload({ waitUntil: 'load' });
  await s.wait(2000);
  const own = s.page.getByTestId('ownership-prompt');
  if (await own.isVisible().catch(() => false)) { await own.getByText('Not Now').click(); await s.wait(600); }
}

// Writes of one storage key fail, so saving the Big 3 mapping rejects.
async function faultWrite(s, key) {
  await s.page.evaluate((k) => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(name, value) {
      if (name === k) throw new Error('capture: write failed');
      return real.call(this, name, value);
    };
  }, key);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const h = await launch({ dist, pw, out });
  const manifest = [];
  const record = async (s, file, state, extra = {}) => {
    if (only && !file.includes(only)) return;
    await s.shot(file);
    manifest.push({ file, scenario: s.info.scenario, overlay: extra.overlay || null, theme: s.info.theme, viewport: s.info.viewport, state, theme_check: await s.verifyTheme(), facts: await facts(s), rendered_commit: process.env.KILO_RENDERED_COMMIT || null });
  };
  const open = (o) => h.open({ tab: 'Analytics', ...o });
  const wants = (name, theme) => !only || `${name}-${theme}.png`.includes(only);
  // One state: open Analytics with the scenario/overlay, move to `where`, act, shoot.
  const stateShot = async (theme, name, state, opts = {}, where = toOverload, act = null) => {
    if (!wants(name, theme)) return;
    const s = await open({ theme, scenario: 'populated', ...opts });
    if (where) await where(s);
    if (act) await act(s);
    await record(s, `${name}-${theme}.png`, state, { overlay: opts.overlayName });
    await s.close();
  };
  const withOverlay = (overlay, overlayName) => ({ overlay, overlayName });
  const press = (s, testID, settle = 500) => s.click({ testID }, { settle });
  const search = async (s, text) => { await s.page.getByTestId('po-search').fill(text); await s.wait(500); };
  const sheet = async (s, rowId) => {
    await s.page.locator(`[data-testid^="po-row-${rowId}"]`).first().click();
    await s.wait(700);
  };

  try {
    // First screens of the Analytics tab (Progress chapter) in the four first-screen themes.
    for (const theme of FIRST_SCREEN_THEMES) {
      await stateShot(theme, 'first-progress', 'Analytics first screen: Strength 1K panel, Big 3 mapping and the start of Progressive Overload', withOverlay(fx.bigThree, 'bigThree'), null);
      await stateShot(theme, 'first-progress-unmapped', 'Analytics first screen with the Big 3 not mapped to routine lifts: setup copy and the mapping disclosure', {}, null);
    }

    for (const theme of STATE_THEMES) {
      const big3 = withOverlay(fx.bigThree, 'bigThree');
      // 1K panel.
      await stateShot(theme, 'onek-summary', '1K Progress panel: total / 1,000 lb, to go, per-lift stacked bar, Squat / Bench / Deadlift values, chart and mapping disclosures collapsed', big3, toStrength);
      await stateShot(theme, 'onek-info', 'What is 1K Progress? info open under the heading', big3, toStrength, async (s) => { await press(s, 'onek-info-toggle'); });
      await stateShot(theme, 'onek-chart-open', '1K total over sessions disclosure open: the unchanged session chart', big3, toStrength, async (s) => { await press(s, 'onek-chart-disclosure-toggle', 800); });
      await stateShot(theme, 'onek-chart-selected', 'Earlier session selected on the chart: headline total and the three lifts show that session; deload/routine markers unchanged', big3, toStrength, async (s) => {
        await press(s, 'onek-chart-disclosure-toggle', 800);
        const chart = s.page.locator('[role="slider"]').first();
        await chart.focus();
        for (let i = 0; i < 4; i += 1) await chart.press('ArrowLeft');
        await s.wait(500);
      });
      await stateShot(theme, 'onek-plates', 'Tapping a lift opens the existing plate-loading sheet', big3, toStrength, async (s) => {
        await s.page.getByRole('button', { name: /Show plate loading for Squat/ }).first().click();
        await s.wait(900);
      });
      await stateShot(theme, 'onek-mapping-open', 'Big 3 mapping disclosure open: Bench / Squat / Deadlift rows with current mapped lifts', big3, toStrength, async (s) => {
        await s.page.getByRole('button', { name: 'Expand Big 3 mapping' }).click();
        await s.wait(600);
        await s.scrollTo({ by: 200 });
        await s.wait(400);
      });
      await stateShot(theme, 'onek-mapping-change', 'A slot opened: the picker lists the routine lifts, the mapped one selected', big3, toStrength, async (s) => {
        await s.page.getByRole('button', { name: 'Expand Big 3 mapping' }).click();
        await s.wait(500);
        await s.page.getByRole('button', { name: /^Bench, Bench Press, expand/ }).click();
        await s.wait(600);
        await s.scrollTo({ by: 250 });
        await s.wait(400);
      });
      await stateShot(theme, 'onek-mapping-changed', 'Squat remapped to Back Squat then Deadlift remapped: saved selection reflected in the summary line and the 1K values', big3, toStrength, async (s) => {
        await s.page.getByRole('button', { name: 'Expand Big 3 mapping' }).click();
        await s.wait(500);
        await s.page.getByRole('button', { name: /^Squat, Back Squat, expand/ }).click();
        await s.wait(500);
        await s.page.getByRole('button', { name: 'Use Front Squat for Squat' }).first().click({ timeout: 2000 }).catch(() => {});
        await s.wait(900);
      });
      await stateShot(theme, 'onek-mapping-failure', 'Saving the mapping fails (note write rejected): the picker and the existing mapping stay as they were', big3, toStrength, async (s) => {
        await faultWrite(s, NOTES_KEY);
        await s.page.getByRole('button', { name: 'Expand Big 3 mapping' }).click();
        await s.wait(500);
        await s.page.getByRole('button', { name: /^Bench, Bench Press, expand/ }).click();
        await s.wait(500);
        await s.page.getByRole('button', { name: /Use Incline Dumbbell Press for Bench/ }).click({ timeout: 2000 }).catch(() => {});
        await s.wait(900);
        await s.scrollTo({ by: 120 });
        await s.wait(300);
      });

      // Progressive Overload.
      await stateShot(theme, 'overload-all', 'Progressive Overload: Exercise Progress with status bar and All / Progressing / Steady / Regressing chips, search, column header, per-day groups', big3, toOverload);
      await stateShot(theme, 'overload-rows', 'Rows: name + trend pill over right-aligned 1RM / Kilo / Best values under the header, >=60dp, non-weighted AVG / BEST kept', big3, toTable, async (s) => { await s.scrollTo({ by: 330 }); await s.wait(300); });
      await stateShot(theme, 'overload-filter-progressing', 'Progressing chip selected: only Progressing rows; the counts stay canonical', big3, toOverload, async (s) => { await press(s, 'po-filter-progressing'); });
      await stateShot(theme, 'overload-filter-steady', 'Steady chip selected: only Steady rows', big3, toOverload, async (s) => { await press(s, 'po-filter-stalled'); });
      await stateShot(theme, 'overload-filter-regressing', 'Regressing chip selected (Leg Press loses load): only Regressing rows', withOverlay(fx.regressing, 'regressing'), toOverload, async (s) => { await press(s, 'po-filter-regressing'); });
      await stateShot(theme, 'overload-filter-regressing-none', 'Regressing chip with no regressing exercise: "No exercises match this filter", chips stay so it can be cleared', big3, toOverload, async (s) => { await press(s, 'po-filter-regressing'); });
      await stateShot(theme, 'overload-search', 'Search "press" composed with the Progressing chip', big3, toOverload, async (s) => { await press(s, 'po-filter-progressing'); await search(s, 'press'); });
      await stateShot(theme, 'overload-no-match', 'Search with no match: No matches message, the search box stays to clear', big3, toOverload, async (s) => { await search(s, 'zzz'); });
      await stateShot(theme, 'overload-collapse-day', 'One day group collapsed on its own: header stays with its count, rows hidden', big3, toTable, async (s) => { await press(s, 'po-group-header-TUESDAY'); });
      await stateShot(theme, 'overload-collapse-all', 'Collapse all: every group collapsed, the control reads Expand all', big3, toOverload, async (s) => { await press(s, 'po-collapse-all'); await s.scrollTo({ by: 560 }); await s.wait(400); });
      await stateShot(theme, 'overload-suggestion', 'Progression suggestion inside the panel (Incline Dumbbell Press 3x8-10) with Open in Log / dismiss / mute', withOverlay(fx.suggestion, 'suggestion'), toOverload, async (s) => { await s.scrollTo({ by: 360 }); await s.wait(400); });
      await stateShot(theme, 'overload-muted', 'Muted exercise keeps its muted row with Unmute', withOverlay(fx.muted, 'muted'), toOverload, async (s) => { await s.scrollTo({ by: 360 }); await s.wait(400); });
      await stateShot(theme, 'overload-explainer-progress', 'Exercise Progress explainer open: only its own topic', big3, toOverload, async (s) => { await press(s, 'po-progress-info-toggle'); });
      await stateShot(theme, 'overload-explainer-metrics', 'Metrics explainer open: only the 1RM / Kilo / Best / Trend topic', big3, toTable, async (s) => { await press(s, 'po-metrics-info-toggle'); });
      await stateShot(theme, 'overload-cross-day', 'Bench Press on two days: the cross-day comparison (and the Also on line) sit in its row', withOverlay(fx.crossDay, 'crossDay'), toTable, async (s) => { await s.scrollTo({ by: 330 }); await s.wait(300); });
      await stateShot(theme, 'overload-sheet', 'Row tapped: detail sheet with 1RM / Kilo / Best, trend pill and the parsed logged sets, newest first', big3, toOverload, async (s) => { await s.scrollTo({ by: 500 }); await s.wait(300); await sheet(s, 'back squat'); });
      await stateShot(theme, 'overload-sheet-nonweighted', 'Detail sheet for a non-weighted exercise (Pull Up): AVG / BEST and its parsed sets', big3, toOverload, async (s) => { await s.scrollTo({ by: 900 }); await s.wait(300); await sheet(s, 'pull up'); });
      await stateShot(theme, 'overload-sheet-closed', 'Sheet closed again: the list and the filter/scroll state are as they were', big3, toOverload, async (s) => {
        await s.scrollTo({ by: 500 }); await s.wait(300); await sheet(s, 'back squat');
        await press(s, 'po-sheet-close', 700);
      });
      await stateShot(theme, 'overload-empty', 'No tracked exercises: the existing empty state with Go to Log', withOverlay(fx.untracked, 'untracked'), toOverload);
      await stateShot(theme, 'overload-baseline', 'Every tracked exercise on its first session: the establishing-baseline message replaces the counts, no chips', withOverlay(fx.baseline, 'baseline'), toOverload);

      // Loading and read failure of the notes.
      if (wants('overload-loading', theme)) {
        const s = await open({ theme, scenario: 'populated' });
        await faultRead(s, NOTES_KEY, 'pending');
        await s.page.addStyleTag({ content: '[data-testid="app-startup-overlay"]{display:none!important}' });
        await s.tab('Analytics');
        await s.wait(800);
        await toOverload(s);
        await record(s, `overload-loading-${theme}.png`, 'Notes read pending: spinner in place of the list, no counts, no chips');
        await s.close();
      }
      if (wants('overload-error', theme)) {
        const s = await open({ theme, scenario: 'populated' });
        await faultRead(s, NOTES_KEY, 'reject');
        await s.tab('Analytics');
        await s.scrollTo('top');
        await s.wait(500);
        await record(s, `overload-error-${theme}.png`, 'Notes read rejected: banner with Retry, no fabricated rows');
        await toOverload(s);
        await record(s, `overload-error-list-${theme}.png`, 'Notes read rejected: Progressive Overload shows its empty state, not zero-filled data');
        await s.close();
      }

      // Active Recovery: the same Progress content under the paused baseline disclosure.
      if (wants('paused-progress', theme)) {
        const s = await open({ theme, scenario: 'recovery-active' });
        await s.scrollTo('top');
        await s.wait(400);
        await record(s, `paused-collapsed-${theme}.png`, 'Active Recovery: baseline Progress collapsed under the Paused chapter');
        await s.page.getByTestId('baseline-disclosure-toggle').click();
        await s.wait(900);
        await toOverload(s);
        await record(s, `paused-progress-${theme}.png`, 'Active Recovery with the baseline disclosure open: identical Progressive Overload content');
        await s.close();
      }
    }
  } finally {
    await h.close();
  }
  fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const bad = manifest.filter((m) => !m.theme_check.ok);
  console.log(`manifest in ${work}`);
  console.log(`r5: ${manifest.length} captures (${bad.length} theme mismatches)`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
