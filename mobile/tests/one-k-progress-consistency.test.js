// Regression tests for issue #459: Home and Analytics 1K progress disagree.
//
// Root cause (NOT the derivation): Home reads `notes` from App's useWorkoutNotes()
// instance; AnalyticsScreen calls useWorkoutNotes() again and gets its own React
// state. useAutoSync's onSyncComplete called noteHook.reload(), which is
// instance-local, so after a cloud sync landed new sessions only App's instance
// re-read storage. Home rendered the synced note set while Analytics kept the
// pre-sync snapshot, and the two screens derived their 1K from different data.
// The mismatch healed on the next write (writes call notifyWorkoutNotes(), which
// fans out to every instance), which is why it kept reappearing after #379.
//
// Fix: reloadWorkoutNotes()/reloadWeightEntries() broadcast a reload to every
// mounted instance, and App's sync callback uses them.
//
// #379's tests could not catch this: they pass one shared `notes` array into both
// derivation functions, so they only ever exercise derivation drift. The divergence
// lives one layer up, in state subscription.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { View } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import * as Storage from '../storage/entries';
import { useWorkoutNotes, reloadWorkoutNotes, getNoteSections } from '../hooks/useEntries';
import { deriveHomeDashboardData } from '../screens/home/homeDashboardData';
import {
  deriveAnalytics,
  deriveParsedSections,
  deriveOneKChartData,
  deriveRoutineStartBoundaries,
} from '../screens/analytics/analyticsDerivations';
import { DEFAULT_1K_EXERCISES } from '../lib/data';
import { displayWeight, lbToKg } from '../lib/units';

// --- Harness for the App-wiring guard (see the last describe block) ---------
//
// Real entry hooks, real storage, real broadcast; only App's shell deps are
// stubbed. `useAutoSync` is replaced with a capture so the test can invoke the
// exact `onSyncComplete` App passes it, which is the thing that regressed.
var mockSync = { onSyncComplete: null };

jest.mock('../hooks/entries/syncRecoveryHooks', () => ({
  ...jest.requireActual('../hooks/entries/syncRecoveryHooks'),
  useAutoSync: (_auth, opts) => {
    mockSync.onSyncComplete = opts?.onSyncComplete ?? null;
    return {};
  },
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-updates', () => ({
  useUpdates: () => ({ isUpdatePending: false }),
  reloadAsync: jest.fn(),
}));
jest.mock('../hooks/useAuthSession', () => ({
  useAuthSession: () => ({ configured: false, loading: false, signedIn: false, user: null }),
}));

const mockScreenStub = () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return () => R.createElement(V);
};
jest.mock('../screens/LogScreen', () => ({ LogScreen: mockScreenStub() }));
jest.mock('../screens/WeightScreen', () => ({ WeightScreen: mockScreenStub() }));
jest.mock('../screens/MoreScreen', () => ({ MoreScreen: mockScreenStub() }));

// HomeScreen renders the notes App hands it as a prop (App.js `notes={noteHook.notes}`).
jest.mock('../screens/HomeScreen', () => ({
  HomeScreen: ({ notes }) => {
    const R = require('react');
    const { View: V } = require('react-native');
    return R.createElement(V, { testID: 'home-probe', 'data-count': notes?.length ?? 0 });
  },
}));

// AnalyticsScreen calls useWorkoutNotes() itself and holds its OWN state
// (AnalyticsScreen.js:30) — the second snapshot that went stale.
jest.mock('../screens/AnalyticsScreen', () => ({
  AnalyticsScreen: () => {
    const R = require('react');
    const { View: V } = require('react-native');
    const { useWorkoutNotes: useNotes } = require('../hooks/useEntries');
    const { notes } = useNotes();
    return R.createElement(V, { testID: 'analytics-probe', 'data-count': notes?.length ?? 0 });
  },
}));

const SEL = DEFAULT_1K_EXERCISES;

// Every mounted instance subscribes to the reload/notify fan-outs, so trees MUST
// be unmounted between tests or the listener arrays leak across them.
let mountedTrees = [];

function mount(element) {
  let tree;
  act(() => { tree = renderer.create(element); });
  mountedTrees.push(tree);
  return tree;
}

afterEach(() => {
  act(() => { mountedTrees.forEach(t => t.unmount()); });
  mountedTrees = [];
});

function renderHook(useHook) {
  const ref = { current: null };
  function Probe() {
    ref.current = useHook();
    return null;
  }
  mount(React.createElement(Probe));
  return { ref };
}

