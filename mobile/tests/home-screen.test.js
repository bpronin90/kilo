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
  const { View, Text, Pressable } = require('react-native');
  return {
    Card: ({ children, style }) => React.createElement(View, { style }, children),
    HeroMetric: { hero: {} },
    LineChart: () => null,
    getSessionTone: () => 'neutral',
    Button: ({ title, onPress }) => React.createElement(Text, { onPress }, title),
    // Shape-faithful stub (#737): the message and the retry wiring are what
    // Home is responsible for, so both stay assertable; the real banner's
    // styling is covered where it lives.
    ErrorBanner: ({ message, onRetry }) => React.createElement(
      View,
      { testID: 'error-banner' },
      React.createElement(Text, null, message),
      onRetry ? React.createElement(Pressable, { testID: 'error-banner-retry', onPress: onRetry }) : null
    ),
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

  // #770: the band's own counts are the per-exercise classification, which is
  // itemized in Progressive Overload — `strength` landed short of the label.
  test('the Exercise Progress band goes to the Analytics Progressive Overload section', () => {
    render.act(() => { byTestID(component.root, 'home-strength-summary-link').props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'progressive-overload');
  });

  test('the 1K card still goes to the Analytics strength section, where the 1K detail lives', () => {
    render.act(() => { byTestID(component.root, 'home-one-k-link').props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'strength');
  });

  test('the full-insights link opens Analytics at the top rather than resuming it', () => {
    render.act(() => { byTestID(component.root, 'home-insights-link').props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'overview');
  });

  test('the weight sparkline goes to the Analytics weight section', () => {
    render.act(() => { byTestID(component.root, 'home-weight-trend-link').props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'weight');
  });

  test('repeating any Analytics handoff issues it again with the same target', () => {
    for (const [testID, expected] of [
      ['home-weight-trend-link', 'weight'],
      ['home-strength-summary-link', 'progressive-overload'],
      ['home-insights-link', 'overview'],
      ['home-one-k-link', 'strength'],
    ]) {
      onNavigate.mockClear();
      const link = byTestID(component.root, testID);
      render.act(() => { link.props.onPress(); });
      render.act(() => { link.props.onPress(); });
      expect(onNavigate).toHaveBeenCalledTimes(2);
      expect(onNavigate).toHaveBeenNthCalledWith(1, 'Analytics', expected);
      expect(onNavigate).toHaveBeenNthCalledWith(2, 'Analytics', expected);
    }
  });

  test('each handoff exposes a button role and an accessible label', () => {
    for (const testID of [
      'home-current-routine-link',
      'home-weight-action',
      'home-strength-summary-link',
      'home-weight-trend-link',
      'home-insights-link',
    ]) {
      const node = byTestID(component.root, testID);
      expect(node.props.accessibilityRole).toBe('button');
      expect(typeof node.props.accessibilityLabel).toBe('string');
      expect(node.props.accessibilityLabel.length).toBeGreaterThan(0);
    }
  });

  // #770: a hint that names a destination the press does not reach is worse
  // than no hint, so each one is pinned to the section its control targets.
  test('each Analytics hint names the section its control actually opens', () => {
    for (const [testID, hint] of [
      ['home-weight-trend-link', 'Opens the weight section of the Analytics tab'],
      ['home-strength-summary-link', 'Opens the Progressive Overload section of the Analytics tab'],
      ['home-one-k-link', 'Opens the strength section of the Analytics tab'],
      ['home-insights-link', 'Opens the Analytics tab at the top'],
    ]) {
      expect(byTestID(component.root, testID).props.accessibilityHint).toBe(hint);
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

      // Every handoff is now a compact labeled row, so they all declare the
      // same minimum target rather than one relying on block geometry.
      for (const testID of [...INLINE_ACTION_IDS, 'home-strength-summary-link', 'home-one-k-link']) {
        const node = local.root.findByProps({ testID });
        expect(node.props.accessibilityRole).toBe('button');
        const style = flatStyle(node);
        expect(style.minHeight).toBeGreaterThanOrEqual(44);
        expect(node.props.hitSlop).not.toBeUndefined();
      }

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
    // Dropping the strength band's chevron in an earlier round recreated the
    // "silently pressable" defect, so every handoff must show a chevron.
    const Svg = require('react-native-svg').default;
    for (const testID of [...INLINE_ACTION_IDS, 'home-strength-summary-link', 'home-one-k-link']) {
      const node = component.root.findByProps({ testID });
      expect(node.props.accessibilityRole).toBe('button');
      expect(node.findAllByType(Svg).length).toBeGreaterThan(0);
    }
  });

  test('the two strength destinations use the established chevron treatment', () => {
    const visibleText = (node) => node.findAllByType('Text')
      .map(t => String(t.props.children ?? '').trim());

    const band = component.root.findByProps({ testID: 'home-strength-summary-link' });
    const oneK = component.root.findByProps({ testID: 'home-one-k-link' });

    // No filled-pill treatment: a chip background read as noisy, so these match
    // the plain `Full history and insights ›` control already on this screen.
    for (const node of [band, oneK]) {
      const filled = node.findAll(n => {
        const s = flatStyle(n);
        return s.backgroundColor !== undefined || s.borderRadius === 999;
      });
      expect(filled).toHaveLength(0);
      expect(flatStyle(node).minHeight).toBe(44);
      expect(node.props.hitSlop).not.toBeUndefined();
    }

    // §12: each accessible label matches its own visible label exactly, and the
    // two names stay distinct so a screen reader can tell them apart.
    expect(visibleText(band)).toContain('Exercise Progress');
    expect(band.props.accessibilityLabel).toBe('Exercise Progress');
    expect(visibleText(oneK)).toContain('1K Progress');
    expect(oneK.props.accessibilityLabel).toBe('1K Progress');
  });

  test('the section-header chevron cannot orphan onto its own line', () => {
    // As independent children of a wrapping full-width row, the chevron dropped
    // alone below the label at 320px with enlarged text. The row now hugs its
    // content and does not wrap; the label shrinks instead.
    for (const testID of ['home-strength-summary-link', 'home-one-k-link']) {
      const style = flatStyle(component.root.findByProps({ testID }));
      expect(style.flexWrap).not.toBe('wrap');
      expect(style.justifyContent).not.toBe('space-between');
    }
  });

  test('each section header keeps its own card alignment', () => {
    // The shared header style must not carry cross-axis alignment: baking
    // `flex-start` into it dragged the centered 1K header to the left edge while
    // that card's total and breakdown stayed centered.
    const band = flatStyle(component.root.findByProps({ testID: 'home-strength-summary-link' }));
    expect(band.alignSelf).toBe('flex-start');

    const oneK = flatStyle(component.root.findByProps({ testID: 'home-one-k-link' }));
    expect(oneK.alignSelf).toBe('center');
  });

  test('the classification columns keep horizontal separation', () => {
    // Content-sized columns with no gap could exactly fill the row, so the three
    // labels ran together as one string at 375px with enlarged text.
    const row = component.root.findByProps({ testID: 'home-strength-summary-link' })
      .parent.findAll(n => flatStyle(n).flexWrap === 'wrap' && flatStyle(n).columnGap)[0];
    expect(row).toBeTruthy();
    expect(flatStyle(row).columnGap).toBeGreaterThanOrEqual(12);
  });

  test('only the section header row is tappable, not the metrics beneath', () => {
    // Making the whole band and the whole 1K card tappable was too much
    // clickable area: the counts, chart, and per-lift grid are data, not
    // controls.
    const band = component.root.findByProps({ testID: 'home-strength-summary-link' });
    const bandText = band.findAllByType('Text').map(t => String(t.props.children ?? '').trim());
    expect(bandText).toContain('Exercise Progress');
    for (const label of ['Progressing', 'Steady', 'Regressing']) {
      expect(bandText).not.toContain(label);
    }

    const oneK = component.root.findByProps({ testID: 'home-one-k-link' });
    const oneKText = oneK.findAllByType('Text').map(t => String(t.props.children ?? '').trim());
    expect(oneKText).toContain('1K Progress');
    for (const label of ['Squats', 'Bench', 'Deadlifts']) {
      expect(oneKText).not.toContain(label);
    }
  });

  test('the 1K card reaches the Analytics strength section, repeatably', () => {
    const oneK = component.root.findByProps({ testID: 'home-one-k-link' });
    render.act(() => { oneK.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'strength');
    render.act(() => { oneK.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'Analytics', 'strength');
  });

  test('the 1K hero total stays the compact-summary size, not the Analytics owner scale (#763)', () => {
    // Regression guard: oneKHeroValue must set its own 32/800 rather than
    // spreading HeroMetric.hero (48/900, the Analytics owner size). Sharing
    // that token would make Home's "compact summary" hierarchy claim false.
    const card = component.root.findByProps({ testID: 'home-one-k-link' }).parent;
    const heroValueNodes = card.findAll(n => n.type === 'Text' && flatStyle(n).fontSize === 32);
    expect(heroValueNodes.length).toBeGreaterThan(0);
    for (const node of heroValueNodes) {
      const style = flatStyle(node);
      expect(style.fontWeight).toBe('800');
    }
    // Nothing in the 1K card renders at the Analytics hero scale.
    const analyticsScaleNodes = card.findAll(n => n.type === 'Text' && flatStyle(n).fontSize === 48);
    expect(analyticsScaleNodes).toHaveLength(0);
  });

  test('the 1K unit suffix uses a literal leading space, not marginLeft (#763)', () => {
    // Nested Text is an inline attributed run on native RN, not a Yoga box, so
    // marginLeft on it does not reliably create spacing. The unit suffix text
    // must carry its own leading space so "1000 lbs" (not "1000lbs") renders
    // on iOS/Android.
    const text = (n) => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? ''));
    const card = component.root.findByProps({ testID: 'home-one-k-link' }).parent;
    const unitNodes = card.findAll(n => n.type === 'Text' && text(n).includes('lbs'));
    expect(unitNodes.length).toBeGreaterThan(0);
    for (const node of unitNodes) {
      expect(text(node)).toBe(' lbs');
      expect(flatStyle(node).marginLeft).toBeFalsy();
    }
  });

  test('neither strength destination nests a press owner', () => {
    // The chevron is presentational; each section header row is the single
    // press owner, so there is no nested responder.
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

  test('the full-insights link still carries its own copy and now targets the overview', () => {
    const matches = component.root.findAll(n => {
      if (n.type !== 'Text') return false;
      const flat = Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '');
      return flat.includes('Full history and insights');
    });
    expect(matches.length).toBeGreaterThan(0);
    let node = matches[0].parent;
    while (node && typeof node.props?.onPress !== 'function') node = node.parent;
    render.act(() => { node.props.onPress(); });
    // #770: "full history and insights" promises the whole tab from the top,
    // which an unsectioned press cannot deliver once Analytics has been scrolled.
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'overview');
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

// ── honest first-paint, failure, and queued-sync states (#737) ────────────────
//
// Home previously rendered `null` for its entire loading branch and computed
// "empty" from collections that a FAILED read also leaves empty. So an
// unresolved read looked broken and a failed read looked like a brand-new
// account. These lock the three outcomes apart, and cover the shell-published
// cloud sync notice Home renders above them.
describe('Home loading, failure, and cloud sync states (#737)', () => {
  const React = require('react');
  const render = require('react-test-renderer');
  const { HomeScreen } = require('../screens/HomeScreen');
  const { CloudSyncContext } = require('../hooks/useEntries');
  const useEntriesModule = require('../hooks/useEntries');
  const hooks = require('../hooks/entries/recoveryBlockHooks');
  const AsyncStorage = require('@react-native-async-storage/async-storage');

  const NOTE = {
    id: 'n1',
    title: 'Routine A',
    raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
    saved_at: '2026-06-01T12:00:00.000Z',
  };

  const props = (overrides = {}) => ({
    weightEntries: [],
    workoutNote: null,
    notes: [],
    successMessage: '',
    onNavigate: jest.fn(),
    loading: false,
    loadError: false,
    onRetryLoad: jest.fn(),
    ...overrides,
  });

  async function mount(overrides = {}, cloudSync = undefined) {
    let component;
    const element = React.createElement(HomeScreen, props(overrides));
    await render.act(async () => {
      component = render.create(
        cloudSync === undefined
          ? element
          : React.createElement(CloudSyncContext.Provider, { value: cloudSync }, element)
      );
    });
    return component;
  }

  const has = (component, testID) => component.root.findAll(n => n.props?.testID === testID).length > 0;
  const hasText = (component, needle) => component.root.findAll(
    n => n.type === 'Text'
      && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '').includes(needle)
  ).length > 0;

  let mounted = [];
  beforeEach(() => {
    jest.clearAllMocks();
    hooks._resetRecoveryAnalyticsFilterCache();
    AsyncStorage.getItem.mockImplementation(async () => null);
    useEntriesModule.useWeightGoal.mockReturnValue({ goal: null, loading: false, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    useEntriesModule.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false, save: jest.fn(), toggle: jest.fn() });
  });

  afterEach(async () => {
    for (const c of mounted) {
      // eslint-disable-next-line no-await-in-loop
      await render.act(async () => { c.unmount(); });
    }
    mounted = [];
    AsyncStorage.getItem.mockReset();
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  const track = (component) => { mounted.push(component); return component; };

  test('an unresolved read paints a labelled placeholder instead of nothing', async () => {
    const component = track(await mount({ loading: true }));

    expect(has(component, 'home-skeleton')).toBe(true);
    const skeleton = component.root.find(n => n.props?.testID === 'home-skeleton');
    expect(skeleton.props.accessibilityLabel).toBe('Loading your dashboard');
    // Loading is not emptiness: the onboarding card must not appear.
    expect(hasText(component, 'Welcome to Kilo')).toBe(false);
  });

  test('a failed read shows the banner and never presents itself as a new account', async () => {
    const onRetryLoad = jest.fn();
    const component = track(await mount({ loadError: true, onRetryLoad }));

    expect(has(component, 'error-banner')).toBe(true);
    expect(hasText(component, 'Could not load your training data.')).toBe(true);
    // The single most damaging confusion: telling a user with history that they
    // have none.
    expect(hasText(component, 'Welcome to Kilo')).toBe(false);
    // And no fabricated dashboard either.
    expect(has(component, 'home-one-k-link')).toBe(false);

    render.act(() => { component.root.findByProps({ testID: 'error-banner-retry' }).props.onPress(); });
    expect(onRetryLoad).toHaveBeenCalled();
  });

  test('a failed read over already-loaded data keeps showing that data under the banner', async () => {
    const component = track(await mount({
      loadError: true,
      notes: [NOTE],
      workoutNote: NOTE,
      weightEntries: [{ id: 'w1', date: '2026-05-30', logged_at: '2026-05-30T08:00:00Z', weight_value: 185, weight_unit: 'lb', note: '' }],
    }));

    expect(has(component, 'error-banner')).toBe(true);
    // Stale but true beats blank.
    expect(has(component, 'home-one-k-link')).toBe(true);
  });

  test('only a verified empty read reaches the welcome card', async () => {
    const component = track(await mount());

    expect(hasText(component, 'Welcome to Kilo')).toBe(true);
    expect(has(component, 'home-skeleton')).toBe(false);
    expect(has(component, 'error-banner')).toBe(false);
  });

  test('with no shell-published summary there is no sync surface at all', async () => {
    const component = track(await mount());
    expect(has(component, 'home-cloud-sync-notice')).toBe(false);
  });

  test('a clean summary shows nothing; queued work links to Cloud Sync and offers no retry', async () => {
    const openCloudSync = jest.fn();
    const clean = track(await mount({}, { summary: { noticeKind: null }, openCloudSync, retrySync: jest.fn() }));
    expect(has(clean, 'home-cloud-sync-notice')).toBe(false);

    const component = track(await mount({}, {
      summary: {
        noticeKind: 'pending',
        noticeTitle: 'Waiting for Cloud Sync',
        noticeMessage: '2 changes are saved on this device and waiting for Cloud Sync.',
      },
      openCloudSync,
      retrySync: jest.fn(),
    }));

    expect(has(component, 'home-cloud-sync-notice')).toBe(true);
    expect(hasText(component, '2 changes are saved on this device and waiting for Cloud Sync.')).toBe(true);
    // Retry belongs to a failure, not to work that simply has not been sent yet.
    expect(has(component, 'home-cloud-sync-retry')).toBe(false);

    render.act(() => { component.root.findByProps({ testID: 'home-cloud-sync-link' }).props.onPress(); });
    expect(openCloudSync).toHaveBeenCalledTimes(1);
    // Repeatable: the shell's own key makes a second identical request a real
    // navigation, so the notice never has to debounce it.
    render.act(() => { component.root.findByProps({ testID: 'home-cloud-sync-link' }).props.onPress(); });
    expect(openCloudSync).toHaveBeenCalledTimes(2);
  });

  test('a failed summary offers retry and surfaces a rejected retry without raw errors', async () => {
    const retrySync = jest.fn().mockResolvedValue({ ok: false, error: 'Could not sync. Open Cloud Sync for details.' });
    const component = track(await mount({}, {
      summary: {
        noticeKind: 'failed',
        noticeTitle: 'Cloud Sync did not finish',
        noticeMessage: 'Your last sync did not finish. Everything you logged is still saved on this device.',
      },
      openCloudSync: jest.fn(),
      retrySync,
    }));

    expect(hasText(component, 'Your last sync did not finish.')).toBe(true);
    const retry = component.root.findByProps({ testID: 'home-cloud-sync-retry' });
    expect(retry.props.accessibilityLabel).toBe('Retry sync');

    await render.act(async () => { retry.props.onPress(); });
    expect(retrySync).toHaveBeenCalledTimes(1);
    expect(hasText(component, 'Could not sync. Open Cloud Sync for details.')).toBe(true);
  });

  test('the notice announces itself as one live region', async () => {
    const component = track(await mount({}, {
      summary: {
        noticeKind: 'pending',
        noticeTitle: 'Waiting for Cloud Sync',
        noticeMessage: '1 change is saved on this device and waiting for Cloud Sync.',
      },
      openCloudSync: jest.fn(),
      retrySync: jest.fn(),
    }));

    // Host elements only: react-test-renderer surfaces RN's composite wrapper
    // and its host element separately, and both carry the same props.
    const alerts = component.root.findAll(
      n => typeof n.type === 'string' && n.props?.accessibilityRole === 'alert'
    );
    expect(alerts.length).toBe(1);
    expect(alerts[0].props.accessibilityLiveRegion).toBe('polite');
    expect(alerts[0].props.accessibilityLabel).toBe(
      'Waiting for Cloud Sync. 1 change is saved on this device and waiting for Cloud Sync.'
    );
  });
});

// ── responsive and large-text structure for the new surfaces (#737) ───────────
//
// Structural guards only: react-test-renderer runs no layout engine. What they
// lock is the set of properties that decide whether these surfaces survive
// 320dp and an enlarged text setting — percentage-based placeholder widths, a
// wrapping action row, >=44dp press targets, and no fixed line boxes or heights
// that an enlarged label would overflow.
describe('Home sync notice and skeleton layout containment (#737)', () => {
  const React = require('react');
  const render = require('react-test-renderer');
  const { HomeScreen } = require('../screens/HomeScreen');
  const { CloudSyncContext } = require('../hooks/useEntries');
  const useEntriesModule = require('../hooks/useEntries');
  const hooks = require('../hooks/entries/recoveryBlockHooks');
  const AsyncStorage = require('@react-native-async-storage/async-storage');

  const flat = (style) => [].concat(style ?? []).reduce((acc, s) => (s ? Object.assign(acc, s) : acc), {});

  const FAILED = {
    summary: {
      noticeKind: 'failed',
      noticeTitle: 'Cloud Sync did not finish',
      noticeMessage: 'Your last sync did not finish. Everything you logged is still saved on this device.',
    },
    openCloudSync: jest.fn(),
    retrySync: jest.fn().mockResolvedValue({ ok: true }),
  };

  let component;
  beforeEach(() => {
    jest.clearAllMocks();
    hooks._resetRecoveryAnalyticsFilterCache();
    AsyncStorage.getItem.mockImplementation(async () => null);
    useEntriesModule.useWeightGoal.mockReturnValue({ goal: null, loading: false, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    useEntriesModule.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false, save: jest.fn(), toggle: jest.fn() });
  });

  afterEach(async () => {
    if (component) await render.act(async () => { component.unmount(); });
    component = null;
    AsyncStorage.getItem.mockReset();
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  async function mountNotice() {
    const props = {
      weightEntries: [], workoutNote: null, notes: [], successMessage: '',
      onNavigate: jest.fn(), loading: false, loadError: false, onRetryLoad: jest.fn(),
    };
    await render.act(async () => {
      component = render.create(
        React.createElement(
          CloudSyncContext.Provider,
          { value: FAILED },
          React.createElement(HomeScreen, props)
        )
      );
    });
    return component;
  }

  test('both notice actions meet the 44dp target and can grow with the label', async () => {
    const c = await mountNotice();
    for (const testID of ['home-cloud-sync-retry', 'home-cloud-sync-link']) {
      const action = c.root.findByProps({ testID });
      const style = flat(action.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      // A fixed height clips an enlarged label instead of growing for it.
      expect(style.height).toBeUndefined();
      expect(action.props.hitSlop).not.toBeUndefined();
      expect(action.props.accessibilityRole).toBe('button');
    }
  });

  test('the action row wraps rather than squeezing two actions onto one narrow line', async () => {
    const c = await mountNotice();
    const retry = c.root.findByProps({ testID: 'home-cloud-sync-retry' });
    const row = retry.parent;
    const style = flat(row.props.style);
    expect(style.flexDirection).toBe('row');
    expect(style.flexWrap).toBe('wrap');
  });

  test('notice copy sets no fixed line box', async () => {
    const c = await mountNotice();
    const texts = c.root.findAll(
      n => n.type === 'Text' && String(n.props.children ?? '').includes('Your last sync did not finish')
    );
    expect(texts.length).toBeGreaterThan(0);
    texts.forEach((t) => {
      const style = flat(t.props.style);
      expect(style.lineHeight).toBeUndefined();
      expect(style.height).toBeUndefined();
      // Nothing truncates the explanation.
      expect(t.props.numberOfLines).toBeUndefined();
    });
  });

  test('skeleton bars are width-relative, so they cannot overflow a 320dp card', async () => {
    const props = {
      weightEntries: [], workoutNote: null, notes: [], successMessage: '',
      onNavigate: jest.fn(), loading: true, loadError: false, onRetryLoad: jest.fn(),
    };
    await render.act(async () => { component = render.create(React.createElement(HomeScreen, props)); });

    const skeleton = component.root.find(n => n.props?.testID === 'home-skeleton');
    const bars = skeleton.findAll(
      n => typeof n.type === 'string' && flat(n.props?.style).borderRadius === 6
    );
    expect(bars.length).toBeGreaterThan(0);
    bars.forEach((bar) => {
      const style = flat(bar.props.style);
      expect(typeof style.width).toBe('string');
      expect(style.width.endsWith('%')).toBe(true);
    });
  });
});

// ── Home's own read failures (#737 review) ────────────────────────────────────
//
// The shell reports the weight/note reads through `loadError`, but Home owns two
// more of its own — useWeightGoal and useTrackedLifts — and both feed visible
// tiers. A failed goal read silently removed the Goal tier and a failed
// tracked-lift read zeroed the strength counts; in both cases the screen looked
// exactly like a user who had set nothing up.
describe('Home local read failures (#737 review)', () => {
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
  const ENTRY = { id: 'w1', date: '2026-05-30', logged_at: '2026-05-30T08:00:00Z', weight_value: 185, weight_unit: 'lb', note: '' };

  const props = (overrides = {}) => ({
    weightEntries: [], workoutNote: null, notes: [], successMessage: '',
    onNavigate: jest.fn(), loading: false, loadError: false, onRetryLoad: jest.fn(),
    ...overrides,
  });

  async function mount(overrides = {}) {
    let component;
    await render.act(async () => { component = render.create(React.createElement(HomeScreen, props(overrides))); });
    return component;
  }

  const has = (component, testID) => component.root.findAll(n => n.props?.testID === testID).length > 0;
  const hasText = (component, needle) => component.root.findAll(
    n => n.type === 'Text'
      && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '').includes(needle)
  ).length > 0;

  let mounted = [];
  const track = (c) => { mounted.push(c); return c; };

  const goalHook = (over = {}) => ({ goal: null, loading: false, error: null, refresh: jest.fn(), save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn(), ...over });
  const trackedHook = (over = {}) => ({ trackedLifts: {}, loading: false, error: null, refresh: jest.fn(), save: jest.fn(), toggle: jest.fn(), ...over });

  beforeEach(() => {
    jest.clearAllMocks();
    hooks._resetRecoveryAnalyticsFilterCache();
    AsyncStorage.getItem.mockImplementation(async () => null);
    useEntriesModule.useWeightGoal.mockReturnValue(goalHook());
    useEntriesModule.useTrackedLifts.mockReturnValue(trackedHook());
  });

  afterEach(async () => {
    for (const c of mounted) {
      // eslint-disable-next-line no-await-in-loop
      await render.act(async () => { c.unmount(); });
    }
    mounted = [];
    AsyncStorage.getItem.mockReset();
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  test('a failed goal read is a failure, not a verified "no goal"', async () => {
    useEntriesModule.useWeightGoal.mockReturnValue(goalHook({ error: new Error('goal read failed') }));
    const component = track(await mount());

    expect(has(component, 'error-banner')).toBe(true);
    // With no data at all it must not fall through to the onboarding card.
    expect(hasText(component, 'Welcome to Kilo')).toBe(false);
  });

  test('a failed tracked-lift read is a failure, not zeroed progress', async () => {
    useEntriesModule.useTrackedLifts.mockReturnValue(trackedHook({ error: new Error('tracked read failed') }));
    const component = track(await mount({ notes: [NOTE], workoutNote: NOTE, weightEntries: [ENTRY] }));

    expect(has(component, 'error-banner')).toBe(true);
    // Cached data still renders under the banner — stale but true.
    expect(has(component, 'home-one-k-link')).toBe(true);
  });

  test('one retry re-runs every read Home renders from, not just the shell pair', async () => {
    const onRetryLoad = jest.fn();
    const refreshGoal = jest.fn();
    const refreshTrackedLifts = jest.fn();
    useEntriesModule.useWeightGoal.mockReturnValue(goalHook({ error: new Error('boom'), refresh: refreshGoal }));
    useEntriesModule.useTrackedLifts.mockReturnValue(trackedHook({ refresh: refreshTrackedLifts }));

    const component = track(await mount({ onRetryLoad }));
    render.act(() => { component.root.findByProps({ testID: 'error-banner-retry' }).props.onPress(); });

    expect(onRetryLoad).toHaveBeenCalledTimes(1);
    expect(refreshGoal).toHaveBeenCalledTimes(1);
    expect(refreshTrackedLifts).toHaveBeenCalledTimes(1);
  });

  test('clean local reads leave the verified empty state reachable', async () => {
    const component = track(await mount());

    expect(has(component, 'error-banner')).toBe(false);
    expect(hasText(component, 'Welcome to Kilo')).toBe(true);
  });

  test('a hook without a refresh function does not break the retry', async () => {
    // Standalone/legacy mocks return partial hook objects; the retry must stay
    // inert rather than throwing.
    useEntriesModule.useWeightGoal.mockReturnValue({ goal: null, loading: false, error: new Error('boom') });
    useEntriesModule.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false });
    const component = track(await mount({ onRetryLoad: undefined }));

    expect(() => render.act(() => {
      component.root.findByProps({ testID: 'error-banner-retry' }).props.onPress();
    })).not.toThrow();
  });
});

// ── Home recovery summary and the compact inclusion help (#757) ───────────────
//
// Two halves of one question: what Home is allowed to SAY about recovery, and
// how much of that explanation has to sit on screen permanently.
//
// The Home half is a truthfulness contract before it is a layout one. Rendering
// nothing means "no recovery block is active", and an unread snapshot is empty
// for exactly the same reason a recovery-free account is — so silence is only
// permitted once a read has actually verified it.
describe('Home recovery summary (#757)', () => {
  const React = require('react');
  const render = require('react-test-renderer');
  const { HomeScreen } = require('../screens/HomeScreen');
  const useEntriesModule = require('../hooks/useEntries');
  const hooks = require('../hooks/entries/recoveryBlockHooks');
  const AsyncStorage = require('@react-native-async-storage/async-storage');

  const BLOCKS_KEY = 'kilo_recovery_blocks';
  const WEEKS_KEY = 'kilo_recovery_block_weeks';
  const JOURNAL_KEY = 'kilo_recovery_operation_journal_v1';

  const NOTE = {
    id: 'n1',
    title: 'Routine A',
    raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
    saved_at: '2026-06-01T12:00:00.000Z',
  };
  const WEEK_NOTE = {
    id: 'nr1',
    title: 'Recovery Week 1',
    raw_text: 'Monday\n+Lifting\n-Bench\n45 5',
    saved_at: '2026-06-08T12:00:00.000Z',
  };

  const block = (over = {}) => ({
    id: 'rb1',
    baseline_note_id: NOTE.id,
    baseline_note_title: 'Routine A',
    baseline: { version: 1, exercises: [] },
    include_in_normal_analytics: false,
    started_at: '2026-06-08T12:00:00.000Z',
    completed_at: null,
    updated_at: '2026-06-08T12:00:00.000Z',
    deleted_at: null,
    ...over,
  });
  const week = (over = {}) => ({
    id: 'rw1',
    block_id: 'rb1',
    note_id: WEEK_NOTE.id,
    week_number: 1,
    completed_at: null,
    updated_at: '2026-06-08T12:00:00.000Z',
    deleted_at: null,
    ...over,
  });

  // Records readable; everything else absent. `null` for the operation journal
  // is an empty journal, so reconciliation is a clean no-op.
  const storageWith = ({ blocks = [], weeks = [], fail = null } = {}) => async (key) => {
    if (fail && fail.includes(key)) throw new Error('storage unavailable');
    if (key === BLOCKS_KEY) return JSON.stringify(blocks);
    if (key === WEEKS_KEY) return JSON.stringify(weeks);
    return null;
  };

  const props = (over = {}) => ({
    weightEntries: [],
    workoutNote: NOTE,
    notes: [NOTE, WEEK_NOTE],
    successMessage: '',
    onNavigate: jest.fn(),
    loading: false,
    ...over,
  });

  const texts = (component) => component.root.findAll(n => n.type === 'Text')
    .map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));
  const hasText = (component, needle) => texts(component).some(t => t.includes(needle));
  const has = (component, testID) => component.root.findAllByProps({ testID }).length > 0;

  let mounted;
  const mount = async (over) => {
    let component;
    await render.act(async () => { component = render.create(<HomeScreen {...props(over)} />); });
    mounted = component;
    return component;
  };

  // Home paints its dashboard once the ordinary-analytics BOUNDARY is verified
  // (#699), which is a different read from the AUTHORITATIVE recovery state
  // this card reports: the boundary read asks storage for the records, while
  // the authoritative pass reconciles the recovery operation journal first. An
  // unreadable journal separates the two exactly as the shipped code does —
  // dashboard populated, recovery status genuinely unknown — which is the
  // situation the loading and unknown renderings exist for.

  beforeEach(() => {
    jest.clearAllMocks();
    hooks._resetRecoveryAnalyticsFilterCache();
    useEntriesModule.useWeightGoal.mockReturnValue({ goal: null, loading: false, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    useEntriesModule.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false, save: jest.fn(), toggle: jest.fn() });
  });

  afterEach(async () => {
    if (mounted) await render.act(async () => { mounted.unmount(); });
    mounted = null;
    AsyncStorage.getItem.mockReset();
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  test('an active block gives Home a compact summary with the current week and its context', async () => {
    AsyncStorage.getItem.mockImplementation(storageWith({ blocks: [block()], weeks: [week()] }));
    const component = await mount();

    expect(has(component, 'home-recovery-summary')).toBe(true);
    expect(hasText(component, 'Week 1 in progress')).toBe(true);
    expect(hasText(component, 'Baselined from Routine A')).toBe(true);
    // The inclusion state is context, not decoration: Home's own classification
    // counts and 1K total are derived from a population this preference decides.
    expect(hasText(component, 'Not counted in your normal analytics.')).toBe(true);
  });

  test('the summary follows the block’s own week and inclusion state', async () => {
    AsyncStorage.getItem.mockImplementation(storageWith({
      blocks: [block({ include_in_normal_analytics: true })],
      weeks: [
        week(),
        week({ id: 'rw2', note_id: 'nr2', week_number: 2, completed_at: '2026-06-22T12:00:00.000Z' }),
      ],
    }));
    const component = await mount();

    expect(hasText(component, 'Week 2 complete')).toBe(true);
    expect(hasText(component, 'Counted in your normal analytics.')).toBe(true);
    expect(hasText(component, 'Not counted in your normal analytics.')).toBe(false);
  });

  test('the summary routes to the Analytics Recovery section, and says so', async () => {
    AsyncStorage.getItem.mockImplementation(storageWith({ blocks: [block()], weeks: [week()] }));
    const onNavigate = jest.fn();
    const component = await mount({ onNavigate });

    const link = component.root.findByProps({ testID: 'home-recovery-link' });
    expect(link.props.accessibilityRole).toBe('button');
    expect(link.props.accessibilityLabel).toBe('Recovery');
    expect(link.props.accessibilityHint).toBe('Opens the Recovery section of the Analytics tab');
    // #770: an unsectioned press inherited whatever position Analytics was last
    // left at, so a control labeled `Recovery` could land anywhere but Recovery.
    render.act(() => { link.props.onPress(); });
    render.act(() => { link.props.onPress(); });
    expect(onNavigate).toHaveBeenNthCalledWith(1, 'Analytics', 'recovery');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'Analytics', 'recovery');
  });

  test('a completed block is not an active one, and Home says nothing at all', async () => {
    AsyncStorage.getItem.mockImplementation(storageWith({
      blocks: [block({ completed_at: '2026-07-01T12:00:00.000Z' })],
      weeks: [week({ completed_at: '2026-07-01T12:00:00.000Z' })],
    }));
    const component = await mount();

    // Verified read, nothing running: silence is the true answer here, and the
    // only state in which it is.
    expect(has(component, 'home-recovery-summary')).toBe(false);
  });

  test('a verified account with no recovery records shows no recovery surface', async () => {
    AsyncStorage.getItem.mockImplementation(storageWith({}));
    const component = await mount();

    expect(has(component, 'home-recovery-summary')).toBe(false);
  });

  test('an unreadable recovery journal is reported as unknown, never as "no recovery"', async () => {
    // The authoritative read fails while the rest of Home loads normally, so
    // the dashboard still paints — and the one thing it cannot honestly claim
    // is that nothing is recovering.
    AsyncStorage.getItem.mockImplementation(storageWith({
      blocks: [block()], weeks: [week()], fail: [JOURNAL_KEY],
    }));
    const component = await mount();

    expect(has(component, 'home-recovery-summary')).toBe(true);
    expect(hasText(component, hooks.RECOVERY_UNVERIFIED_MESSAGE)).toBe(true);
    expect(hasText(component, 'Week 1 in progress')).toBe(false);
  });

  test('the unknown state offers exactly the control its message names', async () => {
    AsyncStorage.getItem.mockImplementation(storageWith({
      blocks: [block()], weeks: [week()], fail: [JOURNAL_KEY],
    }));
    const component = await mount();

    const retry = component.root.findByProps({ testID: 'home-recovery-retry' });
    // ui-design-rules §12: the copy says "Tap Retry recovery", so a control
    // with that exact accessible name has to exist.
    expect(hooks.RECOVERY_UNVERIFIED_MESSAGE).toContain('Retry recovery');
    expect(retry.props.accessibilityRole).toBe('button');
    expect(retry.props.accessibilityLabel).toBe('Retry recovery');

    // And it re-runs the read rather than being decorative: with storage
    // healthy again, the same press resolves the unknown state.
    AsyncStorage.getItem.mockImplementation(storageWith({ blocks: [block()], weeks: [week()] }));
    await render.act(async () => { retry.props.onPress(); });

    expect(hasText(component, 'Week 1 in progress')).toBe(true);
    expect(hasText(component, hooks.RECOVERY_UNVERIFIED_MESSAGE)).toBe(false);
  });

  test('a failed refresh keeps the last verified summary and says why it may be behind', async () => {
    AsyncStorage.getItem.mockImplementation(storageWith({ blocks: [block()], weeks: [week()] }));
    const component = await mount();
    expect(hasText(component, 'Week 1 in progress')).toBe(true);

    AsyncStorage.getItem.mockImplementation(storageWith({ fail: [BLOCKS_KEY, WEEKS_KEY] }));
    await render.act(async () => { await hooks.refreshRecoveryState(); });

    // Stale, not blank and not terminal: last-known-good stays on screen under
    // the reason the newest read did not land.
    expect(hasText(component, 'Week 1 in progress')).toBe(true);
    expect(hasText(component, hooks.RECOVERY_STALE_MESSAGE)).toBe(true);
    expect(has(component, 'home-recovery-retry')).toBe(true);
  });

  test('a failed refresh still warns when the cached snapshot held no active block', async () => {
    // The subtle one: `ready` stays true and `stale` is set, so a card that
    // keyed silence on "verified and nothing active" alone would drop the
    // warning AND the retry, presenting last-known-good as a fresh result.
    AsyncStorage.getItem.mockImplementation(storageWith({}));
    const component = await mount();
    expect(has(component, 'home-recovery-summary')).toBe(false);

    AsyncStorage.getItem.mockImplementation(storageWith({ fail: [BLOCKS_KEY, WEEKS_KEY] }));
    await render.act(async () => { await hooks.refreshRecoveryState(); });

    expect(has(component, 'home-recovery-summary')).toBe(true);
    expect(hasText(component, hooks.RECOVERY_STALE_MESSAGE)).toBe(true);
    expect(has(component, 'home-recovery-retry')).toBe(true);
  });

  test('a still-unresolved read reports loading, and offers no retry for a read that has not failed', async () => {
    let releaseRecoveryRead;
    const gate = new Promise(resolve => { releaseRecoveryRead = resolve; });
    AsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === JOURNAL_KEY) await gate;
      if (key === BLOCKS_KEY) return JSON.stringify([block()]);
      if (key === WEEKS_KEY) return JSON.stringify([week()]);
      return null;
    });

    const component = await mount({ loading: false });
    expect(hasText(component, hooks.RECOVERY_LOADING_MESSAGE)).toBe(true);
    expect(has(component, 'home-recovery-retry')).toBe(false);

    await render.act(async () => { releaseRecoveryRead(); await gate; });
    expect(hasText(component, 'Week 1 in progress')).toBe(true);
    expect(hasText(component, hooks.RECOVERY_LOADING_MESSAGE)).toBe(false);
  });

  test('the summary declares no fixed height or line box that enlarged text could overflow', async () => {
    AsyncStorage.getItem.mockImplementation(storageWith({ blocks: [block()], weeks: [week()] }));
    const component = await mount();

    const flat = (style) => (Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style || {}));
    const card = component.root.findByProps({ testID: 'home-recovery-summary' });
    for (const node of card.findAll(n => n.type === 'Text' || n.type === 'View')) {
      const style = flat(node.props.style);
      expect(style.height).toBeUndefined();
      if (node.type === 'Text') expect(style.lineHeight).toBeUndefined();
    }
    // The one press target inside the card meets the touch minimum.
    const link = component.root.findByProps({ testID: 'home-recovery-link' });
    expect(flat(link.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });
});

// The inclusion control's explanation moved behind an info disclosure (#757).
// Rendered directly: the same control is hosted by the active card on Log and
// by every completed-block row on Analytics, and the behavior under test
// belongs to the control, not to either host.
describe('Recovery inclusion help disclosure (#757)', () => {
  const React = require('react');
  const render = require('react-test-renderer');
  const {
    RecoveryInclusionToggle,
    RECOVERY_INCLUSION_LABEL,
    RECOVERY_INCLUSION_HELP,
  } = require('../components/RecoveryInclusionToggle');

  const BLOCK = {
    id: 'rb1',
    baseline_note_title: 'Routine A',
    include_in_normal_analytics: false,
  };

  const mount = async (over = {}) => {
    let component;
    await render.act(async () => {
      component = render.create(
        <RecoveryInclusionToggle block={BLOCK} onToggle={jest.fn()} {...over} />
      );
    });
    return component;
  };

  const helpText = (component) => component.root.findAll(
    n => typeof n.type === 'string' && n.props.testID === 'recovery-inclusion-help-text-rb1'
  );

  test('the explanation is not on screen until it is asked for', async () => {
    const component = await mount();

    expect(helpText(component).length).toBe(0);
    // The control itself is unchanged — only the paragraph under it moved.
    const label = component.root.findAll(n => n.type === 'Text'
      && String(n.props.children ?? '') === RECOVERY_INCLUSION_LABEL);
    expect(label.length).toBe(1);

    await render.act(async () => { component.unmount(); });
  });

  test('the disclosure opens and closes, and announces its state both ways', async () => {
    const component = await mount();
    const toggle = () => component.root.findByProps({ testID: 'recovery-inclusion-help-rb1' });

    expect(toggle().props.accessibilityRole).toBe('button');
    expect(toggle().props.accessibilityState).toEqual({ expanded: false });
    // The block title disambiguates one row's help button from the next on
    // Analytics, where a row exists per completed block.
    expect(toggle().props.accessibilityLabel).toContain('Routine A');
    expect(toggle().props.accessibilityLabel).toContain('Show');

    await render.act(async () => { toggle().props.onPress(); });
    expect(helpText(component).length).toBe(1);
    expect(toggle().props.accessibilityState).toEqual({ expanded: true });
    expect(toggle().props.accessibilityLabel).toContain('Hide');

    await render.act(async () => { toggle().props.onPress(); });
    expect(helpText(component).length).toBe(0);

    await render.act(async () => { component.unmount(); });
  });

  test('the explanation states what turning it on does, and what it does not do', async () => {
    const component = await mount();
    await render.act(async () => {
      component.root.findByProps({ testID: 'recovery-inclusion-help-rb1' }).props.onPress();
    });

    const shown = String(helpText(component)[0].props.children);
    expect(shown).toBe(RECOVERY_INCLUSION_HELP);
    for (const surface of [
      'normal analytics',
      'classifications',
      'overload signals',
      'Kilo Max',
      '1K',
      'Home summaries',
    ]) {
      expect(shown).toContain(surface);
    }
    // The two questions the paragraph exists to close: the notes are not taken
    // out of Recovery, and they stay editable either way.
    expect(shown).toContain('Recovery Analytics');
    expect(shown).toContain('editable');

    await render.act(async () => { component.unmount(); });
  });

  test('inclusion behavior, accessible names, and the error state are untouched', async () => {
    const onToggle = jest.fn();
    const component = await mount({
      block: { ...BLOCK, include_in_normal_analytics: true },
      busy: true,
      error: 'Could not change this block’s analytics setting.',
      onToggle,
    });

    const sw = component.root.findByProps({ testID: 'recovery-inclusion-switch-rb1' });
    expect(sw.props.accessibilityLabel).toBe(`${RECOVERY_INCLUSION_LABEL}: Routine A`);
    expect(sw.props.accessibilityState).toEqual({ checked: true, disabled: false });
    expect(sw.props.accessibilityHint).toContain('Saving.');
    expect(sw.props.value).toBe(true);

    render.act(() => { sw.props.onValueChange(false); });
    expect(onToggle).toHaveBeenCalledWith({ ...BLOCK, include_in_normal_analytics: true }, false);

    const errors = component.root.findAll(n => n.type === 'Text'
      && String(n.props.children ?? '').includes('Could not change this block'));
    expect(errors.length).toBe(1);

    await render.act(async () => { component.unmount(); });
  });

  test('the help button’s 44dp target is its own box, not a hit slop', async () => {
    const component = await mount();
    const toggle = component.root.findByProps({ testID: 'recovery-inclusion-help-rb1' });

    // A hit slop is clipped at the parent's bounds, and this parent is one text
    // line tall in the common case — so the target has to be real geometry.
    const style = [].concat(toggle.props.style ?? []).reduce(
      (acc, s) => (s ? Object.assign(acc, s) : acc), {}
    );
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);

    await render.act(async () => { component.unmount(); });
  });
});
