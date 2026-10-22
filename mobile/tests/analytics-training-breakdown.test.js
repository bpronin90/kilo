import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ThemeProvider } from '../theme/ThemeContext';
import { AnalyticsTrainingBreakdown, DEFAULT_TRAINING_BREAKDOWN_RANGE } from '../components/AnalyticsTrainingBreakdown';
import { deriveTrainingBreakdownForRange } from '../lib/data/trainingBreakdown';
import { parseWorkoutNote } from '../lib/parser';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => 'light') }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });

// #1588: the dashboard consumes #1589's deriveTrainingBreakdownForRange over a
// paired, verified population. Fixtures are parsed note text with real dates.
const NOW = new Date(2026, 9, 22, 12, 0, 0);
const iso = (daysAgo) => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const RECENT = [
  'Monday', '-Barbell Bench Press: 3x5', '135 5,5,5', '-Mystery Machine Thing: 3x10', '50 10,10',
  '-Back Squat: 2x5', '225 5,5', '-Barbell Row: 2x8', '135 8,8', '-Plank: 3x30s', '30', '30',
  '-Bike 5 min', '- 5 min',
].join('\n');
const OLD = ['Monday', '-Romanian Deadlift: 4x8', '185 8,8,8,8', '-Face Pull: 3x15', '40 15,15,15'].join('\n');

function population(specs) {
  const normalNotes = specs.map((s, i) => ({ id: s.id || `n${i}`, date: s.date, raw_text: s.text, ...(s.extra || {}) }));
  const noteSectionsList = normalNotes.map((n) => parseWorkoutNote(n.raw_text).sections);
  return { normalNotes, noteSectionsList, allSections: noteSectionsList.flat() };
}
const pop = population([
  { id: 'recent', date: iso(3), text: RECENT },
  { id: 'old', date: iso(60), text: OLD, extra: { exercise_movement_groups: { version: 1, overrides: { 'face pull': 'pull' } } } },
  { id: 'ancient', date: iso(200), text: OLD },
]);

const mounted = [];
afterEach(() => {
  while (mounted.length) { const r = mounted.pop(); act(() => { r.unmount(); }); }
});
async function render(props) {
  let root;
  await act(async () => {
    root = renderer.create(<ThemeProvider><AnalyticsTrainingBreakdown now={NOW} populationVerified {...props} /></ThemeProvider>);
  });
  mounted.push(root);
  return root;
}
const texts = (root) => root.root.findAllByType(Text).map((t) => [].concat(t.props.children).filter((c) => typeof c !== 'object').join(''));
const all = (root) => texts(root).join('|');
const byId = (root, testID) => root.root.findAll((n) => n.props.testID === testID && typeof n.type !== 'string');
const has = (root, testID) => byId(root, testID).length > 0;
const press = async (root, testID) => {
  await act(async () => { byId(root, testID)[0].props.onPress(); });
};
const completed = (root) => [].concat(byId(root, 'training-breakdown-completed-sets')[0].props.children).join('');
const sheetTitle = (root) => [].concat(byId(root, 'training-breakdown-sheet-title')[0].props.children).join('');

