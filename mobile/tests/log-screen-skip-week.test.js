import { installRendererCleanup } from './helpers/log-screen';
import React from 'react';
import render from 'react-test-renderer';
import { parseWorkoutNote, applyWeekSkipToText } from '../lib/parser';
import { removeWeekSkipFromText } from '../lib/parser/workoutNote.js';
import { Alert } from 'react-native';

installRendererCleanup();

// Suite-local mocks: each behavior suite runs in its own Jest environment.
jest.mock('expo-updates', () => ({
  useUpdates: () => ({ currentlyRunning: { isEmbeddedLaunch: true } }),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

// A real in-memory store rather than bare jest.fn()s: the durable recovery
// operation journal (#696) reads back what it wrote, so a mock that forgets
// every write would make every journaled operation look unverifiable.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __store: store,
    getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItem: jest.fn(async (key, value) => { store.set(key, value); }),
    removeItem: jest.fn(async (key) => { store.delete(key); }),
    clear: jest.fn(async () => { store.clear(); }),
  };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

jest.mock('../components/LogEmptyState', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LogEmptyState: function MockLogEmptyState() {
      return React.createElement(View);
    }
  };
});

jest.mock('../components/SessionCheckInModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SessionCheckInModal: function MockSessionCheckInModal() {
      return React.createElement(View);
    }
  };
});

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenShell = React.forwardRef(({ children, headerRight }, ref) => {
    return React.createElement(View, { testID: 'screen-shell' }, headerRight, children);
  });
  return {
    ScreenShell,
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});

jest.mock('../hooks/useEntries');

// ── deload ordinal prompt: prefill and editability contract (#284) ────────────
// These legacy source-level assertions check the prefill formula, editable
// input, and forwarding to completeDeload. Rendered screen coverage uses the
// ControlledLogScreen harness below.

const fs = require('fs');

const path = require('path');

// `LogPreviousRoutines` no longer accepts `showRecoveryStart`/
// `onStartRecoveryBlock` (#823) — `Start recovery block` moved to a
// persistent row owned by `LogScreen` itself, under the current routine
// card. See "entry point:" tests in the LogScreen-level Recovery describe
// block below for its current coverage.

// ── applyWeekSkipToText ───────────────────────────────────────────────────────

