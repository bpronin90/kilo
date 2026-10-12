// Regression tests for issue #379: 1k progress mismatch between Home and Analytics.
//
// Root cause: deriveHomeDashboardData called derive1kTotal with sections from the
// current workout note only, while deriveAnalytics used allSections. When squats
// were only in a historical note, Home showed a null total and Analytics showed the
// correct value.
//
// Fix: Home now passes allSections to derive1kTotal, matching Analytics.

import { parseWorkoutNote, epleyPR } from '../lib/parser';
import { derive1kTotal, DEFAULT_1K_EXERCISES } from '../lib/data';
import { deriveHomeDashboardData, deriveHomeRecoveryBig3, resolveHomeOneKSelections, HOME_BIG3_NOT_IN_BASELINE } from '../screens/home/homeDashboardData';
import { deriveAnalytics, deriveOverviewRows, deriveParsedSections } from '../screens/analytics/analyticsDerivations';
import { deriveRecoveryWeekBands } from '../lib/data/recoveryReturnBands';
import { ACTIVE_TRAINING_STATUS } from '../lib/data/activeTrainingContext';
import { buildTrendSections } from '../lib/WeightScreenHelpers';
import {
  summarizeRecoveryBands, formatRecoveryCountLine, recoveryWeekStatusText, WEIGHT_DIRECTION, weightTrendTone,
} from '../lib/data/derivedAnalytics';

// Historical note: all three Big-3 lifts logged in one session.
const HISTORICAL_TEXT = '-DB Bench Press\n135 5\n-Squat\n225 5\n-Deadlift\n315 5';

// Current note: only bench and deadlift — squat was done in the historical note.
const CURRENT_TEXT = '-DB Bench Press\n140 5\n-Deadlift\n320 5';

const SEL = { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' };

describe('1k progress — Home vs Analytics consistency (issue #379)', () => {
  test('Home and Analytics produce the same non-null 1k total when squats are in a historical note', () => {
    const historicalSections = parseWorkoutNote(HISTORICAL_TEXT).sections;
    const currentSections = parseWorkoutNote(CURRENT_TEXT).sections;
    const allSections = [...historicalSections, ...currentSections];

    const historicalNote = { id: 'n1', raw_text: HISTORICAL_TEXT, one_k_exercises: null };
    const currentNote = { id: 'n2', raw_text: CURRENT_TEXT, one_k_exercises: null };
    const notes = [historicalNote, currentNote];

    const { oneK: homeOneK } = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote: currentNote,
      weightGoal: null,
      allSections,
      trackedLifts: {},
    });

    const parsedSections = deriveParsedSections(notes, currentNote);
    const { oneK: analyticsOneK } = deriveAnalytics(parsedSections, {}, SEL, 1.0);

    expect(homeOneK.total).not.toBeNull();
    expect(homeOneK.total).toBeCloseTo(analyticsOneK.total, 5);
    expect(homeOneK.squat).not.toBeNull();
    expect(homeOneK.squat).toBeCloseTo(analyticsOneK.squat, 5);
  });

  test('squat contribution is accounted when it only appears in historical note', () => {
    const historicalSections = parseWorkoutNote(HISTORICAL_TEXT).sections;
    const currentSections = parseWorkoutNote(CURRENT_TEXT).sections;
    const allSections = [...historicalSections, ...currentSections];

    const currentNote = { id: 'n2', raw_text: CURRENT_TEXT, one_k_exercises: null };

    const { oneK } = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote: currentNote,
      weightGoal: null,
      allSections,
      trackedLifts: {},
    });

    // The historical note gives one complete cycle — squat from that cycle is used.
    expect(oneK.squat).toBeCloseTo(epleyPR(225, 5), 5);
    expect(oneK.total).toBeCloseTo(epleyPR(135, 5) + epleyPR(225, 5) + epleyPR(315, 5), 5);
  });

  test('pre-fix behavior: current-only sections give null total when squat is absent', () => {
    // Documents what the bug looked like: passing only the current note's sections
    // returns null because there's no complete Big-3 cycle without squats.
    const currentSections = parseWorkoutNote(CURRENT_TEXT).sections;
    const result = derive1kTotal(currentSections, SEL);
    expect(result.total).toBeNull();
    expect(result.squat).toBeNull();
  });
});