describe('AnalyticsTrainingBreakdown dashboard (#1588)', () => {
  test('defaults to 90D and renders the metrics header, tabs and Movement view from the range API', async () => {
    expect(DEFAULT_TRAINING_BREAKDOWN_RANGE).toBe('90D');
    const root = await render({ parsedSections: pop });
    const expected = deriveTrainingBreakdownForRange(pop, '90D', { now: NOW, populationVerified: true });
    expect(completed(root)).toBe(String(expected.totals.completedSets));
    expect(byId(root, 'training-breakdown-range-90D')[0].props.accessibilityState.selected).toBe(true);
    expect(all(root)).toContain('Compared');
    expect(has(root, 'training-breakdown-compare-push_pull')).toBe(true);
    expect(has(root, 'training-breakdown-compare-knee_hip')).toBe(true);
    expect(all(root)).not.toMatch(/imbalance|should|recommend/i);
    expect(has(root, 'training-breakdown-group-horizontal_push')).toBe(true);
    expect(all(root)).toContain('✎ 3 sets use your saved group');
    expect(all(root)).toMatch(/% classified/);
  });

  test('each range re-derives from dated notes and only this section changes', async () => {
    const root = await render({ parsedSections: pop });
    const counts = {};
    for (const r of ['30D', '90D', 'All']) {
      await press(root, `training-breakdown-range-${r}`);
      counts[r] = completed(root);
      expect(counts[r]).toBe(String(deriveTrainingBreakdownForRange(pop, r, { now: NOW, populationVerified: true }).totals.completedSets));
    }
    expect(Number(counts['30D'])).toBeLessThan(Number(counts['90D']));
    expect(Number(counts['90D'])).toBeLessThan(Number(counts.All));
  });

  test('an unverified population, unusable pairing or invalid date shows unavailable, never empty or unfiltered', async () => {
    for (const props of [
      { parsedSections: pop, populationVerified: false },
      { parsedSections: pop, populationVerified: undefined },
      { parsedSections: { ...pop, noteSectionsList: pop.noteSectionsList.slice(1) } },
      { parsedSections: pop, now: new Date('invalid') },
    ]) {
      const root = await render(props);
      expect(has(root, 'training-breakdown-unavailable')).toBe(true);
      expect(has(root, 'training-breakdown-empty')).toBe(false);
      expect(has(root, 'training-breakdown-completed-sets')).toBe(false);
    }
  });

  test('a range with no notes shows its own empty state while other ranges stay reachable', async () => {
    const onlyOld = population([{ date: iso(200), text: OLD }]);
    const root = await render({ parsedSections: onlyOld });
    expect(has(root, 'training-breakdown-empty')).toBe(true);
    expect(all(root)).toContain('No completed sets in the last 90 days.');
    await press(root, 'training-breakdown-range-30D');
    expect(all(root)).toContain('No completed sets in the last 30 days.');
    await press(root, 'training-breakdown-range-All');
    expect(has(root, 'training-breakdown-empty')).toBe(false);
    expect(completed(root)).toBe('7');
  });

  test('a new local day re-derives bounded ranges (date rollover)', async () => {
    const root = await render({ parsedSections: pop });
    const before = completed(root);
    await act(async () => {
      root.update(<ThemeProvider><AnalyticsTrainingBreakdown parsedSections={pop} populationVerified now={new Date(2026, 9, 22 + 31, 9)} /></ThemeProvider>);
    });
    expect(completed(root)).not.toBe(before);
    expect(completed(root)).toBe(String(deriveTrainingBreakdownForRange(pop, '90D', { now: new Date(2026, 9, 22 + 31, 9), populationVerified: true }).totals.completedSets));
  });

  test('the device clock rolling past local midnight refreshes the range without new props', async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 22, 23, 59, 0) });
    try {
      const recentOnly = population([{ date: iso(29), text: RECENT }]);
      let root;
      await act(async () => {
        root = renderer.create(<ThemeProvider><AnalyticsTrainingBreakdown parsedSections={recentOnly} populationVerified /></ThemeProvider>);
      });
      mounted.push(root);
      await press(root, 'training-breakdown-range-30D');
      expect(has(root, 'training-breakdown-completed-sets')).toBe(true);
      await act(async () => { jest.advanceTimersByTime(2 * 60 * 1000); });
      expect(has(root, 'training-breakdown-empty')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('history changes (new note props) recompute the breakdown', async () => {
    const root = await render({ parsedSections: pop });
    const more = population([{ id: 'recent', date: iso(3), text: RECENT }, { id: 'today', date: iso(0), text: OLD }]);
    await act(async () => {
      root.update(<ThemeProvider><AnalyticsTrainingBreakdown parsedSections={more} populationVerified now={NOW} /></ThemeProvider>);
    });
    expect(completed(root)).toBe(String(deriveTrainingBreakdownForRange(more, '90D', { now: NOW, populationVerified: true }).totals.completedSets));
  });

  test('group, all-groups, saved-choice and Unclassified sheets match the derivation buckets', async () => {
    const root = await render({ parsedSections: pop });
    const b = deriveTrainingBreakdownForRange(pop, '90D', { now: NOW, populationVerified: true });
    await press(root, 'training-breakdown-group-horizontal_push');
    expect(sheetTitle(root)).toBe('Horizontal push');
    const g = b.movement.groups.find((x) => x.id === 'horizontal_push');
    expect(all(root)).toContain(`${g.sets} sets · ${g.exercises.length} exercise`);
    expect(all(root)).toContain('Barbell Bench Press');
    await press(root, 'training-breakdown-sheet-close');
    expect(has(root, 'training-breakdown-sheet-title')).toBe(false);

    await press(root, 'training-breakdown-more-groups');
    expect(sheetTitle(root)).toBe('All movement groups');
    expect(all(root)).toContain('✎ your choice');
    await press(root, 'training-breakdown-all-group-unclassified');
    expect(sheetTitle(root)).toBe('Unclassified');
    expect(all(root)).toContain('Mystery Machine Thing');
    await press(root, 'training-breakdown-sheet-back');
    expect(sheetTitle(root)).toBe('All movement groups');
    await press(root, 'training-breakdown-all-group-legacy:pull');
    expect(sheetTitle(root)).toBe('Pull');
    expect(all(root)).toContain('your saved group');
  });

  test('Unclassified stays reachable with five or fewer classified groups', async () => {
    const root = await render({ parsedSections: population([{ date: iso(1), text: RECENT }]) });
    expect(has(root, 'training-breakdown-more-groups')).toBe(true);
    expect(all(root)).toMatch(/Unclassified · 2 sets/);
  });

  test('Muscles: six regions in order, region → muscle stacked sheet with primary and secondary, unknown muscles', async () => {
    const root = await render({ parsedSections: pop });
    await press(root, 'training-breakdown-view-muscles');
    const order = root.root.findAll((n) => typeof n.props.testID === 'string' && /^training-breakdown-region-[a-z]+$/.test(n.props.testID) && typeof n.type !== 'string')
      .map((n) => n.props.testID.replace('training-breakdown-region-', ''));
    expect([...new Set(order)]).toEqual(['chest', 'back', 'shoulders', 'arms', 'legs', 'core']);
    expect(all(root)).toContain('Overlapping counts');
    // #1593: the muscle short name no longer repeats its region label.
    expect(all(root)).toContain('Most: Pecs');
    expect(all(root)).not.toContain('Most: Chest');

    await press(root, 'training-breakdown-region-chest');
    expect(sheetTitle(root)).toBe('Chest');
    expect(texts(root)).toContain('Pecs');
    await press(root, 'training-breakdown-region-muscle-pectoralis_major');
    expect(sheetTitle(root)).toBe('Pecs');
    expect(has(root, 'training-breakdown-muscle-primary')).toBe(true);
    expect(has(root, 'training-breakdown-sheet-back')).toBe(true);
    await press(root, 'training-breakdown-sheet-back');
    expect(has(root, 'training-breakdown-sheet-back')).toBe(false);
    expect(sheetTitle(root)).toBe('Chest');
    expect(has(root, 'training-breakdown-region-muscle-pectoralis_major')).toBe(true);
    await press(root, 'training-breakdown-sheet-close');

    const b = deriveTrainingBreakdownForRange(pop, '90D', { now: NOW, populationVerified: true });
    const sec = b.muscles.secondary.find((m) => m.id === 'anterior_deltoid');
    await press(root, 'training-breakdown-region-shoulders');
    expect(all(root)).toContain(`+${sec.sets}`);
    await press(root, 'training-breakdown-region-muscle-anterior_deltoid');
    expect(has(root, 'training-breakdown-muscle-secondary')).toBe(true);
    await press(root, 'training-breakdown-sheet-close');

    await press(root, 'training-breakdown-unknown-muscles');
    expect(sheetTitle(root)).toBe('Unknown muscles');
    expect(all(root)).toContain('Mystery Machine Thing');
  });

  test('Equipment: ranked rows, unknown row and sheets; All N appears beyond six items', async () => {
    const root = await render({ parsedSections: pop });
    await press(root, 'training-breakdown-view-equipment');
    expect(has(root, 'training-breakdown-equipment-barbell')).toBe(true);
    expect(all(root)).toContain('Overlapping counts');
    expect(all(root)).toMatch(/Equipment known for \d+% of sets/);
    await press(root, 'training-breakdown-equipment-barbell');
    expect(sheetTitle(root)).toBe('Barbell');
    await press(root, 'training-breakdown-sheet-close');
    await press(root, 'training-breakdown-equipment-unknown');
    expect(sheetTitle(root)).toBe('Unknown equipment');
    expect(has(root, 'training-breakdown-all-equipment')).toBe(false);
  });

  test('timed/cardio stat opens a sheet that says it is not counted as strength sets; info opens methodology', async () => {
    const root = await render({ parsedSections: pop });
    await press(root, 'training-breakdown-timed-stat');
    expect(sheetTitle(root)).toBe('Timed and cardio');
    expect(all(root)).toContain('not counted as strength sets');
    expect(all(root)).toContain('Plank');
    await press(root, 'training-breakdown-sheet-close');
    await press(root, 'training-breakdown-info');
    expect(sheetTitle(root)).toBe('How this is counted');
    const text = all(root);
    expect(text).toContain('Push = horizontal and vertical push');
    expect(text).toContain('Saved group choices and Unclassified sets are left out');
    expect(text).toContain('only the two included sides');
    expect(text).toContain('appear only in All');
  });

  test('unreadable saved choices fall back to library groups and say so', async () => {
    const bad = population([{ date: iso(1), text: OLD, extra: { exercise_movement_groups: { version: 99, overrides: 'x' } } }]);
    const root = await render({ parsedSections: bad });
    expect(has(root, 'training-breakdown-overrides-unreadable')).toBe(true);
  });

  test('loading, error and paused states', async () => {
    expect(has(await render({ parsedSections: pop, isLoading: true }), 'training-breakdown-loading')).toBe(true);
    expect(has(await render({ parsedSections: pop, hasError: true }), 'training-breakdown-error')).toBe(true);
    const paused = await render({ parsedSections: pop, paused: true });
    expect(all(paused)).toContain('Paused during Recovery · baseline history');
    expect(has(await render({ parsedSections: pop }), 'training-breakdown-paused')).toBe(false);
  });

  test('every interactive control keeps a 44dp minimum target', async () => {
    const { createTrainingBreakdownStyles } = require('../screens/analytics/trainingBreakdownStyles');
    const s = createTrainingBreakdownStyles({}, null, 'light');
    for (const k of ['rangeOption', 'tab', 'info', 'iconButton', 'row', 'more', 'allButton', 'footButton']) {
      const st = s[k];
      expect(Math.max(st.minHeight || 0, st.height || 0)).toBeGreaterThanOrEqual(44);
    }
    expect(s.info.width).toBeGreaterThanOrEqual(44);
    expect(s.iconButton.width).toBeGreaterThanOrEqual(44);
  });
});