async function flush() {
  for (let i = 0; i < 8; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

// The 1K surface each screen actually renders, reduced to one comparable shape.
// Home renders the card only; Analytics renders the same card plus the chart, whose
// latest point is by definition the card's value. Comparing the whole normalized
// point array (not just the headline) is what #379's total-only coverage missed.
function homePipeline(notes, currentNote) {
  const noteSectionsList = notes.map(n => getNoteSections(n));
  const { oneK } = deriveHomeDashboardData({
    weightEntries: [],
    workoutNote: currentNote,
    weightGoal: null,
    allSections: noteSectionsList.flat(),
    noteSectionsList,
    trackedLifts: {},
  });
  return oneK;
}

function analyticsPipeline(notes, currentNote) {
  const oneKSelections = { ...DEFAULT_1K_EXERCISES, ...(currentNote?.one_k_exercises || {}) };
  const parsed = deriveParsedSections(notes, currentNote);
  const { oneK, oneKSeries } = deriveAnalytics(parsed, {}, oneKSelections, 1.0);
  const chart = deriveOneKChartData(oneKSeries, deriveRoutineStartBoundaries(notes, oneKSelections));
  return { oneK, chart };
}

// Home's card must equal Analytics' card, and both must equal the chart's latest
// point — same eligibility, PR rule, aggregation and units, on identical data.
function expectScreensAgree(notes, currentNote) {
  const home = homePipeline(notes, currentNote);
  const { oneK: analytics, chart } = analyticsPipeline(notes, currentNote);

  expect(home).toEqual(analytics);

  if (chart.length > 0) {
    const latest = chart[chart.length - 1];
    expect(Math.round(home.total)).toBe(latest.value);
    expect(home.bench).toBeCloseTo(latest.bench, 5);
    expect(home.squat).toBeCloseTo(latest.squat, 5);
    expect(home.deadlift).toBeCloseTo(latest.deadlift, 5);
    // Chronological: session ordinals strictly increase across the series.
    const sessions = chart.map(p => Number(p.label.slice(1)));
    expect([...sessions].sort((a, b) => a - b)).toEqual(sessions);
  } else {
    expect(home.total).toBeNull();
  }
  return { home, analytics, chart };
}

const note = (id, raw_text, extra = {}) => ({ id, title: `R-${id}`, raw_text, one_k_exercises: null, ...extra });

const FULL_BIG3 = '-DB Bench Press\n135 5\n-Squat\n225 5\n-Deadlift\n315 5';
const HEAVIER_BIG3 = '-DB Bench Press\n155 5\n-Squat\n255 5\n-Deadlift\n365 5';

describe('1K progress — Home and Analytics stay on the same note snapshot (#459)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('a completed sync reloads every mounted instance, not just App\'s', async () => {
    await Storage.saveWorkoutNoteItem(note('n1', FULL_BIG3));
    await Storage.setCurrentWorkoutNote('n1');

    // App's instance feeds HomeScreen; AnalyticsScreen holds its own.
    const app = renderHook(() => useWorkoutNotes());
    const analytics = renderHook(() => useWorkoutNotes());
    await flush();

    expect(app.ref.current.notes).toHaveLength(1);
    expect(analytics.ref.current.notes).toHaveLength(1);

    // A cloud sync pulls down a session logged on another device: adapter.sync()
    // writes the rows straight into storage — no hook write path, no notify.
    await Storage.saveWorkoutNoteItem(note('n2', HEAVIER_BIG3));

    // What App.js's onSyncComplete now does.
    await act(async () => { reloadWorkoutNotes(); });
    await flush();

    expect(app.ref.current.notes).toHaveLength(2);
    expect(analytics.ref.current.notes).toHaveLength(2);
  });

  test('Home and Analytics derive the same 1K from post-sync notes', async () => {
    await Storage.saveWorkoutNoteItem(note('n1', FULL_BIG3));
    await Storage.setCurrentWorkoutNote('n1');

    const app = renderHook(() => useWorkoutNotes());
    const analytics = renderHook(() => useWorkoutNotes());
    await flush();

    await Storage.saveWorkoutNoteItem(note('n2', HEAVIER_BIG3));
    await act(async () => { reloadWorkoutNotes(); });
    await flush();

    // Each screen derives from the snapshot ITS OWN hook instance holds — the
    // divergence the user reported. Before the fix, Analytics still had 1 note.
    const home = homePipeline(app.ref.current.notes, app.ref.current.currentNote);
    const { oneK, chart } = analyticsPipeline(analytics.ref.current.notes, analytics.ref.current.currentNote);

    expect(home).toEqual(oneK);
    expect(Math.round(home.total)).toBe(chart[chart.length - 1].value);
    // The synced heavier cycle is what both screens show.
    expect(chart).toHaveLength(2);
    expect(home.squat).toBeGreaterThan(225);
  });

  test('a newly logged session lands on both screens through the write path', async () => {
    await Storage.saveWorkoutNoteItem(note('n1', FULL_BIG3));
    await Storage.setCurrentWorkoutNote('n1');

    const app = renderHook(() => useWorkoutNotes());
    const analytics = renderHook(() => useWorkoutNotes());
    await flush();

    await act(async () => {
      await app.ref.current.update('n1', { raw_text: `${FULL_BIG3}\n\n${HEAVIER_BIG3}` });
    });
    await flush();

    expect(analytics.ref.current.notes[0].raw_text).toBe(app.ref.current.notes[0].raw_text);
    expectScreensAgree(analytics.ref.current.notes, analytics.ref.current.currentNote);
  });
});