// #854/R5: exercise_classifications is a save-time cache (written by
// useLogCurrentRoutineEditor from deriveWorkoutNoteAnalytics). A note saved
// before a parser grammar change (e.g. #854's F2b widening) can carry
// classifications derived from stale parsing until its next save. Home must
// recompute this live from allSections on every render rather than trust the
// persisted value, so a grammar change never surfaces a stale status row.
describe('deriveHomeDashboardData — exercise_classifications self-heals across a grammar change (#854/R5)', () => {
  test('sessionStatusRows reflect a live recompute, not the note\'s stale persisted cache', () => {
    // Two consecutive sessions of Squat, each showing clear progress (so the
    // live classification is "progressing") — but the persisted cache on the
    // note claims something else entirely, standing in for a value computed
    // under an older grammar before this note was last saved.
    const text = '-Squat\n225 5,5,5\n- 235 5,5,5';
    const { sections } = parseWorkoutNote(text);
    const workoutNote = {
      id: 'n1',
      raw_text: text,
      one_k_exercises: null,
      exercise_classifications: { squat: 'regressing' },
    };

    const { weeklySummary } = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote,
      weightGoal: null,
      allSections: sections,
      trackedLifts: { squat: true },
    });

    const squatRow = weeklySummary.sessionStatusRows.find(r => r.name === 'squat');
    expect(squatRow).toBeDefined();
    expect(squatRow.classification).not.toBe('regressing');
    expect(squatRow.classification).toBe('progressing');
  });
});

// ── HomeScreen hydration gating (issue #442) ─────────────────────────────────
//
// Problem: the empty/get-started card flashed briefly on fresh app open for
// returning users. Root causes:
//   1. reload() in weightHooks and workoutNoteHooks did not return its promise,
//      so refresh()'s .finally fired (setting loading=false) before entries were
//      set, creating a window where loading=false but entries=[].
//   2. isEmptyState did not account for weightGoal or trackedLifts as data
//      sources, so a user with only a goal or tracked lifts still saw the flash.

import React from 'react';
import render from 'react-test-renderer';
import { HomeScreen } from '../screens/HomeScreen';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

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

jest.mock('../lib/unitPreference', () => ({
  useWeightUnit: () => 'lbs',
}));

jest.mock('../hooks/useEntries', () => {
  const actual = jest.requireActual('../hooks/useEntries');
  return {
    ...actual,
    useWeightGoal: jest.fn(),
    useTrackedLifts: jest.fn(),
  };
});

const useEntries = require('../hooks/useEntries');