// #1593 polish: bar scaling excludes Unknown/Unclassified from the scale (they
// are capped at full width), and region strips keep one polarity on every tile.
const pctOf = (w) => Number(String(w).replace('%', ''));
const flat = (st) => Object.assign({}, ...[].concat(st || []).flat(Infinity).filter(Boolean));
// Rendered bar width (percent) inside a ranked row: the hatched fill for
// Unknown rows, otherwise the first proportional fill View.
function barWidth(root, testID) {
  const row = byId(root, testID)[0];
  const fills = row.findAll((n) => typeof n.type === 'string' && typeof flat(n.props.style).width === 'string'
    && flat(n.props.style).width.endsWith('%'));
  expect(fills.length).toBeGreaterThan(0);
  const w = pctOf(flat(fills[0].props.style).width);
  expect(Number.isFinite(w)).toBe(true);
  return w;
}
const lines = (name, sets) => [`-${name}: ${sets}x10`, `50 ${Array(sets).fill(10).join(',')}`];
const KNOWN_EQUIPMENT = [
  ['Barbell Bench Press', 12], ['Seated Cable Row', 6], ['Leg Press', 5], ['Pull Up', 3], ['EZ Bar Curl', 3],
  ['Kettlebell Swing', 3], ['Smith Machine Squat', 2], ['Trap Bar Deadlift', 2],
];
const note = (entries) => ['Monday', ...entries.flatMap(([n, s]) => lines(n, s))].join('\n');
const fixture = (entries) => population([{ date: iso(1), text: note(entries) }]);

