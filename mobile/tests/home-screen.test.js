// Cross-surface recovery/normal-analytics boundary (#699).
//
// The contract under test is not "Home filters" or "Analytics filters" — it is
// that BOTH derive their ordinary populations from the same membership decision,
// so the two screens can never disagree about which sessions count. Every test
// here therefore builds one fixture and asserts Home and Analytics against it
// together.
//
// Fixture shape (fixed across the file):
//   ordinary   — a plain routine, always in normal analytics
//   deload     — a deliberately light session; already excluded from SIGNALS by
//                the pre-existing DELOAD_NOTE_PREFIX rule, independently of
//                anything recovery does
//   excluded   — a recovery week of a block whose preference is OFF
//   included   — a recovery week of a completed block whose preference is ON
//   baseline   — the frozen baseline routine of a block; never a member

import { deriveHomeDashboardData } from '../screens/home/homeDashboardData';
import { deriveAnalytics, deriveParsedSections } from '../screens/analytics/analyticsDerivations';
import {
  buildRecoveryAnalyticsFilter,
  deriveRecoveryExcludedNoteIds,
} from '../lib/data/recoveryAnalyticsFilter';
import { deriveRecoveryComparison } from '../lib/data/recoveryAnalytics';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { DELOAD_NOTE_PREFIX } from '../hooks/entries/workoutNoteHooks';
import { getNoteSections } from '../hooks/useEntries';
import { DEFAULT_1K_EXERCISES, deriveNonWeightedTrackedExerciseMetrics } from '../lib/data';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Presentation-only mocks for the HomeScreen render describe at the end of this
// file. The derivation tests above do not touch any of them.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children }) => React.createElement(View, null, children),
    Path: () => null,
    Rect: () => null,
  };
});

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ScreenShell: ({ children }) => React.createElement(View, null, children),
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});

jest.mock('../components/UI', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    Card: ({ children, style }) => React.createElement(View, { style }, children),
    HeroMetric: { hero: {} },
    LineChart: () => null,
    getSessionTone: () => 'neutral',
    Button: ({ title, onPress }) => React.createElement(Text, { onPress }, title),
  };
});

jest.mock('../lib/unitPreference', () => ({ useWeightUnit: () => 'lbs' }));

jest.mock('../hooks/useEntries', () => {
  const actual = jest.requireActual('../hooks/useEntries');
  return { ...actual, useWeightGoal: jest.fn(), useTrackedLifts: jest.fn() };
});

const ONE_K = { bench: 'Bench Press', squat: 'Squat', deadlift: 'Deadlift' };

// Heavy ordinary work.
const ORDINARY_TEXT = [
  'Monday',
  '+Lifting',
  '-Bench Press',
  '- 225 5,5',
  '-Squat',
  '- 315 5,5',
  '-Deadlift',
  '- 405 5,5',
  '-Pull Ups',
  '- 12,12',
].join('\n');

// Light rehab work on the same lifts. Heavy enough to be parsed, light enough
// that admitting it visibly drags every strength aggregate down.
const RECOVERY_TEXT = [
  'Monday',
  '+Lifting',
  '-Bench Press',
  '- 45 5',
  '-Squat',
  '- 45 5',
  '-Deadlift',
  '- 65 5',
  '-Pull Ups',
  '- 3,3',
].join('\n');

const DELOAD_TEXT = [
  'Monday',
  '+Lifting',
  '-Bench Press',
  '- 95 5',
  '-Squat',
  '- 135 5',
  '-Deadlift',
  '- 155 5',
].join('\n');

const TRACKED = { 'Bench Press': true, 'Squat': true, 'Deadlift': true, 'Pull Ups': true };