const MOCK_NOW = new Date('2026-07-07T12:00:00Z');
// Fake timers are installed per-test, not at module scope: a module-scope
// jest.useFakeTimers() contaminates React/react-test-renderer scheduler state
// during import-graph evaluation, which then leaks across Jest's shared worker
// into the next test file (#679).
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(MOCK_NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

function makeHomeProps(overrides = {}) {
  return {
    weightEntries: [],
    workoutNote: null,
    notes: [],
    successMessage: '',
    onNavigate: jest.fn(),
    loading: false,
    ...overrides,
  };
}

function setupHooks({ goalLoading = false, trackedLiftsLoading = false, goal = null, trackedLifts = {} } = {}) {
  useEntries.useWeightGoal.mockReturnValue({ goal, loading: goalLoading, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
  useEntries.useTrackedLifts.mockReturnValue({ trackedLifts, loading: trackedLiftsLoading, save: jest.fn(), toggle: jest.fn() });
}

function hasText(root, needle) {
  return root.findAll(n => {
    if (n.type !== 'Text') return false;
    const flat = Array.isArray(n.props.children)
      ? n.props.children.join('')
      : String(n.props.children ?? '');
    return flat.includes(needle);
  }).length > 0;
}

// #894: Home must be able to tell "nothing classifiable" apart from "freshly
// tracked, still building history" and from "tracked before #893 shipped, no
// activation record" — otherwise a 0/0/0 Progress row reads the same in both
// very different situations.
describe('deriveHomeDashboardData — tracking-state summary (#894)', () => {
  const NOTE_A = { id: 'a', raw_text: '-Bench Press\n135 5' };
  const NOTE_B = { id: 'b', raw_text: '-Bench Press\n140 5' };

  function buildSections() {
    const sectionsA = parseWorkoutNote(NOTE_A.raw_text).sections;
    const sectionsB = parseWorkoutNote(NOTE_B.raw_text).sections;
    return { allSections: [...sectionsA, ...sectionsB], noteSectionsList: [sectionsA, sectionsB] };
  }

  test('a freshly opened tracked span (anchor at the full logged count) is counted as newly tracked', () => {
    const { allSections, noteSectionsList } = buildSections();
    const result = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote: NOTE_B,
      weightGoal: null,
      allSections,
      noteSectionsList,
      trackedLifts: { 'bench press': true },
      trackedLiftActivations: {
        'bench press': { anchor: 2, at: '2026-05-01T00:00:00Z', witness: { headings: [], sessions: '' } },
      },
    });
    expect(result.weeklySummary.newlyTrackedCount).toBe(1);
    expect(result.weeklySummary.hasInheritedTracking).toBe(false);
  });

  test('a tracked exercise with no activation record is reported as inherited, not newly tracked', () => {
    const { allSections, noteSectionsList } = buildSections();
    const result = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote: NOTE_B,
      weightGoal: null,
      allSections,
      noteSectionsList,
      trackedLifts: { 'bench press': true },
      trackedLiftActivations: {},
    });
    expect(result.weeklySummary.newlyTrackedCount).toBe(0);
    expect(result.weeklySummary.hasInheritedTracking).toBe(true);
  });

  // #896 review finding 1: an inherited exercise (no activation record) with
  // exactly one comparable historical session ALSO reports overload_trend
  // 'first_session' — there is nothing prior to compare against either way.
  // Without requiring a live activation, that row double-counted as "newly
  // tracked" instead of "inherited", and newlyTrackedCount's render priority
  // over hasInheritedTracking then showed the wrong explanation.
  test('a single-session inherited exercise (no activation) is never counted as newly tracked', () => {
    const onlyNote = { id: 'a', raw_text: '-Bench Press\n135 5' };
    const { sections } = parseWorkoutNote(onlyNote.raw_text);
    const result = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote: onlyNote,
      weightGoal: null,
      allSections: sections,
      trackedLifts: { 'bench press': true },
      trackedLiftActivations: {},
    });
    expect(result.weeklySummary.newlyTrackedCount).toBe(0);
    expect(result.weeklySummary.hasInheritedTracking).toBe(true);
  });

  // #896 review finding 2: a non-weighted tracked exercise (reps-only/
  // time-based) never gets an `overload_trend` — deriveWorkoutNoteAnalytics's
  // signals cover strength movements only — so its fresh-span state has to be
  // read from deriveNonWeightedTrackedExerciseMetrics's arrow instead.
  test('an explicitly tracked non-weighted exercise in its first span is counted as newly tracked', () => {
    const onlyNote = { id: 'a', raw_text: '-Pull-up\n8,8,7' };
    const { sections } = parseWorkoutNote(onlyNote.raw_text);
    const result = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote: onlyNote,
      weightGoal: null,
      allSections: sections,
      trackedLifts: { 'pull-up': true },
      trackedLiftActivations: {
        'pull-up': { anchor: 0, at: '2026-05-01T00:00:00Z', witness: null },
      },
    });
    expect(result.weeklySummary.newlyTrackedCount).toBe(1);
    expect(result.weeklySummary.hasInheritedTracking).toBe(false);
  });
});

describe('HomeScreen — hydration gating (issue #442)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('shows nothing while the parent loading prop is true, not the empty state', () => {
    setupHooks({ goalLoading: false, trackedLiftsLoading: false });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: true })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
    expect(hasText(component.root, 'Week')).toBe(false);
  });

  test('shows nothing while goalLoading is still true, even when parent loading is false and entries are empty', () => {
    // Reproduces the pre-hydration race window: loading went false early (before
    // entries arrived) but goal hasn't resolved yet. isLoading must stay true.
    setupHooks({ goalLoading: true, trackedLiftsLoading: false });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });

  test('shows nothing while trackedLiftsLoading is still true, even when parent loading is false and entries are empty', () => {
    setupHooks({ goalLoading: false, trackedLiftsLoading: true });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });

  test('shows the empty state only after all sources fully resolve with no data', () => {
    setupHooks({ goalLoading: false, trackedLiftsLoading: false, goal: null, trackedLifts: {} });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(true);
  });

  test('does not show empty state when weight entries exist after hydration', () => {
    setupHooks({ goalLoading: false, trackedLiftsLoading: false });
    const entry = { id: 'e1', date: '2026-07-07', logged_at: '2026-07-07T08:00:00Z', weight_value: 185 };
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false, weightEntries: [entry] })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });

  test('does not show empty state when notes exist after hydration', () => {
    setupHooks({ goalLoading: false, trackedLiftsLoading: false });
    const note = { id: 'n1', raw_text: '-Squat\n225 5', title: 'My Workout' };
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false, notes: [note], workoutNote: note })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });

  test('does not show empty state when a weight goal is set, even with no entries or notes', () => {
    // A user with only a weight goal should not see the get-started card.
    const goal = { target_weight: 175, target_date: '2026-12-01', start_weight: 190, start_date: '2026-01-01' };
    setupHooks({ goalLoading: false, trackedLiftsLoading: false, goal });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });

  test('does not show empty state when tracked lifts are active, even with no entries or notes', () => {
    // A user with tracked lifts should not see the get-started card.
    setupHooks({ goalLoading: false, trackedLiftsLoading: false, trackedLifts: { Squat: true } });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });
});