describe('applyWeekSkipToText: skip week dash insertion', () => {
  test('adds dash after each exercise that has session entries', () => {
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5,5
-Squat
- 225 5,5,5`;
    const { sections } = parseWorkoutNote(raw);
    const result = applyWeekSkipToText(raw, sections);
    const { sections: after } = parseWorkoutNote(result);
    const bench = after[0].exercises.find(e => /bench/i.test(e.name));
    const squat = after[0].exercises.find(e => /squat/i.test(e.name));
    expect(bench.session_entries.at(-1).skipped).toBe(true);
    expect(squat.session_entries.at(-1).skipped).toBe(true);
  });

  test('does not add dash to exercises without any recorded sessions', () => {
    const raw = `Monday
+Lifting
-Bench Press
-Squat`;
    const { sections } = parseWorkoutNote(raw);
    const result = applyWeekSkipToText(raw, sections);
    expect(result).toBe(raw);
  });

  test('skips only exercises with sessions; leaves session-less exercises unchanged', () => {
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5,5
-OHP`;
    const { sections } = parseWorkoutNote(raw);
    const result = applyWeekSkipToText(raw, sections);
    const { sections: after } = parseWorkoutNote(result);
    const bench = after[0].exercises.find(e => /bench/i.test(e.name));
    const ohp = after[0].exercises.find(e => /ohp/i.test(e.name));
    expect(bench.session_entries.at(-1).skipped).toBe(true);
    expect(ohp.session_entries).toHaveLength(0);
  });

  test('preserves existing logged values intact', () => {
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5,5
- 140 3,3,3`;
    const { sections } = parseWorkoutNote(raw);
    const result = applyWeekSkipToText(raw, sections);
    const { sections: after } = parseWorkoutNote(result);
    const bench = after[0].exercises[0];
    const logged = bench.session_entries.filter(e => !e.skipped);
    expect(logged).toHaveLength(2);
    expect(bench.sets.length).toBeGreaterThan(0);
  });

  test('normal workout note with existing skips parses correctly before skip week', () => {
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5,5
-
- 140 3,3,3`;
    const { sections } = parseWorkoutNote(raw);
    const bench = sections[0].exercises[0];
    expect(bench.session_entries[1].skipped).toBe(true);
    expect(bench.session_entries.filter(e => !e.skipped)).toHaveLength(2);
  });

  test('untracked-but-logged exercise receives a dash (eligibility is session_entries only, not tracked state)', () => {
    // Cable Row and Face Pull are accessory exercises not in the default tracked set.
    // They have logged session entries and must receive a skip marker alongside
    // tracked primary lifts — applyWeekSkipToText must be independent of tracking.
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5,5
-Cable Row
- 120 10,10,10
-Face Pull
- 50 15,15,15`;
    const { sections } = parseWorkoutNote(raw);
    const result = applyWeekSkipToText(raw, sections);
    const { sections: after } = parseWorkoutNote(result);
    const bench = after[0].exercises.find(e => /bench/i.test(e.name));
    const cableRow = after[0].exercises.find(e => /cable row/i.test(e.name));
    const facePull = after[0].exercises.find(e => /face pull/i.test(e.name));
    expect(bench.session_entries.at(-1).skipped).toBe(true);
    expect(cableRow.session_entries.at(-1).skipped).toBe(true);
    expect(facePull.session_entries.at(-1).skipped).toBe(true);
  });

  test('deload line between exercises does not misalign skip markers', () => {
    // parseWorkoutNote turns a "Name: 135 lbs 3x5" deload line into its own
    // exercise, so the text walker must treat it as a block boundary too.
    // Before the fix, the flags shifted by one: Bench's marker landed after
    // the deload line (where re-parsing drops it) and Row got Squat's flag.
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5
Squat: 225 lbs 3x5
-Row
- 95 10,10`;
    const { sections } = parseWorkoutNote(raw);
    const result = applyWeekSkipToText(raw, sections);
    const { sections: after } = parseWorkoutNote(result);
    const bench = after[0].exercises.find(e => /bench/i.test(e.name));
    const squat = after[0].exercises.find(e => /squat/i.test(e.name));
    const row = after[0].exercises.find(e => /row/i.test(e.name));
    expect(bench.session_entries.at(-1).skipped).toBe(true);
    expect(row.session_entries.at(-1).skipped).toBe(true);
    // The deload pseudo-exercise has no session entries and gets no marker.
    expect(squat.session_entries).toHaveLength(0);
  });

  test('Skip week can be pressed at any time: no same-marker guard, repeated presses stack skip markers', () => {
    // Per the revised #502 direction, applyWeekSkipToText has no idempotency
    // guard: every call appends exactly one more skip marker per eligible
    // exercise, even when the exercise already ends in a skip.
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5,5`;
    const { sections: s1 } = parseWorkoutNote(raw);
    const once = applyWeekSkipToText(raw, s1);
    const { sections: s2 } = parseWorkoutNote(once);
    const twice = applyWeekSkipToText(once, s2);
    expect(twice).not.toBe(once);
    const { sections: s3 } = parseWorkoutNote(twice);
    const thrice = applyWeekSkipToText(twice, s3);

    const { sections: after } = parseWorkoutNote(thrice);
    const bench = after[0].exercises[0];
    const skipCount = bench.session_entries.filter(e => e.skipped).length;
    expect(skipCount).toBe(3);
  });
});

// ── removeWeekSkipFromText ──────────────────────────────────────────────────

describe('removeWeekSkipFromText: undoes one Skip week press', () => {
  test('removes exactly the last trailing skip marker per exercise', () => {
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5,5
-
-
-Squat
- 225 5,5,5
-`;
    const { sections } = parseWorkoutNote(raw);
    const result = removeWeekSkipFromText(raw, sections);
    const { sections: after } = parseWorkoutNote(result);
    const bench = after[0].exercises.find(e => /bench/i.test(e.name));
    const squat = after[0].exercises.find(e => /squat/i.test(e.name));
    expect(bench.session_entries.filter(e => e.skipped).length).toBe(1);
    expect(squat.session_entries.filter(e => e.skipped).length).toBe(0);
    // Logged values are untouched.
    expect(bench.session_entries.filter(e => !e.skipped)).toHaveLength(1);
    expect(squat.session_entries.filter(e => !e.skipped)).toHaveLength(1);
  });

  test('is a safe no-op when there is no trailing skip to remove', () => {
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5,5`;
    const { sections } = parseWorkoutNote(raw);
    const result = removeWeekSkipFromText(raw, sections);
    expect(result).toBe(raw);
  });

  test('does not touch a non-trailing skip marker or logged values', () => {
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5,5
-
- 140 3,3,3
-`;
    const { sections } = parseWorkoutNote(raw);
    const result = removeWeekSkipFromText(raw, sections);
    const { sections: after } = parseWorkoutNote(result);
    const bench = after[0].exercises[0];
    // The trailing skip is gone, but the mid-history skip and both logged
    // entries remain intact.
    expect(bench.session_entries.map(e => e.skipped)).toEqual([false, true, false]);
    expect(bench.sets.length).toBeGreaterThan(0);
  });

  test('deload line between exercises does not misalign skip removal', () => {
    // Mirror of the applyWeekSkipToText alignment case: the deload line is a
    // block boundary, so the trailing skips on Bench and Row (not the deload
    // or a neighbor) are the ones removed.
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5
-
Squat: 225 lbs 3x5
-Row
- 95 10,10
-`;
    const { sections } = parseWorkoutNote(raw);
    const result = removeWeekSkipFromText(raw, sections);
    const { sections: after } = parseWorkoutNote(result);
    const bench = after[0].exercises.find(e => /bench/i.test(e.name));
    const row = after[0].exercises.find(e => /row/i.test(e.name));
    expect(bench.session_entries.filter(e => e.skipped)).toHaveLength(0);
    expect(row.session_entries.filter(e => e.skipped)).toHaveLength(0);
    expect(bench.session_entries.filter(e => !e.skipped)).toHaveLength(1);
    expect(row.session_entries.filter(e => !e.skipped)).toHaveLength(1);
  });

  test('leaves exercises with no logged sessions unchanged', () => {
    const raw = `Monday
+Lifting
-Bench Press
- 135 5,5,5
-
-OHP`;
    const { sections } = parseWorkoutNote(raw);
    const result = removeWeekSkipFromText(raw, sections);
    const { sections: after } = parseWorkoutNote(result);
    const bench = after[0].exercises.find(e => /bench/i.test(e.name));
    const ohp = after[0].exercises.find(e => /ohp/i.test(e.name));
    expect(bench.session_entries.filter(e => e.skipped)).toHaveLength(0);
    expect(ohp.session_entries).toHaveLength(0);
  });
});

// ── handleSkipWeek: save-gate contract ───────────────────────────────────────
// Source-level assertion that handleSkipWeek captures the handleSave return
// value and bails before _runCheckInDetection when the save fails, mirroring
// the guard in handleDoneCurrent.

describe('handleSkipWeek: fatigue prompt gated on successful save', () => {
  test('handleSkipWeek captures handleSave result and returns early on failure', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../screens/log/useLogCurrentRoutineEditor.js'),
      'utf8'
    );
    // Must capture the return value (not fire-and-forget)
    expect(src).toMatch(/const saved = await handleSave\(/);
    // Must guard on the captured result before check-in detection. The
    // actual failure-gating behavior — including that _runCheckInDetection
    // is never reached and the optimistic text is reverted — is covered by
    // the integration tests below.
    expect(src).toMatch(/if\s*\(!saved\)\s*\{/);
  });

  test('Log keeps both skip controls mounted while saving; the handlers guard the in-flight save', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../screens/LogScreen.js'),
      'utf8'
    );
    expect(src).toMatch(/handleSkipWeek=\{currentEditor\.handleSkipWeek\}/);
    expect(src).toMatch(/handleUnskipWeek=\{currentEditor\.handleUnskipWeek\}/);
    expect(src).not.toMatch(/isSaving \? undefined : currentEditor\.handle(Un)?[sS]kipWeek/);
    const hook = fs.readFileSync(path.join(__dirname, '../screens/log/useLogCurrentRoutineEditor.js'), 'utf8');
    expect(hook).toMatch(/if \(saveCurrentInFlightRef\.current\) \{\s*setSkipWeekStatus\('Finishing the previous save\. Try again\.'\);/);
  });
});

// ── Skip week / Undo skip: integration (#502 revised direction) ────────────
// #502 dropped the calendar-week model: 'Skip week' can be pressed at any
// time with no idempotency guard (repeated presses stack skip markers), and
// a new 'Undo skip' action removes one trailing skip marker per exercise.
// These tests drive the real hook (not source-level regex) through a
// harness matching the pattern used for the A/B week tests above.

describe('Skip week / Undo skip: integration (#502)', () => {
  const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
  const RAW = 'Monday\n+Lifting\n-Bench Press\n- 135 5,5,5';

  // Unmount every harness after each test so the skipWeekStatus/saveSuccess
  // auto-clear timers are cleaned up by their effect teardown instead of
  // firing into an unmounted tree (React act warnings).
  const mounted = [];
  afterEach(() => {
    render.act(() => { mounted.forEach(c => c.unmount()); });
    mounted.length = 0;
    jest.restoreAllMocks();
  });

  function makeHarness({
    updateImpl,
    fatigueTrackingEnabled = false,
    onCheckInPrompt = jest.fn(),
    raw = RAW,
    noteExtras = {},
  } = {}) {
    const update = jest.fn().mockImplementation(
      updateImpl || (async (_id, patch) => ({
        id: 'note1',
        title: patch.title || 'Routine',
        raw_text: patch.raw_text !== undefined ? patch.raw_text : raw,
      }))
    );
    const add = jest.fn();
    const selectCurrent = jest.fn();
    let latest = null;

    function Harness({ currentNote, notes }) {
      const [text, setText] = React.useState(raw);
      const [title, setTitle] = React.useState('Routine');
      const hook = useLogCurrentRoutineEditor({
        workoutNoteText: text,
        setWorkoutNoteText: setText,
        workoutNoteTitle: title,
        setWorkoutNoteTitle: setTitle,
        currentId: 'note1',
        currentNote,
        notes,
        trackedLifts: [],
        update,
        add,
        selectCurrent,
        fatigueTrackingEnabled,
        onCheckInPrompt,
        isActive: true,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook, getText: () => text };
      return null;
    }

    const initialNote = { id: 'note1', title: 'Routine', raw_text: raw, ...noteExtras };
    render.act(() => {
      mounted.push(render.create(<Harness currentNote={initialNote} notes={[initialNote]} />));
    });
    return { getLatest: () => latest, update };
  }

  test('consecutive Skip week presses append multiple skip markers (no idempotency guard)', async () => {
    const { getLatest } = makeHarness();
    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    const skipCount = (getLatest().getText().match(/^-$/gm) || []).length;
    expect(skipCount).toBe(2);
    expect(getLatest().hook.skipWeekStatus).toBe('Skip applied');
  });

  test('a rapid second Skip press cannot reuse an older in-flight save as success', async () => {
    let releaseFirstSave;
    const firstSaveGate = new Promise(resolve => { releaseFirstSave = resolve; });
    const { getLatest, update } = makeHarness({
      updateImpl: async (_id, patch) => {
        if (update.mock.calls.length === 1) await firstSaveGate;
        return {
          id: 'note1',
          title: patch.title || 'Routine',
          raw_text: patch.raw_text,
        };
      },
    });

    let firstPress;
    render.act(() => { firstPress = getLatest().hook.handleSkipWeek(); });
    await render.act(async () => {
      for (let i = 0; i < 10 && update.mock.calls.length === 0; i += 1) {
        await Promise.resolve();
      }
    });
    expect(update).toHaveBeenCalledTimes(1);

    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    expect(update).toHaveBeenCalledTimes(1);
    expect(getLatest().hook.skipWeekStatus).toBe('Finishing the previous save. Try again.');

    await render.act(async () => {
      releaseFirstSave();
      await firstPress;
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect((getLatest().getText().match(/^-$/gm) || [])).toHaveLength(1);
    expect(update).toHaveBeenLastCalledWith(
      'note1',
      expect.objectContaining({
        raw_text: expect.stringMatching(/^-$/m),
        skip_markers: expect.objectContaining({ universal_skip_count: 1 }),
      })
    );
  });

  test('Undo skip removes exactly the last universal skip', async () => {
    const { getLatest } = makeHarness();
    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    expect((getLatest().getText().match(/^-$/gm) || []).length).toBe(2);

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    expect((getLatest().getText().match(/^-$/gm) || []).length).toBe(1);
    expect(getLatest().hook.skipWeekStatus).toBe('Skip removed');

    // Logged values survive both the skips and the undo.
    expect(getLatest().getText()).toContain('135 5,5,5');
  });

  test('Undo skip is a safe no-op when there is nothing to remove', async () => {
    const { getLatest, update } = makeHarness();
    const before = getLatest().getText();
    update.mockClear();

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });

    expect(getLatest().getText()).toBe(before);
    expect(update).not.toHaveBeenCalled();
    expect(getLatest().hook.skipWeekStatus).toBe('No skip to remove');
  });

  test('save failure on Skip week surfaces a status message and does not run fatigue detection', async () => {
    const onCheckInPrompt = jest.fn();
    const { getLatest } = makeHarness({
      updateImpl: async () => null, // handleSave treats a falsy result as a failed save
      fatigueTrackingEnabled: true,
      onCheckInPrompt,
    });

    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });

    expect(onCheckInPrompt).not.toHaveBeenCalled();
    expect(getLatest().hook.skipWeekStatus).toBe('Could not save skip. Try again.');
  });

  test('Undo skip never triggers the fatigue-reason prompt, even on a successful save', async () => {
    const onCheckInPrompt = jest.fn();
    const { getLatest } = makeHarness({ fatigueTrackingEnabled: true, onCheckInPrompt });

    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    onCheckInPrompt.mockClear();

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });

    expect(onCheckInPrompt).not.toHaveBeenCalled();
    expect(getLatest().hook.skipWeekStatus).toBe('Skip removed');
  });

  test('ordinary workout-note path: editing and saving a normal note is unaffected', async () => {
    const { getLatest } = makeHarness();

    render.act(() => {
      getLatest().hook.handleCurrentTextChange('Monday\n+Lifting\n-Bench Press\n- 140 3,3,3');
    });
    await render.act(async () => { await getLatest().hook.handleSave(); });

    expect(getLatest().getText()).toContain('140 3,3,3');
    expect(getLatest().hook.skipWeekStatus).toBe('');
  });

  // ── Universal-skip counter (advisory flag) ────────────────────────────────

  test('counter increments on each skip and decrements on removal, persisted atomically with the text', async () => {
    const { getLatest, update } = makeHarness();

    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    expect(update).toHaveBeenLastCalledWith('note1', expect.objectContaining({
      raw_text: expect.stringContaining('- 135 5,5,5'),
      skip_markers: expect.objectContaining({ universal_skip_count: 1 }),
    }));

    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    expect(update).toHaveBeenLastCalledWith('note1', expect.objectContaining({
      skip_markers: expect.objectContaining({ universal_skip_count: 2 }),
    }));

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    // Decrement rides in the SAME update as the raw_text change (atomic).
    const lastPatch = update.mock.calls[update.mock.calls.length - 1][1];
    expect(lastPatch.skip_markers.universal_skip_count).toBe(1);
    expect(lastPatch.raw_text).toBeDefined();
  });

  test('failed Skip week save does not advance the counter', async () => {
    let fail = true;
    const { getLatest, update } = makeHarness({
      updateImpl: async (_id, patch) => (fail ? null : {
        id: 'note1', title: 'Routine', raw_text: patch.raw_text,
      }),
    });

    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    expect(getLatest().hook.skipWeekStatus).toBe('Could not save skip. Try again.');

    // Next successful skip still persists count 1, not 2: the failed write
    // never committed to the counter.
    fail = false;
    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    expect(update).toHaveBeenLastCalledWith('note1', expect.objectContaining({
      skip_markers: expect.objectContaining({ universal_skip_count: 1 }),
    }));
  });

  test('Remove skip with an outstanding Skip-week press does not ask for confirmation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getLatest } = makeHarness();

    await render.act(async () => { await getLatest().hook.handleSkipWeek(); });
    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(getLatest().hook.skipWeekStatus).toBe('Skip removed');
  });

  test('Remove skip on manual-only trailing skips shows a confirmation; confirm removes them', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // Trailing manual dash, no persisted universal-skip counter.
    const { getLatest, update } = makeHarness({ raw: RAW + '\n-' });

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });

    // Dialog shown; nothing removed or saved yet.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(getLatest().getText()).toBe(RAW + '\n-');

    const buttons = alertSpy.mock.calls[0][2];
    const removeBtn = buttons.find(b => b.text === 'Remove');
    await render.act(async () => { await removeBtn.onPress(); });

    // Confirmed: trailing dash removed, counter stays at 0.
    expect((getLatest().getText().match(/^-$/gm) || []).length).toBe(0);
    expect(update).toHaveBeenLastCalledWith('note1', expect.objectContaining({
      skip_markers: expect.objectContaining({ universal_skip_count: 0 }),
    }));
    expect(getLatest().hook.skipWeekStatus).toBe('Skip removed');
  });

  test('Remove skip confirmation: cancel leaves the text intact', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getLatest, update } = makeHarness({ raw: RAW + '\n-' });

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = alertSpy.mock.calls[0][2];
    const cancelBtn = buttons.find(b => b.text === 'Cancel');
    // Cancel has no onPress handler — it must do nothing.
    expect(cancelBtn.onPress).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(getLatest().getText()).toBe(RAW + '\n-');
  });

  test('stale counter with no trailing skips: no-op wins and the counter clamps to reality', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // Counter claims 3 outstanding skips, but the text has none (hand-edited).
    const { getLatest, update } = makeHarness({
      noteExtras: { skip_markers: { universal_skip_count: 3 } },
    });

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });

    // Text-driven no-op rule wins; no dialog, no text change.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(getLatest().hook.skipWeekStatus).toBe('No skip to remove');
    expect(getLatest().getText()).toBe(RAW);
    // Counter clamped to match reality in a markers-only patch (no raw_text).
    expect(update).toHaveBeenCalledTimes(1);
    const clampPatch = update.mock.calls[0][1];
    expect(clampPatch.skip_markers.universal_skip_count).toBe(0);
    expect(clampPatch.raw_text).toBeUndefined();

    // A second press finds the counter already clamped: pure no-op.
    update.mockClear();
    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    expect(update).not.toHaveBeenCalled();
  });

  test('falsy clamp write does not commit the counter locally; the next press retries the clamp', async () => {
    // Stale counter, no trailing skips, and a persistence layer that returns
    // a falsy result for the clamp write. The ref must NOT be zeroed on the
    // failed write — otherwise a second press is a pure no-op while storage
    // still holds the stale counter (and a reload resurrects it).
    const { getLatest, update } = makeHarness({
      updateImpl: async () => null,
      noteExtras: { skip_markers: { universal_skip_count: 2 } },
    });

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    expect(getLatest().hook.skipWeekStatus).toBe('No skip to remove');
    expect(update).toHaveBeenCalledTimes(1);

    // Second press: counter is still considered stale, so the clamp is
    // retried instead of silently skipped.
    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][1].skip_markers.universal_skip_count).toBe(0);
  });

  test('rejected clamp write is caught, does not commit the counter, and the next press retries', async () => {
    const { getLatest, update } = makeHarness({
      updateImpl: async () => { throw new Error('offline'); },
      noteExtras: { skip_markers: { universal_skip_count: 2 } },
    });

    // Must not throw out of the handler.
    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    expect(getLatest().hook.skipWeekStatus).toBe('No skip to remove');
    expect(update).toHaveBeenCalledTimes(1);

    // Ref kept the stale value, so the clamp is attempted again.
    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    expect(update).toHaveBeenCalledTimes(2);
  });

  test('clamp retry succeeds after an earlier failure and then stops retrying', async () => {
    let fail = true;
    const { getLatest, update } = makeHarness({
      updateImpl: async (_id, patch) => (fail ? null : {
        id: 'note1', title: 'Routine', raw_text: patch.raw_text !== undefined ? patch.raw_text : RAW,
      }),
      noteExtras: { skip_markers: { universal_skip_count: 2 } },
    });

    // First press: clamp write fails, ref stays stale.
    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    expect(update).toHaveBeenCalledTimes(1);

    // Persistence recovers: the retry press clamps and commits the ref.
    fail = false;
    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][1].skip_markers.universal_skip_count).toBe(0);

    // Counter now committed to 0: a third press is a pure no-op.
    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    expect(update).toHaveBeenCalledTimes(2);
  });
});

// ── Undo skip: fatigue-reason check-in cleanup (#502 follow-up) ────────────
// Removing a universal skip must also remove the fatigue-reason check-in
// that was recorded for the session it added, and leave other sessions'
// check-ins correctly attributed. session_checkins is keyed by the note's
// global session index (computeWeeksIn(sections) - 1 at the time the
// check-in was recorded) — the same index removeWeekSkipFromText's removed
// entry occupied.

describe('Undo skip: fatigue-reason check-in cleanup', () => {
  const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');

  const mounted = [];
  afterEach(() => {
    render.act(() => { mounted.forEach(c => c.unmount()); });
    mounted.length = 0;
  });

  function renderWithNote(initialNote, { updateImpl } = {}) {
    const update = jest.fn().mockImplementation(
      updateImpl || (async (_id, patch) => ({
        id: 'note1',
        title: patch.title || initialNote.title,
        raw_text: patch.raw_text !== undefined ? patch.raw_text : initialNote.raw_text,
      }))
    );
    const add = jest.fn();
    const selectCurrent = jest.fn();
    let latest = null;

    function Harness() {
      const [text, setText] = React.useState(initialNote.raw_text);
      const [title, setTitle] = React.useState(initialNote.title);
      const hook = useLogCurrentRoutineEditor({
        workoutNoteText: text,
        setWorkoutNoteText: setText,
        workoutNoteTitle: title,
        setWorkoutNoteTitle: setTitle,
        currentId: 'note1',
        currentNote: initialNote,
        notes: [initialNote],
        trackedLifts: [],
        update,
        add,
        selectCurrent,
        fatigueTrackingEnabled: false,
        onCheckInPrompt: jest.fn(),
        isActive: true,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook, getText: () => text };
      return null;
    }

    render.act(() => { mounted.push(render.create(<Harness />)); });
    return { getLatest: () => latest, update };
  }

  // Depth 2: index 0 is the logged set, index 1 is the trailing skip that
  // Undo skip is about to remove. universal_skip_count 1 marks the trailing
  // skip as Skip-week-added so removal proceeds without a confirmation.
  const RAW_WITH_SKIP = 'Monday\n+Lifting\n-Bench Press\n- 135 5,5,5\n-';
  const MARKERS_ONE_UNIVERSAL = { skip_markers: { universal_skip_count: 1 } };

  test('Undo skip removes the fatigue-reason check-in for the removed session in the same update as the text', async () => {
    const initialNote = {
      id: 'note1',
      title: 'Routine',
      raw_text: RAW_WITH_SKIP,
      ...MARKERS_ONE_UNIVERSAL,
      session_checkins: { '0': { reason: 'sore' }, '1': { reason: 'sick' } },
    };
    const { getLatest, update } = renderWithNote(initialNote);

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });

    // One atomic update: raw_text change, counter decrement, and check-in
    // cleanup all in a single call — a partial write cannot desync them.
    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0][1];
    expect(patch.raw_text).not.toMatch(/^-$/m);
    expect(patch.skip_markers.universal_skip_count).toBe(0);
    // The removed session's (index 1) check-in is dropped; the unaffected
    // earlier session's (index 0) check-in survives with its original key.
    expect(patch.session_checkins).toEqual({ '0': { reason: 'sore' } });
    expect(getLatest().hook.skipWeekStatus).toBe('Skip removed');
  });

  test('Undo skip with no recorded fatigue reason still works and touches no check-in state', async () => {
    const initialNote = {
      id: 'note1',
      title: 'Routine',
      raw_text: RAW_WITH_SKIP,
      ...MARKERS_ONE_UNIVERSAL,
      // no session_checkins at all
    };
    const { getLatest, update } = renderWithNote(initialNote);

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).not.toHaveProperty('session_checkins');
    expect(getLatest().hook.skipWeekStatus).toBe('Skip removed');
  });

  test('failed removal write reports failure — the UI never claims success when cleanup did not persist', async () => {
    // Regression for the review finding: text + check-in cleanup must not be
    // able to desync. With the single atomic update, a failed write persists
    // neither, and the status must be the failure message, never 'Skip removed'.
    const initialNote = {
      id: 'note1',
      title: 'Routine',
      raw_text: RAW_WITH_SKIP,
      ...MARKERS_ONE_UNIVERSAL,
      session_checkins: { '1': { reason: 'sick' } },
    };
    const { getLatest, update } = renderWithNote(initialNote, {
      updateImpl: async () => null, // persistence failure
    });

    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });

    // Exactly one write was attempted (the atomic one) and it failed; there
    // is no separate cleanup write that could have half-applied.
    expect(update).toHaveBeenCalledTimes(1);
    expect(getLatest().hook.skipWeekStatus).toBe('Could not remove skip. Try again.');

    // A retry once persistence recovers still carries the full atomic patch.
    update.mockImplementation(async (_id, patch) => ({
      id: 'note1', title: 'Routine', raw_text: patch.raw_text,
    }));
    await render.act(async () => { await getLatest().hook.handleUnskipWeek(); });
    const retryPatch = update.mock.calls[update.mock.calls.length - 1][1];
    expect(retryPatch.session_checkins).toEqual({});
    expect(retryPatch.skip_markers.universal_skip_count).toBe(0);
    expect(getLatest().hook.skipWeekStatus).toBe('Skip removed');
  });
});