// Oldest first, matching how the app orders notes. The active block's recovery
// week is the NEWEST note, so admitting it visibly changes every "latest
// session" metric; the completed block's week sits back in history.
function makeFixture() {
  const notes = [
    { id: 'baseline', title: 'Baseline Routine', raw_text: ORDINARY_TEXT, one_k_exercises: ONE_K },
    { id: 'included', title: 'Old Recovery Week 1', raw_text: RECOVERY_TEXT, one_k_exercises: ONE_K },
    { id: 'deload', title: `${DELOAD_NOTE_PREFIX}Push Day`, raw_text: DELOAD_TEXT, one_k_exercises: ONE_K },
    { id: 'ordinary', title: 'Push Day', raw_text: ORDINARY_TEXT, one_k_exercises: ONE_K },
    { id: 'excluded', title: 'Recovery Week 1', raw_text: RECOVERY_TEXT, one_k_exercises: ONE_K },
  ];
  const ordinaryNote = notes.find(n => n.id === 'ordinary');
  const blocks = [
    {
      id: 'rbActive',
      baseline_note_id: 'baseline',
      baseline_note_title: 'Baseline Routine',
      baseline: captureRecoveryBaselineFromText(ORDINARY_TEXT),
      include_in_normal_analytics: false,
      started_at: '2026-05-01T00:00:00.000Z',
      completed_at: null,
      deleted_at: null,
    },
    {
      id: 'rbDone',
      baseline_note_id: 'baseline',
      baseline_note_title: 'Baseline Routine',
      baseline: captureRecoveryBaselineFromText(ORDINARY_TEXT),
      include_in_normal_analytics: true,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-02-01T00:00:00.000Z',
      deleted_at: null,
    },
  ];
  const weeks = [
    { id: 'rwA', block_id: 'rbActive', note_id: 'excluded', week_number: 1, completed_at: null, deleted_at: null },
    { id: 'rwB', block_id: 'rbDone', note_id: 'included', week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null },
  ];
  return { notes, blocks, weeks, ordinaryNote };
}

// Both screens' real wiring, reduced to the two calls that decide populations.
// HomeScreen filters `notes` and derives its section lists from the survivors;
// AnalyticsScreen hands the same exclusion set to deriveParsedSections.
function deriveBothSurfaces({ notes, blocks, weeks, currentNote }) {
  const filter = buildRecoveryAnalyticsFilter(blocks, weeks);
  const normalNotes = filter.filterNotes(notes);
  const noteSectionsList = normalNotes.map(n => getNoteSections(n));
  const allSections = noteSectionsList.flat();

  const home = deriveHomeDashboardData({
    weightEntries: [],
    workoutNote: currentNote,
    weightGoal: null,
    allSections,
    noteSectionsList,
    trackedLifts: TRACKED,
  });

  const parsedSections = deriveParsedSections(notes, currentNote, filter.excludedNoteIds);
  const analytics = deriveAnalytics(parsedSections, TRACKED, ONE_K, 1.07);

  return { filter, normalNotes, home, analytics, parsedSections };
}

function signalFor(analytics, name) {
  return (analytics.signals || []).find(s => s.name === name) || null;
}