// ── Welcome card stays short (#1333) ──────────────────────────────────────────
//
// First use is two ways in. Syntax is taught in Log, where it is typed.
describe('HomeScreen — first-use welcome is short (#1333)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('the welcome card offers both daily loops and teaches no syntax', () => {
    setupHooks();
    const onNavigate = jest.fn();
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false, onNavigate })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(true);
    expect(hasText(component.root, '315 5,5')).toBe(false);
    expect(hasText(component.root, '-Squat')).toBe(false);
    const buttons = component.root.findAll(n => n.type === 'Text' && (n.props.children === 'Log Workout' || n.props.children === 'Log Weight'));
    expect(buttons.map(b => b.props.children).sort()).toEqual(['Log Weight', 'Log Workout']);
  });
});

// ── #989: Home feeds the analytics pass the post-deload re-entry inputs ────────
describe('deriveHomeDashboardData — post-deload re-entry wiring (#989)', () => {
  const { captureDeloadWorkingContext, buildDeloadReentryRecord } = require('../lib/parser/deloadHistory');
  const ROUTINE_AT_DELOAD = '-Bench\n- 185 5,5,5\n- 185 5,5,5\n- 185 5,5,5';
  const ROUTINE_FIRST_BACK = '-Bench\n- 185 5,5,5\n- 185 5,5,5\n- 185 5,5,5\n- 185 5,5,5';

  const completedRecord = buildDeloadReentryRecord(
    { id: 'dl_re', completed_at: '2026-06-20T11:00:00.000Z', session_count: 3, note_id: 'wn_dl_re' },
    captureDeloadWorkingContext(parseWorkoutNote(ROUTINE_AT_DELOAD).sections, 'wn_src'),
    parseWorkoutNote(ROUTINE_AT_DELOAD).sections,
  );

  const baseArgs = () => {
    const note = { id: 'wn_src', raw_text: ROUTINE_FIRST_BACK, one_k_exercises: null };
    return {
      weightEntries: [],
      workoutNote: note,
      weightGoal: null,
      allSections: parseWorkoutNote(ROUTINE_FIRST_BACK).sections,
      trackedLifts: { bench: true },
    };
  };

  test('labels the first working session back as re_entry when history + source id are supplied', () => {
    const result = deriveHomeDashboardData({
      ...baseArgs(),
      deloadHistory: [completedRecord],
      sourceNoteId: 'wn_src',
    });
    expect(result.reentry.bench.status).toBe('re_entry');
  });

  test('does not label re_entry for an unrelated source-routine id', () => {
    const result = deriveHomeDashboardData({
      ...baseArgs(),
      deloadHistory: [completedRecord],
      sourceNoteId: 'wn_other',
    });
    expect(result.reentry.bench).toBeUndefined();
  });

  test('does not label re_entry from legacy history with no pre_deload_context', () => {
    const result = deriveHomeDashboardData({
      ...baseArgs(),
      deloadHistory: [{ id: 'dl_legacy', completed_at: '2026-01-01T00:00:00.000Z', session_count: 3 }],
      sourceNoteId: 'wn_src',
    });
    expect(result.reentry.bench).toBeUndefined();
  });

  test('omitting the deload inputs leaves re-entry empty (unchanged legacy behavior)', () => {
    const result = deriveHomeDashboardData(baseArgs());
    expect(result.reentry).toEqual({});
  });

  test('an exercise under an active Recovery block is not labeled', () => {
    const result = deriveHomeDashboardData({
      ...baseArgs(),
      deloadHistory: [completedRecord],
      sourceNoteId: 'wn_src',
      recoveryBlocks: [{
        started_at: '2026-06-01T00:00:00.000Z', completed_at: null,
        baseline: { exercises: [{ key: 'bench' }] },
      }],
    });
    expect(result.reentry.bench).toBeUndefined();
  });
});