describe('Training breakdown scaling and strips (#1593)', () => {
  const unknownDominant = fixture([...KNOWN_EQUIPMENT, ['Mystery Machine Thing', 20], ['Odd Sled Move', 20], ['Weird Rig Lift', 20]]);

  async function equipmentRoot(p) {
    const root = await render({ parsedSections: p });
    await press(root, 'training-breakdown-view-equipment');
    return root;
  }

  test('dashboard and All-equipment sheet scale to the largest known item and cap Unknown', async () => {
    const b = deriveTrainingBreakdownForRange(unknownDominant, '90D', { now: NOW, populationVerified: true });
    const [lead, second] = b.equipment.items;
    expect(b.equipment.items.length).toBeGreaterThan(6);
    expect(b.equipment.unknown.sets).toBeGreaterThan(lead.sets);
    const root = await equipmentRoot(unknownDominant);
    const check = (prefix) => {
      expect(barWidth(root, `${prefix}-${lead.id}`)).toBe(100);
      expect(barWidth(root, `${prefix}-${second.id}`)).toBeCloseTo((second.sets / lead.sets) * 100, 5);
      expect(barWidth(root, `${prefix}-unknown`)).toBe(100);
      const t = all(root);
      expect(t).toContain(`${b.equipment.unknown.sets}| ${Math.round((b.equipment.unknown.sets / b.totals.completedSets) * 100)}%`);
    };
    check('training-breakdown-equipment');
    await press(root, 'training-breakdown-all-equipment');
    check('training-breakdown-all-equipment');
    const lastKnown = b.equipment.items[b.equipment.items.length - 1];
    expect(barWidth(root, `training-breakdown-all-equipment-${lastKnown.id}`)).toBeCloseTo(Math.max(3, (lastKnown.sets / lead.sets) * 100), 5);
    await press(root, 'training-breakdown-all-equipment-unknown');
    expect(sheetTitle(root)).toBe('Unknown equipment');
  });

  test('Unknown below the known maximum keeps its proportional width', async () => {
    const p = fixture([...KNOWN_EQUIPMENT, ['Mystery Machine Thing', 2]]);
    const b = deriveTrainingBreakdownForRange(p, '90D', { now: NOW, populationVerified: true });
    expect(b.equipment.unknown.sets).toBeLessThan(b.equipment.items[0].sets);
    const root = await equipmentRoot(p);
    expect(barWidth(root, 'training-breakdown-equipment-unknown')).toBeCloseTo((b.equipment.unknown.sets / b.equipment.items[0].sets) * 100, 5);
  });

  test('unknown-only and known-only equipment stay finite and bounded', async () => {
    const unknownOnly = await equipmentRoot(fixture([['Mystery Machine Thing', 4]]));
    expect(barWidth(unknownOnly, 'training-breakdown-equipment-unknown')).toBe(100);
    expect(all(unknownOnly)).toContain('4| 100%');
    const knownOnly = await equipmentRoot(fixture(KNOWN_EQUIPMENT.slice(0, 3)));
    expect(has(knownOnly, 'training-breakdown-equipment-unknown')).toBe(false);
    const b = deriveTrainingBreakdownForRange(fixture(KNOWN_EQUIPMENT.slice(0, 3)), '90D', { now: NOW, populationVerified: true });
    b.equipment.items.forEach((it) => {
      const w = barWidth(knownOnly, `training-breakdown-equipment-${it.id}`);
      expect(w).toBeGreaterThanOrEqual(3);
      expect(w).toBeLessThanOrEqual(100);
    });
  });

  test('All-groups sheet scales to the largest classified group (incl. saved choices) and caps Unclassified', async () => {
    const p = population([
      { date: iso(1), text: note([['Barbell Bench Press', 6], ['Back Squat', 3], ['Mystery Machine Thing', 20], ['Odd Sled Move', 20]]) },
      { date: iso(2), text: note([['Face Pull', 9]]), extra: { exercise_movement_groups: { version: 1, overrides: { 'face pull': 'pull' } } } },
    ]);
    const b = deriveTrainingBreakdownForRange(p, '90D', { now: NOW, populationVerified: true });
    const [lead, ...rest] = b.movement.groups;
    expect(lead.source).toBe('override');
    expect(b.movement.unclassified.sets).toBeGreaterThan(lead.sets);
    const root = await render({ parsedSections: p });
    await press(root, 'training-breakdown-more-groups');
    expect(barWidth(root, `training-breakdown-all-group-${lead.id}`)).toBe(100);
    rest.forEach((g) => expect(barWidth(root, `training-breakdown-all-group-${g.id}`)).toBeCloseTo((g.sets / lead.sets) * 100, 5));
    expect(barWidth(root, 'training-breakdown-all-group-unclassified')).toBe(100);
    expect(all(root)).toContain(`${b.movement.unclassified.sets}| ${Math.round((b.movement.unclassified.sets / b.totals.completedSets) * 100)}%`);
    await press(root, 'training-breakdown-all-group-unclassified');
    expect(has(root, 'training-breakdown-sheet-back')).toBe(true);
  });

  test('All-groups sheet with no classified groups caps Unclassified at full width', async () => {
    const root = await render({ parsedSections: fixture([['Mystery Machine Thing', 5]]) });
    await press(root, 'training-breakdown-more-groups');
    expect(barWidth(root, 'training-breakdown-all-group-unclassified')).toBe(100);
  });

  test('empty data renders no bars and no NaN widths', async () => {
    const root = await render({ parsedSections: population([{ date: iso(200), text: OLD }]) });
    expect(has(root, 'training-breakdown-empty')).toBe(true);
    expect(all(root)).not.toMatch(/NaN|Infinity/);
  });

  describe('region strips keep one polarity in every court palette', () => {
    const { KUA_PALETTES } = require('../theme/colors');
    const { MusclesView } = require('../components/trainingBreakdown/BreakdownViews');
    const { resolveBreakdownPalette, heatFill, contrastRatio } = require('../components/trainingBreakdown/breakdownPalette');
    const { createTrainingBreakdownStyles } = require('../screens/analytics/trainingBreakdownStyles');
    const rgba = (c) => { const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(c); return m ? [[+m[1], +m[2], +m[3]], +m[4]] : null; };
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const over = ([fg, a], bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
    const lum = (rgb) => rgb.map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
    // Low (Chest), middle and highest (Legs) intensity regions, plus an empty Core.
    const p90 = fixture([['Barbell Bench Press', 2], ['Barbell Row', 6], ['Lat Pulldown', 3], ['Back Squat', 12], ['Romanian Deadlift', 8]]);

    for (const court of ['hardCourt', 'clayCourt', 'grassCourt']) {
      for (const mode of ['light', 'dark']) {
        test(`${court} ${mode}`, () => {
          const kua = KUA_PALETTES[court][mode];
          const p = resolveBreakdownPalette({}, kua, mode);
          const styles = createTrainingBreakdownStyles({}, kua, mode);
          const b = deriveTrainingBreakdownForRange(p90, '90D', { now: NOW, populationVerified: true });
          let root;
          act(() => { root = renderer.create(<MusclesView styles={styles} p={p} breakdown={b} onOpen={() => {}} />); });
          mounted.push(root);
          const card = hex(p.card);
          const max = Math.max(...b.muscles.regions.map((r) => r.sets));
          const signs = new Set();
          const bases = new Set();
          let checked = 0;
          for (const region of b.muscles.regions) {
            const tile = over(rgba(heatFill(p, region.sets / max).backgroundColor), card);
            const cells = root.root.findAll((n) => typeof n.type === 'string' && String(n.props.testID || '').startsWith(`training-breakdown-strip-${region.id}-`));
            expect(cells.length).toBeGreaterThan(0);
            const strengths = [];
            for (const c of cells) {
              const [base, a] = rgba(flat(c.props.style).backgroundColor);
              bases.add(base.join(','));
              const strip = over([base, a], tile);
              if (!c.props.testID.endsWith('-empty')) {
                signs.add(Math.sign(lum(strip) - lum(tile)));
                strengths.push([a, contrastRatio(strip.map(Math.round), tile.map(Math.round))]);
              }
              checked += 1;
            }
            // Stronger muscle values stay distinguishable (more opaque, more contrast).
            strengths.sort((x, y) => x[0] - y[0]);
            for (let i = 1; i < strengths.length; i++) expect(strengths[i][1]).toBeGreaterThanOrEqual(strengths[i - 1][1] - 1e-9);
            if (strengths.length) expect(strengths[strengths.length - 1][1]).toBeGreaterThan(1.2);
          }
          expect(checked).toBeGreaterThan(6);
          expect(bases.size).toBe(1);
          expect(signs.size).toBe(1);
          expect(has(root, 'training-breakdown-strip-core-empty') || root.root.findAll((n) => n.props.testID === 'training-breakdown-strip-core-empty').length > 0).toBe(true);
        });
      }
    }
  });
});