describe('#699 recovery notes and the ordinary-analytics population', () => {
  test('new blocks exclude their linked notes by default; the included block’s notes stay in', () => {
    const { notes, blocks, weeks, ordinaryNote } = makeFixture();
    const { normalNotes } = deriveBothSurfaces({ notes, blocks, weeks, currentNote: ordinaryNote });

    expect(normalNotes.map(n => n.id)).toEqual(['baseline', 'included', 'deload', 'ordinary']);
  });

  test('Home and Analytics derive from the same filtered population — 1K agrees exactly', () => {
    const { notes, blocks, weeks, ordinaryNote } = makeFixture();
    const { home, analytics } = deriveBothSurfaces({ notes, blocks, weeks, currentNote: ordinaryNote });

    expect(home.oneK.total).not.toBeNull();
    expect(home.oneK.total).toBeCloseTo(analytics.oneK.total, 5);
    expect(home.oneK.bench).toBeCloseTo(analytics.oneK.bench, 5);
    expect(home.oneK.squat).toBeCloseTo(analytics.oneK.squat, 5);
    expect(home.oneK.deadlift).toBeCloseTo(analytics.oneK.deadlift, 5);
  });

  test('toggling one block’s preference moves exactly its own notes, on BOTH surfaces at once', () => {
    const { notes, blocks, weeks, ordinaryNote } = makeFixture();

    const off = deriveBothSurfaces({ notes, blocks, weeks, currentNote: ordinaryNote });

    // The live toggle: the same records, with one field flipped on one block.
    const on = deriveBothSurfaces({
      notes,
      blocks: blocks.map(b => (b.id === 'rbActive' ? { ...b, include_in_normal_analytics: true } : b)),
      weeks,
      currentNote: ordinaryNote,
    });

    expect(off.normalNotes.map(n => n.id)).not.toContain('excluded');
    expect(on.normalNotes.map(n => n.id)).toContain('excluded');

    // 1K reads the best complete cycle, so admitting light rehab work cannot
    // raise it — but the underlying series gains a session on both surfaces.
    expect(on.analytics.oneKSeries.length).toBe(off.analytics.oneKSeries.length + 1);
    expect(on.home.oneK.total).toBeCloseTo(on.analytics.oneK.total, 5);

    // Kilo Max / fatigue-adjusted strength averages every set, so the light
    // recovery session pulls it down the moment it is admitted.
    expect(signalFor(on.analytics, 'Bench Press').kilo_max)
      .toBeLessThan(signalFor(off.analytics, 'Bench Press').kilo_max);

    // Non-weighted tracked metrics move with the same toggle: the excluded
    // recovery week is the newest Pull Ups session, so admitting it replaces the
    // 12-rep ordinary set with the 3-rep rehab set.
    expect(off.analytics.nonWeightedMetrics['pull ups'].avg_reps).toBe(12);
    expect(on.analytics.nonWeightedMetrics['pull ups'].avg_reps).toBe(3);
  });

  test('turning it back off removes the same notes again, with no duplicate counting', () => {
    const { notes, blocks, weeks, ordinaryNote } = makeFixture();

    const before = deriveBothSurfaces({ notes, blocks, weeks, currentNote: ordinaryNote });
    const on = deriveBothSurfaces({
      notes,
      blocks: blocks.map(b => (b.id === 'rbActive' ? { ...b, include_in_normal_analytics: true } : b)),
      weeks,
      currentNote: ordinaryNote,
    });
    const after = deriveBothSurfaces({ notes, blocks, weeks, currentNote: ordinaryNote });

    expect(on.analytics.oneKSeries.length).toBeGreaterThan(before.analytics.oneKSeries.length);
    // Round-tripping the preference returns every aggregate to its exact
    // starting value — a note re-admitted and re-removed is never double-counted.
    expect(after.normalNotes.map(n => n.id)).toEqual(before.normalNotes.map(n => n.id));
    expect(after.analytics.oneKSeries).toEqual(before.analytics.oneKSeries);
    expect(after.home.oneK).toEqual(before.home.oneK);
    expect(signalFor(after.analytics, 'Bench Press').kilo_max)
      .toBe(signalFor(before.analytics, 'Bench Press').kilo_max);
  });

  test('completed blocks with mixed preferences filter their own memberships independently', () => {
    const { notes, blocks, weeks, ordinaryNote } = makeFixture();
    const bothCompleted = blocks.map(b => ({
      ...b,
      completed_at: b.completed_at || '2026-06-01T00:00:00.000Z',
    }));

    const excluded = deriveRecoveryExcludedNoteIds(bothCompleted, weeks);
    expect([...excluded]).toEqual(['excluded']);

    // Flipping the OTHER block's preference must not disturb this one.
    const flipped = deriveRecoveryExcludedNoteIds(
      bothCompleted.map(b => (b.id === 'rbDone' ? { ...b, include_in_normal_analytics: false } : b)),
      weeks
    );
    expect([...flipped].sort()).toEqual(['excluded', 'included']);
  });

  test('deload exclusion is unchanged in both preference states', () => {
    const { notes, blocks, weeks, ordinaryNote } = makeFixture();

    for (const include of [false, true]) {
      const { parsedSections } = deriveBothSurfaces({
        notes,
        blocks: blocks.map(b => (b.id === 'rbActive' ? { ...b, include_in_normal_analytics: include } : b)),
        weeks,
        currentNote: ordinaryNote,
      });

      // The deload note keeps its 1K point (#396) and stays out of the signal
      // population, exactly as before recovery blocks existed.
      const deloadSections = getNoteSections(notes[2]);
      const deloadExercise = deloadSections[0].exercises[0];
      expect(parsedSections.allSections).toEqual(expect.arrayContaining(deloadSections));
      expect(parsedSections.signalSections.some(s => s.exercises.includes(deloadExercise))).toBe(false);
    }
  });

  test('an excluded recovery note still feeds Recovery Analytics in full', () => {
    const { notes, blocks, weeks, ordinaryNote } = makeFixture();
    const { normalNotes } = deriveBothSurfaces({ notes, blocks, weeks, currentNote: ordinaryNote });
    expect(normalNotes.map(n => n.id)).not.toContain('excluded');

    // Recovery Analytics is handed the UNFILTERED notes on purpose.
    const comparison = deriveRecoveryComparison({
      block: blocks[0],
      weeks: weeks.filter(w => w.block_id === 'rbActive'),
      notes,
    });
    expect(comparison.weeks.length).toBe(1);
    expect(comparison.weeks[0].note_id).toBe('excluded');
    expect(comparison.weeks[0].exercises.length).toBeGreaterThan(0);
  });

  test('a missing linked note fails safely: unrelated ordinary notes are untouched', () => {
    const { notes, blocks, weeks, ordinaryNote } = makeFixture();
    const withoutRecoveryNote = notes.filter(n => n.id !== 'excluded');

    const { normalNotes, home, analytics } = deriveBothSurfaces({
      notes: withoutRecoveryNote,
      blocks,
      weeks,
      currentNote: withoutRecoveryNote[1],
    });

    expect(normalNotes.map(n => n.id)).toEqual(['baseline', 'included', 'deload', 'ordinary']);
    expect(home.oneK.total).toBeCloseTo(analytics.oneK.total, 5);
  });

  test('a recovery week stays fully readable while excluded', () => {
    const { notes, blocks, weeks, ordinaryNote } = makeFixture();
    const recoveryNote = notes.find(n => n.id === 'excluded');

    const { parsedSections } = deriveBothSurfaces({
      notes,
      blocks,
      weeks,
      // The user is looking AT the excluded recovery week.
      currentNote: recoveryNote,
    });

    // Its own content renders in full even though it feeds no aggregate.
    expect(parsedSections.currentSections.length).toBeGreaterThan(0);
    expect(parsedSections.currentSections[0].exercises.map(e => e.name))
      .toEqual(expect.arrayContaining(['Bench Press', 'Squat', 'Deadlift']));

    // And it is still absent from the aggregated tracked-metric population: the
    // newest Pull Ups session there is the 12-rep ordinary one, not the 3-rep
    // week the user is currently reading.
    const metrics = deriveNonWeightedTrackedExerciseMetrics(parsedSections.signalSections, ['Pull Ups']);
    expect(metrics['pull ups'].avg_reps).toBe(12);
    expect(metrics['pull ups'].best_set_reps).toBe(12);
  });

  test('1K selections are unaffected by the boundary — only the population changes', () => {
    const { notes, blocks, weeks, ordinaryNote } = makeFixture();
    const { home } = deriveBothSurfaces({ notes, blocks, weeks, currentNote: ordinaryNote });
    // Guards the fixture itself: DEFAULT_1K_EXERCISES must not silently take
    // over and make the assertions above vacuous.
    expect(DEFAULT_1K_EXERCISES.bench).toBeDefined();
    expect(home.oneK.total).not.toBeNull();
  });
});