describe('Home Recovery Big 3 selection (#1192)', () => {
  test('resolves slot defaults under the routine picks and ignores non-string picks', () => {
    expect(resolveHomeOneKSelections(null)).toEqual(DEFAULT_1K_EXERCISES);
    expect(resolveHomeOneKSelections({ one_k_exercises: { squat: 'Press', deadlift: true, bench: '  ' } }))
      .toEqual({ ...DEFAULT_1K_EXERCISES, squat: 'Press' });
  });

  // Strength model (#1315): the Big 3 read the snapshot's per-lift rows.
  const { captureRecoveryBaselineFromText } = require('../lib/data/recoveryBlocks');
  const { getRecoverySnapshot, _resetRecoverySnapshotStore } = require('../lib/data/recoverySnapshot');
  const BASE = '-Squat\n- 100 5\n-Bench\n- 100 5\n-Deadlift\n- 100 5\n-Plank: 2x45s\n- 45,45';
  const snap = (weekText, { baseText = BASE } = {}) => {
    _resetRecoverySnapshotStore();
    const block = {
      id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'R', baseline: captureRecoveryBaselineFromText(baseText),
      started_at: '2026-05-01T00:00:00Z', completed_at: null, deleted_at: null,
    };
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: 'w1', week_number: 1, completed_at: null, deleted_at: null }];
    return getRecoverySnapshot({ block, weeks, notes: [{ id: 'nb', raw_text: baseText }, { id: 'w1', title: 'W1', raw_text: weekText }] });
  };
  const SEL = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };

  test('scored lifts show their floored strength %, the same values as the Analytics ladder', () => {
    const s = snap('-Squat\n- 65 5\n-Bench\n- 90 5\n-Deadlift\n- 44 5');
    const { big3 } = deriveHomeRecoveryBig3(s, SEL);
    expect(big3.map(l => [l.slot, l.state, l.percent])).toEqual([
      ['squat', 'scored', 65], ['bench', 'scored', 90], ['deadlift', 'scored', 44],
    ]);
    // Same numbers as the Analytics ladder rows (snapshot lifts, floored).
    const { displayPercent } = require('../lib/data/recoveryStrength');
    for (const l of big3) {
      expect(l.percent).toBe(displayPercent(s.strength.lifts.find(x => x.key === l.slot).percent));
    }
  });

  test('a lift with no score shows a status, not a number', () => {
    const s = snap('-Squat\n- 65 5\n-Bench\n- 90 5');
    const { big3 } = deriveHomeRecoveryBig3(s, SEL);
    expect(big3.map(l => [l.slot, l.state, l.percent])).toEqual([
      ['squat', 'scored', 65], ['bench', 'scored', 90], ['deadlift', 'not_retested', null],
    ]);
    const timed = deriveHomeRecoveryBig3(s, { ...SEL, deadlift: 'Plank' }).big3[2];
    expect(timed).toMatchObject({ state: 'not_scored', percent: null });
  });

  test('a mapped lift missing from the baseline stays a Big 3 slot without a number', () => {
    const { big3 } = deriveHomeRecoveryBig3(snap('-Squat\n- 65 5'), { squat: 'Press', bench: 'Bench', deadlift: 'Deadlift' });
    expect(big3.map(l => [l.slot, l.label, l.state, l.percent])[0]).toEqual(['squat', 'Press', HOME_BIG3_NOT_IN_BASELINE, null]);
  });

  test('two slots mapped to the same baseline exercise both report it; the count line counts it once', () => {
    const s = snap('-Squat\n- 65 5', { baseText: '-Squat\n- 100 5' });
    const { big3, counts } = deriveHomeRecoveryBig3(s, { squat: 'Squat', bench: 'Squat', deadlift: 'Deadlift' });
    expect(big3.map(l => [l.slot, l.state, l.percent])).toEqual([
      ['squat', 'scored', 65], ['bench', 'scored', 65], ['deadlift', HOME_BIG3_NOT_IN_BASELINE, null],
    ]);
    expect(counts).toMatchObject({ rosterSize: 1, trained: 1, notYet: 0 });
  });

  test('an unreadable selected week with no earlier score still yields each Big 3 status (unknown), never a score', () => {
    _resetRecoverySnapshotStore();
    const block = { id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'R', baseline: captureRecoveryBaselineFromText(BASE), started_at: '2026-05-01T00:00:00Z', completed_at: null, deleted_at: null };
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: 'ghost', week_number: 1, completed_at: null, deleted_at: null }];
    const big3 = deriveHomeRecoveryBig3(getRecoverySnapshot({ block, weeks, notes: [] }), SEL).big3;
    expect(big3).toHaveLength(3);
    expect(big3.every(l => l.percent == null)).toBe(true);
    expect(big3.some(l => l.state === 'unknown')).toBe(true);
  });
});