describe('1K progress — Home and Analytics pipeline equivalence (#459)', () => {
  test('no notes', () => {
    const { chart } = expectScreensAgree([], null);
    expect(chart).toHaveLength(0);
  });

  test('squats only in a historical note (the #379 fixture)', () => {
    const notes = [
      note('n1', FULL_BIG3),
      note('n2', '-DB Bench Press\n140 5\n-Deadlift\n320 5'),
    ];
    const { home } = expectScreensAgree(notes, notes[1]);
    expect(home.total).not.toBeNull();
    expect(home.squat).not.toBeNull();
  });

  test('partial Big-3: a selected lift never logged', () => {
    const notes = [note('n1', '-DB Bench Press\n135 5\n-Deadlift\n315 5')];
    const { home, chart } = expectScreensAgree(notes, notes[0]);
    expect(home.total).toBeNull();
    expect(home.bench).not.toBeNull();
    expect(chart).toHaveLength(0);
  });

  test('same-day multi-session note', () => {
    const notes = [note('n1', '-DB Bench Press\n135 5\n140 5\n-Squat\n225 5\n235 5\n-Deadlift\n315 5\n325 5')];
    const { chart } = expectScreensAgree(notes, notes[0]);
    expect(chart).toHaveLength(2);
  });

  test('deload note keeps its own point on both screens', () => {
    const notes = [
      note('n1', FULL_BIG3),
      note('deload', '-DB Bench Press\n95 5\n-Squat\n135 5\n-Deadlift\n185 5', { title: 'Deload · week' }),
      note('n2', HEAVIER_BIG3),
    ];
    const { chart } = expectScreensAgree(notes, notes[2]);
    expect(chart).toHaveLength(3);
  });

  test('routine switch: ordinals never mix across notes', () => {
    const notes = [
      note('n1', `${FULL_BIG3}\n\n${FULL_BIG3}`),
      note('n2', HEAVIER_BIG3),
    ];
    const { chart } = expectScreensAgree(notes, notes[1]);
    expect(chart).toHaveLength(3);
    expect(chart.some(p => p.isRoutineStart)).toBe(true);
  });

  test('custom Big-3 selection on the current note applies to both screens', () => {
    const raw = '-Incline DB Press\n100 5\n-Squat\n225 5\n-Deadlift\n315 5';
    const notes = [note('n1', raw, { one_k_exercises: { bench: 'Incline DB Press' } })];
    const { home } = expectScreensAgree(notes, notes[0]);
    expect(home.total).not.toBeNull();
  });

  test('kg display: card and chart convert the same lb total', () => {
    const notes = [note('n1', `${FULL_BIG3}\n\n${HEAVIER_BIG3}`)];
    const { home, chart } = expectScreensAgree(notes, notes[0]);

    // Home card (HomeScreen) and Analytics card (AnalyticsScreen) both round the
    // converted lb total to 0dp, so the two screens print the same kg number.
    const homeKg = displayWeight(home.total, 'kg').toFixed(0);
    const analyticsKg = lbToKg(home.total).toFixed(0);
    expect(homeKg).toBe(analyticsKg);
    expect(Math.round(lbToKg(chart[chart.length - 1].value))).toBeCloseTo(Number(homeKg), 0);
  });
});

// The guard that actually pins the fix.
//
// The tests above prove the broadcast works, but every one of them would still
// pass if App.js went back to `noteHook.reload()` — they never exercise App's
// wiring. This block renders the real App with the real entry hooks and invokes
// the exact onSyncComplete App passes to useAutoSync. Restore the instance-local
// reload and this fails on the stale Analytics snapshot: the real defect, not a
// missing symbol.
describe('1K progress — App\'s sync callback refreshes every screen (#459)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockSync.onSyncComplete = null;
  });

  test('a cloud sync refreshes Analytics\' own hook instance, not just App\'s', async () => {
    await Storage.saveWorkoutNoteItem(note('n1', FULL_BIG3));
    await Storage.setCurrentWorkoutNote('n1');

    const App = require('../App').default;
    const tree = mount(React.createElement(App));
    await flush();

    const countOf = (id) => tree.root.findByProps({ testID: id }).props['data-count'];

    expect(countOf('home-probe')).toBe(1);
    expect(countOf('analytics-probe')).toBe(1);
    expect(typeof mockSync.onSyncComplete).toBe('function');

    // A sync pulls a session logged on another device: the adapter writes rows
    // straight into storage, so no hook write path runs and nothing is notified.
    await Storage.saveWorkoutNoteItem(note('n2', HEAVIER_BIG3));

    await act(async () => { await mockSync.onSyncComplete(); });
    await flush();

    // Both screens must now be on the post-sync snapshot. Pre-fix, Home showed 2
    // and Analytics still showed 1 — the reported chart mismatch.
    expect(countOf('home-probe')).toBe(2);
    expect(countOf('analytics-probe')).toBe(2);
  }, 30000);
});