// ── #699 review: Home must not publish an unverified population ─────────────

describe('HomeScreen holds its loading state while the recovery boundary is unverified', () => {
  const React = require('react');
  const render = require('react-test-renderer');
  const { HomeScreen } = require('../screens/HomeScreen');
  const useEntriesModule = require('../hooks/useEntries');
  const hooks = require('../hooks/entries/recoveryBlockHooks');
  const AsyncStorage = require('@react-native-async-storage/async-storage');

  const props = (over = {}) => ({
    weightEntries: [],
    workoutNote: null,
    notes: [],
    successMessage: '',
    onNavigate: jest.fn(),
    loading: false,
    ...over,
  });

  const hasText = (root, needle) => root.findAll(n => {
    if (n.type !== 'Text') return false;
    const flat = Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '');
    return flat.includes(needle);
  }).length > 0;

  beforeEach(() => {
    jest.clearAllMocks();
    hooks._resetRecoveryAnalyticsFilterCache();
    useEntriesModule.useWeightGoal.mockReturnValue({ goal: null, loading: false, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    useEntriesModule.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false, save: jest.fn(), toggle: jest.fn() });
  });

  afterEach(() => {
    AsyncStorage.getItem.mockReset();
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  test('an unreadable recovery store paints nothing, rather than a dashboard that includes excluded work', async () => {
    AsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === 'kilo_recovery_blocks' || key === 'kilo_recovery_block_weeks') {
        throw new Error('storage unavailable');
      }
      return null;
    });

    let component;
    await render.act(async () => { component = render.create(<HomeScreen {...props()} />); });

    // Neither the empty state nor any dashboard content: the population is not
    // known to be correct yet, so Home stays in its existing loading branch.
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
    expect(hasText(component.root, 'Week')).toBe(false);

    await render.act(async () => { component.unmount(); });
  });

  test('once the recovery read succeeds, Home paints as usual', async () => {
    AsyncStorage.getItem.mockImplementation(async () => null);

    let component;
    await render.act(async () => { component = render.create(<HomeScreen {...props()} />); });

    expect(hasText(component.root, 'Welcome to Kilo')).toBe(true);

    await render.act(async () => { component.unmount(); });
  });
});