// #1193 / #1333: Home names the week only when no headline caption already does,
// and carries no per-week scope explainer — that detail is Analytics-owned.
describe('HomeRecoverySummary — week identity (#1193, #1333)', () => {
  const { HomeRecoverySummary } = require('../screens/home/HomeRecoverySummary');
  const base = {
    status: 'ready', stale: false, message: null, active: true, retry: null,
    comparisonStatus: 'ok', weekNumber: 4, weekNoteStatus: 'ok', big3: [], remaining: null,
  };
  const HEADLINE = { state: 'score', headline: '80% total recovery', caption: '2 of 2 lifts back · avg 80% · Week 4', a11y: 'Week 4: 80% total recovery.' };
  const mount = summary => {
    let c;
    render.act(() => { c = render.create(<HomeRecoverySummary summary={summary} onNavigate={jest.fn()} />); });
    return c.root;
  };

  test('without a headline, the week is named on its own line', () => {
    const root = mount(base);
    expect(hasText(root, 'Latest week: Week 4')).toBe(true);
    expect(root.findAllByProps({ testID: 'home-recovery-week-scope-info' })).toHaveLength(0);
  });

  test('with a headline, its caption carries the week and no second label prints', () => {
    const root = mount({ ...base, headline: HEADLINE });
    expect(hasText(root, '80% total recovery')).toBe(true);
    expect(hasText(root, '2 of 2 lifts back · avg 80% · Week 4')).toBe(true);
    expect(hasText(root, 'Latest week')).toBe(false);
  });

  test('names the linked week by its note title when one exists (#1265)', () => {
    const root = mount({ ...base, weekNoteTitle: 'Knee rehab 2' });
    expect(hasText(root, 'Latest week: Knee rehab 2')).toBe(true);
    expect(hasText(root, 'Week 4')).toBe(false);
  });

  test('a stale summary calls it the last loaded week, not the latest', () => {
    const root = mount({ ...base, stale: true, message: 'stale' });
    expect(hasText(root, 'Last loaded week: Week 4')).toBe(true);
    expect(hasText(root, 'Latest week')).toBe(false);
  });

  test('no week is named when none is logged', () => {
    const root = mount({ ...base, weekNumber: null });
    expect(hasText(root, 'Baseline captured. No week logged yet.')).toBe(true);
    expect(root.findAllByProps({ testID: 'home-recovery-week' })).toHaveLength(0);
  });
});