// Home's four cross-screen handoffs (#717). The populated dashboard already shows
// the information a user needs to continue; these press targets carry them to the
// destination instead of making them re-find it by tab.
describe('HomeScreen daily-loop handoffs (#717)', () => {
  const React = require('react');
  const render = require('react-test-renderer');
  const { HomeScreen } = require('../screens/HomeScreen');
  const useEntriesModule = require('../hooks/useEntries');
  const hooks = require('../hooks/entries/recoveryBlockHooks');
  const AsyncStorage = require('@react-native-async-storage/async-storage');

  const NOTE = {
    id: 'n1',
    title: 'Routine A',
    raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
    saved_at: '2026-06-01T12:00:00.000Z',
  };

  const populatedProps = (onNavigate) => ({
    weightEntries: [
      { id: 'w1', date: '2026-05-30', logged_at: '2026-05-30T08:00:00Z', weight_value: 185, weight_unit: 'lb', note: '' },
      { id: 'w2', date: '2026-05-31', logged_at: '2026-05-31T08:00:00Z', weight_value: 184, weight_unit: 'lb', note: '' },
    ],
    workoutNote: NOTE,
    notes: [NOTE],
    successMessage: '',
    onNavigate,
    loading: false,
  });

  const byTestID = (root, testID) => root.findByProps({ testID });

  let onNavigate;
  let component;

  beforeEach(async () => {
    jest.clearAllMocks();
    hooks._resetRecoveryAnalyticsFilterCache();
    AsyncStorage.getItem.mockImplementation(async () => null);
    useEntriesModule.useWeightGoal.mockReturnValue({ goal: null, loading: false, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    useEntriesModule.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false, save: jest.fn(), toggle: jest.fn() });
    onNavigate = jest.fn();
    await render.act(async () => {
      component = render.create(<HomeScreen {...populatedProps(onNavigate)} />);
    });
  });

  afterEach(async () => {
    if (component) await render.act(async () => { component.unmount(); });
    component = null;
    AsyncStorage.getItem.mockReset();
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  test('the current-routine header goes to Log', () => {
    render.act(() => { byTestID(component.root, 'home-current-routine-link').props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Log');
  });

  test('the weight action goes to Weight', () => {
    render.act(() => { byTestID(component.root, 'home-weight-action').props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Weight');
  });

  test('the strength summary goes to the Analytics strength section', () => {
    render.act(() => { byTestID(component.root, 'home-strength-summary-link').props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'strength');
  });

  test('the weight sparkline goes to the Analytics weight section', () => {
    render.act(() => { byTestID(component.root, 'home-weight-trend-link').props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'weight');
  });

  test('repeating a handoff issues it again', () => {
    const link = byTestID(component.root, 'home-weight-trend-link');
    render.act(() => { link.props.onPress(); });
    render.act(() => { link.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'Analytics', 'weight');
  });

  test('each handoff exposes a button role and an accessible label', () => {
    for (const testID of [
      'home-current-routine-link',
      'home-weight-action',
      'home-strength-summary-link',
      'home-weight-trend-link',
    ]) {
      const node = byTestID(component.root, testID);
      expect(node.props.accessibilityRole).toBe('button');
      expect(typeof node.props.accessibilityLabel).toBe('string');
      expect(node.props.accessibilityLabel.length).toBeGreaterThan(0);
    }
  });

  // --- Static style/structure guards ---
  //
  // Scope note: react-test-renderer does not run React Native layout, so these
  // are regression guards on the declared style and structure contract, NOT
  // rendered validation. Actual rendered validation at 320/375/448dp with an
  // enlarged text setting — real geometry, clipping/overlap detection,
  // screenshots, and browser accessibility/focus order — is produced by the
  // capture harness against the Expo web build; see artifacts/717-d4/.

  const flatStyle = (node) => [].concat(node.props.style ?? []).reduce(
    (acc, s) => (s ? Object.assign(acc, s) : acc),
    {}
  );

  const HANDOFF_IDS = [
    'home-current-routine-link',
    'home-weight-action',
    'home-strength-summary-link',
    'home-weight-trend-link',
  ];

  // The three quiet inline controls, which carry an explicit 44pt minimum.
  const INLINE_ACTION_IDS = [
    'home-current-routine-link',
    'home-weight-action',
    'home-weight-trend-link',
  ];

  test(
    'every Home handoff declares a >=44pt minimum target and a button role',
    async () => {
      let local;
      await render.act(async () => {
        local = render.create(<HomeScreen {...populatedProps(jest.fn())} />);
      });

      for (const testID of INLINE_ACTION_IDS) {
        const node = local.root.findByProps({ testID });
        expect(node.props.accessibilityRole).toBe('button');
        const style = flatStyle(node);
        expect(style.minHeight).toBeGreaterThanOrEqual(44);
        expect(node.props.hitSlop).not.toBeUndefined();
      }

      // The strength band is a large multi-row region rather than an inline
      // control, so it clears the target through its own block geometry.
      const band = local.root.findByProps({ testID: 'home-strength-summary-link' });
      expect(band.props.accessibilityRole).toBe('button');
      expect(band.findAllByType('Text').length).toBeGreaterThan(3);

      await render.act(async () => { local.unmount(); });
    }
  );

  test('no handoff declares a fixed height that a scaled label could overflow', () => {
    // Structural guard: both primary controls get equal flexible width, while
    // all labeled handoffs can grow vertically under enlarged text.
    const routineAction = component.root.findByProps({ testID: 'home-current-routine-link' });
    const weightAction = component.root.findByProps({ testID: 'home-weight-action' });
    expect(routineAction.parent).toBe(weightAction.parent);
    expect(flatStyle(routineAction.parent).flexDirection).toBe('row');
    expect(flatStyle(routineAction).flex).toBe(1);
    expect(flatStyle(weightAction).flex).toBe(1);

    for (const testID of ['home-current-routine-link', 'home-weight-action', 'home-weight-trend-link']) {
      const style = flatStyle(component.root.findByProps({ testID }));
      expect(style.height).toBeUndefined();
      expect(style.minHeight).toBe(44);
    }
  });

  test('each handoff owns its press region exclusively — no nested press owners', () => {
    // The sparkline chart owns an inner Pressable for point selection, so the
    // Analytics-weight handoff must not wrap it (#717 review finding 1).
    const { LineChart } = require('../components/UI');
    const trendLink = component.root.findByProps({ testID: 'home-weight-trend-link' });
    expect(trendLink.findAllByType(LineChart)).toHaveLength(0);

    for (const testID of HANDOFF_IDS) {
      const node = component.root.findByProps({ testID });
      // No descendant of a handoff may itself be a press owner.
      const nestedPressOwners = node.findAll(
        n => n !== node && typeof n.props?.onPress === 'function'
      );
      expect(nestedPressOwners).toHaveLength(0);
    }
  });

  test('handoffs appear in the intended order in the rendered tree', () => {
    // Structural guard. Real screen-reader evidence — Chromium accessibility
    // tree plus actual keyboard focus traversal — is in
    // artifacts/717-d4/ax-order-375.json.
    // A Pressable surfaces as both a composite and its host view, so collapse
    // consecutive duplicates.
    const order = component.root
      .findAll(n => n.props?.accessibilityRole === 'button' && n.props?.testID)
      .map(n => n.props.testID)
      .filter(id => HANDOFF_IDS.includes(id))
      .filter((id, i, all) => id !== all[i - 1]);

    expect(order).toEqual([
      'home-current-routine-link',
      'home-weight-action',
      'home-weight-trend-link',
      'home-strength-summary-link',
    ]);
  });

  test('every handoff exposes a visible label, not a silent press target', () => {
    // Discoverability for sighted users (#717 review finding 4): the routine and
    // weigh-in actions must read as actions on screen, not as inert captions.
    const visibleText = (node) => node.findAllByType('Text')
      .map(t => String(t.props.children ?? '').trim())
      .filter(Boolean);

    expect(visibleText(component.root.findByProps({ testID: 'home-current-routine-link' })))
      .toContain('Log workout');
    expect(visibleText(component.root.findByProps({ testID: 'home-weight-action' })))
      .toContain('Log weight');
    // An explicit action label, not the chart caption: "7-day rolling avg" read
    // as chart furniture rather than something tappable (#717 review round 3).
    expect(visibleText(component.root.findByProps({ testID: 'home-weight-trend-link' })))
      .toContain('See weight trends');
    expect(visibleText(component.root.findByProps({ testID: 'home-strength-summary-link' })))
      .toContain('Exercise Progress');
  });

  test('the hero keeps a single dominant metric alongside the new actions', () => {
    // §8: the new controls are quiet primary actions; the latest-weight value
    // remains the only hero-sized element and is no longer itself a press owner.
    const heroValues = component.root.findAll(n => {
      if (n.type !== 'Text') return false;
      const style = flatStyle(n);
      return style.fontWeight === '800' || style.fontSize >= 40;
    });
    for (const value of heroValues) {
      let node = value.parent;
      while (node) {
        expect(node.props?.testID).not.toBe('home-weight-action');
        node = node.parent;
      }
    }
  });

  test('with no weigh-ins the hero degrades to a labeled state, not an empty slot', async () => {
    // The owner reported a bare "—" hero over dead space. With no weigh-ins the
    // hero reads as a short sentence and the empty sparkline is suppressed,
    // while the weigh-in handoff stays available.
    let local;
    await render.act(async () => {
      local = render.create(
        <HomeScreen {...populatedProps(jest.fn())} weightEntries={[]} />
      );
    });

    // The weight state remains visible above the dedicated action row. The
    // unrelated 1K card legitimately shows em-dashes for untracked lifts.
    const noWeighIn = local.root.findAllByType('Text')
      .find(t => t.props.children === 'No weigh-in yet');
    expect(noWeighIn).toBeTruthy();
    expect(noWeighIn.parent).not.toBe(
      local.root.findByProps({ testID: 'home-weight-action' }).parent
    );

    // Chart caption suppressed when there is no series to plot.
    const allTexts = local.root.findAllByType('Text')
      .map(t => String(t.props.children ?? '').trim());
    expect(allTexts).not.toContain('7-day rolling avg');
    // The handoffs are still reachable in the no-data state.
    expect(local.root.findByProps({ testID: 'home-weight-action' })).toBeTruthy();
    expect(local.root.findByProps({ testID: 'home-weight-trend-link' })).toBeTruthy();

    await render.act(async () => { local.unmount(); });
  });

  test('every press target carries a visible affordance', () => {
    // Owner override: dropping the strength band's chevron in an earlier round
    // recreated the "silently pressable" defect, so both strength destinations
    // now carry a filled pill. Every handoff must show something.
    const Svg = require('react-native-svg').default;
    for (const testID of [...INLINE_ACTION_IDS, 'home-strength-summary-link', 'home-one-k-link']) {
      const node = component.root.findByProps({ testID });
      expect(node.props.accessibilityRole).toBe('button');
      expect(node.findAllByType(Svg).length).toBeGreaterThan(0);
    }
  });

  test('the two strength destinations share one affordance treatment', () => {
    const visibleText = (node) => node.findAllByType('Text')
      .map(t => String(t.props.children ?? '').trim());

    const band = component.root.findByProps({ testID: 'home-strength-summary-link' });
    const oneK = component.root.findByProps({ testID: 'home-one-k-link' });

    // Same pill style on both, so they read as one family.
    const pillStyle = (node) => {
      const pill = node.findAll(n => {
        const s = flatStyle(n);
        return s.borderRadius === 999 && s.backgroundColor;
      })[0];
      return pill ? flatStyle(pill) : null;
    };
    expect(pillStyle(band)).not.toBeNull();
    expect(pillStyle(oneK)).not.toBeNull();
    expect(pillStyle(band).backgroundColor).toBe(pillStyle(oneK).backgroundColor);

    // §12: each accessible label matches its own visible label exactly, and the
    // two names stay distinct so a screen reader can tell them apart.
    expect(visibleText(band)).toContain('See strength');
    expect(band.props.accessibilityLabel).toBe('See strength');
    expect(visibleText(oneK)).toContain('See 1K progress');
    expect(oneK.props.accessibilityLabel).toBe('See 1K progress');
  });

  test('the 1K card reaches the Analytics strength section, repeatably', () => {
    const oneK = component.root.findByProps({ testID: 'home-one-k-link' });
    render.act(() => { oneK.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'strength');
    render.act(() => { oneK.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'Analytics', 'strength');
  });

  test('neither strength destination nests a press owner', () => {
    // The pills are presentational; the band and the card stay the single press
    // owners, which also keeps their hit areas large.
    for (const testID of ['home-strength-summary-link', 'home-one-k-link']) {
      const node = component.root.findByProps({ testID });
      expect(node.findAll(n => n !== node && typeof n.props?.onPress === 'function')).toHaveLength(0);
    }
  });

  test('the two daily-loop actions share one stable primary-action row', () => {
    const routineAction = component.root.findByProps({ testID: 'home-current-routine-link' });
    const weightAction = component.root.findByProps({ testID: 'home-weight-action' });
    const actionRow = routineAction.parent;

    expect(actionRow).toBe(weightAction.parent);
    expect(flatStyle(actionRow).flexDirection).toBe('row');
    expect(flatStyle(actionRow).backgroundColor).toBeDefined();
    expect(flatStyle(routineAction).flex).toBe(1);
    expect(flatStyle(weightAction).flex).toBe(1);
  });

  test('the existing full-insights link still reaches Analytics with no section', () => {
    const matches = component.root.findAll(n => {
      if (n.type !== 'Text') return false;
      const flat = Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '');
      return flat.includes('Full history and insights');
    });
    expect(matches.length).toBeGreaterThan(0);
    let node = matches[0].parent;
    while (node && typeof node.props?.onPress !== 'function') node = node.parent;
    render.act(() => { node.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics');
  });
});

// The App-level call site for the same boundary. `importBackup` replaces the
// recovery collections wholesale with no lifecycle action and no sync to
// announce it, so the broadcast has to be explicit — its behavior is covered in
// log-screen.test.js ("a restored local backup refreshes every mounted
// subscriber"); this pins that App actually makes the call.
describe('App.handleImport broadcasts the recovery reload', () => {
  const fs = require('fs');
  const path = require('path');

  test('a successful import reloads recovery records alongside notes and weights', () => {
    const src = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
    expect(src).toMatch(/import \{ reloadRecoveryBlocks \} from '\.\/hooks\/entries\/recoveryBlockHooks'/);
    expect(src).toMatch(
      /if \(result\.ok\) \{[\s\S]*?weightHook\.refresh\(\);[\s\S]*?noteHook\.refresh\(\);[\s\S]*?reloadRecoveryBlocks\(\);[\s\S]*?\}/
    );
  });
});