// #1242: one fixture, one answer. Home, Analytics, Weight, and Log all read the
// shared derived-analytics layer, so the same week prints the same Recovery
// counts and the same weight series reads the same direction and tone.
describe('shared derived analytics (#1242)', () => {
  const metRow = key => ({ key, name: key, state: 'baseline_met', metrics: [{ ratio: 1 }] });
  const rebuildingRow = key => ({ key, name: key, state: 'rebuilding', metrics: [{ ratio: 0.5 }] });
  const notYetRow = key => ({ key, name: key, state: 'not_reintroduced', metrics: [] });
  const WEEK = {
    status: 'ok',
    exercises: [
      metRow('squat'), rebuildingRow('db bench press'), notYetRow('deadlift'),
      metRow('row'), rebuildingRow('press'), notYetRow('curl'), notYetRow('lunge'),
      { key: 'ghost', name: 'Ghost', state: 'not_comparable', unavailable_reason: 'baseline_value_unusable', metrics: [] },
    ],
  };
  const SELECTIONS = { squat: 'Squat', bench: 'DB Bench Press', deadlift: 'Deadlift' };

  test('Home prints the shared roster count line, and the Overview row prints the snapshot headline (#1315)', () => {
    const counts = summarizeRecoveryBands(deriveRecoveryWeekBands(WEEK));
    expect(formatRecoveryCountLine(counts)).toBe('4 of 7 trained · 3 not yet');

    const display = { state: 'score', percent: 80, caption: '2 lifts · Week 1', message: null, a11y: 'Week 1: 80% of X baseline strength.' };
    const row = deriveOverviewRows({
      activeTraining: { status: ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK, recoveryWeekNumber: 1 },
      recoverySnapshot: { stale: false, display },
    }).find(r => r.key === 'recovery');
    expect(row.value).toBe('80%');
    expect(row.infoCaption).toBe('2 lifts · Week 1');
  });

  test('Log and Analytics share the between-weeks wording', () => {
    const rows = deriveOverviewRows({
      activeTraining: { status: ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS, recoveryWeekNumber: 2 },
    });
    expect(rows.find(r => r.key === 'recovery').emptyCaption)
      .toBe(recoveryWeekStatusText({ weekNumber: 2, open: false }));
    expect(recoveryWeekStatusText({ weekNumber: 2, open: false })).toBe('Week 2 complete — add the next week');
    expect(recoveryWeekStatusText({ weekNumber: 3, open: true })).toBe('Week 3 in progress');
  });

  // Rising series: prior 7-day average 180, latest 181.
  const WEIGHT_POINTS = [{ value: 180, label: 'a' }, { value: 181, label: 'b' }];
  const TRENDS = {
    avg7: 181, priorAvg7: 180, avg30: 181, priorAvg30: 180,
    recentDateWeight: 181, priorDateWeight: 180, paceFlag: null,
  };

  test.each([
    [null, 'gaining'],
    ['gain', 'positive'],
    ['loss', 'negative'],
    ['maintain', 'gaining'],
  ])('weight direction and tone agree across Weight and Analytics (goal: %s)', (goalDirection, expectedTone) => {
    const weightSection = buildTrendSections(TRENDS, null).find(s => s.title === '7-day rolling');
    const weightTone = weightTrendTone({ direction: weightSection.direction, goalDirection });

    const analyticsRow = deriveOverviewRows({ weightPoints: WEIGHT_POINTS, currentWeight: 181, weightGoalDirection: goalDirection })
      .find(r => r.key === 'weight');

    expect(weightSection.direction).toBe(WEIGHT_DIRECTION.UP);
    expect(weightSection.col3.value).toBe('↑ Gaining');
    expect(weightTone).toBe(expectedTone);
    expect(analyticsRow.deltaTone).toBe(weightTone);
  });

  test('pace anomalies keep their severity tone over any goal', () => {
    expect(weightTrendTone({ direction: 'up', goalDirection: 'gain', paceLevel: 'spike' })).toBe('spike');
    expect(weightTrendTone({ direction: 'down', goalDirection: null, paceLevel: 'notable' })).toBe('notable');
    expect(weightTrendTone({ direction: 'flat', goalDirection: 'gain' })).toBeNull();
  });
});

describe('deriveHomeDashboardData — weight chart dates use the shared formatter (#1250)', () => {
  test('labels each weight point through formatDate, not MM/DD', () => {
    const weightEntries = [
      { date: '2026-10-01', weight: 180 },
      { date: '2026-10-03', weight: 181 },
    ];
    const { weightSeries } = deriveHomeDashboardData({
      weightEntries,
      workoutNote: null,
      weightGoal: null,
      allSections: [],
      trackedLifts: {},
    });
    expect(weightSeries.map(p => p.label)).toEqual(['10-01-2026', '10-03-2026']);
  });
});

describe('deriveHomeDashboardData — weight chart labels stay with their points (#1250)', () => {
  test('a malformed-date entry does not shift later labels', () => {
    const weightEntries = [
      { date: '2026-10-01', weight: 180 },
      { date: 'bad', weight: 181 },
      { date: '2026-10-03', weight: 182 },
    ];
    const { weightSeries } = deriveHomeDashboardData({
      weightEntries, workoutNote: null, weightGoal: null, allSections: [], trackedLifts: {},
    });
    const labels = weightSeries.map(p => p.label);
    expect(labels).toContain('10-03-2026');
    expect(new Set(labels).size).toBe(labels.length);
  });
});
