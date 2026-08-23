import React from 'react';
import render from 'react-test-renderer';
import { LogScreen } from '../screens/LogScreen';
import { LogPreviousRoutines } from '../components/LogPreviousRoutines';
import { LogEmptyState } from '../components/LogEmptyState';
import { MoreScreen } from '../screens/MoreScreen';
import * as useEntries from '../hooks/useEntries';
import { LightColors } from '../theme/colors';

jest.mock('expo-updates', () => ({
  useUpdates: () => ({ currentlyRunning: { isEmbeddedLaunch: true } }),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));
import { parseWorkoutNote, applyWeekSkipToText, weeksSinceLastDeload, sessionsSinceLastDeload } from '../lib/parser';
import { removeWeekSkipFromText, MAX_RAW_TEXT_LENGTH } from '../lib/parser/workoutNote.js';
import { deriveRoutineStatus } from '../lib/data';

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

// Simulates the skip-aware IIFE used in all clean-view render paths of LogScreen.
// Returns an array of 'skip' | 'set' | 'unparsed:<raw>' tokens in order.
function simulateSkipAwareRender(ex) {
  const tokens = [];
  const renderedUnparsed = new Set();
  const positions = ex.unparsed_positions || [];
  let posIdx = 0;
  let loggedIdx = 0;
  ex.session_entries.forEach((entry, eni) => {
    while (posIdx < positions.length && positions[posIdx].pos === eni) {
      tokens.push('unparsed:' + positions[posIdx].raw);
      posIdx++;
    }
    if (entry.skipped) {
      tokens.push('skip');
    } else if (entry.unparsed) {
      tokens.push('unparsed:' + entry.raw);
      renderedUnparsed.add(entry.raw);
    } else {
      if (ex.rows[loggedIdx]) tokens.push('set');
      loggedIdx++;
    }
  });
  while (posIdx < positions.length) {
    tokens.push('unparsed:' + positions[posIdx].raw);
    posIdx++;
  }
  const loggedCount = ex.session_entries.filter(e => !e.skipped && !e.unparsed).length;
  ex.rows.slice(loggedCount).forEach(() => tokens.push('set'));
  const positionalRaws = new Set(positions.map(p => p.raw));
  ex.unparsed_rows.forEach(u => {
    if (!positionalRaws.has(u) && !renderedUnparsed.has(u) && !renderedUnparsed.has(u.replace(/^-\s+/, ''))) {
      tokens.push('trailing:' + u);
    }
  });
  return tokens;
}

const REPORTER_NOTE = `Push day
-bench
100 5,5,5
105 5,5,5
110 5,5,5
110 2,2,2
115 5,5,5
-
-
120 5,5,5
125 2,2,2
125 1,1,1
130 5,5,5
130 3,2,2
-
-
135 5,5,5
-
-
-
-
-
140
-
-
-
-
-
-
-
-
-
-
-
-
`;

describe('LogScreen skip-aware rendering', () => {
  let sections;

  beforeAll(() => {
    ({ sections } = parseWorkoutNote(REPORTER_NOTE));
  });

  test('reporter note parses to one exercise named bench', () => {
    expect(sections).toHaveLength(1);
    const bench = sections[0].exercises[0];
    expect(bench.name.toLowerCase()).toMatch(/bench/);
  });

  test('bench exercise has skipped session_entries at correct positions', () => {
    const bench = sections[0].exercises[0];
    const skippedPositions = bench.session_entries
      .map((e, i) => e.skipped ? i : -1)
      .filter(i => i >= 0);
    // slots 5 and 6 are the first two skips (after 5 logged rows at indexes 0-4)
    expect(skippedPositions[0]).toBe(5);
    expect(skippedPositions[1]).toBe(6);
  });

  test('skip-aware render produces skips interspersed with sets, not sets-only', () => {
    const bench = sections[0].exercises[0];
    const tokens = simulateSkipAwareRender(bench);

    // The first 5 entries are sets
    expect(tokens.slice(0, 5)).toEqual(['set', 'set', 'set', 'set', 'set']);
    // Then two skips
    expect(tokens.slice(5, 7)).toEqual(['skip', 'skip']);
    // Then more sets follow
    expect(tokens[7]).toBe('set');

    // Total skips must be non-zero
    const skipCount = tokens.filter(t => t === 'skip').length;
    expect(skipCount).toBeGreaterThan(0);

    // Total sets must equal ex.rows.length
    const setCount = tokens.filter(t => t === 'set').length;
    expect(setCount).toBe(bench.rows.length);
  });

  test('bare unparsed row is recorded in unparsed_positions, not session_entries', () => {
    const bench = sections[0].exercises[0];

    // 140 must not appear in session_entries
    expect(bench.session_entries.find(e => e.raw === '140')).toBeUndefined();

    // 140 must appear in unparsed_positions with correct raw text
    const pos = bench.unparsed_positions.find(p => p.raw === '140');
    expect(pos).toBeDefined();

    // session count must equal actual logged rows with no inflation
    const nonSkipped = bench.session_entries.filter(e => !e.skipped).length;
    expect(nonSkipped).toBe(bench.rows.length);
  });

  test('bare unparsed row (140) renders in chronological position between skip groups', () => {
    const bench = sections[0].exercises[0];
    const tokens = simulateSkipAwareRender(bench);

    const unparsedIdx = tokens.indexOf('unparsed:140');
    expect(unparsedIdx).toBeGreaterThan(-1);

    // There must be skips both before and after the unparsed row
    const skipsBefore = tokens.slice(0, unparsedIdx).filter(t => t === 'skip').length;
    const skipsAfter = tokens.slice(unparsedIdx + 1).filter(t => t === 'skip').length;
    expect(skipsBefore).toBeGreaterThan(0);
    expect(skipsAfter).toBeGreaterThan(0);

    // 140 must not appear as a trailing item (which was the old bug)
    expect(tokens[tokens.length - 1]).not.toBe('trailing:140');
  });

  test('row-only render (old behavior) would omit all skip markers', () => {
    const bench = sections[0].exercises[0];
    // Old path: just render ex.rows, no skip markers
    const rowOnlyTokens = bench.rows.map(() => 'set');
    expect(rowOnlyTokens.every(t => t === 'set')).toBe(true);
    // Old path produces no skips — confirms the bug was real
    expect(rowOnlyTokens.filter(t => t === 'skip')).toHaveLength(0);
  });
});

// ── deload date edit: two-metric model ───────────────────────────────────────

const MOCK_NOW_MS_LOG = new Date('2026-06-06T12:00:00.000Z').getTime();

describe('deload date edit: sessions and weeks are independent metrics', () => {
  beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(MOCK_NOW_MS_LOG); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('editing completed_at changes weeksSinceLastDeload but leaves session_count untouched', () => {
    const totalSessions = 14;
    // Deload originally completed May 9 (4 weeks ago); user corrects to May 16 (3 weeks ago)
    const originalRecord = { id: 'dl_1', completed_at: '2026-05-09T12:00:00.000Z', session_count: 11 };
    const editedRecord   = { id: 'dl_1', completed_at: '2026-05-16T12:00:00.000Z', session_count: 11 };

    expect(sessionsSinceLastDeload(totalSessions, [originalRecord])).toBe(3);
    expect(sessionsSinceLastDeload(totalSessions, [editedRecord])).toBe(3); // unchanged

    expect(weeksSinceLastDeload([originalRecord])).toBe(4);
    expect(weeksSinceLastDeload([editedRecord])).toBe(3);   // updated
  });

  test('sessions since deload only depends on session_count, not completed_at', () => {
    const totalSessions = 20;
    const history = [{ id: 'dl_1', completed_at: '2026-01-01T12:00:00.000Z', session_count: 15 }];
    expect(sessionsSinceLastDeload(totalSessions, history)).toBe(5);
  });

  test('weeks since deload only depends on completed_at, not session_count', () => {
    // 14 days = 2 full weeks
    const history = [{ id: 'dl_1', completed_at: '2026-05-23T12:00:00.000Z', session_count: 99 }];
    expect(weeksSinceLastDeload(history)).toBe(2);
  });

  test('legacy records without note_id work for both metrics', () => {
    const history = [{ id: 'dl_legacy', completed_at: '2026-05-23T12:00:00.000Z', session_count: 5 }];
    expect(sessionsSinceLastDeload(10, history)).toBe(5);
    expect(weeksSinceLastDeload(history)).toBe(2);
  });

  test('date edit with no linked history record must not change the analytics anchor (desync guard)', () => {
    // Simulate the save-path contract: if histRecord is not found, saved_at should NOT
    // be applied. The session and weeks metrics must remain based on the original record.
    const totalSessions = 8;
    const legacyRecord = { id: 'dl_legacy', completed_at: '2026-05-23T12:00:00.000Z', session_count: 5 };
    // After attempted date change (no histRecord found, save blocked):
    expect(sessionsSinceLastDeload(totalSessions, [legacyRecord])).toBe(3);
    expect(weeksSinceLastDeload([legacyRecord])).toBe(2);
    // The record is unchanged — same values before and after.
    expect(legacyRecord.completed_at).toBe('2026-05-23T12:00:00.000Z');
  });
});

// ── deload_session_ordinal: session-ordinal anchor (#284) ─────────────────────
// Ordinal logic lives in deriveRoutineStatus (data.js); test via that entry point.

function rawWithSessions(n) {
  return ['Monday', '+ lifting', '1. Squat', ...Array(n).fill('- 225x5')].join('\n');
}

function sectionsWithSessions(n) {
  return parseWorkoutNote(rawWithSessions(n)).sections;
}

describe('deload_session_ordinal: ordinal-based sessions-since-deload (#284)', () => {
  const NOTE = { saved_at: '2026-04-06T00:00:00.000Z' };

  test('ordinal takes precedence over stale session_count', () => {
    // New-format record: session_count=99 is stale; ordinal=4 (pre-deload count, deload_ordinal_is_count=true) wins.
    const history = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 99, deload_session_ordinal: 4, deload_ordinal_is_count: true }];
    expect(deriveRoutineStatus(sectionsWithSessions(5), NOTE, history).sessionsSinceDeload).toBe(1);
    expect(deriveRoutineStatus(sectionsWithSessions(4), NOTE, history).sessionsSinceDeload).toBe(0);
    expect(deriveRoutineStatus(sectionsWithSessions(7), NOTE, history).sessionsSinceDeload).toBe(3);
  });

  test('freshly completed deload (no new sessions yet) reads 0', () => {
    // 4 sessions in note, ordinal=4 (pre-deload count) → max(0, 4-4)=0.
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 4, deload_session_ordinal: 4 }];
    expect(deriveRoutineStatus(sectionsWithSessions(4), NOTE, history).sessionsSinceDeload).toBe(0);
  });

  test('first post-deload session reads 1', () => {
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 4, deload_session_ordinal: 4 }];
    expect(deriveRoutineStatus(sectionsWithSessions(5), NOTE, history).sessionsSinceDeload).toBe(1);
  });

  test('legacy records without deload_session_ordinal fall through to session_count', () => {
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 10 }];
    expect(deriveRoutineStatus(sectionsWithSessions(14), NOTE, history).sessionsSinceDeload).toBe(4);
  });

  test('user-corrected ordinal counts correctly for partial-import scenario', () => {
    // App note has 2 sessions (imported last 2 of a real 14-session routine).
    // Default prefill would be 2; user corrects to 14 (real pre-deload count, deload_ordinal_is_count=true).
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 2, deload_session_ordinal: 14, deload_ordinal_is_count: true }];
    // Before the note accumulates enough sessions past anchor 14, still 0.
    expect(deriveRoutineStatus(sectionsWithSessions(2), NOTE, history).sessionsSinceDeload).toBe(0);
    // Once note reaches session 15 (one beyond ordinal 14), first post-deload session = 1.
    expect(deriveRoutineStatus(sectionsWithSessions(15), NOTE, history).sessionsSinceDeload).toBe(1);
    expect(deriveRoutineStatus(sectionsWithSessions(17), NOTE, history).sessionsSinceDeload).toBe(3);
  });
});

// ── deload ordinal prompt: prefill and editability contract (#284) ────────────
// LogScreen cannot be rendered in this test environment. These source-level
// assertions prove the behavioral contract: prefill formula, editable input,
// and correct forwarding to completeDeload.

const fs = require('fs');
const path = require('path');

function readLogScreenSource() {
  const main = fs.readFileSync(path.join(__dirname, '../screens/LogScreen.js'), 'utf8');
  const deload = fs.readFileSync(path.join(__dirname, '../components/LogDeloadSection.js'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../components/LogScreenEditorCard.js'), 'utf8');
  const active = fs.readFileSync(path.join(__dirname, '../components/LogActiveRoutineCard.js'), 'utf8');
  const previous = fs.readFileSync(path.join(__dirname, '../components/LogPreviousRoutines.js'), 'utf8');
  const helpers = fs.readFileSync(path.join(__dirname, '../lib/LogScreenHelpers.js'), 'utf8');
  const currentEditorHook = fs.readFileSync(path.join(__dirname, '../screens/log/useLogCurrentRoutineEditor.js'), 'utf8');
  const otherEditorHook = fs.readFileSync(path.join(__dirname, '../screens/log/useLogOtherRoutineEditor.js'), 'utf8');
  const deloadEditorHook = fs.readFileSync(path.join(__dirname, '../screens/log/useLogDeloadEditor.js'), 'utf8');
  const logHelpersLocal = fs.readFileSync(path.join(__dirname, '../screens/log/logScreenHelpers.js'), 'utf8');
  return main + '\n' + deload + '\n' + editor + '\n' + active + '\n' + previous + '\n' + helpers + '\n' + currentEditorHook + '\n' + otherEditorHook + '\n' + deloadEditorHook + '\n' + logHelpersLocal;
}

describe('deload ordinal prompt: prefill and editability contract (#284)', () => {
  let src;
  beforeAll(() => {
    src = readLogScreenSource();
  });

  test('prompt is prefilled with logSessionCount (pre-deload session count)', () => {
    expect(src).toMatch(/setDeloadOrdinalInput\(String\(logSessionCount\)\)/);
  });

  test('prompt input is editable: onChangeText wired to setDeloadOrdinalInput', () => {
    expect(src).toMatch(/onChangeText\s*=\s*\{setDeloadOrdinalInput\}/);
  });

  test('confirm handler parses user input as integer', () => {
    expect(src).toMatch(/parseInt\(deloadOrdinalInput,\s*10\)/);
  });

  test('confirm handler forwards parsed ordinal to completeDeload', () => {
    expect(src).toMatch(/deloadSessionOrdinal\s*:\s*ordinal/);
  });
});

// ── autosave vs explicit save: call-site contract ────────────────────────────
// React Native components cannot be rendered in this test environment, so these
// tests assert the source-level contract directly: both debounce timer callbacks
// must pass { autosave: true } to their respective save handlers.  If either
// call site is changed back to a bare call, the test will fail and the flicker
// will return.

describe('autosave call sites: debounce timers pass { autosave: true }', () => {
  let src;
  beforeAll(() => {
    src = readLogScreenSource();
  });

  test('current-note debounce timer calls handleSave({ autosave: true })', () => {
    expect(src).toMatch(/handleSave\(\s*\{\s*autosave\s*:\s*true\s*\}\s*\)/);
  });

  test('other-note debounce timer calls handleSaveOtherNote({ autosave: true })', () => {
    expect(src).toMatch(/handleSaveOtherNote\(\s*\{\s*autosave\s*:\s*true\s*\}\s*\)/);
  });

  test('handleSave suppresses setSaveSuccess when autosave is true', () => {
    // The guarded call must be present: if (!autosave) setSaveSuccess(...)
    expect(src).toMatch(/if\s*\(\s*!autosave\s*\)\s*setSaveSuccess\s*\(\s*'Saved on device'\s*\)/);
  });

  test('current editor save message clearly indicates device-local save', () => {
    // The save confirmation must say "Saved on device", not "Saved!" or any cloud-sync claim.
    expect(src).toMatch(/setSaveSuccess\s*\(\s*'Saved on device'\s*\)/);
    // Verify that the old generic message is not present in the updated section.
    const currentEditorHookStart = src.indexOf("'Saved on device'");
    expect(currentEditorHookStart).toBeGreaterThan(-1);
  });
});

// ── deload date edit: save-flow stuck-state prevention ───────────────────────
// These source-level assertions prove that the save path cannot remain stuck in
// a pending state when the user presses Done while an autosave is in flight.
// The component cannot be rendered in this env, so we assert the code structure.

describe('deload date edit: save flow does not get stuck in pending state', () => {
  let src;
  beforeAll(() => {
    src = readLogScreenSource();
  });

  test('handleSaveOtherNote uses an in-flight ref guard, not a bare noteIsSaving return', () => {
    // The old guard `if (noteIsSaving) return;` returned undefined, causing
    // handleDoneOther to treat the in-flight autosave as a failure. The fix
    // replaces it with an in-flight promise ref so callers can chain on the
    // running save rather than receiving undefined.
    expect(src).toMatch(/saveOtherNoteInFlightRef\.current/);
    expect(src).not.toMatch(/if\s*\(\s*noteIsSaving\s*\)\s*return\s*;/);
  });

  test('in-flight ref is returned when a concurrent save is already running', () => {
    // When saveOtherNoteInFlightRef.current is non-null, the function must return
    // it so the caller awaits the real result rather than undefined.
    expect(src).toMatch(/if\s*\(\s*saveOtherNoteInFlightRef\.current\s*\)\s*return\s+saveOtherNoteInFlightRef\.current/);
  });

  test('in-flight ref is cleared in the finally block so it never leaks', () => {
    // Leak would leave saveOtherNoteInFlightRef.current non-null after the save,
    // preventing any future save from starting.
    expect(src).toMatch(/finally[\s\S]{0,200}saveOtherNoteInFlightRef\.current\s*=\s*null/);
  });

  test('setNoteIsSaving(false) is in a finally block in the deload save path', () => {
    // Guarantees noteIsSaving is always reset regardless of success or failure,
    // preventing the save-spinner state from getting permanently stuck.
    expect(src).toMatch(/finally[\s\S]{0,200}setNoteIsSaving\s*\(\s*false\s*\)/);
  });

  test('deload date save path calls updateDeload before update on date change', () => {
    // Both the history record and the note record must be updated. If updateDeload
    // is absent the history anchor drifts from the note saved_at date.
    expect(src).toMatch(/await\s+updateDeload\s*\([\s\S]{0,700}await\s+update\s*\(\s*editingNoteId/);
  });

  test('deload save path writes deload_session_ordinal into the deloadPatch', () => {
    // The ordinal field must flow through the consolidated deloadPatch so that
    // a single updateDeload call carries both date and ordinal changes.
    expect(src).toMatch(/deload_session_ordinal/);
    expect(src).toMatch(/deloadPatch\.deload_session_ordinal/);
  });

  test('deload ordinal input strips non-numeric characters', () => {
    // The TextInput onChangeText handler must sanitize to digits only so the
    // parseInt call downstream always receives a clean integer string.
    expect(src).toMatch(/replace\s*\(\s*\/\[.*\^.*0-9.*\].*\/.*,\s*''\s*\)/);
  });

  test('deload date picker uses onChange callback prop', () => {
    // Assert that the deload DateTimePicker uses onChange prop rather than onValueChange
    expect(src).toMatch(/<DateTimePicker[\s\S]*?onChange\s*=\s*\{/);
    expect(src).not.toMatch(/<DateTimePicker[\s\S]*?onValueChange\s*=\s*\{/);
  });
});

// ── Done vs in-flight autosave: trailing edits must be flushed (#528) ─────────
// Deterministic reproduction of the #522/#528 race: an autosave for older content
// is still in flight when the user types more and presses Done. Done coalesces onto
// the in-flight promise, which persists the OLD snapshot, and then closes the editor
// without ever persisting the trailing keystrokes. This behavioral test drives the
// real hook and asserts the final persisted content is the latest text.

describe('handleDoneOther flushes trailing edits when Done races an in-flight autosave (#528)', () => {
  const { useLogOtherRoutineEditor } = require('../screens/log/useLogOtherRoutineEditor');

  // These tests exercise handleSaveOtherNote({ autosave: true }), which on success
  // schedules a real (non-fake-timer) setTimeout to clear a transient "saved" flag
  // (see useLogOtherRoutineEditor). Unmounting the harness after each test runs that
  // hook's effect cleanup and clears the timer, so it can't fire after the test file
  // has finished and trip Jest's "log after tests are done" guard (#683).
  let harnessRenderer;

  afterEach(() => {
    if (harnessRenderer) {
      render.act(() => { harnessRenderer.unmount(); });
      harnessRenderer = null;
    }
  });

  test('the latest keystrokes are persisted when Done is pressed during an in-flight autosave', async () => {
    const note = { id: 'n1', title: 'R', raw_text: 'A0' };

    // Hold the first write (the "A" autosave) in flight until we release it, so Done
    // deterministically races it. Later writes resolve immediately.
    let releaseFirstSave;
    const firstSaveGate = new Promise((resolve) => { releaseFirstSave = resolve; });
    let calls = 0;
    const update = jest.fn().mockImplementation(async (id, patch) => {
      calls += 1;
      if (calls === 1) await firstSaveGate;
      return { id, title: patch.title, raw_text: patch.raw_text };
    });

    let latest = null;
    function Harness({ notes }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'n1',
        currentNote: note,
        deloadHistory: [],
        update,
        add: jest.fn(),
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { harnessRenderer = render.create(<Harness notes={[note]} />); });

    // Open the existing note, then type "A".
    render.act(() => { latest.hook.handleOpenOtherNote(note); });
    render.act(() => { latest.hook.setEditingText('A'); });

    // The "A" autosave starts and is held in flight.
    let autosavePromise;
    render.act(() => { autosavePromise = latest.hook.handleSaveOtherNote({ autosave: true }); });

    // The user types "B" while the "A" autosave is still running.
    render.act(() => { latest.hook.setEditingText('B'); });

    // Done is pressed mid-flight.
    let donePromise;
    render.act(() => { donePromise = latest.hook.handleDoneOther(); });

    // Release the in-flight "A" save and let everything Done chains after it settle.
    await render.act(async () => {
      releaseFirstSave();
      await autosavePromise;
      await donePromise;
    });

    // The trailing keystrokes ("B") must be the last persisted content, and the
    // editor must have closed only after that succeeded.
    expect(update).toHaveBeenLastCalledWith('n1', expect.objectContaining({ raw_text: 'B' }));
    expect(latest.hook.editingNoteId).toBe(null);
  });

  test('a linked-deload Session # changed during an in-flight autosave is persisted on Done', async () => {
    const { DELOAD_NOTE_PREFIX } = require('../lib/LogScreenHelpers');
    const note = {
      id: 'd1',
      title: `${DELOAD_NOTE_PREFIX}2026-01-01`,
      raw_text: 'body',
      saved_at: '2026-01-01T12:00:00.000Z',
    };
    const histRecord = {
      id: 'h1', note_id: 'd1', deload_session_ordinal: 1, completed_at: '2026-01-01T12:00:00.000Z',
    };

    let releaseFirstSave;
    const firstSaveGate = new Promise((resolve) => { releaseFirstSave = resolve; });
    let calls = 0;
    const update = jest.fn().mockImplementation(async (id, patch) => {
      calls += 1;
      if (calls === 1) await firstSaveGate; // hold the body autosave in flight
      return { id, title: patch.title, raw_text: patch.raw_text, saved_at: patch.saved_at };
    });
    const updateDeload = jest.fn().mockResolvedValue(true);

    let latest = null;
    function Harness({ notes, deloadHistory }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'other',
        currentNote: { id: 'other' },
        deloadHistory,
        update,
        add: jest.fn(),
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload,
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { harnessRenderer = render.create(<Harness notes={[note]} deloadHistory={[histRecord]} />); });

    render.act(() => { latest.hook.handleOpenOtherNote(note); });
    // Edit the body so the autosave persists something, and start it in flight.
    render.act(() => { latest.hook.setEditingText('body2'); });
    let autosavePromise;
    render.act(() => { autosavePromise = latest.hook.handleSaveOtherNote({ autosave: true }); });

    // While the body autosave is in flight, change ONLY the Session # ordinal.
    render.act(() => { latest.hook.setDeloadEditOrdinal('2'); });

    let donePromise;
    render.act(() => { donePromise = latest.hook.handleDoneOther(); });

    await render.act(async () => {
      releaseFirstSave();
      await autosavePromise;
      await donePromise;
    });

    // The new ordinal must reach the linked deload history record, and the editor
    // must close only after that metadata save succeeded.
    expect(updateDeload).toHaveBeenCalledWith('h1', expect.objectContaining({ deload_session_ordinal: 2 }));
    expect(latest.hook.editingNoteId).toBe(null);
  });

  test('a failed flush save keeps the editor open with the latest text for retry', async () => {
    const note = { id: 'n2', title: 'R', raw_text: 'A0' };

    let releaseFirstSave;
    const firstSaveGate = new Promise((resolve) => { releaseFirstSave = resolve; });
    let calls = 0;
    const update = jest.fn().mockImplementation(async (id, patch) => {
      calls += 1;
      if (calls === 1) { await firstSaveGate; return { id, title: patch.title, raw_text: patch.raw_text }; }
      return null; // the flush save of the trailing edit fails
    });

    let latest = null;
    function Harness({ notes }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'other',
        currentNote: { id: 'other' },
        deloadHistory: [],
        update,
        add: jest.fn(),
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { harnessRenderer = render.create(<Harness notes={[note]} />); });
    render.act(() => { latest.hook.handleOpenOtherNote(note); });
    render.act(() => { latest.hook.setEditingText('A'); });
    let autosavePromise;
    render.act(() => { autosavePromise = latest.hook.handleSaveOtherNote({ autosave: true }); });
    render.act(() => { latest.hook.setEditingText('B'); });
    let donePromise;
    render.act(() => { donePromise = latest.hook.handleDoneOther(); });

    await render.act(async () => {
      releaseFirstSave();
      await autosavePromise;
      await donePromise;
    });

    // The flush attempted to persist "B" and it failed, so the editor stays open
    // with the note still in edit (latest text retained for retry).
    expect(update).toHaveBeenLastCalledWith('n2', expect.objectContaining({ raw_text: 'B' }));
    expect(latest.hook.editingNoteId).not.toBe(null);
  });

  // Feedback follow-up on #764 (finding 2, P2): deloadEditDate is seeded from
  // the note's existing saved_at when the editor opens, so a title-/text-only
  // edit that never touches the compact date row must NOT fall into the
  // date-handling save branch and re-stamp saved_at to noon — that would
  // desync the note's saved_at from its linked history record's completed_at.
  test('a text-only deload edit leaves saved_at untouched when the date row was never opened', async () => {
    const { DELOAD_NOTE_PREFIX } = require('../lib/LogScreenHelpers');
    const originalSavedAt = '2026-01-01T09:47:00.000Z';
    const note = {
      id: 'd2',
      title: `${DELOAD_NOTE_PREFIX}2026-01-01`,
      raw_text: 'body',
      saved_at: originalSavedAt,
    };
    const histRecord = {
      id: 'h2', note_id: 'd2', deload_session_ordinal: 1, completed_at: originalSavedAt,
    };

    const update = jest.fn().mockResolvedValue({ id: 'd2', title: note.title, raw_text: 'body edited', saved_at: originalSavedAt });
    const updateDeload = jest.fn().mockResolvedValue(true);

    let latest = null;
    function Harness({ notes, deloadHistory }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'other',
        currentNote: { id: 'other' },
        deloadHistory,
        update,
        add: jest.fn(),
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload,
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { harnessRenderer = render.create(<Harness notes={[note]} deloadHistory={[histRecord]} />); });

    render.act(() => { latest.hook.handleOpenOtherNote(note); });
    // Text-only edit; the compact "Date · <value>" row is never opened and
    // setDeloadEditDate is never called.
    render.act(() => { latest.hook.setEditingText('body edited'); });

    let savePromise;
    render.act(() => { savePromise = latest.hook.handleSaveOtherNote(); });
    await render.act(async () => { await savePromise; });

    expect(update).toHaveBeenCalled();
    const patch = update.mock.calls[0][1];
    expect(patch).not.toHaveProperty('saved_at');
    expect(updateDeload).not.toHaveBeenCalled();
  });

  // Second follow-up on #764 finding 2: `deloadEditDateTouched` gates entry
  // to the date-handling block, but the correctness property is a VALUE
  // change, not mere interaction. Opening the date control and then
  // restoring the original date before saving must still leave saved_at
  // (and the linked record) untouched — this is the case that got through
  // the first fix, where a stale `else` branch still wrote saved_at whenever
  // newDate === savedDate.
  test('opening the deload date row and restoring the original date leaves saved_at untouched', async () => {
    const { DELOAD_NOTE_PREFIX } = require('../lib/LogScreenHelpers');
    const originalSavedAt = '2026-01-01T09:47:00.000Z';
    const note = {
      id: 'd4',
      title: `${DELOAD_NOTE_PREFIX}2026-01-01`,
      raw_text: 'body',
      saved_at: originalSavedAt,
    };
    const histRecord = {
      id: 'h4', note_id: 'd4', deload_session_ordinal: 1, completed_at: originalSavedAt,
    };

    const update = jest.fn().mockResolvedValue({ id: 'd4', title: note.title, raw_text: 'body', saved_at: originalSavedAt });
    const updateDeload = jest.fn().mockResolvedValue(true);

    let latest = null;
    function Harness({ notes, deloadHistory }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'other',
        currentNote: { id: 'other' },
        deloadHistory,
        update,
        add: jest.fn(),
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload,
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { harnessRenderer = render.create(<Harness notes={[note]} deloadHistory={[histRecord]} />); });

    render.act(() => { latest.hook.handleOpenOtherNote(note); });
    // User opens the date control, picks a different date, then changes their
    // mind and restores the original date before saving.
    render.act(() => { latest.hook.setDeloadEditDate('2026-03-03'); });
    render.act(() => { latest.hook.setDeloadEditDate('2026-01-01'); });

    let savePromise;
    render.act(() => { savePromise = latest.hook.handleSaveOtherNote(); });
    await render.act(async () => { await savePromise; });

    expect(update).toHaveBeenCalled();
    const patch = update.mock.calls[0][1];
    expect(patch).not.toHaveProperty('saved_at');
    expect(updateDeload).not.toHaveBeenCalled();
  });

  // Companion case: once the user explicitly opens the row and picks a new
  // date, the existing linked-record save semantics still apply.
  test('an explicitly changed deload date still updates saved_at and the linked record', async () => {
    const { DELOAD_NOTE_PREFIX } = require('../lib/LogScreenHelpers');
    const originalSavedAt = '2026-01-01T12:00:00.000Z';
    const note = {
      id: 'd3',
      title: `${DELOAD_NOTE_PREFIX}2026-01-01`,
      raw_text: 'body',
      saved_at: originalSavedAt,
    };
    const histRecord = {
      id: 'h3', note_id: 'd3', deload_session_ordinal: 1, completed_at: originalSavedAt,
    };

    const update = jest.fn().mockResolvedValue({ id: 'd3', title: note.title, raw_text: 'body', saved_at: '2026-02-02T12:00:00.000Z' });
    const updateDeload = jest.fn().mockResolvedValue(true);

    let latest = null;
    function Harness({ notes, deloadHistory }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'other',
        currentNote: { id: 'other' },
        deloadHistory,
        update,
        add: jest.fn(),
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload,
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { harnessRenderer = render.create(<Harness notes={[note]} deloadHistory={[histRecord]} />); });

    render.act(() => { latest.hook.handleOpenOtherNote(note); });
    // Explicit user change via the exported (wrapped) setDeloadEditDate.
    render.act(() => { latest.hook.setDeloadEditDate('2026-02-02'); });

    let savePromise;
    render.act(() => { savePromise = latest.hook.handleSaveOtherNote(); });
    await render.act(async () => { await savePromise; });

    const patch = update.mock.calls[0][1];
    expect(patch.saved_at).toBe('2026-02-02T12:00:00.000Z');
    expect(updateDeload).toHaveBeenCalledWith('h3', expect.objectContaining({ completed_at: '2026-02-02T12:00:00.000Z' }));
  });
});

// ── Recovery close/revert choice vs in-flight autosave (#851) ──
describe('Recovery Cancel offers safe Done and confirmed persisted revert (#851)', () => {
  const { useLogOtherRoutineEditor } = require('../screens/log/useLogOtherRoutineEditor');

  let harnessRenderer;
  let alertSpy;
  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    if (harnessRenderer) {
      render.act(() => { harnessRenderer.unmount(); });
      harnessRenderer = null;
    }
    alertSpy.mockRestore();
  });

  const mountHarness = ({ notes, update }) => {
    let latest = null;
    function Harness({ notes: n }) {
      const hook = useLogOtherRoutineEditor({
        notes: n,
        currentId: 'other',
        currentNote: { id: 'other' },
        deloadHistory: [],
        update,
        add: jest.fn(),
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }
    render.act(() => { harnessRenderer = render.create(<Harness notes={notes} />); });
    return () => latest.hook;
  };

  test('Cancel waits for the in-flight autosave before issuing its revert write', async () => {
    const note = { id: 'weeknote', title: 'Recovery Week Note', raw_text: 'ORIGINAL' };
    let releaseAutosave;
    const autosaveGate = new Promise((resolve) => { releaseAutosave = resolve; });
    const update = jest.fn().mockImplementation(async (id, patch) => {
      if (update.mock.calls.length === 1) await autosaveGate;
      return { id, title: patch.title, raw_text: patch.raw_text };
    });
    const getHook = mountHarness({ notes: [note], update });

    // Seed the recovery viewer, then open the inline editor off it exactly as
    // LogRecoverySection's Edit action does.
    render.act(() => { getHook().setRecoveryViewingNoteId(note.id); });
    render.act(() => { getHook().handleEditRecoveryViewedNote(); });
    expect(getHook().editingNoteId).toBe(note.id);

    // Type, and let the debounced autosave start (simulated directly, as the
    // #528 tests above do — the real debounce timer is not under test here).
    render.act(() => { getHook().setEditingText('UNWANTED AUTOSAVED EDIT'); });
    let autosavePromise;
    render.act(() => { autosavePromise = getHook().handleSaveOtherNote({ autosave: true }); });
    expect(update).toHaveBeenCalledTimes(1);

    // Cancel itself only opens explicit choices; the destructive choice then
    // waits for the in-flight autosave before restoring the entry snapshot.
    render.act(() => { getHook().handleCancelRecoveryEdit(); });
    const buttons = alertSpy.mock.calls[0][2];
    expect(buttons.map(button => button.text)).toEqual(['Keep editing', 'Done', 'Revert this edit']);
    expect(buttons.find(button => button.text === 'Revert this edit').style).toBe('destructive');
    let revertPromise;
    render.act(() => { revertPromise = buttons.find(button => button.text === 'Revert this edit').onPress(); });
    expect(update).toHaveBeenCalledTimes(1);

    await render.act(async () => {
      releaseAutosave();
      await autosavePromise;
      await revertPromise;
    });

    // The revert write is issued only after the autosave settles, so it is
    // always the LAST word — the note ends up back at its original content,
    // never left on the unwanted autosaved text.
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith('weeknote', expect.objectContaining({ raw_text: 'ORIGINAL' }));
    expect(getHook().editingNoteId).toBe(null);
  });

  test('Done saves the latest recovery edit and closes without restoring the entry snapshot', async () => {
    const note = { id: 'weeknote', title: 'Recovery Week Note', raw_text: 'ORIGINAL' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ id, ...patch }));
    const getHook = mountHarness({ notes: [note], update });

    render.act(() => { getHook().setRecoveryViewingNoteId(note.id); });
    render.act(() => { getHook().handleEditRecoveryViewedNote(); });
    render.act(() => { getHook().setEditingText('KEPT EDIT'); });
    render.act(() => { getHook().handleCancelRecoveryEdit(); });

    const done = alertSpy.mock.calls[0][2].find(button => button.text === 'Done');
    await render.act(async () => { await done.onPress(); });

    expect(update).toHaveBeenLastCalledWith('weeknote', expect.objectContaining({ raw_text: 'KEPT EDIT' }));
    expect(getHook().editingNoteId).toBe(null);
  });

  test('a failed confirmed revert keeps the inline editor open', async () => {
    const note = { id: 'weeknote', title: 'Recovery Week Note', raw_text: 'ORIGINAL' };
    const update = jest.fn().mockRejectedValue(new Error('write failed'));
    const getHook = mountHarness({ notes: [note], update });

    render.act(() => { getHook().setRecoveryViewingNoteId(note.id); });
    render.act(() => { getHook().handleEditRecoveryViewedNote(); });
    render.act(() => { getHook().setEditingText('edited'); });

    render.act(() => { getHook().handleCancelRecoveryEdit(); });
    const revert = alertSpy.mock.calls[0][2].find(button => button.text === 'Revert this edit');
    await render.act(async () => { await revert.onPress(); });

    // The revert write failed, so Cancel must not have closed the session —
    // otherwise the edited-but-unreverted text would be stranded with no
    // visible way back to Save or retry Cancel.
    expect(getHook().editingNoteId).toBe(note.id);
    expect(alertSpy).toHaveBeenCalled();
  });
});

// ── Web edit path: explicit non-double-tap edit control (#314) ───────────────
// Web has no reliable double-tap idiom, so Log must expose an explicit tap-once
// edit affordance. LogScreen passes enterCurrentEditor (single-press editor
// entry) to the active routine card alongside the legacy double-tap body
// handler, so the explicit "Edit" button works on web without a double-tap.
describe('current-routine autosave close and revert ordering (#851)', () => {
  const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
  const original = { id: 'note1', title: 'Routine A', raw_text: 'ORIGINAL', activeWeek: null };

  let component;
  let latest;
  let alertSpy;

  const mountHarness = (update) => {
    function Harness() {
      const [text, setText] = React.useState(original.raw_text);
      const [title, setTitle] = React.useState(original.title);
      latest = useLogCurrentRoutineEditor({
        workoutNoteText: text,
        setWorkoutNoteText: setText,
        workoutNoteTitle: title,
        setWorkoutNoteTitle: setTitle,
        currentId: original.id,
        currentNote: original,
        notes: [original],
        trackedLifts: [],
        update,
        add: jest.fn(),
        selectCurrent: jest.fn(),
        fatigueTrackingEnabled: false,
        notesLoading: false,
        notesError: null,
        otherModalOwnsScreen: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      return null;
    }
    render.act(() => { component = render.create(<Harness />); });
  };

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    if (component) {
      render.act(() => { component.unmount(); });
      component = null;
    }
    alertSpy.mockRestore();
  });

  test('Done flushes text typed while an older autosave is in flight before closing', async () => {
    let releaseAutosave;
    const autosaveGate = new Promise(resolve => { releaseAutosave = resolve; });
    const update = jest.fn().mockImplementation(async (id, patch) => {
      if (update.mock.calls.length === 1) await autosaveGate;
      return { id, title: patch.title, raw_text: patch.raw_text };
    });
    mountHarness(update);

    render.act(() => { latest.enterCurrentEditor(); });
    render.act(() => { latest.handleCurrentTextChange('AUTOSAVED'); });
    let autosavePromise;
    render.act(() => { autosavePromise = latest.handleSave({ autosave: true }); });
    render.act(() => { latest.handleCurrentTextChange('LATEST'); });
    let donePromise;
    render.act(() => { donePromise = latest.handleDoneCurrent(); });

    await render.act(async () => {
      for (let i = 0; i < 10 && update.mock.calls.length === 0; i += 1) {
        await Promise.resolve();
      }
    });
    expect(update).toHaveBeenCalledTimes(1);
    await render.act(async () => {
      releaseAutosave();
      await autosavePromise;
      await donePromise;
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(
      original.id,
      expect.objectContaining({ raw_text: 'LATEST' })
    );
    expect(latest.mode).toBe('read');
  });

  test('confirmed revert waits for an in-flight autosave and restores the entry snapshot last', async () => {
    let releaseAutosave;
    const autosaveGate = new Promise(resolve => { releaseAutosave = resolve; });
    const update = jest.fn().mockImplementation(async (id, patch) => {
      if (update.mock.calls.length === 1) await autosaveGate;
      return { id, title: patch.title, raw_text: patch.raw_text };
    });
    mountHarness(update);

    render.act(() => { latest.enterCurrentEditor(); });
    render.act(() => { latest.handleCurrentTextChange('AUTOSAVED'); });
    let autosavePromise;
    render.act(() => { autosavePromise = latest.handleSave({ autosave: true }); });
    render.act(() => { latest.handleCurrentTextChange('LATEST UNSAVED'); });
    render.act(() => { latest.handleUndoCurrent(); });
    const revert = alertSpy.mock.calls[0][2].find(button => button.text === 'Revert this edit');
    let revertPromise;
    render.act(() => { revertPromise = revert.onPress(); });

    await render.act(async () => {
      for (let i = 0; i < 10 && update.mock.calls.length === 0; i += 1) {
        await Promise.resolve();
      }
    });
    expect(update).toHaveBeenCalledTimes(1);
    await render.act(async () => {
      releaseAutosave();
      await autosavePromise;
      await revertPromise;
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(
      original.id,
      expect.objectContaining({ title: original.title, raw_text: original.raw_text })
    );
    expect(latest.activeEditText).toBe(original.raw_text);
    expect(latest.mode).toBe('edit');
  });
});

// ── uneven positional-session guard (#855) ──────────────────────────────────

describe('Log Done guards uneven session histories (#855)', () => {
  const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
  const { useLogOtherRoutineEditor } = require('../screens/log/useLogOtherRoutineEditor');
  const ALIGNED = '-Bench\n- 135 5,5\n-Deadlift\n- 225 5';
  const UNEVEN = '-Bench\n- 135 5,5\n- 140 5,5\n-Deadlift\n- 225 5';
  const mounted = [];
  let alertSpy;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    render.act(() => { mounted.forEach(component => component.unmount()); });
    mounted.length = 0;
    alertSpy.mockRestore();
  });

  function mountCurrent({ raw = ALIGNED, activeWeek = null } = {}) {
    const note = { id: 'current', title: 'Routine', raw_text: raw, activeWeek };
    const update = jest.fn(async (id, patch) => ({ ...note, id, ...patch }));
    let latest = null;
    function Harness() {
      const [text, setText] = React.useState(raw);
      const [title, setTitle] = React.useState(note.title);
      latest = useLogCurrentRoutineEditor({
        workoutNoteText: text,
        setWorkoutNoteText: setText,
        workoutNoteTitle: title,
        setWorkoutNoteTitle: setTitle,
        currentId: note.id,
        currentNote: note,
        notes: [note],
        trackedLifts: [],
        update,
        add: jest.fn(),
        selectCurrent: jest.fn(),
        fatigueTrackingEnabled: false,
        notesLoading: false,
        notesError: null,
        otherModalOwnsScreen: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      return null;
    }
    render.act(() => { mounted.push(render.create(<Harness />)); });
    return { getHook: () => latest, update };
  }

  function mountOther(note) {
    const update = jest.fn(async (id, patch) => ({ ...note, id, ...patch }));
    let latest = null;
    function Harness() {
      latest = useLogOtherRoutineEditor({
        notes: [note],
        currentId: 'current',
        currentNote: { id: 'current', raw_text: ALIGNED },
        deloadHistory: [],
        update,
        add: jest.fn(),
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      return null;
    }
    render.act(() => { mounted.push(render.create(<Harness />)); });
    return { getHook: () => latest, update };
  }

  test('current Done identifies affected exercises but never blocks on them (#863)', async () => {
    const { getHook, update } = mountCurrent();
    render.act(() => { getHook().enterCurrentEditor(); });
    render.act(() => { getHook().handleCurrentTextChange(UNEVEN); });

    expect(getHook().sessionAlignmentIssue.message).toMatch(/Bench — 2 entries/);
    expect(getHook().sessionAlignmentIssue.message).toMatch(/Deadlift — 1 entry/);

    await render.act(async () => { await getHook().handleDoneCurrent(); });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith(
      'current',
      expect.objectContaining({ raw_text: UNEVEN })
    );
    expect(getHook().mode).toBe('read');
  });

  test('A/B detection follows only the active editor half', async () => {
    const weekAUneven = UNEVEN;
    const weekBAligned = '-OHP\n- 95 5\n-Row\n- 115 8';
    const { getHook } = mountCurrent({
      raw: `${weekAUneven}\n---\n${weekBAligned}`,
      activeWeek: 'B',
    });

    expect(getHook().effectiveActiveWeek).toBe('B');
    expect(getHook().sessionAlignmentIssue).toBeNull();

    await render.act(async () => { await getHook().handleToggleWeek(); });
    expect(getHook().effectiveActiveWeek).toBe('A');
    expect(getHook().sessionAlignmentIssue.message).toMatch(/Deadlift/);
  });

  test('ordinary multi-day progress neither shows the warning nor blocks Done', async () => {
    const raw = 'Monday\n+Lifting\n-Bench\n- 125 5\n- 130 5\nWednesday\n+Lifting\n-Squat\n- 225 5';
    const { getHook } = mountCurrent({ raw });
    render.act(() => { getHook().enterCurrentEditor(); });

    expect(getHook().sessionAlignmentIssue).toBeNull();
    await render.act(async () => { await getHook().handleDoneCurrent(); });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(getHook().mode).toBe('read');
  });

  test('Recovery note Save identifies affected exercises but never blocks on them (#863)', async () => {
    const note = { id: 'recovery', title: 'Recovery Week 1', raw_text: ALIGNED };
    const { getHook, update } = mountOther(note);
    render.act(() => { getHook().setRecoveryViewingNoteId(note.id); });
    render.act(() => { getHook().handleEditRecoveryViewedNote(); });
    render.act(() => { getHook().setEditingText(UNEVEN); });

    await render.act(async () => { await getHook().handleDoneOther(); });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith(
      note.id,
      expect.objectContaining({ raw_text: UNEVEN })
    );
    expect(getHook().editingNoteId).toBeNull();
  });
});

describe('Log web edit path: explicit edit control is wired (#314)', () => {
  let src;
  beforeAll(() => {
    src = readLogScreenSource();
  });

  test('enterCurrentEditor performs a single-press editor entry (no double-tap gate)', () => {
    // The explicit handler must set edit mode directly, unlike handleNoteBodyPress
    // which is gated behind a 300ms double-tap window.
    expect(src).toMatch(/const\s+enterCurrentEditor\s*=\s*\(\)\s*=>\s*\{[\s\S]*?setMode\('edit'\)/);
  });

  test('LogScreen forwards enterCurrentEditor to the active routine card', () => {
    expect(src).toMatch(/enterCurrentEditor=\{(?:currentEditor\.)?enterCurrentEditor\}/);
  });

  test('active routine card renders an explicit Edit control bound to enterCurrentEditor', () => {
    // LogActiveRoutineCard exposes a single-press "Edit" button (web-usable path)
    // separate from the double-tap body handler.
    expect(src).toMatch(/enterCurrentEditor\(\)/);
    expect(src).toMatch(/>Edit</);
  });
});

// ── Web deload-date fallback: web-compatible date editing path (#314) ─────────
// The native @react-native-community/datetimepicker has no usable web rendering,
// so the Log deload-date editor must render a real DOM <input type="date"> on
// web while keeping the native Android Pressable + DateTimePicker modal path.
describe('Log deload date web fallback renders a DOM date input (#314)', () => {
  const fsLocal = require('fs');
  const pathLocal = require('path');
  let editorSrc;
  beforeAll(() => {
    editorSrc = fsLocal.readFileSync(
      pathLocal.join(__dirname, '../components/LogScreenEditorCard.js'),
      'utf8'
    );
  });

  test('branches the deload date control on Platform.OS === "web"', () => {
    // The web/native branch renders only once the linked-record safety
    // boundary (editingDeloadHasLinkedRecord) has already gated the reveal
    // (#764: the compact "Date · <value>" row).
    expect(editorSrc).toMatch(/editingDeloadHasLinkedRecord\s*&&\s*dateFieldOpen[\s\S]{0,400}Platform\.OS\s*===\s*'web'/);
  });

  test('web path renders a real <input type="date"> via WebDateInput', () => {
    expect(editorSrc).toMatch(/function\s+WebDateInput/);
    expect(editorSrc).toMatch(/createElement\(\s*'input'/);
    expect(editorSrc).toMatch(/type:\s*'date'/);
  });

  test('web date input is capped at today via max', () => {
    expect(editorSrc).toMatch(/max:\s*localDateToday\(\)/);
  });

  test('web date input writes the new date back through the existing setters', () => {
    expect(editorSrc).toMatch(/onChangeDate=\{\(newDateStr\)\s*=>\s*\{[\s\S]*?setDeloadEditDate\(newDateStr\)/);
    expect(editorSrc).toMatch(/setEditingTitle\(DELOAD_NOTE_PREFIX\s*\+\s*newDateStr\)/);
  });

  test('native Android path keeps the Pressable + DateTimePicker modal', () => {
    expect(editorSrc).toMatch(/onPress=\{\(\)\s*=>\s*setShowDeloadDatePicker\(true\)/);
    expect(editorSrc).toMatch(/<DateTimePicker[\s\S]*?onChange\s*=\s*\{/);
  });
});

// ── Undo escape hatch: source-level assertions ─────────────────────
describe('explicit editor rollback: source-level assertions (#851)', () => {
  let src;
  beforeAll(() => {
    src = readLogScreenSource();
  });

  test('declares originalNoteState hooks', () => {
    expect(src).toMatch(/const\s*\[originalNoteState,\s*setOriginalNoteState\]\s*=\s*useState/);
  });

  test('defines undo handlers for current, other, and deload templates', () => {
    expect(src).toMatch(/const\s+handleUndoCurrent\s*=\s*/);
    expect(src).toMatch(/const\s+handleUndoOther\s*=\s*/);
    expect(src).toMatch(/const\s+handleUndoDeload\s*=\s*/);
  });

  test('rollback is removed from the crowded header and rendered with explicit body copy', () => {
    expect(src).not.toMatch(/accessibilityLabel="Undo"/);
    expect(src).toMatch(/title=\{\(editingNoteId === 'new'[\s\S]{0,180}'Revert this edit'\}/);
    expect(src).toMatch(/handleRevertEdit=\{[\s\S]{0,220}handleUndoCurrent/);
  });

  test('handleAndroidBack invokes done handlers for swipe-to-save behavior', () => {
    expect(src).toMatch(/handleDoneDeload\(\)/);
    expect(src).toMatch(/handleDoneOther\(\)/);
    expect(src).toMatch(/handleDoneCurrent\(\)/);
  });
});

// ── Undo escape hatch: integration tests ───────────────────────────

const findPressableByText = (root, text) => {
  const matches = root.findAll(n => {
    if (n.type !== 'Text') return false;
    const children = n.props.children;
    const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
    return flat.includes(text);
  });
  for (const match of matches) {
    let node = match.parent;
    while (node) {
      if (node.props && typeof node.props.onPress === 'function') return node;
      node = node.parent;
    }
  }
  return null;
};

// Routine management is collapsed by default (#724): the routine cards, `+ New
// routine`, and the relocated `Start recovery block` control render only once
// the "More Routines" disclosure is expanded. Tests that drive those controls
// open it first via the whole-header press target.
const expandRoutineManagement = (root) => {
  const header = root.findAll(
    n => n.props
      && (n.props.accessibilityLabel === 'Show routines'
        || n.props.accessibilityLabel === 'Hide routines')
      && typeof n.props.onPress === 'function'
  )[0];
  if (!header) return;
  if (header.props.accessibilityState && header.props.accessibilityState.expanded) return;
  render.act(() => { header.props.onPress(); });
};

// The active Recovery card's rarer controls are collapsed by default (#789):
// `Unlink Week {N}`, `Complete recovery block`, and the analytics-inclusion
// switch render only once the "Manage recovery block" disclosure is expanded.
// Tests that drive those controls open it first. The trigger is never disabled,
// so this works in locked states too — which is the point of the disclosure.
const expandManageRecovery = (root) => {
  const trigger = root.findAll(
    n => n.props
      && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Manage recovery block')
      && typeof n.props.onPress === 'function'
  )[0];
  if (!trigger) return null;
  if (!(trigger.props.accessibilityState && trigger.props.accessibilityState.expanded)) {
    render.act(() => { trigger.props.onPress(); });
  }
  return trigger;
};

// Like findPressableByText, but walks up to the nearest accessibilityRole=button
// node instead of the nearest onPress. A disabled shared Button nulls its
// onPress, so findPressableByText would skip past it; this still finds it and
// exposes its accessibilityState for disabled-state assertions.
const buttonByText = (root, text) => {
  const match = root.findAll(n => {
    if (n.type !== 'Text') return false;
    const children = n.props.children;
    const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
    return flat.includes(text);
  })[0];
  if (!match) return null;
  let node = match.parent;
  while (node) {
    if (node.props && node.props.accessibilityRole === 'button') return node;
    node = node.parent;
  }
  return null;
};

// More Routines' disclosure state lives in LogScreen now (#775), so a
// standalone render of the list has to supply it. This harness stands in for
// that owner in the component-level tests below; the screen-level tests drive
// the real one.
function ControlledPreviousRoutines(props) {
  const [expanded, setExpanded] = React.useState(!!props.expanded);
  return (
    <LogPreviousRoutines
      {...props}
      expanded={expanded}
      onToggleExpanded={() => setExpanded(e => !e)}
    />
  );
}

function ControlledLogScreen(props) {
  const [text, setText] = React.useState(props.initialText || 'Monday\n+Lifting\n-Bench\n135 5,5,5');
  const [title, setTitle] = React.useState(props.initialTitle || 'Routine A');
  return (
    <LogScreen
      workoutNoteText={props.workoutNoteText !== undefined ? props.workoutNoteText : text}
      setWorkoutNoteText={props.setWorkoutNoteText || setText}
      workoutNoteTitle={props.workoutNoteTitle !== undefined ? props.workoutNoteTitle : title}
      setWorkoutNoteTitle={props.setWorkoutNoteTitle || setTitle}
      isCollapsed={false}
      toggleCollapsed={jest.fn()}
      onSaveWorkout={jest.fn()}
      onCheckInPrompt={jest.fn()}
      {...props}
    />
  );
}

describe('active deload deletion (#560)', () => {
  let alertSpy;
  let clearDeloadNote;
  let setActiveDeload;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    clearDeloadNote = jest.fn(() => setActiveDeload(null));

    const currentNote = {
      id: 'note1',
      title: 'Routine A',
      raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote],
      currentId: 'note1',
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn(),
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockImplementation(() => {
      const [note, setNote] = React.useState({
        raw_text: 'deload note text',
        saved_at: '2026-06-01T12:00:00.000Z',
      });
      setActiveDeload = setNote;
      return { note, loading: false, save: jest.fn(), clear: clearDeloadNote };
    });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: true });
  });

  afterEach(() => alertSpy.mockRestore());

  const openDeloadTab = (root) => {
    render.act(() => { findPressableByText(root, 'Deload').props.onPress(); });
  };

  test('cancel leaves the active deload unchanged', () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    openDeloadTab(root);

    render.act(() => { findPressableByText(root, 'Delete active deload').props.onPress(); });
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete active deload?',
      'This will remove the active deload and cannot be undone.',
      expect.any(Array),
    );
    const cancel = alertSpy.mock.calls[0][2].find(button => button.text === 'Cancel');
    expect(cancel.onPress).toBeUndefined();
    expect(clearDeloadNote).not.toHaveBeenCalled();
    expect(findPressableByText(root, 'Delete active deload')).toBeTruthy();
  });

  test('confirm clears the active deload and returns to Generate deload', async () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    openDeloadTab(root);
    render.act(() => { findPressableByText(root, 'Delete active deload').props.onPress(); });

    const remove = alertSpy.mock.calls[0][2].find(button => button.text === 'Delete');
    await render.act(async () => { await remove.onPress(); });

    expect(clearDeloadNote).toHaveBeenCalledTimes(1);
    expect(findPressableByText(root, 'Generate deload')).toBeTruthy();
    expect(findPressableByText(root, 'Delete active deload')).toBeNull();
  });

  test('delete is unavailable while editing the active deload', () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    openDeloadTab(root);
    render.act(() => { findPressableByText(root, 'Edit').props.onPress({ stopPropagation: jest.fn() }); });

    expect(findPressableByText(root, 'Delete active deload')).toBeNull();
  });
});

describe('explicit editor rollback: integration tests (#851)', () => {
  let mockUpdateNote;
  let mockUpdateDeload;
  let mockSelectCurrent;
  let currentNotesList;
  let rollbackAlertSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    rollbackAlertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    currentNotesList = [
      { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' }
    ];

    mockUpdateNote = jest.fn().mockImplementation(async (id, patch) => {
      currentNotesList = currentNotesList.map(n =>
        n.id === id ? { ...n, ...patch } : n
      );
    });

    mockSelectCurrent = jest.fn();
    mockUpdateDeload = jest.fn();

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: currentNotesList,
      currentId: 'note1',
      currentNote: currentNotesList[0],
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: mockSelectCurrent,
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });

    useEntries.useTrackedLifts.mockReturnValue({
      trackedLifts: [],
      toggle: jest.fn(),
    });

    useEntries.useDeloadNote.mockReturnValue({
      note: { raw_text: 'deload note text' },
      loading: false,
      save: jest.fn(),
      clear: jest.fn(),
    });

    useEntries.useDeloadHistory.mockReturnValue({
      history: [],
      completeDeload: jest.fn(),
      deleteDeload: jest.fn(),
      deleteDeloadNote: jest.fn(),
      updateDeload: mockUpdateDeload,
    });

    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: false,
      deloadModeEnabled: false,
    });

    useEntries.useUserProfile.mockReturnValue({
      profile: { sex: 'male', height_cm: 180, activity_level: 'active' },
      save: jest.fn(),
      loading: false,
      clear: jest.fn(),
    });
  });

  afterEach(() => {
    rollbackAlertSpy.mockRestore();
    jest.useRealTimers();
  });

  const confirmRevert = async () => {
    const prompt = rollbackAlertSpy.mock.calls.find(call => call[0] === 'Revert this edit?');
    expect(prompt).toBeTruthy();
    const revert = prompt[2].find(button => button.text === 'Revert this edit');
    expect(revert).toEqual(expect.objectContaining({ style: 'destructive' }));
    await revert.onPress();
  };

  test('App Guide (HelpScreen) in MoreScreen renders the correct example syntax', () => {
    let component;
    render.act(() => {
      component = render.create(
        <MoreScreen
          onNavigate={jest.fn()}
          onExport={jest.fn()}
          onImport={jest.fn()}
          fatigueMultiplier={1}
          onUpdateFatigueMultiplier={jest.fn()}
         
          onUpdateWeightDateEditEnabled={jest.fn()}
          onUpdateDeloadDateEditEnabled={jest.fn()}
        />
      );
    });

    const root = component.root;

    // Navigate to App Guide (HelpScreen)
    const guideItem = findPressableByText(root, 'App Guide');
    expect(guideItem).toBeTruthy();
    render.act(() => {
      guideItem.props.onPress();
    });

    // Now HelpScreen should be active. Verify it displays the example text.
    const allTexts = root.findAllByType('Text');
    const flatTexts = allTexts.map(t => {
      const child = t.props.children;
      return Array.isArray(child) ? child.join('') : String(child ?? '');
    });

    // Assert that the displayed guide copy includes '-Bench' and '135 5,5,5'
    const hasBench = flatTexts.some(txt => txt.includes('-Bench'));
    const hasSets = flatTexts.some(txt => txt.includes('135 5,5,5'));

    expect(hasBench).toBe(true);
    expect(hasSets).toBe(true);
  });

  test('LogScreen TextInput placeholder contains the guide syntax (-Bench and 135 5,5,5)', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen />
      );
    });
    const textInputs = component.root.findAll(n => n.type === 'TextInput');
    const editorInput = textInputs.find(ti => ti.props.placeholder && ti.props.placeholder.includes('-Bench'));
    expect(editorInput).toBeTruthy();
    expect(editorInput.props.placeholder).toContain('-Bench');
    expect(editorInput.props.placeholder).toContain('135 5,5,5');
  });

  test('editing current note requires confirmation before reverting UI and DB', async () => {
    const setWorkoutNoteText = jest.fn();
    const setWorkoutNoteTitle = jest.fn();

    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen
          workoutNoteText="Original Text"
          setWorkoutNoteText={setWorkoutNoteText}
          workoutNoteTitle="Original Title"
          setWorkoutNoteTitle={setWorkoutNoteTitle}
        />
      );
    });

    const root = component.root;

    // Find edit button pressable
    const editButton = findPressableByText(root, 'Edit');
    expect(editButton).toBeTruthy();
    render.act(() => {
      editButton.props.onPress({ stopPropagation: jest.fn() });
    });

    const revertButton = findPressableByText(root, 'Revert this edit');
    expect(revertButton).toBeTruthy();

    await render.act(async () => {
      revertButton.props.onPress();
      expect(mockUpdateNote).not.toHaveBeenCalled();
      await confirmRevert();
    });

    expect(mockUpdateNote).toHaveBeenCalledWith('note1', {
      title: 'Original Title',
      raw_text: 'Original Text',
      activeWeek: null,
    });

    expect(setWorkoutNoteText).toHaveBeenCalledWith('Original Text');
    expect(setWorkoutNoteTitle).toHaveBeenCalledWith('Original Title');
  });

  test('editing other note requires confirmation before reverting UI and DB', async () => {
    const otherNote = { id: 'note2', title: 'Routine B', raw_text: 'Original Other Text', saved_at: '2026-06-02T12:00:00.000Z' };

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [
        { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
        otherNote
      ],
      currentId: 'note1',
      currentNote: { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: mockSelectCurrent,
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen />);
    });

    const root = component.root;
    expandRoutineManagement(root);

    // Tap the other note to view it
    const targetPressable = findPressableByText(root, 'Routine B');
    expect(targetPressable).toBeTruthy();
    render.act(() => {
      targetPressable.props.onPress();
    });

    // Tap "Edit routine" button
    const editBtn = findPressableByText(root, 'Edit routine');
    expect(editBtn).toBeTruthy();
    render.act(() => {
      editBtn.props.onPress();
    });

    // Now in edit mode for other note. Verify text input value.
    const textInputs = root.findAllByType('TextInput');
    const textInput = textInputs.find(ti => ti.props.multiline);
    expect(textInput.props.value).toBe('Original Other Text');

    // Simulate typing
    render.act(() => {
      textInput.props.onChangeText('Changed Other Text');
    });

    const revertButton = findPressableByText(root, 'Revert this edit');
    expect(revertButton).toBeTruthy();
    await render.act(async () => {
      revertButton.props.onPress();
      expect(mockUpdateNote).not.toHaveBeenCalled();
      await confirmRevert();
    });

    expect(mockUpdateNote).toHaveBeenCalledWith('note2', {
      title: 'Routine B',
      raw_text: 'Original Other Text',
      activeWeek: null,
    });

    expect(textInput.props.value).toBe('Original Other Text');
  });

  test('a failed confirmed current-note revert leaves UI state intact and alerts', async () => {
    const setWorkoutNoteText = jest.fn();
    const setWorkoutNoteTitle = jest.fn();
    
    mockUpdateNote.mockRejectedValueOnce(new Error('DB error'));

    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen
          workoutNoteText="Original Text"
          setWorkoutNoteText={setWorkoutNoteText}
          workoutNoteTitle="Original Title"
          setWorkoutNoteTitle={setWorkoutNoteTitle}
        />
      );
    });

    const root = component.root;

    // Find edit button pressable
    const editButton = findPressableByText(root, 'Edit');
    expect(editButton).toBeTruthy();
    render.act(() => {
      editButton.props.onPress({ stopPropagation: jest.fn() });
    });

    const revertButton = findPressableByText(root, 'Revert this edit');
    expect(revertButton).toBeTruthy();

    await render.act(async () => {
      revertButton.props.onPress();
      await confirmRevert();
    });

    expect(setWorkoutNoteText).not.toHaveBeenCalled();
    expect(setWorkoutNoteTitle).not.toHaveBeenCalled();
  });

  test('confirmed other-deload revert compensates history if note update fails', async () => {
    const deloadNoteId = 'note3';
    const deloadNote = {
      id: deloadNoteId,
      title: 'Deload · 2026-06-01',
      raw_text: 'Original Deload Text',
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    const histRecord = {
      id: 'hist3',
      note_id: deloadNoteId,
      completed_at: '2026-06-01T12:00:00.000Z',
      deload_session_ordinal: 5,
    };

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [
        { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
        deloadNote
      ],
      currentId: 'note1',
      currentNote: { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
      deloadNotes: [deloadNote],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: mockSelectCurrent,
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });

    useEntries.useDeloadHistory.mockReturnValue({
      history: [histRecord],
      completeDeload: jest.fn(),
      deleteDeload: jest.fn(),
      deleteDeloadNote: jest.fn(),
      updateDeload: mockUpdateDeload,
    });

    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: false,
      deloadModeEnabled: true,
    });

    // Force note update to fail, but let history update succeed
    mockUpdateNote.mockRejectedValueOnce(new Error('Note update failed'));
    mockUpdateDeload.mockResolvedValue(true);

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen />);
    });

    const root = component.root;

    // Switch to Deload tab
    const deloadTabToggle = findPressableByText(root, 'Deload');
    expect(deloadTabToggle).toBeTruthy();
    render.act(() => {
      deloadTabToggle.props.onPress();
    });

    // Find and tap the deload note card in the list
    const deloadNoteCard = findPressableByText(root, 'Deload · 2026-06-01');
    expect(deloadNoteCard).toBeTruthy();
    render.act(() => {
      deloadNoteCard.props.onPress();
    });

    // Tap "Edit deload record" button
    const editBtn = findPressableByText(root, 'Edit deload record');
    expect(editBtn).toBeTruthy();
    render.act(() => {
      editBtn.props.onPress();
    });

    // Reveal the compact "Date · <value>" secondary row (#764) so the Session #
    // field (shown alongside the date once revealed) is on screen.
    const dateToggle = findPressableByText(root, 'Date ·');
    expect(dateToggle).toBeTruthy();
    render.act(() => {
      dateToggle.props.onPress();
    });

    // Find the session number input and change its value to 10
    const textInputs = root.findAllByType('TextInput');
    const ordinalInput = textInputs.find(ti => ti.props.placeholder === 'Session number');
    expect(ordinalInput).toBeTruthy();
    render.act(() => {
      ordinalInput.props.onChangeText('10');
    });

    const revertButton = findPressableByText(root, 'Revert this edit');
    expect(revertButton).toBeTruthy();
    await render.act(async () => {
      revertButton.props.onPress();
      await confirmRevert();
    });

    expect(mockUpdateDeload).toHaveBeenLastCalledWith('hist3', {
      completed_at: '2026-06-01T12:00:00.000Z',
      deload_session_ordinal: 10,
    });
  });

  test('confirmed other-deload revert compensates a cleared ordinal with null if note update fails', async () => {
    const deloadNoteId = 'note4';
    const deloadNote = {
      id: deloadNoteId,
      title: 'Deload · 2026-06-01',
      raw_text: 'Original Deload Text',
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    const histRecord = {
      id: 'hist4',
      note_id: deloadNoteId,
      completed_at: '2026-06-01T12:00:00.000Z',
      deload_session_ordinal: 5,
    };

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [
        { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
        deloadNote
      ],
      currentId: 'note1',
      currentNote: { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
      deloadNotes: [deloadNote],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: mockSelectCurrent,
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });

    useEntries.useDeloadHistory.mockReturnValue({
      history: [histRecord],
      completeDeload: jest.fn(),
      deleteDeload: jest.fn(),
      deleteDeloadNote: jest.fn(),
      updateDeload: mockUpdateDeload,
    });

    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: false,
      deloadModeEnabled: true,
    });

    mockUpdateNote.mockRejectedValueOnce(new Error('Note update failed'));
    mockUpdateDeload.mockResolvedValue(true);

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen />);
    });

    const root = component.root;

    // Switch to Deload tab
    const deloadTabToggle = findPressableByText(root, 'Deload');
    expect(deloadTabToggle).toBeTruthy();
    render.act(() => {
      deloadTabToggle.props.onPress();
    });

    // Find and tap the deload note card
    const deloadNoteCard = findPressableByText(root, 'Deload · 2026-06-01');
    expect(deloadNoteCard).toBeTruthy();
    render.act(() => {
      deloadNoteCard.props.onPress();
    });

    // Tap "Edit deload record"
    const editBtn = findPressableByText(root, 'Edit deload record');
    expect(editBtn).toBeTruthy();
    render.act(() => {
      editBtn.props.onPress();
    });

    // Reveal the compact "Date · <value>" secondary row (#764) so the Session #
    // field (shown alongside the date once revealed) is on screen.
    const dateToggle = findPressableByText(root, 'Date ·');
    expect(dateToggle).toBeTruthy();
    render.act(() => {
      dateToggle.props.onPress();
    });

    // Find session number input and clear it
    const textInputs = root.findAllByType('TextInput');
    const ordinalInput = textInputs.find(ti => ti.props.placeholder === 'Session number');
    expect(ordinalInput).toBeTruthy();
    render.act(() => {
      ordinalInput.props.onChangeText('');
    });

    const revertButton = findPressableByText(root, 'Revert this edit');
    expect(revertButton).toBeTruthy();
    await render.act(async () => {
      revertButton.props.onPress();
      await confirmRevert();
    });

    // Check that updateDeload compensating rollback was called with deload_session_ordinal: null
    expect(mockUpdateDeload).toHaveBeenLastCalledWith('hist4', {
      completed_at: '2026-06-01T12:00:00.000Z',
      deload_session_ordinal: null,
    });
  });
});


// ── Routine switch: progress rollover (#295) ──────────────────────────────────

import { findMatchingExerciseNames, rolloverOneKExercises, DEFAULT_1K_EXERCISES } from '../lib/data';
import { Alert, Platform } from 'react-native';
import { WebAlertHost } from '../components/WebAlertHost';

describe('routine switch: rollover helper behavior (#295)', () => {
  const OLD_RAW = 'MONDAY — Push\n-DB Bench Press 3x8\n-Squat 3x6\n';
  const NEW_RAW = 'MONDAY — Push\n-DB Bench Press 4x6\n-Deadlift 3x4\n';

  test('findMatchingExerciseNames returns exercises present in both notes', () => {
    const oldSections = parseWorkoutNote(OLD_RAW).sections;
    const newSections = parseWorkoutNote(NEW_RAW).sections;
    const matched = findMatchingExerciseNames(oldSections, newSections);
    expect(matched).toContain('DB Bench Press');
    expect(matched).not.toContain('Squat');
    expect(matched).not.toContain('Deadlift');
  });

  test('findMatchingExerciseNames returns empty array when no overlap', () => {
    const oldSections = parseWorkoutNote('MONDAY\n-Squat 3x5\n').sections;
    const newSections = parseWorkoutNote('MONDAY\n-Deadlift 3x5\n').sections;
    expect(findMatchingExerciseNames(oldSections, newSections)).toHaveLength(0);
  });

  test('rolloverOneKExercises carries matched 1K slots and resets unmatched', () => {
    const oldOneK = { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' };
    const matchedKeys = new Set(['db bench press']);
    const result = rolloverOneKExercises(oldOneK, matchedKeys);
    expect(result.bench).toBe('DB Bench Press');
    expect(result.squat).toBeUndefined();
    expect(result.deadlift).toBeUndefined();
  });

  test('rolloverOneKExercises returns null when no matched slots survive', () => {
    const oldOneK = { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' };
    const matchedKeys = new Set(['cable fly']);
    expect(rolloverOneKExercises(oldOneK, matchedKeys)).toBeNull();
  });
});

describe('routine switch: screen-level rollover prompt (#295)', () => {
  let alertSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const sharedRaw = 'MONDAY — Push\n-DB Bench Press 3x8\n';
    const note1 = { id: 'note1', title: 'Gym Routine', raw_text: sharedRaw, saved_at: '2026-06-01T12:00:00.000Z' };
    const note2 = { id: 'note2', title: 'Home Routine', raw_text: sharedRaw, saved_at: '2026-06-02T12:00:00.000Z' };

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [note1, note2],
      currentId: 'note1',
      currentNote: note1,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({ history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn() });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue({ profile: null, save: jest.fn(), loading: false, clear: jest.fn() });
  });

  afterEach(() => {
    jest.useRealTimers();
    alertSpy.mockRestore();
  });

  test('switching to a note with matching exercises shows the rollover prompt', async () => {
    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen workoutNoteText="MONDAY — Push\n-DB Bench Press 3x8\n" />);
    });

    const root = component.root;
    expandRoutineManagement(root);
    const homeRoutineCard = findPressableByText(root, 'Home Routine');
    expect(homeRoutineCard).toBeTruthy();
    render.act(() => { homeRoutineCard.props.onPress(); });

    const switchBtn = findPressableByText(root, 'Set as current routine');
    expect(switchBtn).toBeTruthy();
    render.act(() => { switchBtn.props.onPress({ stopPropagation: () => {} }); });

    // First alert: "Set as current routine" confirmation
    expect(alertSpy).toHaveBeenCalledWith(
      'Set as current routine',
      expect.any(String),
      expect.any(Array)
    );

    // Simulate pressing the confirm button ("Set as current routine") in the first alert
    const firstAlertButtons = alertSpy.mock.calls[0][2];
    const confirmBtn = firstAlertButtons.find(b => b.text === 'Set as current routine');
    expect(confirmBtn).toBeTruthy();
    await render.act(async () => {
      confirmBtn.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Second alert: rollover prompt because notes share exercises
    expect(alertSpy).toHaveBeenCalledWith(
      'Keep current progress?',
      expect.any(String),
      expect.any(Array)
    );

    await render.act(async () => {
      component.unmount();
    });
  });

  test('switching to a note with no matching exercises skips the rollover prompt', async () => {
    const disjointNote = { id: 'note3', title: 'Cardio Routine', raw_text: 'MONDAY\n-Treadmill 30 min\n', saved_at: '2026-06-03T12:00:00.000Z' };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [
        { id: 'note1', title: 'Gym Routine', raw_text: 'MONDAY\n-DB Bench Press 3x8\n', saved_at: '2026-06-01T12:00:00.000Z' },
        disjointNote,
      ],
      currentId: 'note1',
      currentNote: { id: 'note1', title: 'Gym Routine', raw_text: 'MONDAY\n-DB Bench Press 3x8\n', saved_at: '2026-06-01T12:00:00.000Z' },
      deloadNotes: [], loading: false, error: null, refresh: jest.fn(),
      selectCurrent: jest.fn(), update: jest.fn().mockResolvedValue({}), add: jest.fn(), remove: jest.fn(),
    });

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen workoutNoteText="MONDAY\n-DB Bench Press 3x8\n" />);
    });

    const root = component.root;
    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, 'Cardio Routine').props.onPress(); });
    render.act(() => { findPressableByText(root, 'Set as current routine').props.onPress({ stopPropagation: () => {} }); });

    // First alert: confirmation only
    const firstAlertButtons = alertSpy.mock.calls[0][2];
    const confirmBtn = firstAlertButtons.find(b => b.text === 'Set as current routine');
    await render.act(async () => {
      confirmBtn.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Rollover alert must NOT appear
    const rolloverCall = alertSpy.mock.calls.find(c => c[0] === 'Keep current progress?');
    expect(rolloverCall).toBeUndefined();

    await render.act(async () => {
      component.unmount();
    });
  });

  // #737: switching the current routine re-bases every aggregate on this
  // screen, on Home, and in Analytics, so it is a destructive action in the
  // sense that matters — it silently changes what the user's numbers mean.
  // The press itself must therefore reach no storage function at all, and a
  // cancelled confirmation must leave the switch un-run.
  test('Set as current routine writes nothing until the confirmation is accepted', async () => {
    const selectCurrent = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue({});
    const currentNote = { id: 'note1', title: 'Gym Routine', raw_text: 'MONDAY\n-DB Bench Press 3x8\n', saved_at: '2026-06-01T12:00:00.000Z' };
    const otherNote = { id: 'note3', title: 'Cardio Routine', raw_text: 'MONDAY\n-Treadmill 30 min\n', saved_at: '2026-06-03T12:00:00.000Z' };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote, otherNote],
      currentId: 'note1',
      currentNote,
      deloadNotes: [], loading: false, error: null, refresh: jest.fn(),
      selectCurrent, update, add: jest.fn(), remove: jest.fn(),
    });

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen workoutNoteText="MONDAY\n-DB Bench Press 3x8\n" />);
    });

    const root = component.root;
    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, 'Cardio Routine').props.onPress(); });
    render.act(() => { findPressableByText(root, 'Set as current routine').props.onPress({ stopPropagation: () => {} }); });

    // The press raises a confirmation and nothing else.
    expect(alertSpy).toHaveBeenCalledWith('Set as current routine', expect.any(String), expect.any(Array));
    expect(selectCurrent).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    // Cancelling is a real cancel: still no write.
    const buttons = alertSpy.mock.calls[0][2];
    const cancelBtn = buttons.find(b => b.text === 'Cancel');
    expect(cancelBtn).toBeTruthy();
    expect(cancelBtn.style).toBe('cancel');
    await render.act(async () => {
      cancelBtn.onPress?.();
      await Promise.resolve();
    });
    expect(selectCurrent).not.toHaveBeenCalled();

    // Only the explicit confirm performs the switch.
    const confirmBtn = buttons.find(b => b.text === 'Set as current routine');
    await render.act(async () => {
      confirmBtn.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(selectCurrent).toHaveBeenCalledWith('note3');

    await render.act(async () => {
      component.unmount();
    });
  });

  test('web dialog cancel leaves the routine unchanged and confirm completes the switch (#721)', async () => {
    const originalOS = Platform.OS;
    const selectCurrent = jest.fn().mockResolvedValue(undefined);
    const currentNote = {
      id: 'note1',
      title: 'Gym Routine',
      raw_text: 'MONDAY\n-DB Bench Press 3x8\n',
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    const disjointNote = {
      id: 'note3',
      title: 'Cardio Routine',
      raw_text: 'MONDAY\n-Treadmill 30 min\n',
      saved_at: '2026-06-03T12:00:00.000Z',
    };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote, disjointNote],
      currentId: currentNote.id,
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent,
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });

    let component;
    try {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      await render.act(async () => {
        component = render.create(
          <>
            <WebAlertHost />
            <ControlledLogScreen workoutNoteText={currentNote.raw_text} />
          </>
        );
      });

      const root = component.root;
      expandRoutineManagement(root);
      render.act(() => { findPressableByText(root, 'Cardio Routine').props.onPress(); });
      render.act(() => {
        findPressableByText(root, 'Set as current routine').props.onPress({ stopPropagation: () => {} });
      });

      expect(alertSpy).not.toHaveBeenCalled();
      const cancel = root.findAll(
        n => n.props?.accessibilityLabel === 'Cancel' && typeof n.props?.onPress === 'function'
      ).at(-1);
      render.act(() => { cancel.props.onPress(); });
      expect(selectCurrent).not.toHaveBeenCalled();

      render.act(() => {
        findPressableByText(root, 'Set as current routine').props.onPress({ stopPropagation: () => {} });
      });
      const confirm = root.findAll(
        n => n.props?.accessibilityLabel === 'Set as current routine'
          && typeof n.props?.onPress === 'function'
      ).at(-1);
      await render.act(async () => {
        confirm.props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(selectCurrent).toHaveBeenCalledTimes(1);
      expect(selectCurrent).toHaveBeenCalledWith(disjointNote.id);
      await render.act(async () => {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
      });
    } finally {
      if (component) await render.act(async () => { component.unmount(); });
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    }
  });

  test('web dialog preserves the chained progress-rollover choice (#721)', async () => {
    const originalOS = Platform.OS;
    const selectCurrent = jest.fn().mockResolvedValue(undefined);
    const sharedRaw = 'MONDAY — Push\n-DB Bench Press 3x8\n';
    const note1 = {
      id: 'note1', title: 'Gym Routine', raw_text: sharedRaw,
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    const note2 = {
      id: 'note2', title: 'Home Routine', raw_text: sharedRaw,
      saved_at: '2026-06-02T12:00:00.000Z',
    };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [note1, note2],
      currentId: note1.id,
      currentNote: note1,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent,
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });

    let component;
    try {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      await render.act(async () => {
        component = render.create(
          <>
            <WebAlertHost />
            <ControlledLogScreen workoutNoteText={sharedRaw} />
          </>
        );
      });

      const root = component.root;
      expandRoutineManagement(root);
      render.act(() => { findPressableByText(root, 'Home Routine').props.onPress(); });
      render.act(() => {
        findPressableByText(root, 'Set as current routine').props.onPress({ stopPropagation: () => {} });
      });
      const confirm = root.findAll(
        n => n.props?.accessibilityLabel === 'Set as current routine'
          && typeof n.props?.onPress === 'function'
      ).at(-1);
      render.act(() => { confirm.props.onPress(); });

      const noRollover = root.findAll(
        n => n.props?.accessibilityLabel === 'No' && typeof n.props?.onPress === 'function'
      ).at(-1);
      expect(noRollover).toBeTruthy();
      expect(selectCurrent).not.toHaveBeenCalled();
      await render.act(async () => {
        noRollover.props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(selectCurrent).toHaveBeenCalledTimes(1);
      expect(selectCurrent).toHaveBeenCalledWith(note2.id);
      await render.act(async () => {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
      });
    } finally {
      if (component) await render.act(async () => { component.unmount(); });
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    }
  });
});

// ── A/B week support: behavioral tests (#295) ────────────────────────────────

describe('A/B week: parser splits sections by --- separator (#295)', () => {
  const AB_RAW = 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n';

  test('parseWorkoutNote detects --- and returns non-null weekBStartIndex', () => {
    const { weekBStartIndex } = parseWorkoutNote(AB_RAW);
    expect(weekBStartIndex).not.toBeNull();
    expect(weekBStartIndex).toBeGreaterThan(0);
  });

  test('week A raw text parses to only week A exercises', () => {
    const lines = AB_RAW.split('\n');
    const sepIdx = lines.findIndex(l => l.trim() === '---');
    const weekAText = lines.slice(0, sepIdx).join('\n');
    const { sections } = parseWorkoutNote(weekAText);
    const names = sections.flatMap(s => s.exercises.map(e => e.name));
    expect(names).toContain('DB Bench Press');
    expect(names).not.toContain('DB Floor Press');
  });

  test('week B raw text parses to only week B exercises', () => {
    const lines = AB_RAW.split('\n');
    const sepIdx = lines.findIndex(l => l.trim() === '---');
    const weekBText = lines.slice(sepIdx + 1).join('\n');
    const { sections } = parseWorkoutNote(weekBText);
    const names = sections.flatMap(s => s.exercises.map(e => e.name));
    expect(names).toContain('DB Floor Press');
    expect(names).not.toContain('DB Bench Press');
  });

  test('note without --- has null weekBStartIndex', () => {
    const { weekBStartIndex } = parseWorkoutNote('MONDAY\n-Squat 3x5\n');
    expect(weekBStartIndex).toBeNull();
  });
});

describe('A/B week: current editor preserves Week B through stale refreshes', () => {
  const AB_RAW = 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n';

  test('editing after B is acknowledged and a stale A payload arrives keeps Week B selected and saves into the Week B body', async () => {
    const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
    const update = jest.fn().mockImplementation(async (_id, patch) => ({
      id: 'note1',
      title: patch.title || 'Routine A',
      raw_text: patch.raw_text || AB_RAW,
      activeWeek: patch.activeWeek,
    }));
    const add = jest.fn();
    const selectCurrent = jest.fn();
    let latest = null;

    function Harness({ currentNote, notes }) {
      const [text, setText] = React.useState(AB_RAW);
      const [title, setTitle] = React.useState('Routine A');
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
        fatigueTrackingEnabled: false,
        onCheckInPrompt: jest.fn(),
        isActive: true,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = {
        hook,
        getText: () => text,
      };
      return null;
    }

    const initialNote = { id: 'note1', title: 'Routine A', raw_text: AB_RAW, activeWeek: 'A' };
    let component;
    render.act(() => {
      component = render.create(<Harness currentNote={initialNote} notes={[initialNote]} />);
    });

    expect(latest.hook.effectiveActiveWeek).toBe('A');

    await render.act(async () => {
      await latest.hook.handleToggleWeek();
    });

    expect(latest.hook.effectiveActiveWeek).toBe('B');
    expect(latest.hook.activeEditText).toContain('DB Floor Press 3x8');
    expect(latest.hook.activeEditText).not.toContain('DB Bench Press 3x8');

    const acknowledgedWeekBNote = { id: 'note1', title: 'Routine A', raw_text: AB_RAW, activeWeek: 'B' };
    render.act(() => {
      component.update(<Harness currentNote={acknowledgedWeekBNote} notes={[acknowledgedWeekBNote]} />);
    });

    expect(latest.hook.effectiveActiveWeek).toBe('B');

    const staleRefreshedNote = { id: 'note1', title: 'Routine A', raw_text: AB_RAW, activeWeek: 'A' };
    render.act(() => {
      component.update(<Harness currentNote={staleRefreshedNote} notes={[staleRefreshedNote]} />);
    });

    expect(latest.hook.effectiveActiveWeek).toBe('B');
    expect(latest.hook.activeEditText).toContain('DB Floor Press 3x8');
    expect(latest.hook.activeEditText).not.toContain('DB Bench Press 3x8');

    render.act(() => {
      latest.hook.handleCurrentTextChange('MONDAY — Home\n-DB Floor Press 4x8\n');
    });

    expect(latest.getText()).toBe(
      'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 4x8\n'
    );

    await render.act(async () => {
      await latest.hook.handleSave({ autosave: true });
    });

    expect(update).toHaveBeenLastCalledWith(
      'note1',
      expect.objectContaining({
        raw_text: 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 4x8\n',
        activeWeek: 'B',
      })
    );
  });

  test('editing and saving while remaining on Week A keeps changes in the Week A body', async () => {
    const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
    const update = jest.fn().mockImplementation(async (_id, patch) => ({
      id: 'note1',
      title: patch.title || 'Routine A',
      raw_text: patch.raw_text || AB_RAW,
      activeWeek: patch.activeWeek,
    }));
    let latest = null;

    function Harness({ currentNote, notes }) {
      const [text, setText] = React.useState(AB_RAW);
      const [title, setTitle] = React.useState('Routine A');
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
        add: jest.fn(),
        selectCurrent: jest.fn(),
        fatigueTrackingEnabled: false,
        onCheckInPrompt: jest.fn(),
        isActive: true,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = {
        hook,
        getText: () => text,
      };
      return null;
    }

    const currentNote = { id: 'note1', title: 'Routine A', raw_text: AB_RAW, activeWeek: 'A' };
    render.act(() => {
      render.create(<Harness currentNote={currentNote} notes={[currentNote]} />);
    });

    expect(latest.hook.effectiveActiveWeek).toBe('A');
    expect(latest.hook.activeEditText).toContain('DB Bench Press 3x8');
    expect(latest.hook.activeEditText).not.toContain('DB Floor Press 3x8');

    render.act(() => {
      latest.hook.handleCurrentTextChange('MONDAY — Push\n-DB Bench Press 4x8');
    });

    expect(latest.getText()).toBe(
      'MONDAY — Push\n-DB Bench Press 4x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n'
    );

    await render.act(async () => {
      await latest.hook.handleSave({ autosave: true });
    });

    expect(update).toHaveBeenLastCalledWith(
      'note1',
      expect.objectContaining({
        raw_text: 'MONDAY — Push\n-DB Bench Press 4x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n',
        activeWeek: 'A',
      })
    );
  });
});

describe('A/B week for non-current routines: viewing projection and per-note persistence (#687)', () => {
  const { useLogOtherRoutineEditor } = require('../screens/log/useLogOtherRoutineEditor');
  const AB_RAW = 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n';
  const PLAIN_RAW = 'MONDAY\n-Squat 3x5\n';

  function makeHarness() {
    let latest = null;
    function Harness({ notes, update, add }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'current1',
        currentNote: { id: 'current1', raw_text: 'x' },
        deloadHistory: [],
        update,
        add: add || jest.fn(),
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }
    return { Harness, get: () => latest };
  }

  test('a non-current note with a standalone --- is detected as having A/B weeks', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW };
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleViewOtherNote(note); });
    expect(get().hook.viewingHasABWeeks).toBe(true);
  });

  test('a legacy A/B note with no valid activeWeek defaults to Week A projection', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW }; // no activeWeek field at all
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleViewOtherNote(note); });
    expect(get().hook.viewingEffectiveWeek).toBe('A');
    const names = get().hook.viewingNoteDayGroups.flatMap(g => g.sections.flatMap(s => s.exercises.map(e => e.name)));
    expect(names).toContain('DB Bench Press');
    expect(names).not.toContain('DB Floor Press');
  });

  test('an invalid persisted activeWeek value also defaults to Week A', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'nonsense' };
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleViewOtherNote(note); });
    expect(get().hook.viewingEffectiveWeek).toBe('A');
  });

  test('a note with a persisted Week B selection projects only Week B exercises', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'B' };
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleViewOtherNote(note); });
    expect(get().hook.viewingEffectiveWeek).toBe('B');
    const names = get().hook.viewingNoteDayGroups.flatMap(g => g.sections.flatMap(s => s.exercises.map(e => e.name)));
    expect(names).toContain('DB Floor Press');
    expect(names).not.toContain('DB Bench Press');
  });

  test('toggling the viewed week persists that note\'s activeWeek through update() and never calls selectCurrent', async () => {
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'A' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ ...note, ...patch }));
    const selectCurrent = jest.fn();
    let latest = null;
    function Harness({ notes }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'current1',
        currentNote: { id: 'current1', raw_text: 'x' },
        deloadHistory: [],
        update,
        add: jest.fn(),
        remove: jest.fn(),
        selectCurrent,
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }
    render.act(() => { render.create(<Harness notes={[note]} />); });
    render.act(() => { latest.hook.handleViewOtherNote(note); });
    expect(latest.hook.viewingEffectiveWeek).toBe('A');

    await render.act(async () => { await latest.hook.handleToggleViewingWeek(); });

    expect(latest.hook.viewingEffectiveWeek).toBe('B');
    expect(update).toHaveBeenCalledWith('r1', { activeWeek: 'B' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(selectCurrent).not.toHaveBeenCalled();
  });

  test('each expanded routine remembers its own selected week independently', () => {
    const noteA = { id: 'r1', title: 'R1', raw_text: AB_RAW, activeWeek: 'B' };
    const noteB = { id: 'r2', title: 'R2', raw_text: AB_RAW, activeWeek: 'A' };
    const { Harness, get } = makeHarness();
    render.act(() => { render.create(<Harness notes={[noteA, noteB]} update={jest.fn()} />); });

    render.act(() => { get().hook.handleViewOtherNote(noteA); });
    expect(get().hook.viewingEffectiveWeek).toBe('B');

    render.act(() => { get().hook.handleViewOtherNote(noteA); }); // collapse
    render.act(() => { get().hook.handleViewOtherNote(noteB); }); // expand the other routine
    expect(get().hook.viewingEffectiveWeek).toBe('A');
  });

  test('a plain note without --- has no A/B week toggle and behaves as before', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: PLAIN_RAW };
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleViewOtherNote(note); });
    expect(get().hook.viewingHasABWeeks).toBe(false);
    expect(get().hook.viewingEffectiveWeek).toBe(null);
    const names = get().hook.viewingNoteDayGroups.flatMap(g => g.sections.flatMap(s => s.exercises.map(e => e.name)));
    expect(names).toContain('Squat');
  });

  test('editing a non-current A/B note edits only the selected week; saving preserves the other week and the separator', async () => {
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'B' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ ...note, ...patch }));
    const { Harness, get } = makeHarness();
    render.act(() => { render.create(<Harness notes={[note]} update={update} />); });

    render.act(() => { get().hook.handleViewOtherNote(note); });
    render.act(() => { get().hook.handleEditViewedNote(); });

    // Entering the editor from an expanded Week-B routine edits only Week B.
    expect(get().hook.editingText).toContain('DB Floor Press 3x8');
    expect(get().hook.editingText).not.toContain('DB Bench Press 3x8');

    render.act(() => { get().hook.setEditingText('MONDAY — Home\n-DB Floor Press 5x8\n'); });

    await render.act(async () => { await get().hook.handleSaveOtherNote(); });

    expect(update).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        raw_text: 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 5x8\n',
        activeWeek: 'B',
      })
    );
  });

  test('editing while on Week A keeps changes in the Week A body and preserves Week B untouched', async () => {
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'A' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ ...note, ...patch }));
    const { Harness, get } = makeHarness();
    render.act(() => { render.create(<Harness notes={[note]} update={update} />); });

    render.act(() => { get().hook.handleViewOtherNote(note); });
    render.act(() => { get().hook.handleEditViewedNote(); });

    render.act(() => { get().hook.setEditingText('MONDAY — Push\n-DB Bench Press 4x8'); });

    await render.act(async () => { await get().hook.handleSaveOtherNote(); });

    expect(update).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        raw_text: 'MONDAY — Push\n-DB Bench Press 4x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n',
        activeWeek: 'A',
      })
    );
  });

  test('creating a --- boundary while editing, switching to Week B and authoring it, preserves both bodies', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: PLAIN_RAW };
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleOpenOtherNote(note); });
    expect(get().hook.editingHasABWeeks).toBe(false);

    // Creating the boundary: typing '---' turns the plain note into an A/B note.
    render.act(() => {
      get().hook.setEditingText('MONDAY\n-Squat 3x5\n---\nMONDAY\n-Deadlift 3x5');
    });
    expect(get().hook.editingHasABWeeks).toBe(true);
    expect(get().hook.editingEffectiveWeek).toBe('A');
    expect(get().hook.editingText).toContain('Squat');
    expect(get().hook.editingText).not.toContain('Deadlift');

    // The editing-week toggle (handleToggleEditingWeek) must now be usable: switch
    // to Week B and author it.
    render.act(() => { get().hook.handleToggleEditingWeek(); });
    expect(get().hook.editingEffectiveWeek).toBe('B');
    expect(get().hook.editingText).toContain('Deadlift');
    expect(get().hook.editingText).not.toContain('Squat');

    render.act(() => { get().hook.setEditingText('MONDAY\n-Deadlift 5x5'); });

    // Switching back to Week A must show the original, untouched Week A body —
    // neither side lost any text across the create/switch/author cycle.
    render.act(() => { get().hook.handleToggleEditingWeek(); });
    expect(get().hook.editingEffectiveWeek).toBe('A');
    expect(get().hook.editingText).toBe('MONDAY\n-Squat 3x5');

    render.act(() => { get().hook.handleToggleEditingWeek(); });
    expect(get().hook.editingText).toBe('MONDAY\n-Deadlift 5x5');
  });

  test('reopening a note whose --- boundary has been removed reconciles the controls without losing text', () => {
    const { Harness, get } = makeHarness();
    const abNote = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'B' };
    render.act(() => { render.create(<Harness notes={[abNote]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleOpenOtherNote(abNote); });
    expect(get().hook.editingHasABWeeks).toBe(true);
    expect(get().hook.editingEffectiveWeek).toBe('B');

    // The boundary is gone by the time the note is reopened (e.g. removed through
    // some other save path). Reconciliation must show the full remaining text with
    // no toggle and no data loss, not crash or silently drop content.
    const mergedNoBoundary = { id: 'r1', title: 'R', raw_text: 'MONDAY — Push\n-DB Bench Press 3x8\nMONDAY — Home\n-DB Floor Press 3x8\n' };
    render.act(() => { get().hook.handleOpenOtherNote(mergedNoBoundary); });

    expect(get().hook.editingHasABWeeks).toBe(false);
    expect(get().hook.editingEffectiveWeek).toBe(null);
    expect(get().hook.editingText).toBe(mergedNoBoundary.raw_text);
  });

  test('handleMergeEditingWeeks removes the boundary while editing: both authored bodies survive, the toggle disappears, and the persisted activeWeek is cleared', async () => {
    const abNote = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'B' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ ...abNote, ...patch }));
    const { Harness, get } = makeHarness();
    render.act(() => { render.create(<Harness notes={[abNote]} update={update} />); });

    // Open the A/B note in the editor and author both weeks first.
    render.act(() => { get().hook.handleOpenOtherNote(abNote); });
    expect(get().hook.editingHasABWeeks).toBe(true);
    expect(get().hook.editingEffectiveWeek).toBe('B');

    render.act(() => { get().hook.setEditingText('MONDAY — Home\n-DB Floor Press 4x8'); });
    render.act(() => { get().hook.handleToggleEditingWeek(); });
    expect(get().hook.editingEffectiveWeek).toBe('A');
    render.act(() => { get().hook.setEditingText('MONDAY — Push\n-DB Bench Press 5x8'); });

    // Invoke the real editor removal action.
    render.act(() => { get().hook.handleMergeEditingWeeks(); });

    // The note is now a plain single-week note: no boundary, no toggle state,
    // and both authored bodies present in the merged text.
    expect(get().hook.editingHasABWeeks).toBe(false);
    expect(get().hook.editingEffectiveWeek).toBe(null);
    expect(get().hook.editingText).toBe('MONDAY — Push\n-DB Bench Press 5x8\n\nMONDAY — Home\n-DB Floor Press 4x8');
    expect(get().hook.editingText).not.toContain('---');

    // Saving persists the merge and reconciles (clears) the stale activeWeek.
    await render.act(async () => { await get().hook.handleSaveOtherNote(); });
    expect(update).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        raw_text: 'MONDAY — Push\n-DB Bench Press 5x8\n\nMONDAY — Home\n-DB Floor Press 4x8',
        activeWeek: null,
      })
    );
  });

  test('a brand-new A/B routine persists its selected Week B on first save, and reopening it stays on Week B; currentId is never touched', async () => {
    // add() (useWorkoutNotes) always creates a note with activeWeek: null —
    // the new-note save path must follow up with an explicit update() to
    // persist whichever week was selected before the first save, or the
    // routine would silently reopen on Week A regardless of the author's
    // choice.
    let storedNote = null;
    const add = jest.fn().mockImplementation(async (title, raw_text) => {
      storedNote = { id: 'new1', title, raw_text, activeWeek: null };
      return storedNote;
    });
    const update = jest.fn().mockImplementation(async (id, patch) => {
      storedNote = { ...storedNote, ...patch };
      return storedNote;
    });
    const selectCurrent = jest.fn();

    let latest = null;
    function Harness({ notes }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'current1',
        currentNote: { id: 'current1', raw_text: 'x' },
        deloadHistory: [],
        update,
        add,
        remove: jest.fn(),
        selectCurrent,
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { render.create(<Harness notes={[]} />); });

    render.act(() => { latest.hook.handleCreateRoutine(); });
    render.act(() => {
      latest.hook.setEditingText('MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8');
    });
    expect(latest.hook.editingEffectiveWeek).toBe('A');

    // Select Week B before the very first save.
    render.act(() => { latest.hook.handleToggleEditingWeek(); });
    expect(latest.hook.editingEffectiveWeek).toBe('B');

    await render.act(async () => { await latest.hook.handleSaveOtherNote(); });

    expect(add).toHaveBeenCalledWith(
      'Untitled Routine',
      'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8'
    );
    // The follow-up persistence call, and never a currentId change.
    expect(update).toHaveBeenCalledWith('new1', { activeWeek: 'B' });
    expect(selectCurrent).not.toHaveBeenCalled();
    expect(storedNote.activeWeek).toBe('B');

    // Reopening the note as freshly loaded from the store must still select
    // Week B, not silently reset to the Week A default.
    render.act(() => { latest.hook.handleOpenOtherNote(storedNote); });
    expect(latest.hook.editingHasABWeeks).toBe(true);
    expect(latest.hook.editingEffectiveWeek).toBe('B');
    expect(latest.hook.editingText).toContain('DB Floor Press');
    expect(latest.hook.editingText).not.toContain('DB Bench Press');
  });

  test('a brand-new plain routine (no ---) still saves with activeWeek: null and never calls update() for a week', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'new2', title: 'Plain', raw_text: 'MONDAY\n-Squat 3x5', activeWeek: null });
    const update = jest.fn();
    let latest = null;
    function Harness({ notes }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'current1',
        currentNote: { id: 'current1', raw_text: 'x' },
        deloadHistory: [],
        update,
        add,
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { render.create(<Harness notes={[]} />); });
    render.act(() => { latest.hook.handleCreateRoutine(); });
    render.act(() => { latest.hook.setEditingTitle('Plain'); });
    render.act(() => { latest.hook.setEditingText('MONDAY\n-Squat 3x5'); });

    await render.act(async () => { await latest.hook.handleSaveOtherNote(); });

    expect(add).toHaveBeenCalledWith('Plain', 'MONDAY\n-Squat 3x5');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('LogScreen editor header: editing-week toggle for non-current A/B notes (#687 review feedback)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getInput = (root) =>
    root.findAll(n => n.props && n.props.multiline === true && typeof n.props.onChangeText === 'function')[0];

  test('typing a --- boundary into a new routine reveals an accessible Week toggle; switching weeks preserves both bodies', () => {
    const currentNote = { id: 'current1', title: 'Current', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5' };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote],
      currentId: 'current1',
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn(),
      add: jest.fn().mockResolvedValue({ id: 'new1' }),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    expandRoutineManagement(root);

    // No toggle before there is any A/B routine open in the editor.
    expect(findPressableByText(root, 'Week B')).toBeNull();

    // `New routine` opens the ordinary `editingNoteId === 'new'` editor
    // directly (#786/R6b-3; the header affordance is the section's only
    // create-routine control since #836), the same editor this test has
    // always exercised.
    render.act(() => { findPressableByText(root, 'New routine').props.onPress(); });

    render.act(() => {
      getInput(root).props.onChangeText('MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8');
    });

    // The boundary now exists: the editing-week toggle must appear, accessibly.
    const toggleToB = findPressableByText(root, 'Week B');
    expect(toggleToB).toBeTruthy();
    expect(toggleToB.props.accessibilityRole).toBe('button');
    expect(toggleToB.props.accessibilityLabel).toBe('Switch to Week B');
    expect(toggleToB.props.accessibilityState).toEqual({ selected: false });
    expect(getInput(root).props.value).toBe('MONDAY — Push\n-DB Bench Press 3x8');

    render.act(() => { toggleToB.props.onPress(); });
    expect(getInput(root).props.value).toBe('MONDAY — Home\n-DB Floor Press 3x8');

    render.act(() => { getInput(root).props.onChangeText('MONDAY — Home\n-DB Floor Press 4x8'); });

    // Switch back to Week A: its body must be exactly as authored, untouched by
    // the Week-B edit — neither side lost any text.
    const toggleToA = findPressableByText(root, 'Week A');
    expect(toggleToA.props.accessibilityState).toEqual({ selected: true });
    render.act(() => { toggleToA.props.onPress(); });
    expect(getInput(root).props.value).toBe('MONDAY — Push\n-DB Bench Press 3x8');
  });

  test('the Merge weeks control removes the boundary while editing and then disappears (truthful control)', () => {
    const otherNote = { id: 'other1', title: 'Other', raw_text: 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8', activeWeek: 'A' };
    const currentNote = { id: 'current1', title: 'Current', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ ...otherNote, ...patch }));

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote, otherNote],
      currentId: 'current1',
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update,
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });

    let component;
    render.act(() => {
      // No current-routine content (workoutNoteText: '') so the current-routine
      // card is not rendered, and the double-tap below unambiguously targets the
      // non-current routine card's body.
      component = render.create(<ControlledLogScreen workoutNoteText="" setWorkoutNoteText={jest.fn()} />);
    });
    const root = component.root;
    expandRoutineManagement(root);

    // Expand the non-current routine, then open it in the editor via double-tap.
    // The visible "Double-tap to edit" hint is gone (#724); the body Pressable is
    // located by its rendered exercise content instead, and the gesture persists.
    render.act(() => { findPressableByText(root, 'Other').props.onPress(); });
    const body = pressableAround(root, t => t.includes('DB Bench Press'));
    render.act(() => { body.props.onPress(); });
    render.act(() => { body.props.onPress(); });

    // A/B controls are present for this note, including the truthful Merge weeks
    // control — it must not render for a plain note (covered by the toggle test
    // above finding no "Week B" control at all before any A/B note is open).
    const mergeButton = findPressableByText(root, 'Merge weeks');
    expect(mergeButton).toBeTruthy();
    expect(mergeButton.props.accessibilityRole).toBe('button');
    expect(mergeButton.props.accessibilityLabel).toBe('Merge Week A and Week B into one routine');
    expect(findPressableByText(root, 'Week B')).toBeTruthy();

    render.act(() => { mergeButton.props.onPress(); });

    // The boundary is gone: both authored bodies remain in the single input,
    // and the editor's Merge control disappears (truthful — there is nothing
    // left to merge). Note: the still-mounted (but hidden) non-current
    // viewing card's own Week toggle can remain until this edit is actually
    // saved, since it reflects the persisted note, not the in-progress edit.
    expect(getInput(root).props.value).toBe('MONDAY — Push\n-DB Bench Press 3x8\n\nMONDAY — Home\n-DB Floor Press 3x8');
    expect(findPressableByText(root, 'Merge weeks')).toBeNull();
  });
});

describe('A/B week: empty active card rendering', () => {
  test('renders B-week alternative text in small inline body text instead of emptyText style', () => {
    const { LogActiveRoutineCard } = require('../components/LogActiveRoutineCard');

    let component;
    render.act(() => {
      component = render.create(
        <LogActiveRoutineCard
          workoutNoteTitle="My Routine"
          hasABWeeks={true}
          effectiveActiveWeek="B"
          handleToggleWeek={jest.fn()}
          enterCurrentEditor={jest.fn()}
          handleNoteBodyPress={jest.fn()}
          isCollapsed={false}
          dayGroups={[]}
          trackedLifts={{}}
          handleToggleTrack={jest.fn()}
          roughNoteId="note1"
          currentId="note1"
          roughFlaggedNames={new Set()}
          activeEditText="Raw B-week routine text"
        />
      );
    });

    const root = component.root;
    // Find the text node that renders "Raw B-week routine text"
    const textNode = root.find(n => n.type === 'Text' && n.props.children === 'Raw B-week routine text');
    expect(textNode).toBeTruthy();
    
    // Check that it does NOT have emptyText styling (which has textAlign: 'center'), and has unparsedRowMuted styling (color: LightColors.text)
    expect(textNode.props.style.textAlign).toBeUndefined();
    expect(textNode.props.style.color).toBe(LightColors.text);
  });
});

// WorkoutContentRenderer collapsed four distinct main render modes (active routine,
// active deload card, past deload view, past routine view) into one component. These
// tests pin the two axes that differ across those modes — unparsed-row color and
// whether a tracking toggle is interactive — so the modes can't silently converge.
describe('WorkoutContentRenderer: per-mode parity with main', () => {
  const { WorkoutContentRenderer } = require('../components/WorkoutContentRenderer');

  // One lifting exercise whose only entry is unparsed raw text.
  const liftingDayGroups = [
    {
      heading: 'Day 1',
      sections: [
        {
          subheading: null,
          kind: 'lifting',
          exercises: [
            {
              name: 'Bench',
              session_entries: [{ unparsed: true, raw: 'garbage text' }],
              rows: [],
              unparsed_positions: [],
              unparsed_rows: [],
            },
          ],
        },
      ],
    },
  ];

  const findRawText = (root) =>
    root.find(n => n.type === 'Text' && n.props.children === 'garbage text');

  // Regression #3: past-deload view (isDeload, no mutedUnparsed) must keep red
  // (unparsedRow / LightColors.error) styling for unparsed lifting rows, like main:1423-1459.
  test('past-deload view (isDeload only) renders unparsed lifting rows in error red', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} isDeload={true} />
      );
    });
    expect(findRawText(component.root).props.style.color).toBe(LightColors.error);
  });

  // Active deload editor card (isDeload + mutedUnparsed) was always muted on main.
  test('active deload card (mutedUnparsed) renders unparsed lifting rows muted', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} isDeload={true} mutedUnparsed={true} />
      );
    });
    expect(findRawText(component.root).props.style.color).toBe(LightColors.text);
  });

  // Regression #4: read-only past-routine view passes no onToggleTrack. The renderer
  // must NOT wire a (crashing) toggle closure, so ExerciseBlock shows no Track control.
  test('no onToggleTrack handler -> no tracking toggle rendered', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} emptyText="No exercises to display." />
      );
    });
    const root = component.root;
    const trackNodes = root.findAll(
      n => n.type === 'Text' && (n.props.children === 'Track' || n.props.children === 'Tracked')
    );
    expect(trackNodes.length).toBe(0);
  });

  // Active routine card passes a real onToggleTrack -> toggle IS interactive.
  test('with onToggleTrack handler -> tracking toggle rendered', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} onToggleTrack={jest.fn()} />
      );
    });
    const root = component.root;
    const trackNodes = root.findAll(
      n => n.type === 'Text' && (n.props.children === 'Track' || n.props.children === 'Tracked')
    );
    expect(trackNodes.length).toBeGreaterThan(0);
  });
});

// #615: render read-view marks and comments from the canonical { mark, comments }
// annotation shape, using real parser output so parser <-> renderer stay in sync.
describe('#615: WorkoutContentRenderer renders marks and comments', () => {
  const { WorkoutContentRenderer } = require('../components/WorkoutContentRenderer');
  const { parseWorkoutNote } = require('../lib/parser/workoutNote');

  function dayGroupsFor(note) {
    const { sections } = parseWorkoutNote(note);
    return [{ heading: null, sections }];
  }

  test('a star mark renders as a labeled, muted marker beside the set row', () => {
    const dayGroups = dayGroupsFor('-Squat\n- 225 5,5,5 *PR');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const markNode = component.root.find(
      n => n.type === 'Text' && n.props.accessibilityLabel === 'Marked: PR'
    );
    expect(markNode).toBeTruthy();
    expect(markNode.props.children).toBe('★ PR');
  });

  test('a stored `--` comment renders as a muted, accessibility-labeled note line beneath the set', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 225 5,5,5\n-- felt strong');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const noteNode = component.root.find(
      n => n.type === 'Text' && n.props.accessibilityLabel === 'Note: felt strong'
    );
    expect(noteNode).toBeTruthy();
    expect(noteNode.props.children).toBe('felt strong');
    expect(noteNode.props.style.color).toBe(LightColors.textMuted);
  });

  test('a row with no annotation renders no mark or note text', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 225 5,5,5');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const markNodes = component.root.findAll(
      n => n.type === 'Text' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Marked:')
    );
    const noteNodes = component.root.findAll(
      n => n.type === 'Text' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Note:')
    );
    expect(markNodes.length).toBe(0);
    expect(noteNodes.length).toBe(0);
  });

  test('mark and comment do not duplicate the row as raw unparsed text', () => {
    const dayGroups = dayGroupsFor('-Squat\n- 225 5,5,5 *PR\n-- easiest triple yet');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const rawTextNodes = component.root.findAll(
      n => n.type === 'Text' && n.props.children === '225 5,5,5 *PR'
    );
    expect(rawTextNodes.length).toBe(0);
  });

  // Regression: a `--` comment after a bare (no leading "- ") logged row must
  // render as a "Note: ..." line beneath that row, not as raw unparsed text.
  // Reviewer finding on #615/PR#651.
  test('a `--` comment after a bare logged row renders as a note, only once, with no raw fallback duplication', () => {
    const dayGroups = dayGroupsFor('-Bench\n225 5\n-- felt strong');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const noteNodes = component.root.findAll(
      n => n.type === 'Text' && n.props.accessibilityLabel === 'Note: felt strong'
    );
    expect(noteNodes.length).toBe(1);
    expect(noteNodes[0].props.children).toBe('felt strong');

    const rawCommentNodes = component.root.findAll(
      n => n.type === 'Text' && n.props.children === '-- felt strong'
    );
    expect(rawCommentNodes.length).toBe(0);
  });

  // #618: an inline prose tail ("225 5 - RPE 9") renders as a muted, a11y-labeled
  // note beneath the set, while the set itself still counts and never becomes a
  // phantom load row.
  test('a captured inline prose tail renders as a muted note and the set still counts', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 225 5 - RPE 9');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const noteNode = component.root.find(
      n => n.type === 'Text' && n.props.accessibilityLabel === 'Note: RPE 9'
    );
    expect(noteNode).toBeTruthy();
    expect(noteNode.props.children).toBe('RPE 9');
    expect(noteNode.props.style.color).toBe(LightColors.textMuted);

    // The set row still renders (225 lb), and the prose never appears as raw text.
    const weightNodes = component.root.findAll(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('225')
    );
    expect(weightNodes.length).toBeGreaterThan(0);
    const rawTailNodes = component.root.findAll(
      n => n.type === 'Text' && n.props.children === '225 5 - RPE 9'
    );
    expect(rawTailNodes.length).toBe(0);
  });
});

// #852: the inline read view (both the full-scale routine rendering and
// Recovery's `compact` mode) must show a kg-marked set's converted whole-lb
// value AND visibly indicate that a conversion happened — not just print a
// number. Both modes share the same grouping/labeling approach (see
// WorkoutContentRenderer.js's CompactSetLine and UI.js's SetLine), so both
// are covered here from the same marked note text.
describe('#852: inline read view indicates a kg-marked set was converted', () => {
  const { WorkoutContentRenderer } = require('../components/WorkoutContentRenderer');
  const { parseWorkoutNote } = require('../lib/parser/workoutNote');

  function dayGroupsFor(note) {
    const { sections } = parseWorkoutNote(note);
    return [{ heading: null, sections }];
  }

  test('full-scale rendering: shows the converted whole-lb value and the original kg number', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 40kg 10');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const weightNode = component.root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('88')
    );
    expect(weightNode).toBeTruthy();
    // Whole lb (40 kg -> 88, not 88.18), and the original kg value is visible
    // alongside it so the conversion is indicated, not just a bare number.
    expect(weightNode.props.children).toBe('88 lb (40kg)');
  });

  test('full-scale rendering: an unmarked set never shows a kg suffix', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 135 5,5,5');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const weightNode = component.root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('135')
    );
    expect(weightNode.props.children).toBe('135 lb');
  });

  test('compact (Recovery) rendering: shows the converted value and the kg suffix too', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 40kg 10');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} compact={true} />);
    });
    const weightNode = component.root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('88')
    );
    expect(weightNode).toBeTruthy();
    expect(weightNode.props.children).toBe('88 lb (40kg)');
    expect(weightNode.props.accessibilityLabel).toBe('88 lb, converted from 40 kilograms');
  });

  test('mixed row: only the kg-marked pair shows the conversion suffix', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 40kg 10 60 8,8');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const convertedNode = component.root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('88')
    );
    expect(convertedNode.props.children).toBe('88 lb (40kg)');
    const plainNode = component.root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('60')
    );
    expect(plainNode.props.children).toBe('60 lb');
  });

  // Regression: a converted set and a genuine lb set can share the same
  // weight_value (40kg rounds to 88 lb), so grouping on the number alone
  // merged them into one group and labelled the genuine 88 lb set as
  // converted. The group must break on conversion identity too.
  test('an adjacent genuine 88 lb set is not labelled as converted', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 88 10 40kg 8');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const weightNodes = component.root
      .findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('88'))
      .map(n => n.props.children);
    expect(weightNodes).toEqual(['88 lb', '88 lb (40kg)']);
  });

  // Two different kg loads can round to the same lb value (40kg and 39.9kg
  // are both 88 lb) and must stay separate: they render different suffixes.
  test('40kg and 39.9kg both rounding to 88 lb stay separate groups', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 40kg 10 39.9kg 8');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const weightNodes = component.root
      .findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('88'))
      .map(n => n.props.children);
    expect(weightNodes).toEqual(['88 lb (40kg)', '88 lb (39.9kg)']);
  });
});

// Walk up from a matching Text node to its Nth Pressable (onPress) ancestor,
// nearest first. `depth` defaults to the nearest one; pass 2 to reach the
// enclosing container Pressable when the matched text sits inside its own
// button (e.g. the skip control inside the active card's body).
function pressableAround(root, predicate, depth = 1) {
  const matches = root.findAll(
    n => n.type === 'Text' && predicate(
      Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')
    )
  );
  for (const match of matches) {
    let node = match.parent;
    let seen = 0;
    while (node) {
      if (node.props && typeof node.props.onPress === 'function') {
        seen += 1;
        if (seen === depth) return node;
      }
      node = node.parent;
    }
  }
  return null;
}

// Regression #6: on main the active-card HEADER toggled collapse while the BODY
// handled double-tap-to-edit. The refactor briefly wired both to the body handler
// (and collapsed on every single tap), so entering the editor left the card
// collapsed on return. These pin the two handlers to distinct callbacks.
describe('LogActiveRoutineCard: header collapses, body edits (separate handlers)', () => {
  const { LogActiveRoutineCard } = require('../components/LogActiveRoutineCard');

  const renderCard = (overrides = {}) => {
    const props = {
      workoutNoteTitle: 'My Routine',
      hasABWeeks: false,
      effectiveActiveWeek: 'A',
      handleToggleWeek: jest.fn(),
      enterCurrentEditor: jest.fn(),
      handleNoteBodyPress: jest.fn(),
      toggleCollapsed: jest.fn(),
      isCollapsed: false,
      dayGroups: [],
      trackedLifts: {},
      handleToggleTrack: jest.fn(),
      roughNoteId: 'n1',
      currentId: 'n1',
      roughFlaggedNames: new Set(),
      activeEditText: '',
      ...overrides,
    };
    let component;
    render.act(() => { component = render.create(<LogActiveRoutineCard {...props} />); });
    return { root: component.root, props };
  };

  test('tapping the header calls toggleCollapsed, not the body handler', () => {
    const { root, props } = renderCard();
    const header = pressableAround(root, t => t.includes('Current routine'));
    render.act(() => { header.props.onPress(); });
    expect(props.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(props.handleNoteBodyPress).not.toHaveBeenCalled();
  });

  // #711 removed the advertised "Double-tap to edit" hint in favour of an
  // explicit Edit control, but deliberately kept handleNoteBodyPress wired so
  // the gesture still works for users who know it. The body is now located via
  // the skip control it contains rather than the retired hint text.
  test('tapping the body calls the body handler, not toggleCollapsed', () => {
    const { root, props } = renderCard({ handleSkipWeek: jest.fn() });
    const body = pressableAround(root, t => t.includes('Skip week'), 2);
    render.act(() => { body.props.onPress(); });
    expect(props.handleNoteBodyPress).toHaveBeenCalledTimes(1);
    expect(props.toggleCollapsed).not.toHaveBeenCalled();
  });

  test('the explicit Edit control in the action strip enters the editor', () => {
    const { root, props } = renderCard();
    const editBtn = pressableAround(root, t => t === 'Edit');
    expect(editBtn.props.accessibilityRole).toBe('button');
    expect(editBtn.props.accessibilityLabel).toBe('Edit routine');
    render.act(() => { editBtn.props.onPress({ stopPropagation: jest.fn() }); });
    expect(props.enterCurrentEditor).toHaveBeenCalledTimes(1);
    expect(props.toggleCollapsed).not.toHaveBeenCalled();
    expect(props.handleNoteBodyPress).not.toHaveBeenCalled();
  });
});

// #710 established the header containment contract: a `flex: 1` title column
// next to an action container that could not shrink, so the title absorbed the
// full width deficit and collapsed to zero width. #711 removes the cause rather
// than only containing it — the routine-card headers now hold identity only, so
// there is no sibling action row left to fight the title for width. These pin
// both halves of that: the headers render zero controls, the title still
// truncates rather than collapsing, and the containment props (`flexWrap`,
// `flexShrink`, a real 44dp touch target) followed the controls into the active
// card's action strip and the non-current card's expanded body — the two rows
// that now have to hold more than one control. Jest's renderer cannot measure
// actual Yoga layout or on-screen touch-target overlap, so this asserts the
// style/props contract that produces that layout; the acceptance criteria's
// multi-width visual checks require manual verification.
describe('Routine-card header/action containment (#710, #711)', () => {
  const { LogActiveRoutineCard } = require('../components/LogActiveRoutineCard');

  const LONG_TITLE = 'Return (ease the back) rehab';

  function findTitleText(root, title) {
    return root.find(n => n.type === 'Text' && n.props.children === title);
  }

  function flatStyle(node) {
    return Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style) : node.props.style;
  }

  // Host nodes only: a Pressable renders a host View carrying the same style,
  // so an unfiltered walk counts every styled element twice.
  function findStyled(root, predicate) {
    return root.findAll(
      n => typeof n.type === 'string' && n.props && n.props.style && predicate(flatStyle(n))
    );
  }

  // The header Pressable is the collapse/expand target itself, so "no controls
  // in the header" means: no *nested* onPress anywhere beneath it.
  function nestedPressablesUnder(headerNode) {
    return headerNode.findAll(n => n !== headerNode && n.props && typeof n.props.onPress === 'function');
  }

  test('LogActiveRoutineCard: the header holds identity only; the action strip carries the controls', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogActiveRoutineCard
          workoutNoteTitle={LONG_TITLE}
          hasABWeeks={true}
          effectiveActiveWeek="A"
          handleToggleWeek={jest.fn()}
          enterCurrentEditor={jest.fn()}
          handleNoteBodyPress={jest.fn()}
          handleSkipWeek={jest.fn()}
          handleUnskipWeek={jest.fn()}
          canUnskipWeek={false}
          toggleCollapsed={jest.fn()}
          isCollapsed={false}
          dayGroups={[]}
          trackedLifts={{}}
          handleToggleTrack={jest.fn()}
          roughNoteId="n1"
          currentId="n1"
          roughFlaggedNames={new Set()}
          activeEditText=""
          recoveryWeekNumber={2}
        />
      );
    });
    const root = component.root;

    const title = findTitleText(root, LONG_TITLE);
    expect(title.props.numberOfLines).toBe(2);
    expect(title.props.ellipsizeMode).toBe('tail');

    // Identity only: title, subtitle, badge — and not one nested control.
    const header = pressableAround(root, t => t.includes('Current routine'));
    expect(nestedPressablesUnder(header).length).toBe(0);
    expect(header.findAll(n => n.type === 'Text' && String(n.props.children).includes('Recovery Week')).length)
      .toBeGreaterThan(0);

    const infoColumn = findStyled(root, s => s.flex === 1 && 'minWidth' in s);
    expect(infoColumn.length).toBeGreaterThan(0);
    expect(flatStyle(infoColumn[0]).minWidth).toBeGreaterThan(0);

    // The wrap/shrink containment now lives on the action strip.
    const wrapRows = findStyled(root, s => s.flexWrap === 'wrap');
    expect(wrapRows.length).toBeGreaterThan(0);

    const pills = findStyled(root, s => s.minHeight === 44);
    expect(pills.length).toBe(3); // Edit + Week A/B + Skip week/Remove skip (#823: 44dp floor)
    for (const pill of pills) {
      const style = flatStyle(pill);
      expect(style.justifyContent).toBe('center');
      expect(style.flexShrink).toBe(1);
    }

    // gap:12 minus hitSlop's top+bottom (or left+right) must leave >=4dp of
    // effective separation between two pills stacked on wrapped lines.
    const editPill = pressableAround(root, t => t === 'Edit');
    expect(editPill.props.hitSlop).toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
  });

  test('LogPreviousRoutines: the header holds identity only; the expanded body carries the controls', () => {
    const note = { id: 'r1', title: LONG_TITLE, raw_text: 'MONDAY\n-Squat 3x5\n---\nMONDAY\n-Deadlift 3x5\n', updated_at: '2026-01-01T00:00:00.000Z' };
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={[note]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId="r1"
          viewingNote={note}
          viewingNoteDayGroups={[]}
          viewingHasABWeeks={true}
          viewingEffectiveWeek="A"
          handleToggleViewingWeek={jest.fn()}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
          recoveryWeekNumberByNoteId={{ r1: 2 }}
        />
      );
    });
    const root = component.root;
    expandRoutineManagement(root);

    const title = findTitleText(root, LONG_TITLE);
    expect(title.props.numberOfLines).toBe(2);
    expect(title.props.ellipsizeMode).toBe('tail');

    const header = pressableAround(root, t => t.includes(LONG_TITLE));
    expect(nestedPressablesUnder(header).length).toBe(0);
    expect(header.findAll(n => n.type === 'Text' && String(n.props.children).includes('Recovery week')).length)
      .toBeGreaterThan(0);

    const infoColumn = findStyled(root, s => s.flex === 1 && 'minWidth' in s);
    expect(infoColumn.length).toBeGreaterThan(0);
    expect(flatStyle(infoColumn[0]).minWidth).toBeGreaterThan(0);

    // The one relocated pill (Week A/B) keeps its wrapping row and touch target.
    const wrapRows = findStyled(root, s => s.flexWrap === 'wrap');
    expect(wrapRows.length).toBeGreaterThan(0);

    // Scope to the pill's 44dp target: the disclosure header now also carries a
    // 44dp min height (#724 review), but only the pill also shrinks.
    const pills = findStyled(root, s => s.minHeight === 44 && s.flexShrink === 1);
    expect(pills.length).toBe(1);
    const pillStyle = flatStyle(pills[0]);
    expect(pillStyle.justifyContent).toBe('center');
    expect(pillStyle.flexShrink).toBe(1);
    expect(pressableAround(root, t => t === 'Week B').props.hitSlop)
      .toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
  });

  test('Recovery and More Routines headings share the same section-title treatment (#771)', () => {
    const { LogRecoverySection } = require('../components/LogRecoverySection');
    let recoveryComponent;
    render.act(() => {
      recoveryComponent = render.create(
        <LogRecoverySection blocks={[]} weeks={[]} notes={[]} stateStale />
      );
    });
    const recoveryTitle = findTitleText(recoveryComponent.root, 'Recovery');
    expect(recoveryTitle).toBeTruthy();

    let routinesComponent;
    render.act(() => {
      routinesComponent = render.create(
        <ControlledPreviousRoutines
          otherNotes={[]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId={null}
          viewingNote={null}
          viewingNoteDayGroups={[]}
          viewingHasABWeeks={false}
          viewingEffectiveWeek={null}
          handleToggleViewingWeek={jest.fn()}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
        />
      );
    });
    const routinesTitle = findTitleText(routinesComponent.root, 'More Routines · 0');
    expect(routinesTitle).toBeTruthy();

    const recoveryStyle = flatStyle(recoveryTitle);
    const routinesStyle = flatStyle(routinesTitle);
    for (const prop of ['fontSize', 'fontWeight', 'color', 'textTransform', 'letterSpacing']) {
      expect(recoveryStyle[prop]).toBe(routinesStyle[prop]);
    }
  });

  test('LogPreviousRoutines: a collapsed More Routines list renders only the disclosure toggle and a New Note affordance (#756)', () => {
    const notes = [
      { id: 'r1', title: 'Routine One', raw_text: 'MONDAY\n-Squat 3x5\n', saved_at: '2026-01-01T00:00:00.000Z' },
      { id: 'r2', title: 'Routine Two', raw_text: 'MONDAY\n-Bench 3x5\n', saved_at: '2026-01-02T00:00:00.000Z' },
    ];
    const handleCreateRoutine = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={notes}
          handleViewOtherNote={jest.fn()}
          viewingNoteId={null}
          viewingNote={null}
          viewingNoteDayGroups={[]}
          viewingHasABWeeks={false}
          viewingEffectiveWeek={null}
          handleToggleViewingWeek={jest.fn()}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={handleCreateRoutine}
        />
      );
    });
    const root = component.root;

    // Collapsed routine management (#724, redesigned #843, recontained #847)
    // still hides the routine cards and every row-level management action
    // behind the disclosure, but the count and the `New routine` affordance
    // live outside it entirely — always visible, not gated by the
    // disclosure's own open state, and a sibling of the toggle rather than
    // its child (PR #760 review).
    const toggle = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Show routines'
        && typeof n.props.onPress === 'function'
    )[0];
    expect(toggle).toBeTruthy();
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    const newRoutine = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'New routine' && typeof n.props.onPress === 'function'
    )[0];
    expect(newRoutine).toBeTruthy();

    // Pressing it neither expands the disclosure nor mounts routine cards —
    // it calls straight through to handleCreateRoutine.
    render.act(() => { newRoutine.props.onPress({ stopPropagation: jest.fn() }); });
    expect(handleCreateRoutine).toHaveBeenCalledTimes(1);
    expect(root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Hide routines'
    ).length).toBe(0);

    // No routine card is mounted and no other management action exists while
    // collapsed.
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Routine One').length).toBe(0);
    for (const label of ['Start recovery block', 'Set as current routine', 'Edit routine', 'Delete routine']) {
      expect(root.findAll(n => n.type === 'Text' && n.props.children === label).length).toBe(0);
    }

    // The count is `More Routines · {count}` (#843), always visible, with no
    // "Latest:" naming one routine over the others.
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'More Routines · 2').length).toBe(1);
    expect(root.findAll(
      n => n.type === 'Text' && Array.isArray(n.props.children) && n.props.children[0] === 'Latest: '
    ).length).toBe(0);
  });
});

// -- More Routines: quiet individual note cards, no enclosing panel (#847) --
describe('LogPreviousRoutines: quiet note-card containment (#847)', () => {
  const notes = [
    { id: 'r1', title: 'Routine One', raw_text: 'MONDAY\n-Squat 3x5\n', saved_at: '2026-01-01T00:00:00.000Z' },
    { id: 'r2', title: 'Routine Two', raw_text: 'MONDAY\n-Bench 3x5\n', saved_at: '2026-01-02T00:00:00.000Z' },
  ];
  const baseProps = {
    otherNotes: notes,
    handleViewOtherNote: jest.fn(),
    viewingNoteId: null,
    viewingNote: null,
    viewingNoteDayGroups: [],
    viewingHasABWeeks: false,
    viewingEffectiveWeek: null,
    handleToggleViewingWeek: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleEditViewedNote: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    handleCreateRoutine: jest.fn(),
  };
  const render_ = (expanded) => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines {...baseProps} expanded={expanded} />
      );
    });
    return component.root;
  };
  const flat = (n) => Object.assign({}, ...(Array.isArray(n.props.style) ? n.props.style : [n.props.style]).filter(Boolean));

  test('collapsed, no routine card and no enclosing panel-style surface render at all', () => {
    const root = render_(false);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Routine One').length).toBe(0);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Routine Two').length).toBe(0);
    // No tinted, bordered panel-equivalent surface is mounted while collapsed.
    expect(root.findAll(n => n.props && n.props.style && flat(n).backgroundColor === LightColors.subtleBg).length).toBe(0);
  });

  test('expanded, each routine renders as its own bordered, rounded card — not one shared panel', () => {
    const root = render_(true);
    // Two separate rounded, bordered surfaces, one per routine — not a single
    // enclosing panel wrapping a flat divided list.
    const cards = root.findAll(n => typeof n.type === 'string' && n.props && n.props.style && flat(n).borderRadius === 24 && flat(n).overflow === 'hidden');
    expect(cards.length).toBe(2);
    for (const card of cards) {
      const style = flat(card);
      expect(style.backgroundColor).toBe(LightColors.card);
      expect(style.borderWidth).toBe(1);
      expect(style.borderColor).toBe(LightColors.cardBorder);
    }

    // No shared row-divider chrome (colors.divider) links the cards together.
    const dividedRows = root.findAll(n => typeof n.type === 'string' && n.props && n.props.style && flat(n).borderBottomColor === LightColors.divider);
    expect(dividedRows.length).toBe(0);

    // The cards are separated by ordinary shell spacing (a `gap` container),
    // not nested inside one tinted collection bar.
    expect(root.findAll(n => n.props && n.props.style && flat(n).backgroundColor === LightColors.subtleBg).length).toBe(0);
  });

  test('the collection disclosure is a lightweight text-plus-glyph control, not a bordered panel header', () => {
    const root = render_(false);
    const toggle = root.findAll(n => n.props && n.props.accessibilityLabel === 'Show routines')[0];
    expect(toggle).toBeTruthy();
    const style = flat(toggle);
    // No panel-equivalent chrome on the toggle itself: no border, no tinted
    // background, no rounded card radius.
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
    expect(style.borderRadius).toBeUndefined();
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });
});

// #711: the two behavior changes, and the relocation contract for the
// non-current card. Everything else in this issue moves controls without
// changing what they do.
describe('Log action hierarchy (#711)', () => {
  const { LogActiveRoutineCard } = require('../components/LogActiveRoutineCard');

  const renderActiveCard = (overrides = {}) => {
    const props = {
      workoutNoteTitle: 'My Routine',
      hasABWeeks: false,
      effectiveActiveWeek: 'A',
      handleToggleWeek: jest.fn(),
      enterCurrentEditor: jest.fn(),
      handleNoteBodyPress: jest.fn(),
      handleSkipWeek: jest.fn(),
      handleUnskipWeek: jest.fn(),
      canUnskipWeek: false,
      toggleCollapsed: jest.fn(),
      isCollapsed: false,
      dayGroups: [],
      trackedLifts: {},
      handleToggleTrack: jest.fn(),
      roughNoteId: 'n1',
      currentId: 'n1',
      roughFlaggedNames: new Set(),
      activeEditText: '',
      ...overrides,
    };
    let component;
    render.act(() => { component = render.create(<LogActiveRoutineCard {...props} />); });
    return { root: component.root, props };
  };

  const textNodes = (root, exact) =>
    root.findAll(n => n.type === 'Text' && n.props.children === exact);

  // Behavior change 1. Both controls used to render unconditionally, with
  // `canUnskipWeek` only dimming "Remove skip" to opacity 0.4 over already-muted
  // text — two contradictory-looking controls, and a disabled state carried by
  // opacity alone. The state now decides which single control exists.
  describe('mutually exclusive skip control', () => {
    test('with nothing to unskip, only "Skip week" is on screen', () => {
      const { root, props } = renderActiveCard({ canUnskipWeek: false });
      expect(textNodes(root, 'Skip week').length).toBe(1);
      expect(textNodes(root, 'Remove skip').length).toBe(0);

      const skipBtn = pressableAround(root, t => t === 'Skip week');
      expect(skipBtn.props.accessibilityRole).toBe('button');
      expect(skipBtn.props.accessibilityState).toBeUndefined();
      render.act(() => { skipBtn.props.onPress({ stopPropagation: jest.fn() }); });
      expect(props.handleSkipWeek).toHaveBeenCalledTimes(1);
      expect(props.handleUnskipWeek).not.toHaveBeenCalled();
    });

    test('with a trailing skip present, only "Remove skip" is on screen', () => {
      const { root, props } = renderActiveCard({ canUnskipWeek: true });
      expect(textNodes(root, 'Remove skip').length).toBe(1);
      expect(textNodes(root, 'Skip week').length).toBe(0);

      const unskipBtn = pressableAround(root, t => t === 'Remove skip');
      // No opacity-only disabled state left to carry: the control is either
      // present and live, or absent.
      const style = Array.isArray(unskipBtn.props.style)
        ? Object.assign({}, ...unskipBtn.props.style)
        : (unskipBtn.props.style || {});
      expect(style.opacity).toBeUndefined();
      expect(unskipBtn.props.disabled).toBeFalsy();
      render.act(() => { unskipBtn.props.onPress({ stopPropagation: jest.fn() }); });
      expect(props.handleUnskipWeek).toHaveBeenCalledTimes(1);
      expect(props.handleSkipWeek).not.toHaveBeenCalled();
    });

    test('neither control renders when the screen supplies no skip handlers', () => {
      const { root } = renderActiveCard({ handleSkipWeek: undefined, handleUnskipWeek: undefined, canUnskipWeek: true });
      expect(textNodes(root, 'Skip week').length).toBe(0);
      expect(textNodes(root, 'Remove skip').length).toBe(0);
    });
  });

  describe('active card action strip', () => {
    test('the Week A/B switch moved out of the header into the strip and still toggles', () => {
      const { root, props } = renderActiveCard({ hasABWeeks: true, effectiveActiveWeek: 'A' });
      const header = pressableAround(root, t => t.includes('Current routine'));
      expect(header.findAll(n => n !== header && n.props && typeof n.props.onPress === 'function').length).toBe(0);

      const weekBtn = pressableAround(root, t => t === 'Week B');
      expect(weekBtn.props.accessibilityLabel).toBe('Switch to Week B');
      expect(weekBtn.props.accessibilityState).toEqual({ selected: false });
      render.act(() => { weekBtn.props.onPress({ stopPropagation: jest.fn() }); });
      expect(props.handleToggleWeek).toHaveBeenCalledTimes(1);
      expect(props.toggleCollapsed).not.toHaveBeenCalled();
    });

    test('a routine with no A/B weeks shows no week switch', () => {
      const { root } = renderActiveCard({ hasABWeeks: false });
      expect(pressableAround(root, t => t === 'Week B')).toBeNull();
      expect(pressableAround(root, t => t === 'Week A')).toBeNull();
    });

    test('the retired "Double-tap to edit" hint is gone but the gesture is still wired', () => {
      const { root, props } = renderActiveCard();
      expect(root.findAll(n => n.type === 'Text' && String(n.props.children).includes('Double-tap')).length).toBe(0);
      const body = pressableAround(root, t => t === 'Skip week', 2);
      render.act(() => { body.props.onPress(); });
      expect(props.handleNoteBodyPress).toHaveBeenCalledTimes(1);
    });

    test('the strip is hidden with the body when the card is collapsed', () => {
      const { root } = renderActiveCard({ isCollapsed: true, hasABWeeks: true });
      const body = pressableAround(root, t => t === 'Skip week', 2);
      const style = Array.isArray(body.props.style)
        ? Object.assign({}, ...body.props.style.filter(Boolean))
        : body.props.style;
      expect(style.display).toBe('none');
    });
  });

  describe('non-current card: secondary actions live in the expanded body', () => {
    const note = { id: 'r1', title: 'Routine 1', raw_text: 'MONDAY\n-Squat 3x5\n---\nMONDAY\n-Deadlift 3x5\n', updated_at: '2026-01-01T00:00:00.000Z' };

    const renderList = (overrides = {}) => {
      const props = {
        otherNotes: [note],
        handleViewOtherNote: jest.fn(),
        viewingNoteId: 'r1',
        viewingNote: note,
        viewingNoteDayGroups: [],
        viewingHasABWeeks: true,
        viewingEffectiveWeek: 'A',
        handleToggleViewingWeek: jest.fn(),
        handleSwitchCurrent: jest.fn(),
        handleEditViewedNote: jest.fn(),
        handleDeleteRoutine: jest.fn(),
        handleCreateRoutine: jest.fn(),
        ...overrides,
      };
      let component;
      render.act(() => { component = render.create(<ControlledPreviousRoutines {...props} />); });
      const root = component.root;
      // Routine management is collapsed by default (#724); open it so the card
      // and its expanded-body controls are mounted.
      expandRoutineManagement(root);
      return { root, props };
    };

    test('every relocated action is reachable once the card is expanded, and calls its own handler', () => {
      const { root, props } = renderList();

      const setCurrent = pressableAround(root, t => t === 'Set as current routine');
      expect(setCurrent).toBeTruthy();
      render.act(() => { setCurrent.props.onPress(); });
      expect(props.handleSwitchCurrent).toHaveBeenCalledWith('r1');

      const weekBtn = pressableAround(root, t => t === 'Week B');
      expect(weekBtn.props.accessibilityLabel).toBe('Switch to Week B');
      expect(weekBtn.props.accessibilityState).toEqual({ selected: false });
      render.act(() => { weekBtn.props.onPress(); });
      expect(props.handleToggleViewingWeek).toHaveBeenCalledTimes(1);

      render.act(() => { pressableAround(root, t => t === 'Edit routine').props.onPress(); });
      expect(props.handleEditViewedNote).toHaveBeenCalledTimes(1);

      render.act(() => { pressableAround(root, t => t === 'Delete routine').props.onPress(); });
      expect(props.handleDeleteRoutine).toHaveBeenCalledWith('r1', 'Routine 1', false);
    });

    test('a collapsed card exposes none of them', () => {
      const { root } = renderList({ viewingNoteId: null, viewingNote: null });
      for (const label of ['Set as current routine', 'Week B', 'Edit routine', 'Delete routine']) {
        expect(pressableAround(root, t => t === label)).toBeNull();
      }
    });

    test('an expanded routine with no A/B weeks shows no week switch among its actions', () => {
      const { root } = renderList({ viewingHasABWeeks: false, viewingEffectiveWeek: null });
      expect(pressableAround(root, t => t === 'Week B')).toBeNull();
      expect(pressableAround(root, t => t === 'Set as current routine')).toBeTruthy();
    });
  });
});

// #756: New Note and set-current-routine stop being gated behind expansion.
// The header's `+ New routine` action gains a compact header-level twin that
// is present whether the disclosure is collapsed or expanded, and every
// collapsed (unopened) non-current row gains its own compact `Set as current
// routine` action, so switching never requires opening a row and scrolling to
// its expand-on-tap body. Existing safeguards are untouched: both quick
// actions call straight through to the same handlers (`handleCreateRoutine`,
// `handleSwitchCurrent`) that already own confirmation/eligibility.
describe('LogPreviousRoutines: compact New Note and set-current actions (#756)', () => {

  const notes = [
    { id: 'r1', title: 'Routine One', updated_at: '2026-01-01T00:00:00.000Z' },
    { id: 'r2', title: 'Routine Two', updated_at: '2026-01-02T00:00:00.000Z' },
  ];

  const baseProps = {
    otherNotes: notes,
    handleViewOtherNote: jest.fn(),
    viewingNoteId: null,
    viewingNote: null,
    viewingNoteDayGroups: [],
    viewingHasABWeeks: false,
    viewingEffectiveWeek: null,
    handleToggleViewingWeek: jest.fn(),
    handleEditViewedNote: jest.fn(),
    handleDeleteRoutine: jest.fn(),
  };

  const renderList = (overrides = {}) => {
    const props = { ...baseProps, handleSwitchCurrent: jest.fn(), handleCreateRoutine: jest.fn(), ...overrides };
    let component;
    render.act(() => { component = render.create(<ControlledPreviousRoutines {...props} />); });
    return { root: component.root, props };
  };

  test('the header New Note affordance calls handleCreateRoutine without toggling the disclosure', () => {
    const { root, props } = renderList();
    const headerButton = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'New routine' && typeof n.props.onPress === 'function'
    )[0];
    expect(headerButton).toBeTruthy();

    render.act(() => { headerButton.props.onPress({ stopPropagation: jest.fn() }); });
    expect(props.handleCreateRoutine).toHaveBeenCalledTimes(1);
    // Still collapsed: the disclosure toggle was not fired by the nested press.
    const toggle = root.findAll(n => n.props && n.props.accessibilityLabel === 'Show routines')[0];
    expect(toggle).toBeTruthy();
  });

  // The icon-only per-row quick action is gone (#843): `Set as current
  // routine` is reachable only from a row's own expanded body now, alongside
  // Edit routine and Delete routine.
  test('a collapsed row exposes no icon-only set-current action', () => {
    const { root } = renderList();
    expandRoutineManagement(root);

    expect(root.findAll(
      n => n.props && typeof n.props.accessibilityLabel === 'string'
        && n.props.accessibilityLabel.startsWith('Set as current routine:')
    ).length).toBe(0);
  });

  test('opening a row reveals `Set as current routine` in its expanded body', () => {
    const note = notes[0];
    const { root, props } = renderList({ viewingNoteId: note.id, viewingNote: note });
    expandRoutineManagement(root);

    const setCurrent = pressableAround(root, t => t === 'Set as current routine');
    expect(setCurrent).toBeTruthy();
    render.act(() => { setCurrent.props.onPress(); });
    expect(props.handleSwitchCurrent).toHaveBeenCalledWith('r1');
  });

  // PR #760 review: a nested Pressable is grouped into its accessible ancestor
  // by VoiceOver, making it unreachable as its own action. `New routine` must
  // be a sibling of the toggle it sits beside, not a child of it.
  test('the New routine control is not nested inside another accessible Pressable', () => {
    const { root } = renderList();
    expandRoutineManagement(root);

    const isOwnAncestorButton = (node, ownLabel) => {
      let ancestor = node.parent;
      while (ancestor) {
        if (
          ancestor.props
          && ancestor.props.accessibilityRole === 'button'
          && typeof ancestor.props.onPress === 'function'
          && ancestor.props.accessibilityLabel !== ownLabel
        ) {
          return true;
        }
        ancestor = ancestor.parent;
      }
      return false;
    };

    const headerButton = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'New routine' && typeof n.props.onPress === 'function'
    )[0];
    expect(isOwnAncestorButton(headerButton, 'New routine')).toBe(false);
  });
});

// Regression #5: the extracted viewed-note body handler was stubbed to a no-op,
// killing double-tap-to-edit on saved routines. This pins the restored 300ms
// double-tap that opens the routine in the editor.
describe('LogPreviousRoutines: double-tap viewed routine opens editor', () => {

  test('two quick taps on the viewed body call handleEditViewedNote; one tap does not', () => {
    const handleEditViewedNote = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={[{ id: 'r1', title: 'Routine 1', raw_text: 'x' }]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId="r1"
          viewingNote={{ id: 'r1', title: 'Routine 1', raw_text: 'x' }}
          viewingNoteDayGroups={[]}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={handleEditViewedNote}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
        />
      );
    });
    const root = component.root;
    expandRoutineManagement(root);
    // The visible "Double-tap to edit" hint is gone (#724); the body Pressable
    // is now located by its empty-content text, and the gesture still works.
    const body = pressableAround(root, t => t.includes('No exercises to display'));
    expect(body).toBeTruthy();

    render.act(() => { body.props.onPress(); });
    expect(handleEditViewedNote).not.toHaveBeenCalled(); // single tap is a no-op

    render.act(() => { body.props.onPress(); }); // second tap within 300ms
    expect(handleEditViewedNote).toHaveBeenCalledTimes(1);
  });
});

describe('LogPreviousRoutines: Week A/B control on an expanded non-current routine (#687)', () => {

  test('an expanded non-current A/B routine shows a Week toggle with an accessible label and role', () => {
    const handleToggleViewingWeek = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={[{ id: 'r1', title: 'Routine 1', raw_text: 'MONDAY\n-Squat 3x5\n---\nMONDAY\n-Deadlift 3x5\n' }]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId="r1"
          viewingNote={{ id: 'r1', title: 'Routine 1', raw_text: 'MONDAY\n-Squat 3x5\n---\nMONDAY\n-Deadlift 3x5\n' }}
          viewingNoteDayGroups={[]}
          viewingHasABWeeks={true}
          viewingEffectiveWeek="A"
          handleToggleViewingWeek={handleToggleViewingWeek}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
        />
      );
    });

    const root = component.root;
    expandRoutineManagement(root);
    const toggle = pressableAround(root, t => t.includes('Week B'));
    expect(toggle).toBeTruthy();
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityLabel).toBe('Switch to Week B');
    expect(toggle.props.accessibilityState).toEqual({ selected: false });

    render.act(() => { toggle.props.onPress({ stopPropagation: jest.fn() }); });
    expect(handleToggleViewingWeek).toHaveBeenCalledTimes(1);
  });

  test('a non-current routine without a standalone --- shows no Week toggle', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={[{ id: 'r1', title: 'Routine 1', raw_text: 'MONDAY\n-Squat 3x5\n' }]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId="r1"
          viewingNote={{ id: 'r1', title: 'Routine 1', raw_text: 'MONDAY\n-Squat 3x5\n' }}
          viewingNoteDayGroups={[]}
          viewingHasABWeeks={false}
          viewingEffectiveWeek={null}
          handleToggleViewingWeek={jest.fn()}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
        />
      );
    });

    const root = component.root;
    expandRoutineManagement(root);
    const weekTexts = root.findAll(
      n => n.type === 'Text' && Array.isArray(n.props.children) && n.props.children[0] === 'Week '
    );
    expect(weekTexts.length).toBe(0);
  });
});

// #724 Contain and Connect: routine management is a collapsed-by-default
// disclosure (count + latest summary + chevron), and the single Start recovery
// block entry point lives inside its expanded body. Jest's renderer cannot
// measure Yoga layout, so these pin the render/props contract; the multi-width
// and light/dark visual checks in the acceptance criteria require manual review.
describe('LogPreviousRoutines: collapsed routine management (#724)', () => {

  const baseProps = {
    handleViewOtherNote: jest.fn(),
    viewingNoteId: null,
    viewingNote: null,
    viewingNoteDayGroups: [],
    viewingHasABWeeks: false,
    viewingEffectiveWeek: null,
    handleToggleViewingWeek: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleEditViewedNote: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    handleCreateRoutine: jest.fn(),
  };

  const renderList = (overrides = {}) => {
    let component;
    render.act(() => { component = render.create(<ControlledPreviousRoutines {...baseProps} {...overrides} />); });
    return component.root;
  };

  // The count is `More Routines · {count}` (#843) — the section title itself
  // — always visible outside the panel, expanded or collapsed.
  const countText = (root) =>
    root.findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && /^More Routines · \d+$/.test(n.props.children))
      .map(n => n.props.children);

  const latestLineCount = (root) =>
    root.findAll(
      n => n.type === 'Text' && Array.isArray(n.props.children) && n.props.children[0] === 'Latest: '
    ).length;

  const headerFor = (root) => root.findAll(
    n => n.props
      && (n.props.accessibilityLabel === 'Show routines'
        || n.props.accessibilityLabel === 'Hide routines')
      && typeof n.props.onPress === 'function'
  )[0];

  test('zero non-current routines: a plural-zero count, no latest line, and the New routine control always reachable (#836, #843)', () => {
    const root = renderList({ otherNotes: [] });
    expect(countText(root)).toEqual(['More Routines · 0']);
    expect(latestLineCount(root)).toBe(0);
    // The section's one create-routine affordance is present collapsed too
    // (#836) — it no longer requires expanding the disclosure first.
    expect(findPressableByText(root, 'New routine')).toBeTruthy();
  });

  test('one non-current routine: the count still reads "More Routines · 1" with no latest line (#836, #843)', () => {
    const root = renderList({ otherNotes: [{ id: 'r1', title: 'Only One', updated_at: '2026-01-01T00:00:00.000Z' }] });
    expect(countText(root)).toEqual(['More Routines · 1']);
    expect(latestLineCount(root)).toBe(0);
  });

  test('many routines: the count reflects the list regardless of order, with no latest line (#836, #843)', () => {
    const root = renderList({ otherNotes: [
      { id: 'r1', title: 'Older', saved_at: '2026-01-01T00:00:00.000Z' },
      { id: 'r2', title: 'Newest', saved_at: '2026-03-01T00:00:00.000Z' },
      { id: 'r3', title: 'Middle', saved_at: '2026-02-01T00:00:00.000Z' },
    ] });
    expect(countText(root)).toEqual(['More Routines · 3']);
    expect(latestLineCount(root)).toBe(0);
  });

  test('the header toggles expansion and announces its state; the count and New routine stay visible either way (#836, #843)', () => {
    const root = renderList({ otherNotes: [{ id: 'r1', title: 'One', updated_at: '2026-01-01T00:00:00.000Z' }] });
    expect(headerFor(root).props.accessibilityState).toEqual({ expanded: false });
    expect(countText(root)).toEqual(['More Routines · 1']);
    expect(findPressableByText(root, 'New routine')).toBeTruthy();

    render.act(() => { headerFor(root).props.onPress(); });
    expect(headerFor(root).props.accessibilityState).toEqual({ expanded: true });
    expect(findPressableByText(root, 'New routine')).toBeTruthy();
    // Unlike the former in-header summary, the count lives outside the
    // disclosure entirely now, so it is unaffected by expansion.
    expect(countText(root)).toEqual(['More Routines · 1']);

    render.act(() => { headerFor(root).props.onPress(); });
    expect(headerFor(root).props.accessibilityState).toEqual({ expanded: false });
    expect(countText(root)).toEqual(['More Routines · 1']);
  });

  test('the disclosure header keeps a 44dp touch target when collapsed-empty and when expanded (#724 review)', () => {
    const flat = (node) => (Array.isArray(node.props.style)
      ? Object.assign({}, ...node.props.style.filter(Boolean))
      : node.props.style) || {};

    // Collapsed with zero routines — the sparsest header — still ≥44dp.
    const empty = renderList({ otherNotes: [] });
    expect(flat(headerFor(empty)).minHeight).toBeGreaterThanOrEqual(44);

    // Expanded, where the header holds only the chevron, still ≥44dp.
    const one = renderList({ otherNotes: [{ id: 'r1', title: 'One', updated_at: '2026-01-01T00:00:00.000Z' }] });
    render.act(() => { headerFor(one).props.onPress(); });
    expect(flat(headerFor(one)).minHeight).toBeGreaterThanOrEqual(44);
  });
});

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

  test('Log withholds both specialized save controls while the current note is saving', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../screens/LogScreen.js'),
      'utf8'
    );
    expect(src).toMatch(/handleSkipWeek=\{currentEditor\.isSaving \? undefined : currentEditor\.handleSkipWeek\}/);
    expect(src).toMatch(/handleUnskipWeek=\{currentEditor\.isSaving \? undefined : currentEditor\.handleUnskipWeek\}/);
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
    expect(getLatest().hook.skipWeekStatus).toBe('Finishing the previous save — try again');

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
    expect(getLatest().hook.skipWeekStatus).toBe('Could not save skip — try again');
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
    expect(getLatest().hook.skipWeekStatus).toBe('Could not save skip — try again');

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
    expect(getLatest().hook.skipWeekStatus).toBe('Could not remove skip — try again');

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

// ── Android Back ownership (#527): the shell holds one back-consumer slot;
// LogScreen must claim it through registerBackConsumer (not BackHandler
// directly) and only while it is the active tab, so a hidden Log editor
// cannot outrace the visible tab after a tab switch.
describe('Android Back routes through registerBackConsumer, gated by isActive (#527)', () => {
  let mockUpdateNote;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateNote = jest.fn().mockResolvedValue({});
    const currentNote = {
      id: 'note1',
      title: 'Routine A',
      raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote],
      currentId: 'note1',
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
  });

  test('registers a back consumer while the Log tab is active and unregisters when it becomes inactive', () => {
    let unregister;
    const registerBackConsumer = jest.fn(() => {
      unregister = jest.fn();
      return unregister;
    });

    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen isActive={true} registerBackConsumer={registerBackConsumer} />
      );
    });
    expect(registerBackConsumer).toHaveBeenCalledTimes(1);

    render.act(() => {
      component.update(
        <ControlledLogScreen isActive={false} registerBackConsumer={registerBackConsumer} />
      );
    });
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  test('does not register a back consumer while the Log tab is inactive', () => {
    const registerBackConsumer = jest.fn(() => jest.fn());
    render.act(() => {
      render.create(
        <ControlledLogScreen isActive={false} registerBackConsumer={registerBackConsumer} />
      );
    });
    expect(registerBackConsumer).not.toHaveBeenCalled();
  });

  test('the registered consumer finishes the current-routine editor through its Done path and consumes Back', async () => {
    let capturedConsumer;
    const registerBackConsumer = jest.fn((consumer) => {
      capturedConsumer = consumer;
      return jest.fn();
    });

    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen isActive={true} registerBackConsumer={registerBackConsumer} />
      );
    });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Edit').props.onPress({ stopPropagation: jest.fn() }); });
    // The editor's ScreenShell mounts unconditionally (toggled via display:none), so
    // its own "Done" control stays in the tree; the read view's inline "Edit" control
    // is the one that is conditionally rendered on mode, so its absence/return is the
    // reliable edit/read-mode signal here.
    expect(findPressableByText(root, 'Edit')).toBeNull();

    let handled;
    await render.act(async () => { handled = capturedConsumer(); });

    expect(handled).toBe(true);
    expect(findPressableByText(root, 'Edit')).toBeTruthy();
  });

  test('the registered consumer returns false with no active editor state, letting the shell fall back to Home', () => {
    let capturedConsumer;
    const registerBackConsumer = jest.fn((consumer) => {
      capturedConsumer = consumer;
      return jest.fn();
    });

    render.act(() => {
      render.create(
        <ControlledLogScreen isActive={true} registerBackConsumer={registerBackConsumer} />
      );
    });

    expect(capturedConsumer()).toBe(false);
  });
});

// ── syntax-sensitive input autocorrect/autocapitalize/spellcheck disabled ──────

import { Modal } from 'react-native';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';
import { LogDeloadSection } from '../components/LogDeloadSection';

describe('LogScreenEditorCard syntax-sensitive inputs have autocorrect disabled', () => {
  const mockHandlers = {
    handleSaveDeload: jest.fn(),
    handleCurrentTextChange: jest.fn(),
    handleSaveOtherNote: jest.fn(),
    handleSave: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleDeleteDeloadNoteFromEditor: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    setDeloadEditText: jest.fn(),
    setEditingTitle: jest.fn(),
    setWorkoutNoteTitle: jest.fn(),
    setDeloadEditDate: jest.fn(),
    setShowDeloadDatePicker: jest.fn(),
    setDeloadEditOrdinal: jest.fn(),
    setEditingText: jest.fn(),
  };

  test('deload note TextInput has autoCorrect={false}, autoCapitalize="none", spellCheck={false}', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogScreenEditorCard
          deloadMode="edit"
          deloadEditText="test deload"
          isSaving={false}
          saveSuccess={false}
          editingNoteId={null}
          isEditingDeloadNote={false}
          workoutNoteTitle="Test"
          editingTitle=""
          editingDeloadHasLinkedRecord={false}
          deloadEditDate=""
          deloadEditOrdinal=""
          showDeloadDatePicker={false}
          editingNote={null}
          editingText=""
          activeEditText="test"
          currentId={null}
          {...mockHandlers}
        />
      );
    });
    const root = component.root;
    const textInputs = root.findAllByType('TextInput');

    // Find the deload note input (first TextInput in deload edit mode)
    const deloadNoteInput = textInputs.find(ti =>
      ti.props.value === 'test deload' && ti.props.multiline
    );
    expect(deloadNoteInput).toBeTruthy();
    expect(deloadNoteInput.props.autoCorrect).toBe(false);
    expect(deloadNoteInput.props.autoCapitalize).toBe('none');
    expect(deloadNoteInput.props.spellCheck).toBe(false);
  });

  test('routine title TextInput has autoCorrect={false}, autoCapitalize="none", spellCheck={false}', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogScreenEditorCard
          deloadMode="read"
          deloadEditText=""
          isSaving={false}
          saveSuccess={false}
          editingNoteId={null}
          isEditingDeloadNote={false}
          workoutNoteTitle="Test Routine"
          editingTitle=""
          editingDeloadHasLinkedRecord={false}
          deloadEditDate=""
          deloadEditOrdinal=""
          showDeloadDatePicker={false}
          editingNote={null}
          editingText=""
          activeEditText="test"
          currentId={null}
          {...mockHandlers}
        />
      );
    });
    const root = component.root;
    const textInputs = root.findAllByType('TextInput');

    // Find the title input
    const titleInput = textInputs.find(ti =>
      ti.props.placeholder && ti.props.placeholder.includes('Routine Name')
    );
    expect(titleInput).toBeTruthy();
    expect(titleInput.props.autoCorrect).toBe(false);
    expect(titleInput.props.autoCapitalize).toBe('none');
    expect(titleInput.props.spellCheck).toBe(false);
  });

  test('main workout note TextInput has autoCorrect={false}, autoCapitalize="none", spellCheck={false}', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogScreenEditorCard
          deloadMode="read"
          deloadEditText=""
          isSaving={false}
          saveSuccess={false}
          editingNoteId={null}
          isEditingDeloadNote={false}
          workoutNoteTitle="Test"
          editingTitle=""
          editingDeloadHasLinkedRecord={false}
          deloadEditDate=""
          deloadEditOrdinal=""
          showDeloadDatePicker={false}
          editingNote={null}
          editingText=""
          activeEditText="Monday\n+Lifting\n-Bench\n135 5,5,5"
          currentId={null}
          {...mockHandlers}
        />
      );
    });
    const root = component.root;
    const textInputs = root.findAllByType('TextInput');

    // Should find title and main note TextInputs
    expect(textInputs.length).toBeGreaterThanOrEqual(2);

    // Find the main note editor: the multiline TextInput that's not the title
    // Title has placeholder "Routine Name", main note has the example placeholder
    const noteInput = textInputs.find(ti =>
      ti.props.multiline && (!ti.props.placeholder || !ti.props.placeholder.includes('Routine Name'))
    );

    expect(noteInput).toBeTruthy();
    expect(noteInput.props.autoCorrect).toBe(false);
    expect(noteInput.props.autoCapitalize).toBe('none');
    expect(noteInput.props.spellCheck).toBe(false);
  });

  test('deload session number TextInput has autoCorrect={false}, autoCapitalize="none", spellCheck={false}', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogScreenEditorCard
          deloadMode="read"
          deloadEditText=""
          isSaving={false}
          saveSuccess={false}
          editingNoteId={null}
          isEditingDeloadNote={true}
          workoutNoteTitle="Test"
          editingTitle="Deload: 2026-07-23"
          editingDeloadHasLinkedRecord={true}
          deloadEditDate="2026-07-23"
          deloadEditOrdinal="5"
          showDeloadDatePicker={false}
          editingNote={null}
          editingText=""
          activeEditText=""
          currentId={null}
          {...mockHandlers}
        />
      );
    });
    const root = component.root;

    // Reveal the compact "Date · <value>" secondary row (#764) so the Session #
    // field (shown alongside the date once revealed) is on screen.
    const dateToggle = findPressableByText(root, 'Date ·');
    expect(dateToggle).toBeTruthy();
    render.act(() => {
      dateToggle.props.onPress();
    });

    const textInputs = root.findAllByType('TextInput');

    // Find the session number input
    const sessionInput = textInputs.find(ti =>
      ti.props.placeholder === 'Session number' && ti.props.keyboardType === 'number-pad'
    );
    expect(sessionInput).toBeTruthy();
    expect(sessionInput.props.autoCorrect).toBe(false);
    expect(sessionInput.props.autoCapitalize).toBe('none');
    expect(sessionInput.props.spellCheck).toBe(false);
  });
});

// ── editor-reachable workout syntax help (#584) ─────────────────────────────

describe('LogScreenEditorCard workout syntax help button', () => {
  const mockHandlers = {
    handleSaveDeload: jest.fn(),
    handleCurrentTextChange: jest.fn(),
    handleSaveOtherNote: jest.fn(),
    handleSave: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleDeleteDeloadNoteFromEditor: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    setDeloadEditText: jest.fn(),
    setEditingTitle: jest.fn(),
    setWorkoutNoteTitle: jest.fn(),
    setDeloadEditDate: jest.fn(),
    setShowDeloadDatePicker: jest.fn(),
    setDeloadEditOrdinal: jest.fn(),
    setEditingText: jest.fn(),
  };

  function renderEditor(overrides = {}) {
    let component;
    render.act(() => {
      component = render.create(
        <LogScreenEditorCard
          deloadMode="read"
          deloadEditText=""
          isSaving={false}
          saveSuccess={false}
          editingNoteId={null}
          isEditingDeloadNote={false}
          workoutNoteTitle="Test"
          editingTitle=""
          editingDeloadHasLinkedRecord={false}
          deloadEditDate=""
          deloadEditOrdinal=""
          showDeloadDatePicker={false}
          editingNote={null}
          editingText=""
          activeEditText="Monday\n-Bench\n135 5,5,5"
          currentId={null}
          {...mockHandlers}
          {...overrides}
        />
      );
    });
    return component;
  }

  function findSyntaxHelpButton(root) {
    return root.findAll(
      node => node.props?.accessibilityLabel === 'Workout syntax help' && typeof node.props?.onPress === 'function'
    )[0];
  }

  test('a "Workout syntax help" button is reachable from the editor', () => {
    const component = renderEditor();
    const button = findSyntaxHelpButton(component.root);
    expect(button).toBeTruthy();
  });

  test('the standing bordered session-alignment block is gone (#863)', () => {
    const message = 'Uneven exercise histories do not line up: Bench — 2 entries; Deadlift — 1 entry.';
    const component = renderEditor({
      sessionAlignmentIssue: { code: 'uneven_session_entries', message },
    });
    expect(component.root.findAll(n => n.props?.testID === 'session-alignment-warning').length).toBe(0);
  });

  test('tapping the button opens the modal, and the close control closes it', () => {
    const component = renderEditor();
    const root = component.root;

    // Modal starts closed: WorkoutSyntaxModal returns null when not visible.
    expect(root.findAllByType(Modal).length).toBe(0);

    render.act(() => {
      findSyntaxHelpButton(root).props.onPress();
    });

    const modal = root.findByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(typeof modal.props.onRequestClose).toBe('function');

    const closeBtn = root.findAll(
      node => node.props?.accessibilityLabel === 'Close workout syntax help' && typeof node.props?.onPress === 'function'
    )[0];
    expect(closeBtn).toBeTruthy();

    render.act(() => {
      closeBtn.props.onPress();
    });

    expect(root.findAllByType(Modal).length).toBe(0);
  });

  test('Modal onRequestClose (Android back) also closes it without altering editor text', () => {
    const component = renderEditor();
    const root = component.root;

    render.act(() => {
      findSyntaxHelpButton(root).props.onPress();
    });

    render.act(() => {
      root.findByType(Modal).props.onRequestClose();
    });

    expect(root.findAllByType(Modal).length).toBe(0);
    expect(mockHandlers.handleCurrentTextChange).not.toHaveBeenCalled();
    expect(mockHandlers.setEditingText).not.toHaveBeenCalled();
  });

  test('opening and closing the syntax help modal preserves unsaved editor text', () => {
    const component = renderEditor({ activeEditText: 'Unsaved draft text\n-Squat\n' });
    const root = component.root;

    const noteInputBefore = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === 'Unsaved draft text\n-Squat\n');
    expect(noteInputBefore).toBeTruthy();

    render.act(() => {
      findSyntaxHelpButton(root).props.onPress();
    });
    render.act(() => {
      root.findByType(Modal).props.onRequestClose();
    });

    const noteInputAfter = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === 'Unsaved draft text\n-Squat\n');
    expect(noteInputAfter).toBeTruthy();
    expect(mockHandlers.handleCurrentTextChange).not.toHaveBeenCalled();
  });
});

// ── #863: quiet on-demand problem list in the Log editor ─────────────────────

describe('LogScreenEditorCard quiet on-demand problem list (#863)', () => {
  const { LightColors } = require('../theme/colors');

  const mockHandlers = {
    handleSaveDeload: jest.fn(),
    handleCurrentTextChange: jest.fn(),
    handleSaveOtherNote: jest.fn(),
    handleSave: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleDeleteDeloadNoteFromEditor: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    setDeloadEditText: jest.fn(),
    setEditingTitle: jest.fn(),
    setWorkoutNoteTitle: jest.fn(),
    setDeloadEditDate: jest.fn(),
    setShowDeloadDatePicker: jest.fn(),
    setDeloadEditOrdinal: jest.fn(),
    setEditingText: jest.fn(),
  };

  // Selecting a problem sets a one-shot forced selection (the same
  // mechanism the seed-example insert uses), which schedules a same-tick
  // cleanup timer. Unmounting after each test lets that timer fire against a
  // still-live tree instead of leaking past this test into a later one.
  const mounted = [];
  afterEach(() => {
    render.act(() => { mounted.forEach(c => c.unmount()); });
    mounted.length = 0;
  });

  function buildElement(overrides = {}) {
    return (
      <LogScreenEditorCard
        deloadMode="read"
        deloadEditText=""
        isSaving={false}
        saveSuccess={false}
        editingNoteId={null}
        isEditingDeloadNote={false}
        workoutNoteTitle="Test"
        editingTitle=""
        editingDeloadHasLinkedRecord={false}
        deloadEditDate=""
        deloadEditOrdinal=""
        showDeloadDatePicker={false}
        editingNote={null}
        editingText=""
        activeEditText=""
        currentId={null}
        currentMode="edit"
        editingEffectiveWeek={null}
        {...mockHandlers}
        {...overrides}
      />
    );
  }

  function renderEditor(overrides = {}) {
    let component;
    render.act(() => {
      component = render.create(buildElement(overrides));
    });
    mounted.push(component);
    return component;
  }

  function findByTestID(root, testID) {
    return root.findAll(n => n.props?.testID === testID)[0];
  }

  function findFlatStyle(node) {
    return [].concat(node.props.style).filter(Boolean).reduce((acc, s) => ({ ...acc, ...s }), {});
  }

  function rowLabels(root) {
    return findByTestID(root, 'editor-validation-list')
      .findAllByType('Text')
      .map(n => n.props.children);
  }

  function findFirstListRow(root) {
    return findByTestID(root, 'editor-validation-list')
      .findAll(n => typeof n.props?.onPress === 'function')[0];
  }

  function findListRowByPrefix(root, prefix) {
    return findByTestID(root, 'editor-validation-list')
      .findAll(n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel?.startsWith(prefix))[0];
  }

  // Advances the debounced recompute past VALIDATION_DEBOUNCE_MS so a prop
  // update (a simulated edit) is reflected in the problem list.
  function settleDebounce() {
    render.act(() => { jest.runAllTimers(); });
  }

  test('a clean note shows no badge and no bar', () => {
    const component = renderEditor({ activeEditText: 'Monday\n-Bench\n135 5,5,5' });
    expect(findByTestID(component.root, 'editor-validation-badge')).toBeFalsy();
    expect(findByTestID(component.root, 'editor-validation-bar')).toBeFalsy();
  });

  test('badge renders an outlined "!" and the total count, colored by the severity mix', () => {
    const errorOnly = renderEditor({ activeEditText: 'Monday\n-Bench\n135 8,,8' });
    let badge = findByTestID(errorOnly.root, 'editor-validation-badge');
    expect(badge).toBeTruthy();
    expect(badge.props.accessibilityLabel).toMatch(/^1 problem\./);
    const glyph = badge.findAllByType('Text')[0];
    expect(glyph.props.children).toBe('!');
    expect(findFlatStyle(glyph).color).toBe(LightColors.error);
    const count = badge.findAllByType('Text')[1];
    expect(count.props.children).toBe(1);
    expect(findFlatStyle(count).color).toBe(LightColors.error);

    const warningOnly = renderEditor({
      activeEditText: 'Monday\n-Bench\n- 135 5,5\n- 140 5,5\n-Deadlift\n- 225 5',
      sessionAlignmentIssue: {
        code: 'uneven_session_entries',
        message: 'placeholder',
        affectedExercises: [
          { name: 'Bench', entryCount: 2, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [] },
          { name: 'Deadlift', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2] },
        ],
      },
    });
    badge = findByTestID(warningOnly.root, 'editor-validation-badge');
    expect(findFlatStyle(badge.findAllByType('Text')[0]).color).toBe(LightColors.caution);

    const mixed = renderEditor({
      activeEditText: 'Monday\n-Bench\n135 8,,8\n- 140 5,5\n-Deadlift\n- 225 5',
      sessionAlignmentIssue: {
        code: 'uneven_session_entries',
        message: 'placeholder',
        affectedExercises: [
          { name: 'Deadlift', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2] },
        ],
      },
    });
    badge = findByTestID(mixed.root, 'editor-validation-badge');
    expect(findFlatStyle(badge.findAllByType('Text')[0]).color).toBe(LightColors.error);
  });

  test('tapping the badge opens the list; tapping it again closes it', () => {
    const component = renderEditor({ activeEditText: 'Monday\n-Bench\n135 8,,8' });
    const root = component.root;
    expect(findByTestID(root, 'editor-validation-list')).toBeFalsy();

    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    expect(findByTestID(root, 'editor-validation-list')).toBeTruthy();

    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    expect(findByTestID(root, 'editor-validation-list')).toBeFalsy();
  });

  test('list rows use human-readable context, never a visible line number', () => {
    const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
    const component = renderEditor({ activeEditText: text });
    render.act(() => { findByTestID(component.root, 'editor-validation-badge').props.onPress(); });
    const labels = rowLabels(component.root);
    expect(labels.length).toBeGreaterThan(0);
    labels.forEach(label => expect(label).not.toMatch(/\bLine \d/));
    expect(labels[0]).toMatch(/^Bench —/);
  });

  test('session alignment: only exercises with a missing position appear, one row per position', () => {
    const text = ['Monday', '-Bench', '- 135 5', '- 135 5', '- 135 5', '-Deadlift', '- 225 5'].join('\n');
    const component = renderEditor({
      activeEditText: text,
      sessionAlignmentIssue: {
        code: 'uneven_session_entries',
        message: 'placeholder',
        affectedExercises: [
          { name: 'Bench', entryCount: 3, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [] },
          { name: 'Deadlift', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2, 3] },
        ],
      },
    });
    render.act(() => { findByTestID(component.root, 'editor-validation-badge').props.onPress(); });
    const labels = rowLabels(component.root);
    expect(labels).toEqual([
      'Monday · Deadlift — session 2 has no entry',
      'Monday · Deadlift — session 3 has no entry',
    ]);
  });

  test('selecting a syntax row closes the list, selects the malformed line, and shows the bar below the input', () => {
    const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
    const component = renderEditor({ activeEditText: text });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });

    const row = findFirstListRow(root);
    render.act(() => { row.props.onPress(); });

    expect(findByTestID(root, 'editor-validation-list')).toBeFalsy();
    const noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
    const expectedStart = 'Monday\n-Bench\n'.length;
    expect(noteInput.props.selection).toEqual({ start: expectedStart, end: expectedStart + '135 8,,8'.length });
    expect(mockHandlers.handleCurrentTextChange).not.toHaveBeenCalled();

    const bar = findByTestID(root, 'editor-validation-bar');
    expect(bar).toBeTruthy();
    expect(bar.findAllByType('Text')[0].props.children).toMatch(/^Bench —/);
  });

  test('selecting a missing-session row places the caret right after that exercise\'s existing entries', () => {
    const text = ['Monday', '-Bench', '- 135 5,5', '- 140 5,5', '-Deadlift', '- 225 5'].join('\n');
    const component = renderEditor({
      activeEditText: text,
      sessionAlignmentIssue: {
        code: 'uneven_session_entries',
        message: 'placeholder',
        affectedExercises: [
          { name: 'Deadlift', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2] },
        ],
      },
    });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    const row = findFirstListRow(root);
    render.act(() => { row.props.onPress(); });

    const noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
    // Deadlift is the last exercise with no trailing lines after it, so the
    // insertion point (mirroring the "Skip week" marker) lands at the very
    // end of the text.
    expect(noteInput.props.selection).toEqual({ start: text.length, end: text.length });

    const bar = findByTestID(root, 'editor-validation-bar');
    expect(bar.findAllByType('Text')[0].props.children).toBe('Monday · Deadlift — session 2 has no entry');
  });

  test('fixing the selected problem clears the bar on its own', () => {
    jest.useFakeTimers();
    try {
      const broken = ['Monday', '-Bench', '135 8,,8'].join('\n');
      const fixed = ['Monday', '-Bench', '135 8,8'].join('\n');
      const component = renderEditor({ activeEditText: broken });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const row = findFirstListRow(root);
      render.act(() => { row.props.onPress(); });
      expect(findByTestID(root, 'editor-validation-bar')).toBeTruthy();

      render.act(() => { component.update(buildElement({ activeEditText: fixed })); });
      settleDebounce();

      expect(findByTestID(root, 'editor-validation-bar')).toBeFalsy();
      expect(findByTestID(root, 'editor-validation-badge')).toBeFalsy();
    } finally {
      jest.useRealTimers();
    }
  });

  test('the bar stays attached to the same logical problem when lines shift above it, and other problems remain listed', () => {
    jest.useFakeTimers();
    try {
      const original = ['Monday', '-Bench', '135 8,,8', '-Squat', '225 5-8'].join('\n');
      const shifted = ['Monday', '-Row', '135 5,5', '-Bench', '135 8,,8', '-Squat', '225 5-8'].join('\n');
      const component = renderEditor({ activeEditText: original });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const benchRow = findListRowByPrefix(root, 'Bench —');
      render.act(() => { benchRow.props.onPress(); });
      const barBefore = findByTestID(root, 'editor-validation-bar').findAllByType('Text')[0].props.children;

      render.act(() => { component.update(buildElement({ activeEditText: shifted })); });
      settleDebounce();

      const barAfter = findByTestID(root, 'editor-validation-bar').findAllByType('Text')[0].props.children;
      expect(barAfter).toBe(barBefore);

      // The other, unfixed problem (Squat) is still reachable in the list.
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const labels = rowLabels(root);
      expect(labels.some(l => l.startsWith('Squat —'))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the FIRST edit after mount still debounces into an updated problem list (no skipped-debounce regression)', () => {
    jest.useFakeTimers();
    try {
      const clean = 'Monday\n-Bench\n135 5,5,5';
      const broken = 'Monday\n-Bench\n135 8,,8';
      const component = renderEditor({ activeEditText: clean });
      expect(findByTestID(component.root, 'editor-validation-badge')).toBeFalsy();

      // A single edit — the first (and only) prop change since mount.
      render.act(() => {
        component.update(buildElement({ activeEditText: broken }));
      });
      settleDebounce();

      expect(findByTestID(component.root, 'editor-validation-badge')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  test('leaving the editor (currentMode) clears the selected problem and closes the list', () => {
    const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
    const component = renderEditor({ activeEditText: text, currentMode: 'edit' });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    const row = findFirstListRow(root);
    render.act(() => { row.props.onPress(); });
    expect(findByTestID(root, 'editor-validation-bar')).toBeTruthy();

    render.act(() => { component.update(buildElement({ activeEditText: text, currentMode: 'read' })); });

    expect(findByTestID(root, 'editor-validation-bar')).toBeFalsy();
  });

  test('switching A/B week (editingEffectiveWeek) clears the selected problem and closes the list', () => {
    const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
    const component = renderEditor({
      editingNoteId: 'other-1',
      editingText: text,
      editingEffectiveWeek: 'A',
    });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    expect(findByTestID(root, 'editor-validation-list')).toBeTruthy();

    render.act(() => {
      component.update(buildElement({ editingNoteId: 'other-1', editingText: text, editingEffectiveWeek: 'B' }));
    });

    expect(findByTestID(root, 'editor-validation-list')).toBeFalsy();
  });

  test('dismissing the bar clears the selected problem without closing anything else', () => {
    const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
    const component = renderEditor({ activeEditText: text });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    const row = findFirstListRow(root);
    render.act(() => { row.props.onPress(); });
    const bar = findByTestID(root, 'editor-validation-bar');

    const dismiss = bar.findAll(n => n.props?.accessibilityLabel === 'Dismiss problem message')[0];
    render.act(() => { dismiss.props.onPress(); });

    expect(findByTestID(root, 'editor-validation-bar')).toBeFalsy();
  });

  test('the inline problem list persists taps while the keyboard is open (#863 review)', () => {
    const component = renderEditor({ activeEditText: 'Monday\n-Bench\n135 8,,8' });
    render.act(() => { findByTestID(component.root, 'editor-validation-badge').props.onPress(); });
    const list = findByTestID(component.root, 'editor-validation-list');
    expect(list.props.keyboardShouldPersistTaps).toBe('handled');
  });

  test('missing-session caret lands before a directly-following dash-header exercise, not inside it (#863 review)', () => {
    // Bench (the affected exercise) is immediately followed by "-Squat" with
    // no blank line between them — the inserted "-" marker line and "-Squat"
    // share a leading "-", which previously fooled a char-by-char scan into
    // landing the caret one character into "-Squat" instead of before it.
    const text = ['Monday', '-Bench', '- 135 5,5', '-Squat', '- 225 5,5', '- 230 5,5'].join('\n');
    const component = renderEditor({
      activeEditText: text,
      sessionAlignmentIssue: {
        code: 'uneven_session_entries',
        message: 'placeholder',
        affectedExercises: [
          { name: 'Bench', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2] },
        ],
      },
    });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    render.act(() => { findFirstListRow(root).props.onPress(); });

    const noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
    const expectedOffset = text.indexOf('-Squat');
    expect(noteInput.props.selection).toEqual({ start: expectedOffset, end: expectedOffset });
  });

  test('two rows with an identical diagnostic get distinct ids, and fixing one clears only its own selection (#863 review)', () => {
    jest.useFakeTimers();
    try {
      const text = ['Monday', '-Bench', '135 8,,8', '135 8,,8'].join('\n');
      const fixedSecond = ['Monday', '-Bench', '135 8,,8', '135 8,8'].join('\n');
      const component = renderEditor({ activeEditText: text });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const rows = findByTestID(root, 'editor-validation-list').findAll(n => typeof n.props?.onPress === 'function');
      expect(rows.length).toBe(2);

      // Select the SECOND occurrence — the one that's about to be fixed.
      render.act(() => { rows[1].props.onPress(); });
      expect(findByTestID(root, 'editor-validation-bar')).toBeTruthy();

      render.act(() => { component.update(buildElement({ activeEditText: fixedSecond })); });
      settleDebounce();

      // Its own bar clears, and the still-broken first occurrence remains
      // listed as exactly one problem (not silently reattached to it).
      expect(findByTestID(root, 'editor-validation-bar')).toBeFalsy();
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      expect(rowLabels(root).length).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('fixing the FIRST of two identical duplicates also clears its own selection, without reattaching to the second (#863 review)', () => {
    jest.useFakeTimers();
    try {
      const text = ['Monday', '-Bench', '135 8,,8', '135 8,,8'].join('\n');
      const fixedFirst = ['Monday', '-Bench', '135 8,8', '135 8,,8'].join('\n');
      const component = renderEditor({ activeEditText: text });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const rows = findByTestID(root, 'editor-validation-list').findAll(n => typeof n.props?.onPress === 'function');
      expect(rows.length).toBe(2);

      // Select the FIRST occurrence — the one that's about to be fixed. A
      // rank-based id would reassign the surviving second occurrence onto
      // this exact selection once the first is gone, so the bar would
      // wrongly stay up; an offset-from-the-exercise-header id must not.
      render.act(() => { rows[0].props.onPress(); });
      expect(findByTestID(root, 'editor-validation-bar')).toBeTruthy();

      render.act(() => { component.update(buildElement({ activeEditText: fixedFirst })); });
      settleDebounce();

      expect(findByTestID(root, 'editor-validation-bar')).toBeFalsy();
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      expect(rowLabels(root).length).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('LogDeloadSection deload ordinal input has autocorrect disabled', () => {
  test('deload ordinal modal TextInput has autoCorrect={false}, autoCapitalize="none", spellCheck={false}', () => {
    let component;
    const completeDeloadMock = jest.fn();

    render.act(() => {
      component = render.create(
        <LogDeloadSection
          deloadNote={{ raw_text: 'test deload' }}
          deloadLoading={false}
          deloadDayGroups={[]}
          enterDeloadEditor={jest.fn()}
          handleDeloadBodyPress={jest.fn()}
          deloadMode="read"
          completeDeload={completeDeloadMock}
          clearDeloadNote={jest.fn()}
          handleGenerateDeload={jest.fn()}
          isGenerating={false}
          workoutNoteText="test"
          saveError={null}
          deloadNotes={[]}
          deloadHistory={[]}
          deleteDeloadNote={jest.fn()}
          deleteDeload={jest.fn()}
          viewingNoteId={null}
          handleViewOtherNote={jest.fn()}
          viewingNote={null}
          viewingNoteDayGroups={[]}
          handleOpenOtherNote={jest.fn()}
          logSessionCount={5}
        />
      );
    });

    const root = component.root;

    // Find and click the "Deload complete" button to trigger the ordinal modal
    const deloadCompleteButton = root.findByProps({ title: 'Deload complete' });
    expect(deloadCompleteButton).toBeTruthy();

    render.act(() => {
      deloadCompleteButton.props.onPress();
    });

    // Find the ordinal TextInput in the modal (number-pad keyboard, ordinal input)
    const textInputs = root.findAllByType('TextInput');
    const ordinalInput = textInputs.find(ti =>
      ti.props.keyboardType === 'number-pad' && ti.props.selectTextOnFocus
    );

    expect(ordinalInput).toBeTruthy();
    expect(ordinalInput.props.autoCorrect).toBe(false);
    expect(ordinalInput.props.autoCapitalize).toBe('none');
    expect(ordinalInput.props.spellCheck).toBe(false);
  });
});

// #616: the read view surfaces parser rejection. Per-row unparsed records show
// a non-color-only affordance (glyph + message + a11y label); a note-level
// rejection renders a visible banner instead of a blank read view.
describe('#616: WorkoutContentRenderer surfaces parser errors', () => {
  const { WorkoutContentRenderer } = require('../components/WorkoutContentRenderer');

  function dayGroupsFor(note) {
    const { sections } = parseWorkoutNote(note);
    return [{ heading: null, sections }];
  }

  test('an unparsed row shows a ⚠ glyph, the parser message, and a recovery a11y label naming the raw line', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 100 x');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const root = component.root;
    // Non-color-only: a warning glyph accompanies the row.
    const glyphNodes = root.findAll(n => n.type === 'Text' && n.props.children === '⚠');
    expect(glyphNodes.length).toBeGreaterThan(0);
    // The actionable parser message is rendered.
    const hintNode = root.find(
      n => n.type === 'Text' && n.props.children === 'Invalid reps "x" — use: 8 or 8,8,8'
    );
    expect(hintNode).toBeTruthy();
    // An accessibility label names the raw line and the recovery message.
    const labeled = root.find(
      n => typeof n.props.accessibilityLabel === 'string' &&
           n.props.accessibilityLabel.startsWith('Unrecognized set row: 100 x.')
    );
    expect(labeled).toBeTruthy();
    expect(labeled.props.accessibilityLabel).toContain('Invalid reps "x"');
    // Raw text is preserved unchanged (not swallowed into the glyph string).
    expect(root.find(n => n.type === 'Text' && n.props.children === '100 x')).toBeTruthy();
  });

  test('a note-level rejection renders a labeled parse-failure banner instead of a blank read view', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={[]} noteError="Note text is too large to parse (200001 characters; limit 200000)." />
      );
    });
    const root = component.root;
    // The empty-state copy is suppressed in favor of the error banner.
    const emptyNodes = root.findAll(
      n => n.type === 'Text' && n.props.children === 'Add some exercises to see the formatted view.'
    );
    expect(emptyNodes.length).toBe(0);
    const banner = root.find(
      n => typeof n.props.accessibilityLabel === 'string' &&
           n.props.accessibilityLabel.startsWith('Note could not be parsed.')
    );
    expect(banner).toBeTruthy();
    const bannerText = root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.includes('too large to parse')
    );
    expect(bannerText).toBeTruthy();
    expect(bannerText.props.style.color).toBe(LightColors.error);
  });

  // #854/G5: cardio/non-weight exercises use the same row grammar as any
  // other exercise now, so a genuinely malformed row under one still gets
  // the ordinary error glyph — it is no longer special-cased silent.
  test('a malformed row under a non-weight exercise gets the ordinary error glyph', () => {
    const dayGroups = dayGroupsFor('-Treadmill\n- 5 min easy');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const root = component.root;
    const glyphNodes = root.findAll(n => n.type === 'Text' && n.props.children === '⚠');
    expect(glyphNodes.length).toBe(1);
    // The raw non-weight line is still rendered.
    expect(root.find(n => n.type === 'Text' && n.props.children === '5 min easy')).toBeTruthy();
  });

  // #854/G1-p: a bare integer with no governing header declaration renders
  // visibly with no ⚠ and no message — recognized but not structured data.
  test('a bare integer with no declaration renders with no error glyph', () => {
    const dayGroups = dayGroupsFor('-Bench\n225 5\n140');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const root = component.root;
    const glyphNodes = root.findAll(n => n.type === 'Text' && n.props.children === '⚠');
    expect(glyphNodes.length).toBe(0);
    expect(root.find(n => n.type === 'Text' && n.props.children === '140')).toBeTruthy();
  });

  // #854/G4: a duration set (header-declared, e.g. "3x30 sec") renders as
  // "Ns", not a bare/blank reps column.
  test('a duration set renders as "Ns"', () => {
    const dayGroups = dayGroupsFor('-Plank 3x30 sec\n45');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    expect(component.root.find(n => n.type === 'Text' && n.props.children === '45s')).toBeTruthy();
  });

  // #854/G7a: a "-- " line with no preceding valid entry (including no open
  // exercise) is retained as a section-level annotation, not dropped.
  test('a "-- " line with no open exercise renders as a preserved section note', () => {
    const dayGroups = dayGroupsFor('+Lifting\n-- felt strong today\n-Bench\n135 5');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    expect(component.root.find(n => n.type === 'Text' && n.props.children === 'felt strong today')).toBeTruthy();
  });

  // #854/G7c: a nonblank line with no open exercise is preserved as a
  // section-level annotation, never silently dropped.
  test('an orphan line with no open exercise renders as a preserved section note', () => {
    const dayGroups = dayGroupsFor('+Lifting\nfelt good warming up\n-Bench\n135 5');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    expect(component.root.find(n => n.type === 'Text' && n.props.children === 'felt good warming up')).toBeTruthy();
  });
});

// #616: end-to-end note-error transport. This drives a real oversize note from
// the store through useLogCurrentRoutineEditor → LogScreen → LogActiveRoutineCard
// → WorkoutContentRenderer and asserts the rendered parse-failure banner. Unlike
// the direct-render test above, it injects NO noteError prop, so it fails if the
// hook stops deriving noteError, LogScreen drops it, or the card fails to forward
// it — closing the transport gap flagged in review.
describe('#616: oversize note reaches the read-view failure affordance through the full path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const oversizeText = 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1);
    const currentNote = {
      id: 'note1',
      title: 'Routine A',
      raw_text: oversizeText,
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote],
      currentId: 'note1',
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn(),
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: true });
  });

  test('an oversize stored note renders the parse-failure banner in the current-routine read view', () => {
    const oversizeText = 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1);
    // Sanity: the note really is rejected at the parser boundary.
    expect(parseWorkoutNote(oversizeText).ok).toBe(false);

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen initialText={oversizeText} />);
    });
    const root = component.root;

    // The banner is reached only via hook-derived noteError threaded through the
    // real component tree — no noteError prop is injected anywhere here.
    const banner = root.find(
      n => typeof n.props.accessibilityLabel === 'string' &&
           n.props.accessibilityLabel.startsWith('Note could not be parsed.')
    );
    expect(banner).toBeTruthy();
    const bannerText = root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.includes('too large to parse')
    );
    expect(bannerText).toBeTruthy();

    // The blank-read-view empty state must not appear in its place.
    const emptyNodes = root.findAll(
      n => n.type === 'Text' && n.props.children === 'Add some exercises to see the formatted view.'
    );
    expect(emptyNodes.length).toBe(0);
  });
});

// ── LogEmptyState: shared syntax example regression tests (#585)
describe('LogEmptyState workout syntax example parses correctly (#585)', () => {
  // LogEmptyState is mocked at the top of this file for LogScreen tests; pull
  // the real module here so we validate the shipped component and its exports.
  const { LogEmptyState, WORKOUT_SYNTAX_EXAMPLE, WORKOUT_SYNTAX_ROWS } = jest.requireActual('../components/LogEmptyState');

  test('rendered rows are derived from the exact tested example string', () => {
    // Single source of truth: displayed rows must be the tested string split.
    expect(WORKOUT_SYNTAX_ROWS).toEqual(WORKOUT_SYNTAX_EXAMPLE.split('\n'));

    let component;
    render.act(() => {
      component = render.create(<LogEmptyState onCreateRoutine={jest.fn()} />);
    });
    const rendered = component.root.findAllByType('Text').map(t => {
      const child = t.props.children;
      return Array.isArray(child) ? child.join('') : String(child ?? '');
    });
    for (const row of WORKOUT_SYNTAX_EXAMPLE.split('\n')) {
      expect(rendered).toContain(row);
    }
  });

  test('example syntax parses without errors', () => {
    const result = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE);
    expect(result.ok).toBe(true);
  });

  test('example produces one section Monday/Lifting/Bench', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Monday');
    expect(sections[0].subheading).toBe('Lifting');
    expect(sections[0].exercises[0].name).toBe('Bench');
  });

  test('example has 3 session rows (135/140/145)', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE);
    const bench = sections[0].exercises[0];
    expect(bench.rows).toHaveLength(3);
    const sessionWeights = bench.rows.map(r => r.raw);
    expect(sessionWeights).toEqual(['135 5,5,5', '140 5,5', '145 5']);
  });

  test('example logs 6 total sets across 3 sessions', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE);
    const bench = sections[0].exercises[0];
    const totalSets = bench.rows.reduce((sum, r) => sum + r.sets.length, 0);
    expect(totalSets).toBe(6);
  });

  test('example has no unparsed entries', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE);
    const bench = sections[0].exercises[0];
    const unparsedEntries = bench.session_entries.filter(e => e.unparsed);
    expect(unparsedEntries).toHaveLength(0);
  });
});

describe('#583: App Guide analytics copy matches shipped surfaces', () => {
  const renderGuideTexts = () => {
    let component;
    render.act(() => {
      component = render.create(
        <MoreScreen
          onNavigate={jest.fn()}
          onExport={jest.fn()}
          onImport={jest.fn()}
          fatigueMultiplier={1}
          onUpdateFatigueMultiplier={jest.fn()}
         
          onUpdateWeightDateEditEnabled={jest.fn()}
          onUpdateDeloadDateEditEnabled={jest.fn()}
        />
      );
    });
    const root = component.root;
    render.act(() => {
      findPressableByText(root, 'App Guide').props.onPress();
    });
    return root.findAllByType('Text').map(t => {
      const child = t.props.children;
      return Array.isArray(child) ? child.join('') : String(child ?? '');
    });
  };

  test('describes real Analytics surfaces and drops unavailable-feature promises', () => {
    const texts = renderGuideTexts();
    const joined = texts.join('\n');

    // Corrected descriptions are present.
    expect(joined).toContain('Weight trend charts');
    expect(joined).toContain('combined Big 3');
    // Big 3 chart prerequisites: mapped lifts and enough complete cycles.
    expect(joined).toContain('mapped squat, bench, and deadlift');
    expect(joined).toContain('enough complete logged cycles');
    // Progressive Overload rows expose all four current metrics.
    expect(joined).toContain('Progressive Overload');
    expect(joined).toContain('Est. Max');
    expect(joined).toContain('Kilo Max');
    expect(joined).toContain('best set');
    expect(joined).toContain('progress trend');
    expect(joined).toContain('when fatigue tracking is enabled');

    // Removed promises of features Kilo does not ship.
    expect(joined).not.toContain('Est. Max history');
    expect(joined).not.toContain(
      "Tracked exercises show progress charts, Est. Max history, and overload trends."
    );
  });
});

// ── Recovery Block start flow (#695) ────────────────────────────────────────

describe('Recovery Block start flow', () => {
  const { LightColors, DarkColors } = require('../theme/colors');
  const { ThemeContext } = require('../theme/ThemeContext');

  const baselineNote = { id: 'routine1', title: 'Push Day', raw_text: 'Push\n-Bench\n100 5,5,5', updated_at: '2026-01-01T00:00:00.000Z' };
  const otherNote = { id: 'routine2', title: 'Pull Day', raw_text: 'Pull\n-Row\n80 5,5,5', updated_at: '2026-01-02T00:00:00.000Z' };
  const linkedNote = { id: 'routine3', title: 'Legs Day', raw_text: 'Legs\n-Squat\n100 5,5,5', updated_at: '2026-01-03T00:00:00.000Z' };

  let add, update, remove, selectCurrent, startBlock, refresh;

  // Some note titles (e.g. "Pull Day") appear both as an ordinary previous-
  // routine card in the background and as a selectable option inside the
  // modal; accessibilityLabel disambiguates where text alone cannot.
  const findByAccessibilityLabel = (root, label) =>
    root.findAll(n => n.props && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0] || null;

  const setupCommonMocks = ({ notes, currentId, currentNote, activeBlock = null, blocks = [], weeks = [] } = {}) => {
    add = jest.fn().mockResolvedValue({ id: 'newnote1', title: 'New Week 1 Note', raw_text: '' });
    update = jest.fn();
    remove = jest.fn();
    selectCurrent = jest.fn();
    // Mirrors the real `useStartRecoveryBlock().startBlock` contract: the
    // caller no longer creates the Week-1 note itself, it supplies
    // `createWeekNote`/`removeWeekNote` and this call orchestrates them (gate
    // -> optional note creation -> block/week write -> rollback on failure).
    // The real gate itself is exercised separately, against the real hook,
    // in the "authoritative Recovery state contract (#716)" describe below —
    // here `startBlock` stands in for an already-passed gate so these flow
    // tests stay focused on the screen's own wiring.
    startBlock = jest.fn().mockImplementation(async ({ weekNoteId, createWeekNote, removeWeekNote } = {}) => {
      let finalWeekNoteId = weekNoteId;
      let createdNoteId = null;
      if (!finalWeekNoteId && createWeekNote) {
        const created = await createWeekNote();
        finalWeekNoteId = created?.id || null;
        createdNoteId = finalWeekNoteId;
      }
      if (!finalWeekNoteId) {
        return { ok: false, error: 'Select or create a note for Recovery Week 1.' };
      }
      const result = { ok: true, block: { id: 'rb1' }, week: { id: 'rw1', week_number: 1 } };
      if (!result.ok && createdNoteId && removeWeekNote) {
        try { await removeWeekNote(createdNoteId); } catch (_e) { /* best-effort */ }
      }
      return result;
    });
    refresh = jest.fn();

    useEntries.useWorkoutNotes.mockReturnValue({
      notes, currentId, currentNote, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(),
      selectCurrent, update, add, remove,
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock,
      blocks,
      weeks,
      recoveryWeekNumberByNoteId: weeks.reduce((acc, w) => {
        if (!activeBlock || w.block_id === activeBlock.id) acc[w.note_id] = w.week_number;
        return acc;
      }, {}),
      loading: false,
      error: null,
      refresh,
    });
    useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Real (unmocked) pure eligibility helpers stay wired through the actual
    // module — only the storage-backed hooks are mocked above.
    useEntries.isEligibleBaselineNote.mockImplementation(jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleBaselineNote);
    useEntries.isEligibleRecoveryWeekNote.mockImplementation(jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleRecoveryWeekNote);
  });

  // #711: the entry point is no longer a per-card pill. It is the single
  // control in the Recovery section, and it opens the modal with NO subject —
  // the modal's own pickers (which always existed) choose the baseline and
  // Week 1. `openEntryPoint` is how every test below reaches the flow.
  // #823: it is now a persistent row directly under the current routine
  // card, never nested inside routine management — reachable with no
  // disclosure to open first.
  const openEntryPoint = (root) => {
    const startBtn = findPressableByText(root, 'Start recovery block');
    expect(startBtn).toBeTruthy();
    render.act(() => { startBtn.props.onPress(); });
  };
  const chooseBaseline = (root, title) => {
    const option = findByAccessibilityLabel(root, `Use ${title} as the frozen baseline`);
    expect(option).toBeTruthy();
    render.act(() => { option.props.onPress(); });
  };

  test('entry point: the single start control is a persistent row under the current routine card, opening the modal with both pickers and no preset', () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // Visible with no disclosure to open first (#823) — unlike #724, routine
    // management stays collapsed and the control is already there.
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Mark as recovery week').length).toBe(0);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Start recovery block').length).toBe(1);

    openEntryPoint(root);

    expect(findPressableByText(root, 'Confirm')).toBeTruthy();
    // Nothing is fixed: both eligible notes are offered as selectable baselines,
    // and the Week 1 chooser renders its Existing/New toggle.
    expect(findByAccessibilityLabel(root, 'Use Push Day as the frozen baseline')).toBeTruthy();
    expect(findByAccessibilityLabel(root, 'Use Pull Day as the frozen baseline')).toBeTruthy();
    expect(findPressableByText(root, 'Existing note')).toBeTruthy();
    expect(findPressableByText(root, 'New note')).toBeTruthy();
  });

  test('entry point: no eligible baseline note means no Recovery section at all', () => {
    // The only note is already linked to a block, so nothing can be frozen as a
    // baseline — the section returns null rather than advertising a dead start.
    const weeks = [{ id: 'rw0', block_id: 'rbX', note_id: linkedNote.id, week_number: 1, deleted_at: null }];
    const blocks = [{ id: 'rbX', baseline_note_id: 'gone', started_at: '2026-01-01T00:00:00.000Z', completed_at: '2026-01-05T00:00:00.000Z', deleted_at: null }];
    setupCommonMocks({ notes: [linkedNote], currentId: linkedNote.id, currentNote: linkedNote, blocks, weeks });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // Even inside expanded routine management, an ineligible non-adopter is
    // never offered the start control (#724).
    expandRoutineManagement(root);
    expect(findPressableByText(root, 'Start recovery block')).toBeNull();
  });

  test('entry point: an active block withholds the start control entirely', () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: otherNote.id, week_number: 1, deleted_at: null }];
    const blocks = [{ id: 'rb1', baseline_note_id: baselineNote.id, baseline_note_title: 'Push Day', started_at: '2026-01-01T00:00:00.000Z', completed_at: null, deleted_at: null }];
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote, activeBlock: blocks[0], blocks, weeks });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // The active block's own card renders instead; starting a second block is
    // not offered anywhere — not even inside expanded routine management —
    // which is exactly what recoveryBlockingMessage would have refused.
    expandManageRecovery(root);
    expect(findPressableByText(root, 'End recovery block')).toBeTruthy();
    expandRoutineManagement(root);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Start recovery block').length).toBe(0);
  });

  test('unverified state withholds the start control from routine management (#724)', () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    // A first read still in flight is not a verified empty result, so no note is
    // treated as eligible and the entry point is withheld even when expanded.
    useEntries.useRecoveryBlockState.mockReturnValue({
      ...useEntries.useRecoveryBlockState(), ready: false, loading: true,
    });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expandRoutineManagement(root);
    expect(findPressableByText(root, 'Start recovery block')).toBeNull();
  });

  test('a stale snapshot withholds the start control from routine management (#724)', () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    useEntries.useRecoveryBlockState.mockReturnValue({
      ...useEntries.useRecoveryBlockState(), stale: true,
    });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expandRoutineManagement(root);
    expect(findPressableByText(root, 'Start recovery block')).toBeNull();
  });

  test('a pending recovery operation withholds the start control from routine management (#724)', () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    // The contract requires the control ABSENT — not merely disabled — while
    // another Recovery action is pending/busy (#724 review finding 2).
    useEntries.useRecoveryBlockState.mockReturnValue({
      ...useEntries.useRecoveryBlockState(),
      pendingRecovery: [{ id: 'op1', error: null }],
    });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expandRoutineManagement(root);
    expect(findPressableByText(root, 'Start recovery block')).toBeNull();
    expect(buttonByText(root, 'Start recovery block')).toBeNull();
  });

  test('mutations-not-allowed withholds the start control from routine management (#724)', () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    useEntries.useRecoveryBlockState.mockReturnValue({
      ...useEntries.useRecoveryBlockState(),
      mutationsAllowed: false,
    });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expandRoutineManagement(root);
    expect(buttonByText(root, 'Start recovery block')).toBeNull();
  });

  test('the action lock rejects a second concurrent start from the entry point', async () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    let releaseStart;
    startBlock.mockImplementation(() => new Promise(resolve => { releaseStart = resolve; }));

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    chooseBaseline(root, 'Push Day');
    render.act(() => { findByAccessibilityLabel(root, 'Use Pull Day as Recovery Week 1').props.onPress(); });

    const confirmBtn = findPressableByText(root, 'Confirm');
    await render.act(async () => { confirmBtn.props.onPress(); });
    // In flight: the control reports itself busy and refuses a second press.
    const busyBtn = findPressableByText(root, 'Starting…');
    expect(busyBtn.props.accessibilityState.disabled).toBe(true);
    await render.act(async () => { busyBtn.props.onPress(); });
    expect(startBlock).toHaveBeenCalledTimes(1);

    await render.act(async () => {
      releaseStart({ ok: true, block: { id: 'rb1' }, week: { id: 'rw1', week_number: 1 } });
    });
    expect(startBlock).toHaveBeenCalledTimes(1);
  });

  test('existing-note path: selecting a baseline and an eligible note calls startBlock with both ids, no new note created', async () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    chooseBaseline(root, 'Push Day');
    render.act(() => { findPressableByText(root, 'Existing note').props.onPress(); });
    render.act(() => { findByAccessibilityLabel(root, 'Use Pull Day as Recovery Week 1').props.onPress(); });

    const confirmBtn = findPressableByText(root, 'Confirm');
    await render.act(async () => { confirmBtn.props.onPress(); });

    expect(add).not.toHaveBeenCalled();
    expect(startBlock).toHaveBeenCalledWith(expect.objectContaining({
      baselineNoteId: 'routine1',
      baselineNoteTitle: 'Push Day',
      baselineNoteText: baselineNote.raw_text,
      weekNoteId: 'routine2',
      createWeekNote: undefined,
    }));
  });

  test('new-note path: choosing "New note" creates the note first, then starts the block with its id', async () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    chooseBaseline(root, 'Push Day');
    // Defaults to "Existing note"; switch to "New note" and type a title.
    render.act(() => { findPressableByText(root, 'New note').props.onPress(); });
    const titleInput = root.findAll(n => n.props && n.props.accessibilityLabel === 'Recovery Week 1 note title')[0];
    render.act(() => { titleInput.props.onChangeText('Recovery Week 1'); });

    const confirmBtn = findPressableByText(root, 'Confirm');
    await render.act(async () => { confirmBtn.props.onPress(); });

    expect(add).toHaveBeenCalledWith('Recovery Week 1', '');
    expect(startBlock).toHaveBeenCalledWith(expect.objectContaining({
      baselineNoteId: 'routine1',
      baselineNoteTitle: 'Push Day',
      baselineNoteText: baselineNote.raw_text,
      weekNoteId: null,
      createWeekNote: expect.any(Function),
    }));
  });

  // #711 review finding 2 (round 2): the confirm-time gate, the new-note
  // creation, and the block/week write are now ALL sequenced inside
  // `startRecoveryBlock` itself — this screen has no code path that reaches
  // storage independently of that one call, so there is nothing left here to
  // race or bypass. The gate-precedes-every-write guarantee itself (including
  // a corrupt-journal gate failure specifically) is exercised directly
  // against the REAL `useStartRecoveryBlock` hook in the "authoritative
  // Recovery state contract (#716)" describe block below, where it can prove
  // `createWeekNote` is never invoked when the gate rejects.
  test('confirm requires an explicit selection: the Confirm button is disabled until both sides are chosen', () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    const confirmBtn = findPressableByText(root, 'Confirm');
    // Nothing is preset from the generic entry point, so both sides must be
    // chosen before Confirm becomes reachable.
    expect(confirmBtn.props.accessibilityState.disabled).toBe(true);

    chooseBaseline(root, 'Push Day');
    expect(confirmBtn.props.accessibilityState.disabled).toBe(true);

    render.act(() => { findByAccessibilityLabel(root, 'Use Pull Day as Recovery Week 1').props.onPress(); });
    expect(confirmBtn.props.accessibilityState.disabled).toBe(false);
  });

  // #713 review: the no-preset entry point is the first path on which BOTH
  // pickers are live at once (a preset always fixed one side before), so it is
  // the first path on which a Week 1 choice can be invalidated by a LATER
  // baseline choice. `weekChoices` drops the note from the visible list, but the
  // id stayed selected in state — invisible and unclearable — and Confirm
  // submitted the same note as both sides, failing only as NOTE_IS_BASELINE.
  test('choosing a note as the baseline AFTER picking it for Week 1 retires that Week 1 selection', () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    // Week 1 first, baseline second — the order that reproduces it.
    render.act(() => { findByAccessibilityLabel(root, 'Use Pull Day as Recovery Week 1').props.onPress(); });
    chooseBaseline(root, 'Pull Day');

    // The note is gone from the Week 1 list AND no longer held in state, so
    // Confirm is not reachable with two identical ids.
    expect(findByAccessibilityLabel(root, 'Use Pull Day as Recovery Week 1')).toBeNull();
    expect(findPressableByText(root, 'Confirm').props.accessibilityState.disabled).toBe(true);

    // Picking the other eligible note re-enables it, with two distinct ids.
    render.act(() => { findByAccessibilityLabel(root, 'Use Push Day as Recovery Week 1').props.onPress(); });
    expect(findPressableByText(root, 'Confirm').props.accessibilityState.disabled).toBe(false);
  });

  test('the same note is never submitted as both baseline and Week 1', async () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    render.act(() => { findByAccessibilityLabel(root, 'Use Pull Day as Recovery Week 1').props.onPress(); });
    chooseBaseline(root, 'Pull Day');

    // Pressing the disabled Confirm writes nothing at all.
    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });
    expect(startBlock).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();

    // Completing the pair the valid way submits two distinct ids.
    render.act(() => { findByAccessibilityLabel(root, 'Use Push Day as Recovery Week 1').props.onPress(); });
    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });
    expect(startBlock).toHaveBeenCalledWith(expect.objectContaining({
      baselineNoteId: 'routine2',
      baselineNoteTitle: 'Pull Day',
      baselineNoteText: otherNote.raw_text,
      weekNoteId: 'routine1',
    }));
  });

  test('cancel flow: closing the modal makes no storage calls and leaves the current selection untouched', () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    chooseBaseline(root, 'Push Day');
    render.act(() => { findByAccessibilityLabel(root, 'Use Pull Day as Recovery Week 1').props.onPress(); });
    render.act(() => { findPressableByText(root, 'Cancel').props.onPress(); });

    expect(add).not.toHaveBeenCalled();
    expect(startBlock).not.toHaveBeenCalled();
    expect(selectCurrent).not.toHaveBeenCalled();
    expect(findPressableByText(root, 'Confirm')).toBeNull();
  });

  test('ineligible notes never appear as selectable candidates: a note already linked to a block is excluded', () => {
    const weeks = [{ id: 'rw0', block_id: 'rbX', note_id: linkedNote.id, week_number: 1, deleted_at: null }];
    const blocks = [{ id: 'rbX', baseline_note_id: 'someOtherRoutine', started_at: '2026-01-01T00:00:00.000Z', completed_at: '2026-01-05T00:00:00.000Z', deleted_at: null }];
    setupCommonMocks({ notes: [baselineNote, otherNote, linkedNote], currentId: baselineNote.id, currentNote: baselineNote, blocks, weeks });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    // The note itself still renders as an ordinary previous-routine card in
    // the background, but it must never appear as a selectable Week 1 option
    // (nor as a baseline) inside the modal — structurally excluded, never
    // inferred from title.
    expect(findByAccessibilityLabel(root, 'Use Legs Day as Recovery Week 1')).toBeNull();
    expect(findByAccessibilityLabel(root, 'Use Legs Day as the frozen baseline')).toBeNull();
    // The still-eligible notes remain selectable on both sides.
    expect(findByAccessibilityLabel(root, 'Use Pull Day as Recovery Week 1')).toBeTruthy();
    expect(findByAccessibilityLabel(root, 'Use Pull Day as the frozen baseline')).toBeTruthy();
  });

  test('duplicate active block rejection: startBlock failure surfaces truthful error copy and keeps the modal open', async () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    startBlock.mockResolvedValue({ ok: false, code: 'ACTIVE_BLOCK_EXISTS', error: 'Recovery block rbX is still active; complete or delete it first.' });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    chooseBaseline(root, 'Push Day');
    render.act(() => { findByAccessibilityLabel(root, 'Use Pull Day as Recovery Week 1').props.onPress(); });
    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });

    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Recovery block rbX is still active; complete or delete it first.').length).toBe(1);
    expect(findPressableByText(root, 'Confirm')).toBeTruthy();
  });

  test('recovery week badge is accessible on the linked note, in the active routine card', () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: baselineNote.id, week_number: 1, deleted_at: null }];
    const blocks = [{ id: 'rb1', baseline_note_id: 'someOtherRoutine', started_at: '2026-01-01T00:00:00.000Z', completed_at: null, deleted_at: null }];
    const activeBlock = blocks[0];
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote, activeBlock, blocks, weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // An active block lands on the Recovery tab by default (#823) — switch
    // to Routine to reach the active routine card the badge renders on.
    render.act(() => { pressableAround(root, t => t === 'Routine').props.onPress(); });

    const badge = root.findAll(n => n.props && n.props.accessibilityLabel === 'Recovery Week 1');
    expect(badge.length).toBeGreaterThan(0);
    expect(badge[0].props.accessible).toBe(true);
  });

  test('current-note selection is preserved across opening and cancelling the recovery flow', () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    render.act(() => { findPressableByText(root, 'Cancel').props.onPress(); });

    expect(selectCurrent).not.toHaveBeenCalled();
    expect(startBlock).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    // The current-routine entry point is still reachable — the screen was not
    // left in some half-open state by the cancelled flow.
    expect(findPressableByText(root, 'Start recovery block')).toBeTruthy();
  });

  // #711 removed the per-card callers that opened this modal with a preset, but
  // NOT the preset contract itself: `baselineFixed`/`weekNoteFixed` now gate on
  // `presetNote` rather than `mode`, so both preset paths must keep behaving
  // exactly as they did. Exercised directly against the component, since the
  // screen no longer has a control that supplies a preset.
  describe('preset compatibility: the modal still fixes a supplied note', () => {
    const { RecoveryBlockStartModal } = require('../components/RecoveryBlockStartModal');

    const renderModal = (props) => {
      let component;
      render.act(() => {
        component = render.create(
          <RecoveryBlockStartModal
            visible
            eligibleBaselineNotes={[baselineNote, otherNote]}
            eligibleWeekNotes={[baselineNote, otherNote]}
            onConfirm={jest.fn()}
            onClose={jest.fn()}
            {...props}
          />
        );
      });
      return component.root;
    };

    test("mode 'routine' with a preset fixes that baseline and offers no baseline choices", () => {
      const root = renderModal({ mode: 'routine', presetNote: baselineNote });
      expect(findByAccessibilityLabel(root, 'Use Push Day as the frozen baseline')).toBeNull();
      expect(findByAccessibilityLabel(root, 'Use Pull Day as the frozen baseline')).toBeNull();
      // Week 1 is still an open choice on this path.
      expect(findByAccessibilityLabel(root, 'Use Pull Day as Recovery Week 1')).toBeTruthy();
    });

    test("mode 'note' with a preset fixes Week 1 and never offers it as its own baseline", () => {
      // Presetting "Pull Day" as Week 1 must exclude it from the baseline
      // choices (it would otherwise only fail as NOTE_IS_BASELINE after
      // Confirm); the other eligible note remains a valid baseline.
      const root = renderModal({ mode: 'note', presetNote: otherNote });
      expect(findByAccessibilityLabel(root, 'Use Pull Day as the frozen baseline')).toBeNull();
      expect(findByAccessibilityLabel(root, 'Use Push Day as the frozen baseline')).toBeTruthy();
      // Week 1 is fixed: no Existing/New chooser at all.
      expect(findPressableByText(root, 'Existing note')).toBeNull();
      expect(findPressableByText(root, 'New note')).toBeNull();
    });

    test('a null preset in either mode renders both pickers', () => {
      for (const mode of ['routine', 'note']) {
        const root = renderModal({ mode, presetNote: null });
        expect(findByAccessibilityLabel(root, 'Use Push Day as the frozen baseline')).toBeTruthy();
        expect(findPressableByText(root, 'Existing note')).toBeTruthy();
      }
    });
  });

  test('onConfirm rejecting (e.g. the new-note write itself failing) clears "Starting…" and shows an error instead of getting stuck', async () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    add.mockRejectedValue(new Error('Could not save the note.'));
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    chooseBaseline(root, 'Push Day');
    render.act(() => { findPressableByText(root, 'New note').props.onPress(); });
    const titleInput = root.findAll(n => n.props && n.props.accessibilityLabel === 'Recovery Week 1 note title')[0];
    render.act(() => { titleInput.props.onChangeText('Recovery Week 1'); });

    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });

    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Could not save the note.').length).toBe(1);
    const confirmBtn = findPressableByText(root, 'Confirm');
    expect(confirmBtn.props.accessibilityLabel).toBe('Confirm and start recovery block');
    expect(confirmBtn.props.accessibilityState.disabled).toBe(false);
  });

  test('new-note path rollback: startBlock failing after note creation deletes the orphaned note', async () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    // Exercises LogScreen's wiring of `createWeekNote`/`removeWeekNote` into
    // `startRecoveryBlock`: this override simulates the real hook's own
    // rollback behavior (note created, then the block/week write fails, then
    // the note is removed) rather than testing the hook itself — that lives
    // in the "authoritative Recovery state contract (#716)" describe below.
    startBlock.mockImplementation(async ({ createWeekNote, removeWeekNote }) => {
      const created = await createWeekNote();
      if (removeWeekNote && created?.id) await removeWeekNote(created.id);
      return { ok: false, code: 'ACTIVE_BLOCK_EXISTS', error: 'Recovery block rbX is still active; complete or delete it first.' };
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openEntryPoint(root);
    chooseBaseline(root, 'Push Day');
    render.act(() => { findPressableByText(root, 'New note').props.onPress(); });
    const titleInput = root.findAll(n => n.props && n.props.accessibilityLabel === 'Recovery Week 1 note title')[0];
    render.act(() => { titleInput.props.onChangeText('Recovery Week 1'); });

    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });

    expect(add).toHaveBeenCalledWith('Recovery Week 1', '');
    // The note the flow created before the failure must not survive as an
    // orphan routine — "no partial changes" covers the note it created too.
    expect(remove).toHaveBeenCalledWith('newnote1');
  });

  test('renders without crashing in dark palette', () => {
    setupCommonMocks({ notes: [baselineNote, otherNote], currentId: baselineNote.id, currentNote: baselineNote });
    let component;
    render.act(() => {
      component = render.create(
        <ThemeContext.Provider value={{ preference: 'dark', mode: 'dark', colors: DarkColors, setPreference: jest.fn() }}>
          <ControlledLogScreen />
        </ThemeContext.Provider>
      );
    });
    const root = component.root;
    openEntryPoint(root);
    expect(findPressableByText(root, 'Confirm')).toBeTruthy();
  });
});

// -- Recovery-tab lockout while a note is edited inline (#841 automated review) --
//
// The shared full-screen editor keys off `otherEditor.editingNoteId`
// truthiness alone, not tab or mode, to decide which note/handlers it binds
// to. A recovery-sourced session deliberately stays out of `isEditing`
// (Save/Cancel live inline in the Recovery block instead), which means the
// tab toggle stays visible while it is open — so leaving Recovery has to be
// refused outright, or the user could reach the current routine's
// full-screen editor while `editingNoteId` still names the recovery note.
describe('LogScreen: leaving Recovery is refused while a recovery note is mid-edit (#841)', () => {
  const baselineNote = { id: 'baseline1', title: 'Push Day', raw_text: 'Push\n-Bench\n100 5,5,5', updated_at: '2026-01-01T00:00:00.000Z' };
  const weekNote = { id: 'week1note', title: 'Recovery Week 1 Note', raw_text: 'Pull\n-Row\n80 5,5,5', updated_at: '2026-01-08T00:00:00.000Z' };

  const activeBlock = {
    id: 'rb1', baseline_note_id: baselineNote.id, baseline_note_title: baselineNote.title,
    started_at: '2026-01-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };
  const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: weekNote.id, week_number: 1, completed_at: null, deleted_at: null }];

  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [baselineNote, weekNote], currentId: baselineNote.id, currentNote: baselineNote, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(),
      selectCurrent: jest.fn(), update: jest.fn().mockResolvedValue({}), add: jest.fn(), remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    // Deload also selectable, so the guard is proven against BOTH sibling
    // tabs, not just the one that happens to be Routine.
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: true });
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock, blocks: [activeBlock], weeks,
      recoveryWeekNumberByNoteId: { [weekNote.id]: 1 },
      loading: false, error: null, refresh: jest.fn(),
    });
    useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });
    useEntries.isEligibleBaselineNote.mockImplementation(jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleBaselineNote);
    useEntries.isEligibleRecoveryWeekNote.mockImplementation(jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleRecoveryWeekNote);
  });

  // Finds the tab toggle's own Pressable for an exact label — not
  // `findPressableByText`'s substring match, which would also match "More
  // Routines" for the text "Routine".
  const tabButton = (root, label) => {
    for (const node of root.findAll(n => n.type === 'Text' && n.props.children === label)) {
      let p = node.parent;
      while (p && typeof p.props?.onPress !== 'function') p = p.parent;
      if (p) return p;
    }
    return null;
  };

  test('an active block defaults the screen to Recovery, and editing its week note inline locks the tab toggle', () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // The active-block default (LogScreen's recoveryDefaultAppliedRef effect)
    // already lands on Recovery with no tap needed.
    const weekRow = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'View Recovery Week 1 Note, Recovery Week 1' && typeof n.props.onPress === 'function'
    )[0];
    expect(weekRow).toBeTruthy();
    render.act(() => { weekRow.props.onPress(); });

    const editBtn = root.findAll(n => n.props && n.props.accessibilityLabel === 'Edit' && typeof n.props.onPress === 'function')[0];
    expect(editBtn).toBeTruthy();
    render.act(() => { editBtn.props.onPress(); });

    // Now mid-edit: both sibling tabs report disabled and refuse to switch.
    const routineTab = tabButton(root, 'Routine');
    const deloadTab = tabButton(root, 'Deload');
    expect(routineTab.props.disabled).toBe(true);
    expect(routineTab.props.accessibilityState.disabled).toBe(true);
    expect(deloadTab.props.disabled).toBe(true);
    expect(deloadTab.props.accessibilityState.disabled).toBe(true);

    render.act(() => { routineTab.props.onPress(); });
    render.act(() => { deloadTab.props.onPress(); });
    // Recovery's own inline editor is still on screen — the tab never moved.
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Recovery note title')[0]).toBeTruthy();
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'More Routines').length).toBe(0);
  });
});

describe('useStartRecoveryBlock: rollback on Week-1 failure leaves no orphan active block', () => {
  test('createRecoveryBlock succeeding but addRecoveryWeek throwing deletes the just-created block', async () => {
    // Only ../hooks/useEntries is auto-mocked at the top of this file.
    // startRecoveryBlockCore takes the storage API as a parameter, so the
    // rollback logic is exercised directly against a fake storage object —
    // no module mocking or React rendering required.
    const { startRecoveryBlockCore } = require('../hooks/entries/recoveryBlockHooks');

    const createFn = jest.fn().mockResolvedValue({ id: 'rb-orphan' });
    const addFn = jest.fn().mockRejectedValue(
      Object.assign(new Error('Workout note is the frozen baseline'), { code: 'NOTE_IS_BASELINE' })
    );
    const deleteFn = jest.fn().mockResolvedValue({ id: 'rb-orphan' });
    const fakeStorage = { createRecoveryBlock: createFn, addRecoveryWeek: addFn, deleteRecoveryBlock: deleteFn };

    const result = await startRecoveryBlockCore(fakeStorage, {
      baselineNoteId: 'baseline1',
      baselineNoteTitle: 'Push Day',
      baselineNoteText: 'raw',
      weekNoteId: 'week1',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOTE_IS_BASELINE');
    expect(createFn).toHaveBeenCalledTimes(1);
    expect(addFn).toHaveBeenCalledWith({ blockId: 'rb-orphan', noteId: 'week1' });
    expect(deleteFn).toHaveBeenCalledWith('rb-orphan');
  });
});

describe('useRecoveryBlockState: cloud sync triggers a reload', () => {
  test('a completed SYNC phase refreshes recovery state even with no local startRecoveryBlockCore call', async () => {
    // Another device's active block/week records can arrive purely through
    // cloud sync (App.js only reloads workout notes/weight on its
    // automatic-sync callback), so the hook must subscribe to the sync-state
    // broadcast directly rather than relying solely on the private local
    // notification used by startRecoveryBlockCore. Spies target the leaf
    // modules (not the `storage/entries` aggregator, whose re-exports are not
    // spy-able — see the comment in storage/entries.js) so the hook's actual
    // named imports resolve through the same live bindings we control.
    const recoveryStorageModule = require('../storage/entries/recoveryStorage');
    const syncRecoveryModule = require('../storage/syncRecovery');
    const { useRecoveryBlockState } = require('../hooks/entries/recoveryBlockHooks');

    const loadBlocksSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockResolvedValue([]);
    const loadWeeksSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryBlockWeeks').mockResolvedValue([]);
    let syncListener = null;
    const subscribeSpy = jest.spyOn(syncRecoveryModule, 'subscribeSyncState').mockImplementation((listener) => {
      syncListener = listener;
      return () => {};
    });

    function Harness() {
      useRecoveryBlockState();
      return null;
    }

    let component;
    // The reads are now preceded by reconciliation of the durable operation
    // journal (#696), so refresh resolves on a later microtask than it used to.
    await render.act(async () => { component = render.create(React.createElement(Harness)); });
    expect(loadBlocksSpy).toHaveBeenCalledTimes(1);
    expect(typeof syncListener).toBe('function');

    await render.act(async () => {
      syncListener({ [syncRecoveryModule.SYNC_PHASE.SYNC]: { status: syncRecoveryModule.SYNC_STATUS.COMPLETE } });
    });
    expect(loadBlocksSpy).toHaveBeenCalledTimes(2);

    // A second notification of the same completed status (no new transition)
    // must not refresh again — only the RUNNING->COMPLETE edge does.
    await render.act(async () => {
      syncListener({ [syncRecoveryModule.SYNC_PHASE.SYNC]: { status: syncRecoveryModule.SYNC_STATUS.COMPLETE } });
    });
    expect(loadBlocksSpy).toHaveBeenCalledTimes(2);

    render.act(() => { component.unmount(); });
    loadBlocksSpy.mockRestore();
    loadWeeksSpy.mockRestore();
    subscribeSpy.mockRestore();
  });
});

// ── Recovery Block Week 2+ lifecycle (#696) ─────────────────────────────────

describe('Recovery Block Week 2+ lifecycle', () => {
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const {
    RECOVERY_BLOCKS_KEY,
    RECOVERY_BLOCK_WEEKS_KEY,
    RECOVERY_OPERATION_JOURNAL_KEY,
  } = require('../storage/entries/keys');
  const journalModule = require('../storage/entries/recoveryOperationJournal');

  const baselineNote = { id: 'baseline1', title: 'Push Day', raw_text: 'Push\n-Bench\n100 5,5,5', updated_at: '2026-01-01T00:00:00.000Z' };
  const week1Note = { id: 'week1note', title: 'Recovery Week 1 Note', raw_text: 'Push\n-Bench\n60 5,5,5', updated_at: '2026-01-08T00:00:00.000Z' };
  const week2Note = { id: 'week2note', title: 'Recovery Week 2 Note', raw_text: 'Push\n-Bench\n65 5,5,5', updated_at: '2026-01-15T00:00:00.000Z' };
  const otherNote = { id: 'other1', title: 'Other Eligible Note', raw_text: 'Pull\n-Row\n80 5,5,5', updated_at: '2026-01-16T00:00:00.000Z' };

  const activeBlockFixture = {
    id: 'rb1',
    baseline_note_id: baselineNote.id,
    baseline_note_title: baselineNote.title,
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
  };

  let add, remove, update, refresh, alertSpy;
  let completeWeekSpy, uncompleteWeekSpy, addWeekSpy, deleteWeekSpy;
  let loadWeeksForBlockSpy, loadBlocksSpy, loadAllWeeksSpy, loadWorkoutNotesRawSpy;
  // The note store the journal's registered note operations act on. The two
  // journaled operations own the note deletion end to end (#696), so there is
  // no injected `deleteNote` callback to assert on any more — the persisted
  // outcome is the assertion.
  let noteStore;

  const readPersistedBlocks = async () => JSON.parse((await AsyncStorage.getItem(RECOVERY_BLOCKS_KEY)) || '[]');
  const readPersistedWeeks = async () => JSON.parse((await AsyncStorage.getItem(RECOVERY_BLOCK_WEEKS_KEY)) || '[]');
  const readJournal = async () => JSON.parse((await AsyncStorage.getItem(RECOVERY_OPERATION_JOURNAL_KEY)) || '[]');

  const _orderedLive = (weeks, blockId) => (weeks || [])
    .filter(w => w.block_id === blockId && !w.deleted_at)
    .sort((a, b) => a.week_number - b.week_number || String(a.id).localeCompare(String(b.id)));

  // The Week 2+ lifecycle cores (recoveryBlockHooks.js) re-read persisted
  // state themselves rather than trusting a caller-supplied snapshot (#696
  // review), so every test must give these three leaf reads a resolved value
  // that matches the same fixtures `useRecoveryBlockState` reports for the
  // UI — otherwise the real (unmocked) storage read would hit the bare
  // AsyncStorage jest.fn() mock and silently see empty lists. A dedicated
  // "stale UI, fresh storage" test further below overrides these to diverge
  // from the UI props on purpose.
  const setup = ({ notes, weeks, activeBlock = activeBlockFixture, blocks = [activeBlockFixture] } = {}) => {
    add = jest.fn().mockResolvedValue({ id: 'newweeknote1', title: 'New Recovery Week Note', raw_text: '' });
    remove = jest.fn().mockResolvedValue();
    update = jest.fn();
    refresh = jest.fn();

    useEntries.useWorkoutNotes.mockReturnValue({
      notes, currentId: baselineNote.id, currentNote: baselineNote, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(),
      selectCurrent: jest.fn(), update, add, remove,
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock,
      blocks,
      weeks,
      recoveryWeekNumberByNoteId: weeks.reduce((acc, w) => {
        if (!activeBlock || w.block_id === activeBlock.id) acc[w.note_id] = w.week_number;
        return acc;
      }, {}),
      loading: false,
      error: null,
      refresh,
    });
    useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });
    useEntries.isEligibleBaselineNote.mockImplementation(jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleBaselineNote);
    useEntries.isEligibleRecoveryWeekNote.mockImplementation(jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleRecoveryWeekNote);

    loadBlocksSpy.mockResolvedValue(blocks);
    loadAllWeeksSpy.mockResolvedValue(weeks);
    loadWeeksForBlockSpy.mockImplementation(async (blockId) => _orderedLive(weeks, blockId));
    // unlinkNoteForDeleteCore verifies a deleteNote rejection against the
    // actual persisted notes (#696 review) rather than trusting the storage
    // -layer revert blindly; default this to "still present" so ordinary
    // tests never accidentally trip the reconciliation path.
    loadWorkoutNotesRawSpy.mockResolvedValue(notes.map(n => ({ ...n, deleted_at: null })));

    // The journaled operations read and write persisted state directly (that
    // is the whole point — they must survive a restart), so the fixtures have
    // to exist in storage, not only in the mocked read-model hook.
    noteStore = notes.map(n => ({ ...n }));
    journalModule.setRecoveryNoteOperations({
      loadNoteState: async (id) => {
        const note = noteStore.find(n => n.id === id);
        return { exists: !!note, deleted: !note, requiresQueue: false, queued: false };
      },
      deleteNote: async (id) => {
        const idx = noteStore.findIndex(n => n.id === id);
        if (idx >= 0) noteStore.splice(idx, 1);
      },
      // The new-note week operation's pair: "durably live", not merely present.
      loadNoteLiveState: async (id) => {
        const note = noteStore.find(n => n.id === id);
        return { exists: !!note, deleted: !!note?.deleted_at, requiresQueue: false, queued: false };
      },
      ensureNoteLive: async (seed) => {
        const idx = noteStore.findIndex(n => n.id === seed.id);
        const live = { ...seed, deleted_at: null };
        if (idx >= 0) noteStore[idx] = live; else noteStore.push(live);
      },
    });
    return Promise.all([
      AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify(blocks || [])),
      AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks || [])),
      AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, JSON.stringify([])),
    ]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    completeWeekSpy = jest.spyOn(recoveryStorageModule, 'completeRecoveryWeek');
    uncompleteWeekSpy = jest.spyOn(recoveryStorageModule, 'uncompleteRecoveryWeek');
    addWeekSpy = jest.spyOn(recoveryStorageModule, 'addRecoveryWeek');
    deleteWeekSpy = jest.spyOn(recoveryStorageModule, 'deleteRecoveryWeek');
    // The two journaled multi-record operations (#696) read and write
    // persisted state directly, so each test starts from an empty store and a
    // clean in-memory journal guard.
    AsyncStorage.__store.clear();
    journalModule.__resetRecoveryOperationJournal();
    loadWeeksForBlockSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryWeeksForBlock');
    loadBlocksSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks');
    loadAllWeeksSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryBlockWeeks');
    loadWorkoutNotesRawSpy = jest.spyOn(require('../storage/entries/workoutNotes'), 'loadWorkoutNotesRaw');
  });

  afterEach(() => {
    alertSpy.mockRestore();
    completeWeekSpy.mockRestore();
    uncompleteWeekSpy.mockRestore();
    addWeekSpy.mockRestore();
    deleteWeekSpy.mockRestore();
    journalModule.__resetRecoveryOperationJournal();
    loadWeeksForBlockSpy.mockRestore();
    loadBlocksSpy.mockRestore();
    loadAllWeeksSpy.mockRestore();
    loadWorkoutNotesRawSpy.mockRestore();
  });

  test('current week open: "Complete week" is offered and "Add week" is not', () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    setup({ notes: [baselineNote, week1Note], weeks });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expect(findPressableByText(root, 'Complete Week')).toBeTruthy();
    expect(findPressableByText(root, 'Add week')).toBeNull();
  });

  test('tapping "Complete week" confirms the consequence, then completes the current week and refreshes (#836)', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    setup({ notes: [baselineNote, week1Note], weeks });
    completeWeekSpy.mockResolvedValue({ ...weeks[0], completed_at: '2026-01-08T00:00:00.000Z' });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Complete Week').props.onPress(); });
    expect(completeWeekSpy).not.toHaveBeenCalled();
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Complete Week 1?');
    expect(message).toContain('does not create or submit a note for the next week');

    await render.act(async () => { await buttons.find(b => b.text === 'Complete week').onPress(); });

    expect(completeWeekSpy).toHaveBeenCalledWith('rw1');
    expect(refresh).toHaveBeenCalled();
  });

  test('current week completed: "Add week" is offered and "Complete week" is not', () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    setup({ notes: [baselineNote, week1Note, otherNote], weeks });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expect(findPressableByText(root, 'Add week')).toBeTruthy();
    expect(findPressableByText(root, 'Complete Week')).toBeNull();
  });

  test('add-week existing-note path attaches the chosen note as the next week, no new note created', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    setup({ notes: [baselineNote, week1Note, otherNote], weeks });
    addWeekSpy.mockResolvedValue({ id: 'rw2', block_id: 'rb1', note_id: otherNote.id, week_number: 2, completed_at: null, deleted_at: null });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Add week').props.onPress(); });
    const optionBtn = root.findAll(n => n.props
      && n.props.accessibilityLabel === 'Use Other Eligible Note as this recovery week'
      && typeof n.props.onPress === 'function')[0];
    render.act(() => { optionBtn.props.onPress(); });
    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });

    expect(add).not.toHaveBeenCalled();
    expect(addWeekSpy).toHaveBeenCalledWith({ blockId: 'rb1', noteId: otherNote.id });
  });

  test('add-week new-note path journals one operation that creates the note and its membership', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Add week').props.onPress(); });
    render.act(() => { findPressableByText(root, 'New note').props.onPress(); });
    const titleInput = root.findAll(n => n.props && n.props.accessibilityLabel === 'Recovery week note title')[0];
    render.act(() => { titleInput.props.onChangeText('Recovery Week 2'); });
    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });

    // The screen no longer creates the note itself: the journaled operation owns
    // both writes, so the note and the ordinal are minted once inside its lock.
    expect(add).not.toHaveBeenCalled();
    const created = noteStore.find(n => n.title === 'Recovery Week 2');
    expect(created).toBeTruthy();
    expect(created.raw_text).toBe('');
    const persisted = (await readPersistedWeeks()).filter(w => !w.deleted_at);
    expect(persisted).toHaveLength(2);
    expect(persisted.find(w => w.note_id === created.id).week_number).toBe(2);
    expect(await readJournal()).toEqual([]);
  });

  test('add-week new-note: a membership write failure retains the intent and replay finishes it — no orphan note, no second ordinal', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });
    const jsonStorage = require('../storage/entries/jsonStorage');
    const originalWrite = jsonStorage.writeList;
    let failWeeks = true;
    const writeSpy = jest.spyOn(jsonStorage, 'writeList').mockImplementation(async (key, list) => {
      if (key === RECOVERY_BLOCK_WEEKS_KEY && failWeeks) throw new Error('Injected membership write failure');
      return originalWrite(key, list);
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Add week').props.onPress(); });
    render.act(() => { findPressableByText(root, 'New note').props.onPress(); });
    const titleInput = root.findAll(n => n.props && n.props.accessibilityLabel === 'Recovery week note title')[0];
    render.act(() => { titleInput.props.onChangeText('Recovery Week 2'); });
    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });

    // The note landed; the membership did not. That is a TRACKED partial state:
    // the intent names the exact note id, week id, and ordinal to finish with, so
    // there is no orphan note and nothing is left to a best-effort cleanup delete.
    const journal = await readJournal();
    expect(journal).toHaveLength(1);
    expect(journal[0].type).toBe('add_week_with_new_note');
    expect(journal[0].week_seed.week_number).toBe(2);
    const createdId = journal[0].note_id;
    expect(noteStore.some(n => n.id === createdId)).toBe(true);
    expect((await readPersistedWeeks()).filter(w => !w.deleted_at)).toHaveLength(1);

    failWeeks = false;
    await render.act(async () => { await journalModule.reconcileRecoveryOperations(); });

    const persisted = (await readPersistedWeeks()).filter(w => !w.deleted_at);
    expect(persisted).toHaveLength(2);
    expect(persisted.find(w => w.note_id === createdId).week_number).toBe(2);
    // Exactly one note and exactly one ordinal, after a failure plus a replay.
    expect(noteStore.filter(n => n.id === createdId)).toHaveLength(1);
    expect(await readJournal()).toEqual([]);
    writeSpy.mockRestore();
  });

  test('add-week new-note: a membership write failure whose journal-clear also fails still converges without duplicating anything', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });
    const jsonStorage = require('../storage/entries/jsonStorage');
    const originalWrite = jsonStorage.writeList;
    let failWeeks = true;
    let failJournalClear = false;
    const writeSpy = jest.spyOn(jsonStorage, 'writeList').mockImplementation(async (key, list) => {
      if (key === RECOVERY_BLOCK_WEEKS_KEY && failWeeks) throw new Error('Injected membership write failure');
      if (key === RECOVERY_OPERATION_JOURNAL_KEY && failJournalClear && Array.isArray(list) && list.length === 0) {
        throw new Error('Injected journal cleanup failure');
      }
      return originalWrite(key, list);
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    render.act(() => { findPressableByText(root, 'Add week').props.onPress(); });
    render.act(() => { findPressableByText(root, 'New note').props.onPress(); });
    const titleInput = root.findAll(n => n.props && n.props.accessibilityLabel === 'Recovery week note title')[0];
    render.act(() => { titleInput.props.onChangeText('Recovery Week 2'); });
    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });
    const createdId = (await readJournal())[0].note_id;

    // Second attempt: the membership lands, but the cleanup write fails.
    failWeeks = false;
    failJournalClear = true;
    await render.act(async () => { await journalModule.reconcileRecoveryOperations(); });
    expect((await readPersistedWeeks()).filter(w => !w.deleted_at)).toHaveLength(2);
    expect(await readJournal()).toHaveLength(1);

    // Third attempt: only the cleanup is retried; nothing is written twice.
    failJournalClear = false;
    await render.act(async () => { await journalModule.reconcileRecoveryOperations(); });
    const persisted = (await readPersistedWeeks()).filter(w => !w.deleted_at);
    expect(persisted).toHaveLength(2);
    expect(persisted.filter(w => w.note_id === createdId)).toHaveLength(1);
    expect(noteStore.filter(n => n.id === createdId)).toHaveLength(1);
    expect(await readJournal()).toEqual([]);
    writeSpy.mockRestore();
  });

  test('add-week new-note: an app restart between the note write and the attach resumes from the journal alone', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });
    const jsonStorage = require('../storage/entries/jsonStorage');
    const originalWrite = jsonStorage.writeList;
    let failWeeks = true;
    const writeSpy = jest.spyOn(jsonStorage, 'writeList').mockImplementation(async (key, list) => {
      if (key === RECOVERY_BLOCK_WEEKS_KEY && failWeeks) throw new Error('Injected membership write failure');
      return originalWrite(key, list);
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    render.act(() => { findPressableByText(root, 'Add week').props.onPress(); });
    render.act(() => { findPressableByText(root, 'New note').props.onPress(); });
    const titleInput = root.findAll(n => n.props && n.props.accessibilityLabel === 'Recovery week note title')[0];
    render.act(() => { titleInput.props.onChangeText('Recovery Week 2'); });
    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });
    const journal = await readJournal();
    const createdId = journal[0].note_id;
    failWeeks = false;

    // Restart: every piece of in-memory protocol state is discarded, including
    // the registered note operations and the single-flight queue. Only the
    // persisted journal and collections survive.
    const survivingNotes = noteStore.map(n => ({ ...n }));
    journalModule.__resetRecoveryOperationJournal();
    journalModule.setRecoveryNoteOperations({
      loadNoteState: async (id) => {
        const note = survivingNotes.find(n => n.id === id);
        return { exists: !!note, deleted: !note, requiresQueue: false, queued: false };
      },
      deleteNote: async () => {},
      loadNoteLiveState: async (id) => {
        const note = survivingNotes.find(n => n.id === id);
        return { exists: !!note, deleted: !!note?.deleted_at, requiresQueue: false, queued: false };
      },
      ensureNoteLive: async (seed) => { survivingNotes.push({ ...seed, deleted_at: null }); },
    });

    await render.act(async () => { await journalModule.reconcileRecoveryOperations(); });

    const persisted = (await readPersistedWeeks()).filter(w => !w.deleted_at);
    expect(persisted).toHaveLength(2);
    expect(persisted.find(w => w.note_id === createdId).week_number).toBe(2);
    expect(survivingNotes.filter(n => n.id === createdId)).toHaveLength(1);
    expect(await readJournal()).toEqual([]);
    writeSpy.mockRestore();
  });

  test('add-week new-note: two same-tick confirms create ONE note and ONE ordinal', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    render.act(() => { findPressableByText(root, 'Add week').props.onPress(); });
    render.act(() => { findPressableByText(root, 'New note').props.onPress(); });
    const titleInput = root.findAll(n => n.props && n.props.accessibilityLabel === 'Recovery week note title')[0];
    render.act(() => { titleInput.props.onChangeText('Recovery Week 2'); });

    // Both presses are dispatched in the SAME tick, before any re-render can
    // publish a busy flag. Only a synchronous mutex can reject the second one;
    // React state cannot, because both closures captured the same null.
    const confirm = findPressableByText(root, 'Confirm');
    await render.act(async () => {
      const first = confirm.props.onPress();
      const second = confirm.props.onPress();
      await Promise.all([first, second]);
    });

    const created = noteStore.filter(n => n.title === 'Recovery Week 2');
    expect(created).toHaveLength(1);
    const persisted = (await readPersistedWeeks()).filter(w => !w.deleted_at);
    expect(persisted).toHaveLength(2);
    expect(persisted.map(w => w.week_number).sort()).toEqual([1, 2]);
    expect(await readJournal()).toEqual([]);
  });

  test('"End recovery block" opens the confirmation modal and, on confirm, completes the block (#843)', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expandManageRecovery(root);
    render.act(() => { findPressableByText(root, 'End recovery block').props.onPress(); });
    // The Alert-based confirm is gone (#843) — this now opens
    // RecoveryBlockEndModal instead.
    expect(alertSpy).not.toHaveBeenCalledWith('Complete recovery block?', expect.any(String), expect.any(Array));
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'End this recovery block?').length).toBe(1);
    // #843 review: the baseline routine/notes stay untouched, stated plainly.
    expect(root.findAll(n => n.type === 'Text'
      && String(n.props.children).includes('baseline routine and every week')
      && String(n.props.children).includes('untouched')).length).toBe(1);

    await render.act(async () => { await findPressableByText(root, 'End block').props.onPress(); });

    // The verified postcondition is the assertion: the persisted block carries
    // a completion timestamp, and the journal is empty because it was cleared
    // only after that was read back.
    expect((await readPersistedBlocks()).find(b => b.id === 'rb1').completed_at).toBeTruthy();
    expect(await readJournal()).toEqual([]);
    // The modal closes on success.
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'End this recovery block?').length).toBe(0);
  });

  test('completing the block with an open current week completes that week too, with one stable timestamp', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expandManageRecovery(root);
    render.act(() => { findPressableByText(root, 'End recovery block').props.onPress(); });
    await render.act(async () => { await findPressableByText(root, 'End block').props.onPress(); });

    // One journaled operation, one immutable requested timestamp: the block and
    // its open current week must carry exactly the same completed_at, and the
    // journal must be clear because both postconditions were verified.
    const persistedBlock = (await readPersistedBlocks()).find(b => b.id === 'rb1');
    const persistedWeek = (await readPersistedWeeks()).find(w => w.id === 'rw1');
    expect(persistedBlock.completed_at).toBeTruthy();
    expect(persistedWeek.completed_at).toBe(persistedBlock.completed_at);
    expect(await readJournal()).toEqual([]);
    // No separate single-record write is used for this action.
    expect(completeWeekSpy).not.toHaveBeenCalled();
  });

  test('the disclosed Unlink targets the current week only; earlier weeks have no Unlink (#789)', () => {
    const weeks = [
      { id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null },
      { id: 'rw2', block_id: 'rb1', note_id: week2Note.id, week_number: 2, completed_at: null, deleted_at: null },
    ];
    setup({ notes: [baselineNote, week1Note, week2Note], weeks });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // Collapsed by default, Unlink is not offered at all (#789).
    expect(root.findAll(n => n.props
      && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Unlink Week')).length).toBe(0);

    expandManageRecovery(root);
    const unlinkButtons = root.findAll(n => n.props
      && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Unlink Week')
      && typeof n.props.onPress === 'function');
    expect(unlinkButtons.length).toBe(1);
    expect(unlinkButtons[0].props.accessibilityLabel).toBe('Unlink Week 2');
  });

  test('unlinking the latest week confirms, then removes only the membership — the note itself is never deleted', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    setup({ notes: [baselineNote, week1Note], weeks });
    deleteWeekSpy.mockResolvedValue({ ...weeks[0], deleted_at: '2026-01-10T00:00:00.000Z' });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expandManageRecovery(root);
    const unlinkBtn = root.findAll(n => n.props && n.props.accessibilityLabel === 'Unlink Week 1')[0];
    render.act(() => { unlinkBtn.props.onPress(); });
    const buttons = alertSpy.mock.calls[0][2];
    await render.act(async () => { await buttons.find(b => b.text === 'Unlink').onPress(); });

    expect(deleteWeekSpy).toHaveBeenCalledWith('rw1');
    expect(remove).not.toHaveBeenCalled();
  });

  test('a persistence failure on "Complete week" surfaces an inline error and does not crash', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    setup({ notes: [baselineNote, week1Note], weeks });
    completeWeekSpy.mockRejectedValue(new Error('Network unavailable'));

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Complete Week').props.onPress(); });
    const confirmButtons = alertSpy.mock.calls[0][2];
    await render.act(async () => { await confirmButtons.find(b => b.text === 'Complete week').onPress(); });

    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Network unavailable').length).toBe(1);
  });

  test('no undo affordance while the current week is still in progress (#836)', () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    setup({ notes: [baselineNote, week1Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expect(findPressableByText(root, 'Undo completion')).toBeNull();
  });

  test('undoing a just-completed week confirms, then restores it to in-progress without touching its note (#836)', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    setup({ notes: [baselineNote, week1Note], weeks });
    uncompleteWeekSpy.mockResolvedValue({ ...weeks[0], completed_at: null });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Undo completion').props.onPress(); });
    expect(uncompleteWeekSpy).not.toHaveBeenCalled();
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Reopen Week 1?');
    expect(message).toContain('Its note is unchanged');

    await render.act(async () => { await buttons.find(b => b.text === 'Reopen week').onPress(); });

    expect(uncompleteWeekSpy).toHaveBeenCalledWith('rw1');
    expect(refresh).toHaveBeenCalled();
    // The note itself was never touched by the undo.
    expect(update).not.toHaveBeenCalled();
  });

  test('undo targets only the latest week; an earlier completed week offers no undo once a later week exists (#836)', () => {
    const weeks = [
      { id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null },
      { id: 'rw2', block_id: 'rb1', note_id: week2Note.id, week_number: 2, completed_at: null, deleted_at: null },
    ];
    setup({ notes: [baselineNote, week1Note, week2Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // Week 2 is in progress, so there is nothing completed to undo — Week 1
    // (already superseded) must not offer it either.
    expect(findPressableByText(root, 'Undo completion')).toBeNull();
  });

  test('Log renders no Recovery section when only completed blocks exist — one block', () => {
    // Completed history lives in Analytics (#729). With no active block, no
    // pending operations, and no stale snapshot, the Recovery section must not
    // render at all regardless of how many completed blocks are in storage.
    const completedBlock = {
      id: 'rb0', baseline_note_id: 'oldBaseline', baseline_note_title: 'Old Baseline Routine',
      started_at: '2025-11-01T00:00:00.000Z', completed_at: '2025-12-01T00:00:00.000Z', deleted_at: null,
    };
    const historyWeeks = [
      { id: 'hw1', block_id: 'rb0', note_id: week1Note.id, week_number: 1, completed_at: '2025-11-08T00:00:00.000Z', deleted_at: null },
    ];
    setup({ notes: [baselineNote, week1Note], weeks: historyWeeks, activeBlock: null, blocks: [completedBlock] });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Recovery').length).toBe(0);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Recovery History').length).toBe(0);
    expect(findPressableByText(root, '1 completed block')).toBeNull();
  });

  test('Log renders no Recovery section when only completed blocks exist — multiple blocks', () => {
    const block1 = {
      id: 'rb0', baseline_note_id: 'oldBaseline', baseline_note_title: 'Old Baseline',
      started_at: '2025-09-01T00:00:00.000Z', completed_at: '2025-10-01T00:00:00.000Z', deleted_at: null,
    };
    const block2 = {
      id: 'rb1x', baseline_note_id: 'oldBaseline2', baseline_note_title: 'Another Baseline',
      started_at: '2025-11-01T00:00:00.000Z', completed_at: '2025-12-01T00:00:00.000Z', deleted_at: null,
    };
    setup({ notes: [baselineNote], weeks: [], activeBlock: null, blocks: [block1, block2] });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Recovery History').length).toBe(0);
    expect(findPressableByText(root, '2 completed blocks')).toBeNull();
  });

  test('Log shows every live week as its own labeled entry, distinguishing completed from in-progress (#836)', () => {
    // #836 corrects #729's original hidden-completed-week behavior: each
    // week is now its own distinct, labeled entry so the block's whole
    // sequence is visible, and a completed week's note stays viewable.
    const weeks = [
      { id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null },
      { id: 'rw2', block_id: 'rb1', note_id: week2Note.id, week_number: 2, completed_at: null, deleted_at: null },
    ];
    setup({ notes: [baselineNote, week1Note, week2Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // Both weeks render as their own navigable row.
    const weekRows = root.findAll(n =>
      n.props && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('View ')
      && n.props.accessibilityLabel.includes('Recovery Week')
      && typeof n.props.onPress === 'function'
    );
    expect(weekRows.some(r => r.props.accessibilityLabel.includes('Week 2') && !r.props.accessibilityLabel.includes('completed'))).toBe(true);
    expect(weekRows.some(r => r.props.accessibilityLabel.includes('Week 1') && r.props.accessibilityLabel.includes('completed'))).toBe(true);
    // The two are visibly distinguished by the status dot alone (#843), not a
    // repeated text label — at least one completed check glyph renders (the
    // exact render count of a font-icon component is not a stable assertion
    // across environments).
    const checks = root.findAll(n => n.props && n.props.name === 'check');
    expect(checks.length).toBeGreaterThanOrEqual(1);
  });

  test('tapping an expanded recovery week again collapses it (#836)', () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    setup({ notes: [baselineNote, week1Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    const row = () => root.findAll(n =>
      n.props && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('View ')
      && n.props.accessibilityLabel.includes('Recovery Week')
      && typeof n.props.onPress === 'function'
    )[0];

    render.act(() => { row().props.onPress(); });
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Bench').length).toBeGreaterThan(0);

    // A second tap on the same row collapses it — a repeat tap used to be
    // set-only and never closed the note (#836).
    render.act(() => { row().props.onPress(); });
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Bench').length).toBe(0);
  });

  test('an expanded Recovery note stays local to the Recovery tab: Routine neither shows nor inherits it (#836)', () => {
    // A distinct exercise name from every other note in this fixture set
    // (including the current routine card, which stays mounted once the
    // Routine tab is showing) so its presence unambiguously means THIS
    // note's body rendered — not a coincidental text collision.
    const week1NoteUnique = { ...week1Note, raw_text: 'Push\n-Incline Row\n60 5,5,5' };
    // A second, ordinary (non-recovery) prior routine is what makes the
    // Routine tab's "More Routines" list render at all.
    const priorRoutine = { id: 'prior1', title: 'Prior Routine', raw_text: 'Legs\n-Squat\n100 5,5,5', updated_at: '2026-01-20T00:00:00.000Z' };
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1NoteUnique.id, week_number: 1, completed_at: null, deleted_at: null }];
    setup({ notes: [baselineNote, week1NoteUnique, priorRoutine], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    const recoveryRow = () => root.findAll(n =>
      n.props && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('View ')
      && n.props.accessibilityLabel.includes('Recovery Week')
      && typeof n.props.onPress === 'function'
    )[0];
    render.act(() => { recoveryRow().props.onPress(); });
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Incline Row').length).toBeGreaterThan(0);

    // Switching to Routine must not show the Recovery week's note content —
    // its expansion is local to the Recovery tab.
    render.act(() => { pressableAround(root, t => t === 'Routine').props.onPress(); });
    expandRoutineManagement(root);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Incline Row').length).toBe(0);

    // And Routine's own "More Routines" row for the SAME recovery-week note
    // is not expanded either — Routine inherits nothing from Recovery.
    const routineRow = root.findAll(n =>
      n.props && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith(`Expand ${week1NoteUnique.title}`)
      && typeof n.props.onPress === 'function'
    )[0];
    expect(routineRow).toBeTruthy();

    // Switching back to Recovery: the original expansion is exactly as the
    // user left it, unaffected by the trip through Routine.
    render.act(() => { pressableAround(root, t => t === 'Recovery').props.onPress(); });
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Incline Row').length).toBeGreaterThan(0);
  });

  test('Android Back on Recovery does not consume the event for a note left expanded on the invisible Routine tab (#836 review)', () => {
    // A recovery-week note is expanded on Routine (via routineViewer, not
    // Recovery's own viewer) and the user then switches to Recovery WITHOUT
    // touching Recovery's viewer. Back on Recovery must not fall through to
    // collapsing that invisible Routine-tab expansion — that would consume
    // the event and strand the user on Recovery instead of navigating back.
    const priorRoutine = { id: 'prior1', title: 'Prior Routine', raw_text: 'Legs\n-Squat\n100 5,5,5', updated_at: '2026-01-20T00:00:00.000Z' };
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    setup({ notes: [baselineNote, week1Note, priorRoutine], weeks });

    let capturedConsumer;
    const registerBackConsumer = jest.fn((consumer) => { capturedConsumer = consumer; return jest.fn(); });
    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen isActive registerBackConsumer={registerBackConsumer} />);
    });
    const root = component.root;

    // Land on Routine and expand the prior (non-recovery) routine's row —
    // this sets the shared Routine-tab viewer.
    render.act(() => { pressableAround(root, t => t === 'Routine').props.onPress(); });
    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, priorRoutine.title).props.onPress(); });

    // Switch to Recovery. Recovery's own viewer is untouched (nothing
    // expanded there).
    render.act(() => { pressableAround(root, t => t === 'Recovery').props.onPress(); });

    let handled;
    render.act(() => { handled = capturedConsumer(); });
    // Nothing on Recovery consumed Back, so it falls through to the shell's
    // own fallback instead of silently no-opping.
    expect(handled).toBe(false);
  });

  test('Unlink remains reachable, with its week context, when the latest week is completed and no next week exists', () => {
    // Unlink must be accessible so the user can back out before adding the
    // next week (#729). It lives inside `Manage recovery block` and names
    // the concrete current week rather than floating in the action row
    // (#789).
    const weeks = [
      { id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null },
    ];
    setup({ notes: [baselineNote, week1Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // The completed week's row is now shown too (#836), reachable to view/edit.
    const weekRows = root.findAll(n =>
      n.props && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('View ')
      && n.props.accessibilityLabel.includes('Recovery Week')
      && typeof n.props.onPress === 'function'
    );
    expect(weekRows.length).toBe(1);

    // The Unlink affordance is still present once the disclosure is opened,
    // and it names the week it targets.
    expandManageRecovery(root);
    const unlinkBtn = root.findAll(n =>
      n.props && n.props.accessibilityLabel === 'Unlink Week 1' && typeof n.props.onPress === 'function'
    );
    expect(unlinkBtn.length).toBe(1);
  });

  test('deleting a linked recovery-week note shows a recovery-aware confirmation, then the standard delete confirmation, and only the final confirm cascades the atomic delete', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // An active block lands on the Recovery tab by default (#823) — More
    // Routines only mounts on the Routine tab.
    render.act(() => { pressableAround(root, t => t === 'Routine').props.onPress(); });
    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, week1Note.title).props.onPress(); });
    render.act(() => { findPressableByText(root, 'Delete routine').props.onPress(); });

    // First alert: the recovery-aware confirmation, naming the week. Nothing
    // is written yet — cancelling here must be a full no-op, journal included.
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete this recovery week note?',
      expect.stringContaining('Recovery Week 1'),
      expect.any(Array)
    );
    expect(await readJournal()).toEqual([]);

    const firstAlertButtons = alertSpy.mock.calls[0][2];
    render.act(() => { firstAlertButtons.find(b => b.text === 'Continue').onPress(); });

    // Second alert: the pre-existing standard "Delete Routine" confirmation.
    // Still nothing written — the unlink is fused with the actual removal,
    // not run eagerly on our own confirm.
    expect(alertSpy).toHaveBeenCalledWith('Delete Routine', expect.any(String), expect.any(Array));
    expect(await readJournal()).toEqual([]);
    expect(noteStore.some(n => n.id === week1Note.id)).toBe(true);

    const secondAlertButtons = alertSpy.mock.calls[1][2];
    await render.act(async () => { await secondAlertButtons.find(b => b.text === 'Delete').onPress(); });

    // Both halves of the single roll-forward outcome are persisted, and the
    // journal was cleared only after they were read back.
    expect((await readPersistedWeeks()).find(w => w.id === 'rw1').deleted_at).toBeTruthy();
    expect(noteStore.some(n => n.id === week1Note.id)).toBe(false);
    expect(await readJournal()).toEqual([]);
  });

  test('cancelling the recovery-aware confirmation for a linked note leaves it linked and undeleted', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, week1Note.title).props.onPress(); });
    render.act(() => { findPressableByText(root, 'Delete routine').props.onPress(); });
    const firstAlertButtons = alertSpy.mock.calls[0][2];
    // The recovery-aware alert's "Cancel" button carries no onPress (the
    // standard no-op cancel style); nothing further must happen if it's the
    // only button pressed.
    expect(firstAlertButtons.find(b => b.text === 'Cancel').onPress).toBeUndefined();

    expect(await readJournal()).toEqual([]);
    expect((await readPersistedWeeks()).find(w => w.id === 'rw1').deleted_at).toBeFalsy();
    expect(noteStore.some(n => n.id === week1Note.id)).toBe(true);
  });

  test('an earlier (non-latest, already-completed) linked week note can still be deleted — history notes stay ordinary and deletable', async () => {
    // Deleting a linked note applies uniformly to any week, unlike the
    // position-restricted explicit Unlink action: a completed-history note
    // must remain an ordinary, editable (and deletable) note.
    const weeks = [
      { id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null },
      { id: 'rw2', block_id: 'rb1', note_id: week2Note.id, week_number: 2, completed_at: null, deleted_at: null },
    ];
    await setup({ notes: [baselineNote, week1Note, week2Note], weeks });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // An active block lands on the Recovery tab by default (#823) — More
    // Routines only mounts on the Routine tab.
    render.act(() => { pressableAround(root, t => t === 'Routine').props.onPress(); });
    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, week1Note.title).props.onPress(); });
    render.act(() => { findPressableByText(root, 'Delete routine').props.onPress(); });
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete this recovery week note?',
      expect.stringContaining('Recovery Week 1'),
      expect.any(Array)
    );

    render.act(() => { alertSpy.mock.calls[0][2].find(b => b.text === 'Continue').onPress(); });
    const secondAlertButtons = alertSpy.mock.calls[1][2];
    await render.act(async () => { await secondAlertButtons.find(b => b.text === 'Delete').onPress(); });

    const persisted = await readPersistedWeeks();
    expect(persisted.find(w => w.id === 'rw1').deleted_at).toBeTruthy();
    // The later week is untouched: this operation names exactly one membership.
    expect(persisted.find(w => w.id === 'rw2').deleted_at).toBeFalsy();
    expect(noteStore.some(n => n.id === week1Note.id)).toBe(false);
  });

  test('a completed block\'s linked note can still be deleted', async () => {
    const completedBlock = { id: 'rb0', baseline_note_id: 'oldBaseline', baseline_note_title: 'Old Baseline', started_at: '2025-11-01T00:00:00.000Z', completed_at: '2025-12-01T00:00:00.000Z', deleted_at: null };
    const weeks = [{ id: 'hw1', block_id: 'rb0', note_id: week1Note.id, week_number: 1, completed_at: '2025-11-08T00:00:00.000Z', deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks, activeBlock: null, blocks: [completedBlock] });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, week1Note.title).props.onPress(); });
    render.act(() => { findPressableByText(root, 'Delete routine').props.onPress(); });
    render.act(() => { alertSpy.mock.calls[0][2].find(b => b.text === 'Continue').onPress(); });
    const secondAlertButtons = alertSpy.mock.calls[1][2];
    await render.act(async () => { await secondAlertButtons.find(b => b.text === 'Delete').onPress(); });

    expect((await readPersistedWeeks()).find(w => w.id === 'hw1').deleted_at).toBeTruthy();
    expect(noteStore.some(n => n.id === week1Note.id)).toBe(false);
  });

  test('a note-delete failure leaves a journaled pending operation, an honest error, and no live dangling membership', async () => {
    // The membership tombstone is written first and is NEVER reverted (#696):
    // a delete callback that persisted the removal and then threw is
    // indistinguishable from one that never committed, so rolling back could
    // point a live week at a note that is already gone. The operation stays
    // journaled and converges on the next reconciliation instead.
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });
    journalModule.setRecoveryNoteOperations({
      loadNoteState: async (id) => {
        const note = noteStore.find(n => n.id === id);
        return { exists: !!note, deleted: !note, requiresQueue: false, queued: false };
      },
      deleteNote: async () => { throw new Error('Could not delete the note.'); },
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // An active block lands on the Recovery tab by default (#823) — More
    // Routines only mounts on the Routine tab.
    render.act(() => { pressableAround(root, t => t === 'Routine').props.onPress(); });
    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, week1Note.title).props.onPress(); });
    render.act(() => { findPressableByText(root, 'Delete routine').props.onPress(); });
    render.act(() => { alertSpy.mock.calls[0][2].find(b => b.text === 'Continue').onPress(); });
    const secondAlertButtons = alertSpy.mock.calls[1][2];
    await render.act(async () => {
      await expect(secondAlertButtons.find(b => b.text === 'Delete').onPress()).rejects.toThrow();
    });

    // Not presented as complete, and the durable evidence for a retry is kept.
    expect(alertSpy).toHaveBeenCalledWith('Could not delete this note', expect.any(String));
    const journal = await readJournal();
    expect(journal).toHaveLength(1);
    expect(journal[0].note_id).toBe(week1Note.id);
    expect((await readPersistedWeeks()).find(w => w.id === 'rw1').deleted_at).toBeTruthy();
    expect(addWeekSpy).not.toHaveBeenCalled();

    // The same reconciler the retry affordance, restart, and sync all use.
    journalModule.setRecoveryNoteOperations({
      loadNoteState: async (id) => {
        const note = noteStore.find(n => n.id === id);
        return { exists: !!note, deleted: !note, requiresQueue: false, queued: false };
      },
      deleteNote: async (id) => {
        const idx = noteStore.findIndex(n => n.id === id);
        if (idx >= 0) noteStore.splice(idx, 1);
      },
    });
    await render.act(async () => { await journalModule.reconcileRecoveryOperations(); });
    expect(noteStore.some(n => n.id === week1Note.id)).toBe(false);
    expect(await readJournal()).toEqual([]);
  });

  test('a pending recovery operation disables lifecycle actions and offers Retry recovery', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });
    useEntries.useRecoveryBlockState.mockReturnValue({
      ...useEntries.useRecoveryBlockState(),
      pendingRecovery: [{ operationId: 'recop_1', type: 'delete_linked_note', error: 'This note deletion is not fully applied yet.' }],
      recoveryPendingError: 'This note deletion is not fully applied yet.',
      retryRecovery: jest.fn(),
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    const retry = findPressableByText(root, 'Retry recovery');
    expect(retry).toBeTruthy();
    expect(retry.props.accessibilityLabel).toBe('Retry recovery');
    // Conflicting lifecycle actions are disabled while the operation is pending.
    expect(findPressableByText(root, 'Complete Week').props.disabled).toBe(true);

    // Blocked never means hidden (#789): the `Manage recovery block` trigger is
    // NEVER disabled, so a locked user can still open it and see which specific
    // control is unavailable — and, via the banner above, why. Disabling the
    // trigger instead would strand Unlink, Complete recovery block, and the
    // inclusion switch behind a container that cannot be opened.
    const trigger = expandManageRecovery(root);
    expect(trigger.props.disabled).toBeFalsy();
    expect(trigger.props.accessibilityState.disabled).toBeUndefined();
    expect(trigger.props.accessibilityState.expanded).toBe(true);

    // Each control inside keeps its own per-control gating, announced on the
    // control itself rather than on the container.
    const unlink = root.findAll(n => n.props && n.props.accessibilityLabel === 'Unlink Week 1')[0];
    expect(unlink.props.disabled).toBe(true);
    expect(unlink.props.accessibilityState.disabled).toBe(true);
    const completeBlock = findPressableByText(root, 'End recovery block');
    expect(completeBlock.props.disabled).toBe(true);
    expect(completeBlock.props.accessibilityState.disabled).toBe(true);
  });

  test('a terminal recovery cancellation explains itself but locks nothing and offers no retry', async () => {
    // A cancelled conflict has already retired its journal record, so there is
    // nothing left to retry and nothing may stay disabled — otherwise an
    // unreachable outcome would freeze every recovery action permanently.
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: null, deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note], weeks });
    const base = useEntries.useRecoveryBlockState();
    useEntries.useRecoveryBlockState.mockReturnValue({
      ...base,
      pendingRecovery: [],
      recoveryPendingError: 'That note was linked to a different recovery block before this week could be added, so this week was not created.',
      retryRecovery: jest.fn(),
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    const notice = root.findAll(n => n.props
      && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Recovery change not applied'))[0];
    expect(notice).toBeTruthy();
    expect(findPressableByText(root, 'Retry recovery')).toBeNull();
    expect(findPressableByText(root, 'Complete Week').props.disabled).toBe(false);
    expandManageRecovery(root);
    expect(findPressableByText(root, 'End recovery block').props.disabled).toBe(false);
  });

  test('deleting an unlinked note skips the recovery confirmation entirely', () => {
    setup({ notes: [baselineNote, otherNote], weeks: [], activeBlock: null, blocks: [] });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    expandRoutineManagement(root);

    render.act(() => { findPressableByText(root, otherNote.title).props.onPress(); });
    const deleteBtn = findPressableByText(root, 'Delete routine');
    render.act(() => { deleteBtn.props.onPress(); });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Routine',
      expect.any(String),
      expect.any(Array)
    );
  });

  test('completeRecoveryBlockCore reports the machine-readable protocol outcome, not a generic failure', async () => {
    const { completeRecoveryBlockCore } = require('../hooks/entries/recoveryBlockHooks');
    const { RECOVERY_OPERATION_CODES } = journalModule;

    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([{ ...activeBlockFixture }]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([
      { id: 'rw1', block_id: 'rb1', note_id: 'noteA', week_number: 1, completed_at: null, deleted_at: null },
    ]));
    await AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, JSON.stringify([]));

    const storage = {
      loadRecoveryBlocksRaw: recoveryStorageModule.loadRecoveryBlocksRaw,
      loadRecoveryBlockWeeksRaw: recoveryStorageModule.loadRecoveryBlockWeeksRaw,
    };

    const okResult = await completeRecoveryBlockCore(storage, { blockId: 'rb1' });
    expect(okResult.ok).toBe(true);
    expect(okResult.code).toBe(RECOVERY_OPERATION_CODES.VERIFIED);
    expect(okResult.block.completed_at).toBeTruthy();

    // Eligibility failure: an explicit VALIDATION_FAILED with the domain reason
    // preserved, and provably zero writes.
    const missing = await completeRecoveryBlockCore(storage, { blockId: 'rb_missing' });
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe(RECOVERY_OPERATION_CODES.VALIDATION_FAILED);
    expect(missing.reason).toBe('BLOCK_NOT_FOUND');
  });

  test('a pending operation is surfaced as RECONCILIATION_PENDING rather than an unexplained failure', async () => {
    const { completeRecoveryBlockCore } = require('../hooks/entries/recoveryBlockHooks');
    const { RECOVERY_OPERATION_CODES } = journalModule;
    const jsonStorage = require('../storage/entries/jsonStorage');

    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([{ ...activeBlockFixture }]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([]));
    await AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, JSON.stringify([]));
    const storage = {
      loadRecoveryBlocksRaw: recoveryStorageModule.loadRecoveryBlocksRaw,
      loadRecoveryBlockWeeksRaw: recoveryStorageModule.loadRecoveryBlockWeeksRaw,
    };

    const originalWrite = jsonStorage.writeList;
    const spy = jest.spyOn(jsonStorage, 'writeList').mockImplementation(async (key, list) => {
      if (key === RECOVERY_BLOCKS_KEY) throw new Error('Storage unavailable');
      return originalWrite(key, list);
    });

    const result = await completeRecoveryBlockCore(storage, { blockId: 'rb1' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(RECOVERY_OPERATION_CODES.OPERATION_FAILED);
    expect(await readJournal()).toHaveLength(1);
    spy.mockRestore();
  });

  test('every Week 2+ core re-reads persisted state instead of trusting a stale caller snapshot (sync-refresh race)', async () => {
    // A caller-supplied `weeks` array would be exactly what a render-time
    // prop looks like while a native confirmation sits open; these cores no
    // longer accept one at all, so a background sync that changes the
    // persisted current week between confirm-open and confirm-press is
    // reflected correctly rather than being decided from stale render state.
    const { completeCurrentWeekCore, addRecoveryWeekCore, unlinkRecoveryWeekCore } = require('../hooks/entries/recoveryBlockHooks');

    // Persisted truth: week 1 is already complete (e.g. another device just
    // completed it), unlike whatever a stale UI snapshot might have shown.
    const freshWeeks = [{ id: 'rw1', block_id: 'rb1', note_id: 'noteA', week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    const freshBlocks = [{ id: 'rb1', completed_at: null, deleted_at: null }];
    const loadWeeksForBlockFn = jest.fn().mockResolvedValue(freshWeeks);
    const loadBlocksFn = jest.fn().mockResolvedValue(freshBlocks);
    const addWeekFn = jest.fn().mockResolvedValue({ id: 'rw2', block_id: 'rb1', note_id: 'noteB', week_number: 2, completed_at: null, deleted_at: null });
    const completeWeekFn = jest.fn();
    const deleteWeekFn = jest.fn();
    const fakeStorage = {
      loadRecoveryWeeksForBlock: loadWeeksForBlockFn,
      loadRecoveryBlocks: loadBlocksFn,
      addRecoveryWeek: addWeekFn,
      completeRecoveryWeek: completeWeekFn,
      deleteRecoveryWeek: deleteWeekFn,
    };

    // completeCurrentWeekCore sees the fresh, already-complete week and is a
    // pure no-op — it never calls storage.completeRecoveryWeek again.
    const completeResult = await completeCurrentWeekCore(fakeStorage, { blockId: 'rb1' });
    expect(completeResult.ok).toBe(true);
    expect(completeWeekFn).not.toHaveBeenCalled();

    // addRecoveryWeekCore sees the fresh, already-complete week 1 and allows
    // the next week to be added — a stale snapshot showing week 1 as still
    // open would have wrongly refused this.
    const addResult = await addRecoveryWeekCore(fakeStorage, { blockId: 'rb1', noteId: 'noteB' });
    expect(addResult.ok).toBe(true);
    expect(addWeekFn).toHaveBeenCalledWith({ blockId: 'rb1', noteId: 'noteB' });

    // unlinkRecoveryWeekCore refuses to unlink week 1 once a fresh read shows
    // it is no longer the latest live week (week 2 was just added above) —
    // a stale snapshot still showing only week 1 would have wrongly allowed it.
    const staleFreshWeeks = [...freshWeeks, { id: 'rw2', block_id: 'rb1', note_id: 'noteB', week_number: 2, completed_at: null, deleted_at: null }];
    loadWeeksForBlockFn.mockResolvedValue(staleFreshWeeks);
    const unlinkResult = await unlinkRecoveryWeekCore(fakeStorage, { blockId: 'rb1', weekId: 'rw1' });
    expect(unlinkResult.ok).toBe(false);
    expect(unlinkResult.code).toBe('NOT_LATEST_WEEK');
    expect(deleteWeekFn).not.toHaveBeenCalled();
  });

  test('race protection: an Add Week confirm while ending the recovery block is still persisting is rejected, not silently written', async () => {
    const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null }];
    await setup({ notes: [baselineNote, week1Note, otherNote], weeks });
    // Hold the block-completion write open so the two actions genuinely
    // overlap. The block write is the second (and last) domain write of the
    // journaled operation, so the whole operation is still in flight here.
    const jsonStorage = require('../storage/entries/jsonStorage');
    const originalWrite = jsonStorage.writeList;
    let releaseBlockWrite;
    const blocked = new Promise(resolve => { releaseBlockWrite = resolve; });
    let held = false;
    const writeSpy = jest.spyOn(jsonStorage, 'writeList').mockImplementation(async (key, list) => {
      if (key === RECOVERY_BLOCKS_KEY && !held) {
        held = true;
        await blocked;
      }
      return originalWrite(key, list);
    });
    addWeekSpy.mockResolvedValue({ id: 'rw2', block_id: 'rb1', note_id: otherNote.id, week_number: 2, completed_at: null, deleted_at: null });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expandManageRecovery(root);
    render.act(() => { findPressableByText(root, 'End recovery block').props.onPress(); });
    let completePromise;
    render.act(() => { completePromise = findPressableByText(root, 'End block').props.onPress(); });

    // Race an Add Week confirm against the in-flight completion, bypassing the
    // disabled button to prove the mutex itself — not just the UI affordance —
    // blocks the concurrent write.
    render.act(() => { findPressableByText(root, 'Add week').props.onPress(); });
    const optionBtn = root.findAll(n => n.props
      && n.props.accessibilityLabel === 'Use Other Eligible Note as this recovery week'
      && typeof n.props.onPress === 'function')[0];
    render.act(() => { optionBtn.props.onPress(); });
    await render.act(async () => { findPressableByText(root, 'Confirm').props.onPress(); });

    expect(addWeekSpy).not.toHaveBeenCalled();
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Another recovery action is already in progress.').length).toBeGreaterThan(0);

    await render.act(async () => {
      releaseBlockWrite();
      await completePromise;
    });
    expect((await readPersistedBlocks()).find(b => b.id === 'rb1').completed_at).toBeTruthy();
    expect(await readJournal()).toEqual([]);
    writeSpy.mockRestore();
  });
});

// #843 review: the summary must state a first-to-last date RANGE, not just a
// single "started" date, and must preselect the stored inclusion value.
describe('RecoveryBlockEndModal', () => {
  const { RecoveryBlockEndModal } = require('../components/RecoveryBlockEndModal');

  const BLOCK = {
    id: 'rb1', baseline_note_title: 'Push Day',
    started_at: '2026-01-01T00:00:00.000Z', include_in_normal_analytics: false,
  };
  const weeks = [
    { id: 'rw1', block_id: 'rb1', week_number: 1, saved_at: '2026-01-01T00:00:00.000Z' },
    { id: 'rw2', block_id: 'rb1', week_number: 2, saved_at: '2026-01-15T00:00:00.000Z' },
  ];

  test('the summary states a first-to-last date range, and Off is preselected as the current setting', () => {
    let component;
    render.act(() => {
      component = render.create(
        <RecoveryBlockEndModal
          visible
          block={BLOCK}
          weeks={weeks}
          onSetInclusion={jest.fn()}
          onConfirmComplete={jest.fn()}
          onClose={jest.fn()}
        />
      );
    });
    const root = component.root;
    const allText = () => root.findAll(n => n.type === 'Text').map(n => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });

    const first = new Date(weeks[0].saved_at).toLocaleDateString();
    const last = new Date(weeks[1].saved_at).toLocaleDateString();
    expect(allText().some(t => t.includes(`Push Day · 2 weeks · ${first}–${last}`))).toBe(true);

    const off = root.findAll(n => n.props && n.props.accessibilityLabel === 'Keep them out of normal analytics')[0];
    const on = root.findAll(n => n.props && n.props.accessibilityLabel === 'Count them with everything else')[0];
    expect(off.props.accessibilityState).toEqual({ checked: true });
    expect(on.props.accessibilityState).toEqual({ checked: false });
    expect(allText().filter(t => t === 'Your current setting')).toHaveLength(1);
  });
});

// ── Reopen the newest completed recovery block (#839) ──────────────────────

describe('Recovery Block reopen flow', () => {
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const {
    RECOVERY_BLOCKS_KEY,
    RECOVERY_BLOCK_WEEKS_KEY,
    RECOVERY_OPERATION_JOURNAL_KEY,
  } = require('../storage/entries/keys');
  const journalModule = require('../storage/entries/recoveryOperationJournal');

  const baselineNote = { id: 'baseline1', title: 'Push Day', raw_text: 'Push\n-Bench\n100 5,5,5', updated_at: '2026-01-01T00:00:00.000Z' };
  // A SECOND, unused routine: `baselineNote` is already `completedBlockFixture`'s
  // frozen baseline (via `baseline_note_id`), so it is not itself eligible to
  // start a NEW block (isEligibleBaselineNote excludes any note already tied to
  // a block, live or completed). Coexistence tests need a genuinely eligible
  // baseline for Start alongside Reopen.
  const otherBaselineNote = { id: 'baseline2', title: 'Pull Day', raw_text: 'Pull\n-Row\n80 5,5,5', updated_at: '2026-01-02T00:00:00.000Z' };

  const completedBlockFixture = {
    id: 'rb-done',
    baseline_note_id: baselineNote.id,
    baseline_note_title: 'Push Day',
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-02-01T00:00:00.000Z',
    deleted_at: null,
  };
  const completedWeekFixture = {
    id: 'rw-done-1', block_id: 'rb-done', note_id: 'week1note', week_number: 1,
    completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null,
  };

  let refresh, alertSpy, uncompleteBlockSpy;
  let recoveryState;

  const readPersistedBlocks = async () => JSON.parse((await AsyncStorage.getItem(RECOVERY_BLOCKS_KEY)) || '[]');

  // A stateful mock (unlike the static fixtures the Week-2+ suite above uses)
  // is needed here specifically to prove row disappearance after success: the
  // rendered "Start"/"Reopen" rows both derive from `activeBlock`/`blocks`
  // read straight from `useRecoveryBlockState`, so proving they vanish once a
  // block becomes active requires that mock to actually reflect the write —
  // not just a persisted-storage assertion.
  const setup = ({ notes, blocks = [completedBlockFixture], weeks = [completedWeekFixture], activeBlock = null } = {}) => {
    refresh = jest.fn();
    recoveryState = { activeBlock, blocks, weeks };

    useEntries.useWorkoutNotes.mockReturnValue({
      notes, currentId: baselineNote.id, currentNote: baselineNote, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(),
      selectCurrent: jest.fn(), update: jest.fn(), add: jest.fn(), remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useRecoveryBlockState.mockImplementation(() => ({
      activeBlock: recoveryState.activeBlock,
      blocks: recoveryState.blocks,
      weeks: recoveryState.weeks,
      recoveryWeekNumberByNoteId: {},
      loading: false,
      error: null,
      refresh,
    }));
    useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });
    useEntries.isEligibleBaselineNote.mockImplementation(jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleBaselineNote);
    useEntries.isEligibleRecoveryWeekNote.mockImplementation(jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleRecoveryWeekNote);

    return Promise.all([
      AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify(blocks || [])),
      AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks || [])),
      AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, JSON.stringify([])),
    ]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    uncompleteBlockSpy = jest.spyOn(recoveryStorageModule, 'uncompleteRecoveryBlock');
    AsyncStorage.__store.clear();
    journalModule.__resetRecoveryOperationJournal();
  });

  afterEach(() => {
    alertSpy.mockRestore();
    uncompleteBlockSpy.mockRestore();
    journalModule.__resetRecoveryOperationJournal();
  });

  test('Start and Reopen are independent: both render together when both qualify', async () => {
    await setup({ notes: [baselineNote, otherBaselineNote] });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expect(findPressableByText(root, 'Start recovery block')).toBeTruthy();
    expect(findPressableByText(root, 'Reopen recovery block: Push Day')).toBeTruthy();
  });

  test('Reopen is absent with no eligible completed block, even though Start renders', async () => {
    await setup({ notes: [baselineNote], blocks: [], weeks: [] });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expect(findPressableByText(root, 'Start recovery block')).toBeTruthy();
    expect(root.findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('Reopen recovery block')).length).toBe(0);
  });

  test('Reopen is absent while a block is already active, even though a completed block exists', async () => {
    const activeBlockFixture = {
      id: 'rb-active', baseline_note_id: 'other', baseline_note_title: 'Other Split',
      started_at: '2026-02-01T00:00:00.000Z', completed_at: null, deleted_at: null,
    };
    await setup({ notes: [baselineNote], activeBlock: activeBlockFixture, blocks: [activeBlockFixture, completedBlockFixture] });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expect(findPressableByText(root, 'Start recovery block')).toBeNull();
    expect(root.findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('Reopen recovery block')).length).toBe(0);
  });

  test('tapping Reopen shows the #839 confirmation copy naming the baseline, with Cancel and Reopen block actions', async () => {
    await setup({ notes: [baselineNote] });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Reopen recovery block: Push Day').props.onPress(); });

    expect(alertSpy).toHaveBeenCalledWith(
      'Reopen this recovery block?',
      expect.stringContaining('Push Day'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Reopen block' }),
      ])
    );
    const [, message] = alertSpy.mock.calls[0];
    expect(message).toContain('Every week\'s status stays exactly as it is');
    expect(message).toContain('only reopen your most recently completed block');
  });

  test('confirming Reopen reactivates the block, leaves week completion untouched, refreshes, and switches to the Recovery tab', async () => {
    await setup({ notes: [baselineNote] });
    uncompleteBlockSpy.mockResolvedValue({ ...completedBlockFixture, completed_at: null, updated_at: '2026-03-01T00:00:00.000Z' });
    // The refresh callback stands in for the real re-read: it flips the shared
    // mock state to what storage now holds, which is what proves both rows
    // disappear once a block is active (#839's "both entry rows disappear").
    refresh = jest.fn(() => {
      recoveryState = {
        activeBlock: { ...completedBlockFixture, completed_at: null },
        blocks: [{ ...completedBlockFixture, completed_at: null }],
        weeks: [completedWeekFixture],
      };
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Reopen recovery block: Push Day').props.onPress(); });
    const buttons = alertSpy.mock.calls[0][2];
    await render.act(async () => { await buttons.find(b => b.text === 'Reopen block').onPress(); });

    expect(uncompleteBlockSpy).toHaveBeenCalledWith('rb-done');
    expect(refresh).toHaveBeenCalled();
    // Week completion state is exactly as it was — reopening the block never
    // reopens its latest week (#836 stays independent of #839).
    expect(completedWeekFixture.completed_at).toBe('2026-01-08T00:00:00.000Z');

    expect(findPressableByText(root, 'Start recovery block')).toBeNull();
    expect(root.findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('Reopen recovery block')).length).toBe(0);
  });

  test('a rejected reopen surfaces a truthful error and makes no mutation', async () => {
    await setup({ notes: [baselineNote] });
    uncompleteBlockSpy.mockRejectedValue(Object.assign(new Error('Only the most recently completed recovery block can be reopened.'), { code: 'BLOCK_NOT_NEWEST_COMPLETED' }));

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Reopen recovery block: Push Day').props.onPress(); });
    const buttons = alertSpy.mock.calls[0][2];
    await render.act(async () => { await buttons.find(b => b.text === 'Reopen block').onPress(); });

    expect(alertSpy).toHaveBeenCalledWith(
      'Could not reopen this recovery block',
      'Only the most recently completed recovery block can be reopened.'
    );
    expect((await readPersistedBlocks()).find(b => b.id === 'rb-done').completed_at).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  test('a busy reopen prevents a double action: a second confirm press is rejected, not a second storage write', async () => {
    await setup({ notes: [baselineNote] });
    let releaseReopen;
    uncompleteBlockSpy.mockImplementation(() => new Promise(resolve => { releaseReopen = resolve; }));

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    render.act(() => { findPressableByText(root, 'Reopen recovery block: Push Day').props.onPress(); });
    const confirmOnPress = alertSpy.mock.calls[0][2].find(b => b.text === 'Reopen block').onPress;
    let firstPromise;
    render.act(() => { firstPromise = confirmOnPress(); });
    // A second confirm press while the first is still in flight — the same
    // shape as double-tapping a slow-to-dismiss native alert.
    await render.act(async () => { await confirmOnPress(); });

    expect(uncompleteBlockSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      'Could not reopen this recovery block',
      'Another recovery action is already in progress.'
    );

    await render.act(async () => {
      releaseReopen({ ...completedBlockFixture, completed_at: null });
      await firstPromise;
    });
    expect(uncompleteBlockSpy).toHaveBeenCalledTimes(1);
  });
});

// ── Recovery inclusion preference (#699) ────────────────────────────────────
//
// The per-block "Include recovery notes in normal analytics" control. Its whole
// job is to write ONE field on ONE block, so these tests assert against what is
// actually persisted, not against optimistic UI state.

describe('Recovery inclusion preference', () => {
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const journalModule = require('../storage/entries/recoveryOperationJournal');
  const { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY, RECOVERY_OPERATION_JOURNAL_KEY } =
    require('../storage/entries/keys');

  const baselineNote = { id: 'baseline1', title: 'Push Day', raw_text: 'Push\n-Bench\n100 5,5,5', updated_at: '2026-01-01T00:00:00.000Z' };
  const weekNote = { id: 'week1note', title: 'Recovery Week 1 Note', raw_text: 'Push\n-Bench\n60 5,5,5', updated_at: '2026-01-08T00:00:00.000Z' };

  const activeBlock = {
    id: 'rbActive',
    baseline_note_id: baselineNote.id,
    baseline_note_title: 'Push Day',
    baseline: { version: 1, exercises: [] },
    include_in_normal_analytics: false,
    started_at: '2026-05-01T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  };
  const completedBlockOn = {
    ...activeBlock,
    id: 'rbDoneOn',
    baseline_note_title: 'Old Legs Day',
    include_in_normal_analytics: true,
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-02-01T00:00:00.000Z',
  };
  const completedBlockOff = {
    ...activeBlock,
    id: 'rbDoneOff',
    baseline_note_title: 'Older Push Day',
    include_in_normal_analytics: false,
    started_at: '2025-11-01T00:00:00.000Z',
    completed_at: '2025-12-01T00:00:00.000Z',
  };

  const weeks = [{ id: 'rw1', block_id: 'rbActive', note_id: weekNote.id, week_number: 1, completed_at: null, deleted_at: null }];

  const setup = async ({ blocks = [activeBlock], pendingRecovery = [] } = {}) => {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [baselineNote, weekNote], currentId: baselineNote.id, currentNote: baselineNote,
      deloadNotes: [], loading: false, error: null, refresh: jest.fn(),
      selectCurrent: jest.fn(), update: jest.fn(), add: jest.fn(), remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock: blocks.find(b => !b.completed_at) || null,
      blocks,
      weeks,
      recoveryWeekNumberByNoteId: { [weekNote.id]: 1 },
      loading: false,
      error: null,
      refresh: jest.fn(),
      pendingRecovery,
      recoveryPendingError: null,
      retryRecovery: jest.fn(),
    });
    useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });

    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify(blocks));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks));
    await AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, JSON.stringify([]));
  };

  // `Counting in normal analytics` IS the Log-surface inclusion control now
  // (#843 review): a tap on the row itself writes the field directly — there
  // is no separate `RecoveryInclusionToggle` Switch nested under it. Log
  // only ever shows one row (the one active block), so a live lookup by role
  // is enough; it is re-run after every `act()` rather than cached, since
  // the row's own accessibilityLabel/state changes with the value.
  const inclusionRow = (root) => root.findAll(
    n => n.props && n.props.accessibilityRole === 'switch' && typeof n.props.onPress === 'function'
  )[0];

  const renderScreen = async () => {
    let component;
    await render.act(async () => { component = render.create(<ControlledLogScreen />); });
    // The inclusion control is still on Log and still the only way to set this
    // preference while a block is active, but it is no longer in the default
    // view: it lives inside `Manage recovery block` (#789), as the
    // `Counting in normal analytics` row itself (#843). Every assertion in
    // this suite is about the control's behavior, so open the disclosure
    // once here rather than restating the interaction in each test.
    expandManageRecovery(component.root);
    return component;
  };

  const persistedBlocks = async () => JSON.parse((await AsyncStorage.getItem(RECOVERY_BLOCKS_KEY)) || '[]');

  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.__store.clear();
    journalModule.__resetRecoveryOperationJournal();
  });

  test('the active block exposes the control with the exact label, switch role, and unchecked state', async () => {
    await setup();
    const component = await renderScreen();
    const control = inclusionRow(component.root);

    expect(control).toBeTruthy();
    expect(control.props.accessibilityRole).toBe('switch');
    // Default off (#692): the control must report the authored preference.
    expect(control.props.accessibilityLabel).toBe('Counting in normal analytics: Off');
    expect(control.props.accessibilityState).toEqual({ checked: false, disabled: false, busy: false });
  });

  test('toggling it on persists exactly that field and nothing else', async () => {
    await setup();
    const component = await renderScreen();

    await render.act(async () => { await inclusionRow(component.root).props.onPress(); });

    const [stored] = await persistedBlocks();
    expect(stored.include_in_normal_analytics).toBe(true);
    // The frozen baseline and lifecycle state are untouched by the patch.
    expect(stored.baseline).toEqual(activeBlock.baseline);
    expect(stored.started_at).toBe(activeBlock.started_at);
    expect(stored.completed_at).toBeNull();
  });

  test('the change reaches mounted analytics subscribers live, without a remount', async () => {
    const { useRecoveryAnalyticsFilter, _resetRecoveryAnalyticsFilterCache } =
      require('../hooks/entries/recoveryBlockHooks');
    _resetRecoveryAnalyticsFilterCache();
    await setup();

    // A stand-in for Home/Analytics: it subscribes to the same boundary those
    // screens read, and must repopulate off the toggle alone.
    const seen = [];
    function FilterProbe() {
      seen.push(useRecoveryAnalyticsFilter());
      return null;
    }
    const Harness = () => (
      <React.Fragment>
        <FilterProbe />
        <ControlledLogScreen />
      </React.Fragment>
    );

    let component;
    await render.act(async () => { component = render.create(<Harness />); });

    // Default off: the linked note is out of ordinary analytics.
    expect(seen[seen.length - 1].isNoteExcluded(weekNote.id)).toBe(true);

    expandManageRecovery(component.root);
    await render.act(async () => { await inclusionRow(component.root).props.onPress(); });

    // Same mounted subscriber, no remount: the note is back in.
    expect(seen[seen.length - 1].isNoteExcluded(weekNote.id)).toBe(false);

    // The row toggles relative to the CURRENT value, so — since this test's
    // `useRecoveryBlockState` mock is static — reflect the write that just
    // landed before pressing again, via `component.update` (reconciliation
    // against the SAME mounted tree, not a fresh mount/unmount).
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock: { ...activeBlock, include_in_normal_analytics: true },
      blocks: [{ ...activeBlock, include_in_normal_analytics: true }],
      weeks,
      recoveryWeekNumberByNoteId: { [weekNote.id]: 1 },
      loading: false, error: null, refresh: jest.fn(),
      pendingRecovery: [], recoveryPendingError: null, retryRecovery: jest.fn(),
    });
    await render.act(async () => { component.update(<Harness />); });

    await render.act(async () => { await inclusionRow(component.root).props.onPress(); });
    expect(seen[seen.length - 1].isNoteExcluded(weekNote.id)).toBe(true);

    await render.act(async () => { component.unmount(); });
    _resetRecoveryAnalyticsFilterCache();
  });

  test('toggling it back off restores exclusion, and the persisted note records are never rewritten', async () => {
    await setup({ blocks: [{ ...activeBlock, include_in_normal_analytics: true }] });
    const component = await renderScreen();
    const control = inclusionRow(component.root);
    expect(control.props.accessibilityState.checked).toBe(true);

    const weeksBefore = await AsyncStorage.getItem(RECOVERY_BLOCK_WEEKS_KEY);
    await render.act(async () => { await control.props.onPress(); });

    const [stored] = await persistedBlocks();
    expect(stored.include_in_normal_analytics).toBe(false);
    expect(await AsyncStorage.getItem(RECOVERY_BLOCK_WEEKS_KEY)).toBe(weeksBefore);
  });

  test('the active block\'s own stored preference is exposed even with completed blocks in storage', async () => {
    // Log exposes only the active block's inclusion control; completed-block
    // controls live on Analytics (#728). Both completed blocks are in
    // storage but must not produce a second row here.
    await setup({ blocks: [activeBlock, completedBlockOn, completedBlockOff] });
    const component = await renderScreen();
    const controls = component.root.findAll(
      n => n.props && n.props.accessibilityRole === 'switch' && typeof n.props.onPress === 'function'
    );

    expect(controls).toHaveLength(1);
    expect(controls[0].props.accessibilityState.checked).toBe(false);
  });

  test('an in-flight write disables the control, and re-enables once it settles', async () => {
    await setup({ blocks: [activeBlock] });
    let resolveWrite;
    const updateSpy = jest.spyOn(recoveryStorageModule, 'updateRecoveryBlock')
      .mockImplementation(() => new Promise((resolve) => { resolveWrite = resolve; }));

    const component = await renderScreen();
    expect(inclusionRow(component.root).props.accessibilityState.disabled).toBe(false);

    // Start the write and leave it in flight: the guarded action reaches
    // storage after a few microtasks, and the mock never settles.
    await render.act(async () => { inclusionRow(component.root).props.onPress(); });

    expect(inclusionRow(component.root).props.disabled).toBe(true);
    expect(inclusionRow(component.root).props.accessibilityState.disabled).toBe(true);

    await render.act(async () => {
      resolveWrite({ ...activeBlock, include_in_normal_analytics: true });
    });

    // Interactive again once the write settles.
    expect(inclusionRow(component.root).props.accessibilityState.disabled).toBe(false);
    updateSpy.mockRestore();
  });

  test('a pending recovery operation disables the control rather than letting it race', async () => {
    await setup({
      pendingRecovery: [{ operation_id: 1, block_id: 'rbActive', error: 'A recovery change is still being applied on this device.' }],
    });
    const component = await renderScreen();
    const control = inclusionRow(component.root);

    expect(control.props.disabled).toBe(true);
    expect(control.props.accessibilityState.disabled).toBe(true);
    expect(control.props.accessibilityState.checked).toBe(false);
  });

  test('a rejected write surfaces an honest error and leaves the stored preference alone', async () => {
    await setup();
    const updateSpy = jest.spyOn(recoveryStorageModule, 'updateRecoveryBlock')
      .mockRejectedValue(Object.assign(new Error('Recovery block rbActive is deleted.'), { code: 'BLOCK_NOT_FOUND' }));
    const component = await renderScreen();

    await render.act(async () => { await inclusionRow(component.root).props.onPress(); });

    const texts = component.root.findAllByType('Text').map(t => {
      const c = t.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
    expect(texts).toContain('Recovery block rbActive is deleted.');
    const [stored] = await persistedBlocks();
    expect(stored.include_in_normal_analytics).toBe(false);
    // The control still reports the PERSISTED value, not the attempted one.
    expect(inclusionRow(component.root).props.accessibilityState.checked).toBe(false);

    updateSpy.mockRestore();
  });
});

// ── Save-time classification and the recovery boundary (#699) ───────────────
//
// `exercise_classifications` is a cross-note aggregate cached onto the saved
// note, and Home renders the stored value back as its session-status rows. If
// the save path used a different population from the render path, an excluded
// recovery week would leak into Home through this cache. These tests drive the
// real editor hook against real persisted recovery records.

describe('save-time exercise classifications respect the recovery boundary', () => {
  const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } = require('../storage/entries/keys');

  // Two logged sessions of the same lift. The ordinary note progresses; the
  // recovery week is far lighter, which flips the classification the moment it
  // is admitted.
  const CURRENT_RAW = 'Monday\n+Lifting\n-Squat\n- 315 5,5\n- 320 5,5';
  const RECOVERY_RAW = 'Monday\n+Lifting\n-Squat\n- 45 5,5';

  const currentNote = { id: 'note1', title: 'Push Day', raw_text: CURRENT_RAW };
  const recoveryNote = { id: 'recoverynote', title: 'Recovery Week 1', raw_text: RECOVERY_RAW };

  const block = (include) => ({
    id: 'rb1',
    baseline_note_id: 'note1',
    baseline_note_title: 'Push Day',
    baseline: { version: 1, exercises: [] },
    include_in_normal_analytics: include,
    started_at: '2026-05-01T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  });
  const weeks = [{
    id: 'rw1', block_id: 'rb1', note_id: 'recoverynote', week_number: 1,
    completed_at: null, deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
  }];

  const mounted = [];
  afterEach(() => {
    render.act(() => { mounted.forEach(c => c.unmount()); });
    mounted.length = 0;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.__store.clear();
  });

  async function saveOnce() {
    const update = jest.fn(async (_id, patch) => ({ id: 'note1', title: patch.title || 'Push Day', raw_text: CURRENT_RAW }));
    let latest = null;
    function Harness() {
      const [text, setText] = React.useState(CURRENT_RAW);
      const [title, setTitle] = React.useState('Push Day');
      latest = useLogCurrentRoutineEditor({
        workoutNoteText: text, setWorkoutNoteText: setText,
        workoutNoteTitle: title, setWorkoutNoteTitle: setTitle,
        currentId: 'note1', currentNote, notes: [currentNote, recoveryNote],
        trackedLifts: [], update, add: jest.fn(), selectCurrent: jest.fn(),
        fatigueTrackingEnabled: false, onCheckInPrompt: jest.fn(), isActive: true,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<Harness />)); });
    await render.act(async () => { await latest.handleSave({}); });
    return update;
  }

  test('an excluded recovery week never enters the classifications written to the note', async () => {
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block(false)]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks));

    const update = await saveOnce();
    const excludedPatch = update.mock.calls[0][1];

    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block(true)]));
    const includedUpdate = await saveOnce();
    const includedPatch = includedUpdate.mock.calls[0][1];

    // Both saves wrote a classification map — the boundary decides its content,
    // not whether it exists.
    expect(excludedPatch.exercise_classifications).toBeTruthy();
    expect(includedPatch.exercise_classifications).toBeTruthy();
    // Admitting the light rehab session changes what the lift is classified as,
    // which is exactly the leak this boundary prevents when the preference is off.
    expect(excludedPatch.exercise_classifications.squat).toBe('progressing');
    expect(includedPatch.exercise_classifications.squat).toBe('regressing');
  });

  test('a recovery read failure saves the text but writes no classification at all', async () => {
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('storage unavailable'));

    const update = await saveOnce();
    const patch = update.mock.calls[0][1];

    // The user's writing is never lost to an analytics read.
    expect(patch.raw_text).toBe(CURRENT_RAW);
    expect(patch.title).toBe('Push Day');
    // But no aggregate is written, so a possibly-leaky value cannot replace the
    // stored one. The next successful save repairs it.
    expect('exercise_classifications' in patch).toBe(false);
  });
});

// ── #699 review: the boundary subscriber's freshness and failure behavior ────

describe('useRecoveryAnalyticsFilter freshness and fail-closed reads', () => {
  const hooks = require('../hooks/entries/recoveryBlockHooks');
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } = require('../storage/entries/keys');

  const block = {
    id: 'rb1', baseline_note_id: 'baseline', baseline_note_title: 'Push Day',
    baseline: { version: 1, exercises: [] }, include_in_normal_analytics: false,
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
  };
  const week = {
    id: 'rw1', block_id: 'rb1', note_id: 'recoverynote', week_number: 1,
    completed_at: null, deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
  };

  const mounted = [];
  const seen = [];

  function Probe() {
    seen.push(hooks.useRecoveryAnalyticsFilter());
    return null;
  }
  const latest = () => seen[seen.length - 1];

  const mountProbe = async () => {
    await render.act(async () => { mounted.push(render.create(<Probe />)); });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    AsyncStorage.__store.clear();
    seen.length = 0;
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  afterEach(async () => {
    await render.act(async () => { mounted.forEach(c => c.unmount()); });
    mounted.length = 0;
    jest.restoreAllMocks();
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  test('a restored local backup refreshes every mounted subscriber', async () => {
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([]));
    await mountProbe();
    expect(latest().ready).toBe(true);
    expect(latest().isNoteExcluded('recoverynote')).toBe(false);

    // Stand-in for importBackup's `replace` path: it rewrites both collections
    // directly, with no lifecycle action and no sync to announce it.
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([week]));
    // Mounted screens are still serving the pre-import boundary until told.
    expect(latest().isNoteExcluded('recoverynote')).toBe(false);

    await render.act(async () => { hooks.reloadRecoveryBlocks(); });

    expect(latest().isNoteExcluded('recoverynote')).toBe(true);
  });

  test('a cold-start read failure reports an UNVERIFIED boundary instead of "nothing excluded"', async () => {
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('storage unavailable'));

    await mountProbe();

    // The empty snapshot is a placeholder, not evidence. Consumers see this and
    // hold their loading state rather than publishing ordinary analytics.
    expect(latest().ready).toBe(false);
    // And it still hides nothing, so a bad read can never remove an unrelated
    // ordinary note from the population.
    const notes = [{ id: 'ordinary' }, { id: 'recoverynote' }];
    expect(latest().filterNotes(notes)).toBe(notes);
  });

  test('a failed cold-start read retries on its own and publishes once storage recovers', async () => {
    const spy = jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('storage unavailable'));
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([week]));

    await mountProbe();
    expect(latest().ready).toBe(false);

    // Storage comes back. Nothing else in the app needs to notice: the hook's
    // own bounded retry is what clears the loading state for a local-only user
    // who may never produce a recovery mutation or a sync.
    spy.mockRestore();
    await render.act(async () => { await new Promise(r => setTimeout(r, 600)); });

    expect(latest().ready).toBe(true);
    expect(latest().isNoteExcluded('recoverynote')).toBe(true);
  });

  test('a later read failure keeps the last verified boundary rather than reverting to unfiltered', async () => {
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([week]));
    await mountProbe();
    expect(latest().isNoteExcluded('recoverynote')).toBe(true);

    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('storage unavailable'));
    await render.act(async () => { hooks.reloadRecoveryBlocks(); });

    expect(latest().ready).toBe(true);
    expect(latest().isNoteExcluded('recoverynote')).toBe(true);
  });
});

// ── #716: one authoritative Recovery read-and-reconcile contract ─────────────

describe('authoritative Recovery state contract (#716)', () => {
  const hooks = require('../hooks/entries/recoveryBlockHooks');
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const journalModule = require('../storage/entries/recoveryOperationJournal');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } = require('../storage/entries/keys');

  const block = {
    id: 'rb716', baseline_note_id: 'baseline', baseline_note_title: 'Push Day',
    baseline: { version: 1, exercises: [] }, include_in_normal_analytics: false,
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
  };
  const week = {
    id: 'rw716', block_id: 'rb716', note_id: 'recoverynote', week_number: 1,
    completed_at: null, deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
  };

  const mounted = [];
  const seen = [];

  function Probe({ bucket }) {
    bucket.push(hooks.useRecoveryBlockState());
    return null;
  }
  const latestOf = (bucket) => bucket[bucket.length - 1];
  const latest = () => latestOf(seen);

  const mountProbe = async (bucket = seen) => {
    await render.act(async () => {
      mounted.push(render.create(<Probe bucket={bucket} />));
    });
  };

  const seedRecords = async (blocks, weeks) => {
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify(blocks));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.__store.clear();
    seen.length = 0;
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  afterEach(async () => {
    await render.act(async () => { mounted.forEach(c => c.unmount()); });
    mounted.length = 0;
    jest.restoreAllMocks();
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  test('a successful cold load reports ready, allows mutations, and is not stale', async () => {
    await seedRecords([block], [week]);
    await mountProbe();

    expect(latest().status).toBe(hooks.RECOVERY_STATUS.READY);
    expect(latest().ready).toBe(true);
    expect(latest().loading).toBe(false);
    expect(latest().stale).toBe(false);
    expect(latest().error).toBe(null);
    expect(latest().mutationsAllowed).toBe(true);
    expect(latest().activeBlock.id).toBe('rb716');
  });

  test('a terminal first-load failure is an error state, never a verified-empty one', async () => {
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('recovery key unreadable'));
    await mountProbe();

    // The arrays are empty, but nothing may treat that as "no recovery blocks":
    // `ready` is what separates a verified empty result from an unknown one.
    expect(latest().blocks).toEqual([]);
    expect(latest().ready).toBe(false);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.ERROR);
    expect(latest().error).toBeTruthy();
    // A terminal failure is distinguishable from initial progress: it is not
    // loading, so the UI shows a retry path instead of an endless spinner.
    expect(latest().loading).toBe(false);
    expect(latest().refreshing).toBe(false);
    expect(latest().mutationsAllowed).toBe(false);
  });

  test('retry after a terminal first-load failure reaches the verified state', async () => {
    const loadSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValueOnce(new Error('recovery key unreadable'));
    await mountProbe();
    expect(latest().ready).toBe(false);

    await seedRecords([block], [week]);
    loadSpy.mockRestore();
    await render.act(async () => { await latest().retryRecovery(); });

    expect(latest().ready).toBe(true);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.READY);
    expect(latest().error).toBe(null);
    expect(latest().activeBlock.id).toBe('rb716');
  });

  test('a refresh failure keeps last-known-good data visible and marks it stale', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    const goodBlocks = latest().blocks;
    expect(latest().ready).toBe(true);

    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('transient read failure'));
    await render.act(async () => { await latest().refresh(); });

    // Last-known-good survives the failure, identity included, and is labelled.
    expect(latest().blocks).toBe(goodBlocks);
    expect(latest().activeBlock.id).toBe('rb716');
    expect(latest().ready).toBe(true);
    expect(latest().stale).toBe(true);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.STALE);
    expect(latest().staleError).toBeTruthy();
    // A stale snapshot is still verified persisted state, so it is not an
    // unverified read and does not have to freeze mutations.
    expect(latest().mutationsAllowed).toBe(true);
  });

  test('two simultaneously mounted consumers share exactly one reconciliation pass, not a coalesced follow-up', async () => {
    await seedRecords([block], [week]);

    let readCount = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const real = recoveryStorageModule.loadRecoveryBlocks;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(async () => {
      readCount += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      try {
        return await real();
      } finally {
        concurrent -= 1;
      }
    });

    const logBucket = [];
    const analyticsBucket = [];
    await render.act(async () => {
      mounted.push(render.create(<Probe bucket={logBucket} />));
      mounted.push(render.create(<Probe bucket={analyticsBucket} />));
    });

    expect(maxConcurrent).toBe(1);
    // Not merely "never concurrent" — genuinely ONE shared pass. The second
    // mount, joining the subscriber base while the first mount's pass is
    // already in flight, must NOT trigger its own coalesced follow-up read;
    // it subscribes to the SAME pass instead (#711 review finding 3, round 2).
    expect(readCount).toBe(1);
    // Not merely equal — the SAME published object, which is what makes
    // divergent reconciliation results structurally impossible.
    expect(latestOf(logBucket).blocks).toBe(latestOf(analyticsBucket).blocks);
    expect(latestOf(logBucket).weeks).toBe(latestOf(analyticsBucket).weeks);
    expect(latestOf(logBucket).ready).toBe(latestOf(analyticsBucket).ready);
    expect(latestOf(logBucket).status).toBe(latestOf(analyticsBucket).status);
  });

  // #711 review finding 3 (round 2): the earlier fix only deduplicated the
  // MOUNT-time read. Every mounted `useRecoveryBlockState` instance still
  // registered its own `recoveryListeners` entry and its own sync-completion
  // subscription, so a LATER automatic signal (a mutation/import
  // notification, a completed cloud sync) still invoked one
  // `refreshRecoveryState()` call per mounted consumer — and since that
  // function guarantees a fresh follow-up pass for any caller arriving while
  // one is in flight, two consumers on the same later signal still produced
  // two full passes. These tests mount Log+Analytics FIRST (past the initial
  // mount-time read), then fire a signal, and prove exactly one read results.
  test('a post-mount recovery notification triggers exactly one shared pass across two mounted consumers', async () => {
    await seedRecords([block], [week]);

    const logBucket = [];
    const analyticsBucket = [];
    await render.act(async () => {
      mounted.push(render.create(<Probe bucket={logBucket} />));
      mounted.push(render.create(<Probe bucket={analyticsBucket} />));
    });
    expect(latestOf(logBucket).ready).toBe(true);

    let readCount = 0;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(async () => {
      readCount += 1;
      return [block];
    });

    // `reloadRecoveryBlocks` fires the same private `recoveryListeners`
    // notification a local recovery mutation or a restored backup would.
    await render.act(async () => { hooks.reloadRecoveryBlocks(); });

    expect(readCount).toBe(1);
    expect(latestOf(logBucket).blocks).toBe(latestOf(analyticsBucket).blocks);
  });

  test('a post-mount cloud-sync completion triggers exactly one shared pass, and only one sync subscription is registered', async () => {
    await seedRecords([block], [week]);
    const syncRecoveryModule = require('../storage/syncRecovery');

    let subscribeCallCount = 0;
    const syncListeners = [];
    const subscribeSpy = jest.spyOn(syncRecoveryModule, 'subscribeSyncState').mockImplementation((listener) => {
      subscribeCallCount += 1;
      syncListeners.push(listener);
      return () => {};
    });

    const logBucket = [];
    const analyticsBucket = [];
    await render.act(async () => {
      mounted.push(render.create(<Probe bucket={logBucket} />));
      mounted.push(render.create(<Probe bucket={analyticsBucket} />));
    });

    // Exactly one subscription for two simultaneously mounted consumers.
    expect(subscribeCallCount).toBe(1);
    expect(syncListeners.length).toBe(1);

    let readCount = 0;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(async () => {
      readCount += 1;
      return [block];
    });

    await render.act(async () => {
      syncListeners[0]({ [syncRecoveryModule.SYNC_PHASE.SYNC]: { status: syncRecoveryModule.SYNC_STATUS.COMPLETE } });
    });

    expect(readCount).toBe(1);
    expect(latestOf(logBucket).blocks).toBe(latestOf(analyticsBucket).blocks);
    subscribeSpy.mockRestore();
  });

  test('after the shared subscription owner unmounts, a remaining consumer keeps working and a later solo mount resubscribes', async () => {
    await seedRecords([block], [week]);

    const logBucket = [];
    const analyticsBucket = [];
    let logComponent;
    await render.act(async () => {
      logComponent = render.create(<Probe bucket={logBucket} />);
      mounted.push(logComponent);
      mounted.push(render.create(<Probe bucket={analyticsBucket} />));
    });
    expect(latestOf(analyticsBucket).ready).toBe(true);

    // Unmount the FIRST-mounted (subscription-owning) consumer while the
    // second is still mounted. The shared subscription must transfer, not
    // disappear — the surviving consumer still reacts to later signals.
    await render.act(async () => { logComponent.unmount(); });
    mounted.splice(mounted.indexOf(logComponent), 1);

    let readCount = 0;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(async () => {
      readCount += 1;
      return [block];
    });
    await render.act(async () => { hooks.reloadRecoveryBlocks(); });
    expect(readCount).toBe(1);
    expect(latestOf(analyticsBucket).blocks[0]).toBeTruthy();
  });

  // #711 review finding 1 (round 3): round 2's fix bound `verified` onto a
  // SINGLE shared snapshot object, which closed the trust leak but destroyed
  // last-known-good retention — a later, less-trusted filter read publishing
  // DIFFERENT content replaced the very record `useRecoveryBlockState`
  // rendered, so Log immediately stopped showing previously-verified data
  // (and a subsequent refresh failure then mis-resolved to terminal ERROR
  // instead of STALE, because it saw that replacement as "never verified").
  // The structural fix is TWO independent snapshots — `useRecoveryBlockState`
  // and `useRecoveryAnalyticsFilter` each read their own module-level record,
  // and a filter-only publish can never touch the one Log renders.
  test('a later unreconciled filter read that returns DIFFERENT records updates the filter, but never touches what Log renders or its mutation trust', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);
    expect(latest().mutationsAllowed).toBe(true);
    const verifiedBlocks = latest().blocks;

    // Different content from what was authoritatively verified — e.g. another
    // device's write landed between the authoritative read and this one.
    const changedBlock = { ...block, updated_at: '2026-05-02T00:00:00.000Z' };
    await seedRecords([changedBlock], [week]);

    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });

    // The filter itself picks up the new data — a raw read is adequate
    // evidence for its own exclusion-boundary purpose, and it is free to move
    // forward on unreconciled data because it never authorizes a mutation.
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);
    // But `useRecoveryBlockState` — the authoritative, mutation-gating
    // consumer — must keep rendering the LAST-KNOWN-GOOD verified data
    // (same object, even), completely unaffected by the filter's read. This
    // is the last-known-good retention issue #716 locks in: it must never be
    // silently evicted by an unrelated, less-trusted read.
    expect(latest().blocks).toBe(verifiedBlocks);
    expect(latest().blocks[0].updated_at).toBe('2026-05-01T00:00:00.000Z');
    expect(latest().ready).toBe(true);
    expect(latest().mutationsAllowed).toBe(true);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.READY);
  });

  // The reviewer's specifically requested regression: a refresh FAILURE after
  // a filter publish must still degrade to STALE with the previously-verified
  // data visible — never to terminal ERROR. Round 2's shared-object design
  // broke exactly this, because the filter publish had already overwritten
  // the "was anything ever verified" record the failure path checks.
  test('a refresh failure after an intervening filter publish still degrades to STALE with the previously-verified data visible, never ERROR', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);
    const verifiedBlocks = latest().blocks;
    const verifiedWeeks = latest().weeks;

    // An unrelated filter mount reads (possibly different) unreconciled data
    // in between — this must not affect what the failure path below sees.
    const changedBlock = { ...block, updated_at: '2026-05-02T00:00:00.000Z' };
    await seedRecords([changedBlock], [week]);
    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);

    // Now the NEXT authoritative refresh genuinely fails.
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('transient read failure'));
    await render.act(async () => { await latest().refresh(); });

    // STALE, not ERROR — and the data on screen is still the last GENUINELY
    // verified snapshot, not the filter's unreconciled one and not an empty
    // placeholder.
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.STALE);
    expect(latest().error).toBe(null);
    expect(latest().staleError).toBeTruthy();
    expect(latest().blocks).toBe(verifiedBlocks);
    expect(latest().weeks).toBe(verifiedWeeks);
    expect(latest().ready).toBe(true);
    expect(latest().mutationsAllowed).toBe(true);
  });

  test('a later unreconciled filter read that returns the SAME records does not affect the already-verified consumer', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);

    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });

    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);
    // Identical content, and this is the steady-state case (Log and Analytics
    // both mounted, nothing changed) — Log must not flicker unready.
    expect(latest().ready).toBe(true);
    expect(latest().mutationsAllowed).toBe(true);
  });

  // #711 review finding 2 (round 2): the earlier fix added a gate call before
  // note creation in LogScreen, but `startBlock` ran its OWN second gate
  // afterward — so a gate failure discovered on that second call still
  // arrived after the note had already been persisted. The fix folds note
  // creation inside `useStartRecoveryBlock.startBlock` itself, behind exactly
  // one gate, so there is no second decision point left to bypass. These
  // tests exercise the REAL hook end-to-end (not LogScreen's mocked
  // `startBlock`) to prove that.
  describe('useStartRecoveryBlock: the gate precedes the new-note write, not just the block write', () => {
    test('an unverified read gate rejects before the Week-1 note is ever created', async () => {
      jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
        .mockRejectedValue(new Error('recovery key unreadable'));
      const createWeekNote = jest.fn().mockResolvedValue({ id: 'shouldNeverExist' });

      const startSeen = [];
      function StartProbe() {
        startSeen.push(hooks.useStartRecoveryBlock());
        return null;
      }
      await render.act(async () => { mounted.push(render.create(<StartProbe />)); });

      let result;
      await render.act(async () => {
        result = await startSeen[startSeen.length - 1].startBlock({
          baselineNoteId: 'baseline', baselineNoteTitle: 'Push Day', baselineNoteText: '',
          weekNoteId: null, createWeekNote,
        });
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('RECOVERY_STATE_UNVERIFIED');
      expect(createWeekNote).not.toHaveBeenCalled();
    });

    test('a corrupt journal discovered by the gate rejects before the Week-1 note is ever created', async () => {
      const corruptResult = {
        ok: false, code: 'JOURNAL_CORRUPT', corrupt: true, pending: [], cancelled: [], results: [],
        error: 'Recovery operations could not be read from this device. Recovery actions are paused until this is retried.',
        cause: null,
      };
      const reconcileSpy = jest.spyOn(journalModule, 'reconcileRecoveryOperations').mockResolvedValue(corruptResult);
      const createWeekNote = jest.fn().mockResolvedValue({ id: 'shouldNeverExist' });

      const startSeen = [];
      function StartProbe() {
        startSeen.push(hooks.useStartRecoveryBlock());
        return null;
      }
      await render.act(async () => { mounted.push(render.create(<StartProbe />)); });

      let result;
      await render.act(async () => {
        result = await startSeen[startSeen.length - 1].startBlock({
          baselineNoteId: 'baseline', baselineNoteTitle: 'Push Day', baselineNoteText: '',
          weekNoteId: null, createWeekNote,
        });
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('RECOVERY_JOURNAL_CORRUPT');
      expect(createWeekNote).not.toHaveBeenCalled();
      reconcileSpy.mockRestore();
    });

    test('a passing gate creates the note exactly once, then starts the block with its id', async () => {
      await seedRecords([], []);
      const createWeekNote = jest.fn().mockResolvedValue({ id: 'newnote-x' });
      const createSpy = jest.spyOn(recoveryStorageModule, 'createRecoveryBlock').mockResolvedValue({ id: 'rbX' });
      const addWeekSpy = jest.spyOn(recoveryStorageModule, 'addRecoveryWeek')
        .mockResolvedValue({ id: 'rwX', block_id: 'rbX', note_id: 'newnote-x', week_number: 1 });

      const startSeen = [];
      function StartProbe() {
        startSeen.push(hooks.useStartRecoveryBlock());
        return null;
      }
      await render.act(async () => { mounted.push(render.create(<StartProbe />)); });

      let result;
      await render.act(async () => {
        result = await startSeen[startSeen.length - 1].startBlock({
          baselineNoteId: 'baseline', baselineNoteTitle: 'Push Day', baselineNoteText: '',
          weekNoteId: null, createWeekNote,
        });
      });

      expect(createWeekNote).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      expect(addWeekSpy).toHaveBeenCalledWith({ blockId: 'rbX', noteId: 'newnote-x' });
      createSpy.mockRestore();
      addWeekSpy.mockRestore();
    });

    test('a note created under a passing gate is rolled back if the block/week write then fails', async () => {
      await seedRecords([], []);
      const createWeekNote = jest.fn().mockResolvedValue({ id: 'newnote-y' });
      const removeWeekNote = jest.fn().mockResolvedValue(undefined);
      const createSpy = jest.spyOn(recoveryStorageModule, 'createRecoveryBlock').mockResolvedValue({ id: 'rbY' });
      const addWeekSpy = jest.spyOn(recoveryStorageModule, 'addRecoveryWeek')
        .mockRejectedValue(Object.assign(new Error('Week-1 write failed'), { code: 'WEEK_WRITE_FAILED' }));
      const deleteSpy = jest.spyOn(recoveryStorageModule, 'deleteRecoveryBlock').mockResolvedValue({ id: 'rbY' });

      const startSeen = [];
      function StartProbe() {
        startSeen.push(hooks.useStartRecoveryBlock());
        return null;
      }
      await render.act(async () => { mounted.push(render.create(<StartProbe />)); });

      let result;
      await render.act(async () => {
        result = await startSeen[startSeen.length - 1].startBlock({
          baselineNoteId: 'baseline', baselineNoteTitle: 'Push Day', baselineNoteText: '',
          weekNoteId: null, createWeekNote, removeWeekNote,
        });
      });

      expect(result.ok).toBe(false);
      expect(deleteSpy).toHaveBeenCalledWith('rbY');
      // The orphaned note this call itself created is rolled back too — not
      // just the orphaned block.
      expect(removeWeekNote).toHaveBeenCalledWith('newnote-y');
      createSpy.mockRestore();
      addWeekSpy.mockRestore();
      deleteSpy.mockRestore();
    });
  });

  test('a mutation is rejected at confirm time while state is unverified', async () => {
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('recovery key unreadable'));
    const weeksForBlockSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryWeeksForBlock');

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });

    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECOVERY_STATE_UNVERIFIED');
    // Refused before any domain read or write: the mutation never decided
    // anything against the unverified placeholder snapshot.
    expect(weeksForBlockSpy).not.toHaveBeenCalled();
  });

  test('the confirm-time recheck re-establishes verified state and then allows the mutation', async () => {
    const loadSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValueOnce(new Error('recovery key unreadable'));

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });
    await mountProbe();
    expect(latest().ready).toBe(false);

    // The storage failure clears while the confirmation dialog is open.
    await seedRecords([block], [week]);
    loadSpy.mockRestore();

    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });

    expect(result.ok).toBe(true);
    expect(result.week.id).toBe('rw716');
    expect(latest().ready).toBe(true);
  });

  // #711 review finding (round 4): the confirm-time gate must require SUCCESS
  // FROM THE EXACT AUTHORITATIVE PASS IT AWAITED, not merely "a prior
  // snapshot exists and display status isn't ERROR". Round 3 correctly made a
  // confirm-time read failure over an already-verified snapshot degrade
  // DISPLAY to STALE-with-last-known-good rather than ERROR — but
  // `ensureVerifiedRecoveryState` then read that same STALE status back and
  // treated "not ERROR" as "safe to mutate", which is wrong: STALE means the
  // recheck this call just awaited FAILED. These three tests are the ones the
  // reviewer specifically requested.
  test('a transient confirm-time read failure over an already-verified snapshot: display goes STALE with last-known-good, but the mutation is rejected', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);
    const verifiedBlocks = latest().blocks;

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });

    // The confirm-time recheck's own read fails — a transient error, not a
    // corrupt journal.
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('transient confirm-time read failure'));
    const weeksForBlockSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryWeeksForBlock');

    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });

    // Display: STALE, with the last-known-good data still visible — this is
    // finding 1 of the prior round and must not regress.
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.STALE);
    expect(latest().blocks).toBe(verifiedBlocks);
    expect(latest().ready).toBe(true);
    // The mutation itself: rejected. THIS recheck failed, so the domain write
    // never proceeds — the storage layer's own week-lookup was never reached.
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECOVERY_STATE_UNVERIFIED');
    expect(weeksForBlockSpy).not.toHaveBeenCalled();
  });

  test('a reconciliation that resolves ok:false with pending operations rejects the mutation even though display is READY', async () => {
    await seedRecords([block], [week]);

    const pendingRecord = {
      id: 'op-pending-1', type: 'ADD_WEEK_WITH_NEW_NOTE', block_id: 'rb716',
      status: 'pending', code: 'RECONCILIATION_PENDING',
    };
    const reconcileSpy = jest.spyOn(journalModule, 'reconcileRecoveryOperations').mockResolvedValue({
      ok: false,
      code: 'RECONCILIATION_PENDING',
      corrupt: false,
      pending: [pendingRecord],
      cancelled: [],
      results: [pendingRecord],
      error: null,
      cause: null,
    });

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });
    await mountProbe();

    // Display: READY (the read itself succeeded, nothing is corrupt) — this
    // is deliberate and must not regress: a pending operation is surfaced via
    // `pendingRecovery`, not by refusing to render.
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.READY);
    expect(latest().ready).toBe(true);
    expect(latest().pendingRecovery).toEqual([pendingRecord]);

    // But the confirm-time gate must reject: THIS pass's own reconciliation
    // outcome was ok:false with a non-zero pending count, regardless of the
    // READY display status.
    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECONCILIATION_PENDING');

    reconcileSpy.mockRestore();
  });

  test('the happy path still succeeds: a clean read with no pending operations allows the mutation', async () => {
    await seedRecords([block], [week]);

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });

    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });

    expect(result.ok).toBe(true);
    expect(result.week.id).toBe('rw716');
  });

  // #711 review finding 2: a corrupt operation journal must never resolve like
  // an ordinary reconciliation with nothing pending. It must block mutations
  // even when a previously-verified snapshot keeps the read-only view "stale"
  // rather than "error".
  test('a corrupt journal read blocks mutations, whether or not a snapshot was previously verified', async () => {
    const corruptResult = {
      ok: false,
      code: 'JOURNAL_CORRUPT',
      corrupt: true,
      pending: [],
      cancelled: [],
      results: [],
      error: 'Recovery operations could not be read from this device. Recovery actions are paused until this is retried.',
      cause: null,
    };
    const reconcileSpy = jest.spyOn(journalModule, 'reconcileRecoveryOperations')
      .mockResolvedValue(corruptResult);

    // Case 1: nothing was ever verified. A corrupt journal is a terminal
    // error, not a verified-empty result.
    await mountProbe();
    expect(latest().ready).toBe(false);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.ERROR);
    expect(latest().mutationsAllowed).toBe(false);

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });
    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECOVERY_JOURNAL_CORRUPT');

    reconcileSpy.mockRestore();
  });

  test('a corrupt journal read on a previously-verified snapshot goes stale AND stays mutation-blocked', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);
    expect(latest().mutationsAllowed).toBe(true);

    const corruptResult = {
      ok: false, code: 'JOURNAL_CORRUPT', corrupt: true, pending: [], cancelled: [], results: [],
      error: 'Recovery operations could not be read from this device. Recovery actions are paused until this is retried.',
      cause: null,
    };
    const reconcileSpy = jest.spyOn(journalModule, 'reconcileRecoveryOperations')
      .mockResolvedValue(corruptResult);
    await render.act(async () => { await latest().refresh(); });

    // Last-known-good data still renders (stale), but — unlike an ordinary
    // transient read failure — mutations must stay blocked, because the
    // journal contract itself says recovery actions are paused while it is
    // unreadable.
    expect(latest().ready).toBe(true);
    expect(latest().stale).toBe(true);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.STALE);
    expect(latest().mutationsAllowed).toBe(false);

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });
    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECOVERY_JOURNAL_CORRUPT');

    reconcileSpy.mockRestore();
  });

  // #711 review finding 1: an ordinary (unreconciled) filter read must never
  // be able to establish the mutation-authorizing verified state.
  // `useRecoveryAnalyticsFilter` reads records directly, without running the
  // journal reconciliation `useRecoveryBlockState` always runs first.
  test('a plain analytics filter read never establishes the mutation-verified state for a not-yet-reconciled consumer', async () => {
    await seedRecords([block], [week]);

    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });
    // The filter itself becomes ready (it read real records)...
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);

    // ...now mount an authoritative consumer whose OWN read is held open. If
    // the filter's raw read had (incorrectly) set the shared mutation-verified
    // bit, this consumer would report `ready`/`mutationsAllowed` true
    // immediately, without ever completing its own reconcile-then-read pass.
    let releaseRead;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(
      () => new Promise((resolve) => { releaseRead = () => resolve([block]); })
    );
    await mountProbe();

    expect(latest().ready).toBe(false);
    expect(latest().loading).toBe(true);
    expect(latest().mutationsAllowed).toBe(false);

    await render.act(async () => { releaseRead(); await Promise.resolve(); });
  });

  test('a plain analytics filter success does not paper over a real authoritative read failure', async () => {
    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    // The filter succeeds first — an empty snapshot is a legitimate empty
    // read for the filter boundary.
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);

    // The authoritative pass then genuinely fails. If the two verified flags
    // were still one shared bit, the filter's earlier success would leak into
    // this consumer and hide the failure.
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockRejectedValue(new Error('boom'));
    await mountProbe();

    expect(latest().ready).toBe(false);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.ERROR);
    expect(latest().mutationsAllowed).toBe(false);
  });

  // #711 review finding 3 (round 2): `publishRecoverySnapshot` used to notify
  // subscribers BEFORE `recoveryFilterVerified` was set true, so a
  // `useRecoveryAnalyticsFilter` that was stuck unverified after a cold
  // failure and then observed a successful authoritative read (triggered
  // elsewhere — e.g. Log's `Retry recovery`) would snapshot the new DATA in
  // that notification while still reading the OLD, unverified boundary flag,
  // and get no second notification to correct it. Reproduces exactly that
  // sequence: filter fails first, stays unverified; a later independent
  // authoritative read (not the filter's own) then succeeds; the filter must
  // end up ready in that SAME notification, not stuck loading forever.
  test('a successful authoritative read unblocks an already-unverified filter subscriber in the very same notification', async () => {
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValueOnce(new Error('cold start failure'));

    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });
    // The filter's own read failed and nothing was ever verified — it must
    // report itself unready, not silently admit recovery work.
    expect(filterSeen[filterSeen.length - 1].ready).toBe(false);

    // Storage recovers, and a SEPARATE authoritative read succeeds (mirrors
    // Log mounting, or the user pressing "Retry recovery" — never the
    // filter's own retry loop).
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);

    // The filter subscriber must already be unblocked from that same publish
    // — not left waiting on its own bounded retry timer.
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);
  });

  // #711 review finding 4: strengthen the existing max-concurrency assertion
  // to prove a single shared reconciliation pass — not merely that two
  // `useRecoveryBlockState` consumers never run concurrently, but that a
  // simultaneously-mounted `useRecoveryAnalyticsFilter` reuses that same pass
  // instead of issuing its own separate read.
  test('Log, Analytics, and the analytics filter share exactly one storage read on cold mount', async () => {
    await seedRecords([block], [week]);

    let readCount = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const real = recoveryStorageModule.loadRecoveryBlocks;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(async () => {
      readCount += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      try {
        return await real();
      } finally {
        concurrent -= 1;
      }
    });

    const logBucket = [];
    const analyticsBucket = [];
    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => {
      mounted.push(render.create(<Probe bucket={logBucket} />));
      mounted.push(render.create(<Probe bucket={analyticsBucket} />));
      mounted.push(render.create(<FilterProbe />));
    });

    expect(maxConcurrent).toBe(1);
    // All three mounted consumers — two `useRecoveryBlockState` instances
    // (Log, Analytics) plus the analytics filter — share exactly ONE storage
    // read. Neither the second `useRecoveryBlockState` mount nor the filter
    // mount triggers its own separate pass (#711 review finding 3, round 2;
    // finding 4's filter-piggyback still holds on top of that).
    expect(readCount).toBe(1);
    expect(latestOf(logBucket).blocks).toBe(latestOf(analyticsBucket).blocks);
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);
  });
});

// ── #716: the Log Recovery section never renders unverified state as empty ───

describe('LogRecoverySection — authoritative Recovery state (#716)', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');
  const {
    RECOVERY_STALE_MESSAGE,
    RECOVERY_UNVERIFIED_MESSAGE,
  } = require('../hooks/entries/recoveryBlockHooks');

  const activeBlock = {
    id: 'rbActive716',
    baseline_note_id: 'baseline716',
    baseline_note_title: 'Push Day',
    baseline: { version: 1, exercises: [] },
    include_in_normal_analytics: false,
    started_at: '2026-05-01T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  };
  const activeWeek = {
    id: 'rw716', block_id: 'rbActive716', note_id: 'weeknote716', week_number: 1,
    completed_at: null, deleted_at: null,
  };

  const renderSection = async (props) => {
    let component;
    await render.act(async () => {
      component = render.create(<LogRecoverySection notes={[]} {...props} />);
    });
    return component;
  };

  // Flattens array children too: the baseline is now an interpolated caption
  // (`Baseline: {title}`), which renders as a children array, not one string.
  const texts = (component) =>
    component.root.findAll(n => typeof n.type === 'string' && n.props.children)
      .map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
      .filter(c => typeof c === 'string');

  const retryButton = (component) =>
    component.root.findAll(n => n.props && n.props.accessibilityLabel === 'Retry recovery' && n.props.onPress)[0];

  test('a cold load stays visually neutral and renders nothing (no Recovery card flash)', async () => {
    // #724: a first read in flight must not flash a Recovery card for a
    // non-adopter, so the section renders nothing until the read verifies or
    // terminally fails.
    const component = await renderSection({ stateReady: false, stateLoading: true });
    expect(component.toJSON()).toBeNull();
    expect(retryButton(component)).toBeUndefined();
  });

  test('a terminal first-load failure renders the unknown state with the Retry recovery control', async () => {
    const onRetryRecovery = jest.fn();
    const component = await renderSection({
      stateReady: false,
      stateError: new Error('unreadable'),
      onRetryRecovery,
    });

    expect(texts(component)).toContain(RECOVERY_UNVERIFIED_MESSAGE);
    const button = retryButton(component);
    expect(button).toBeTruthy();
    // ui-design-rules §12: the copy names the control by its exact accessible
    // name, so a screen-reader user searching for it finds it.
    expect(RECOVERY_UNVERIFIED_MESSAGE).toContain('Retry recovery');
    await render.act(async () => { await button.props.onPress(); });
    expect(onRetryRecovery).toHaveBeenCalledTimes(1);
  });

  test('a refresh failure keeps the active block visible and marks it stale', async () => {
    const component = await renderSection({
      blocks: [activeBlock],
      weeks: [activeWeek],
      stateStale: true,
      onRetryRecovery: jest.fn(),
    });

    const rendered = texts(component);
    expect(rendered).toContain('Baseline: Push Day');
    expect(rendered).toContain(RECOVERY_STALE_MESSAGE);
    expect(retryButton(component)).toBeTruthy();
  });

  test('unverified state disables every lifecycle control', async () => {
    const component = await renderSection({
      blocks: [activeBlock],
      weeks: [activeWeek],
      mutationsAllowed: false,
      onCompleteWeek: jest.fn(),
      onOpenAddWeek: jest.fn(),
      onCompleteBlock: jest.fn(),
      onUnlinkWeek: jest.fn(),
    });

    const controls = component.root.findAll(
      // Composite Pressables only: React Native's own host View mirrors an
      // accessibilityState with an undefined `disabled`, which is noise here.
      n => typeof n.type !== 'string'
        && n.props && n.props.accessibilityRole === 'button'
        && n.props.accessibilityState
        && typeof n.props.accessibilityState.disabled === 'boolean'
        && n.props.accessibilityLabel !== 'Retry recovery'
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.props.accessibilityState.disabled).toBe(true);
    }
  });

  test('a verified snapshot with nothing to show still renders nothing', async () => {
    const component = await renderSection({ stateReady: true });
    expect(component.toJSON()).toBeNull();
  });
});

// ── typed note navigation intents (#718) ──────────────────────────────────────

describe('typed note navigation intents (#718)', () => {
  const CURRENT = {
    id: 'note1',
    title: 'Routine A',
    raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
    saved_at: '2026-06-01T12:00:00.000Z',
  };
  const OTHER = {
    id: 'r1',
    title: 'Routine B',
    raw_text: 'Tuesday\n+Lifting\n-Squat\n225 5,5,5',
    saved_at: '2026-05-01T12:00:00.000Z',
  };

  // A past-deload note. It lives in `notes` (so the intent can resolve it) but
  // is rendered ONLY by LogDeloadSection: LogPreviousRoutines filters the
  // 'Deload · ' prefix out of otherNotes.
  const DELOAD = {
    id: 'd1',
    title: 'Deload · Week 1',
    raw_text: 'Monday\n+Lifting\n-Bench\n95 5,5,5',
    saved_at: '2026-04-01T12:00:00.000Z',
  };

  let alertSpy;

  function mockNotes({ notes = [CURRENT, OTHER], loading = false, error = null, deloadNotes = [] } = {}) {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes,
      currentId: 'note1',
      currentNote: CURRENT,
      deloadNotes,
      loading,
      error,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });
  }

  // Routine and Deload are mutually exclusive: only the active one is mounted.
  const hasText = (component, needle) =>
    component.root.findAll(
      n => n.type === 'Text'
        && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '')
          .includes(needle)
    ).length > 0;
  // Rendered only by LogDeloadSection (with no generated deload week).
  const onDeloadView = (component) => hasText(component, 'No deload week generated yet.');
  // Rendered only by LogPreviousRoutines, which lives in the routine view.
  const onRoutineView = (component) => hasText(component, 'More Routines');

  // Switch the screen to the Deload view the way a user does, so tabView holds
  // 'deload' when the navigation intent arrives.
  function showDeloadView(component) {
    const toggle = pressableAround(component.root, t => t === 'Deload');
    render.act(() => { toggle.props.onPress(); });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockNotes();
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    // `jest.clearAllMocks()` clears call history but NOT a previously
    // configured `mockReturnValue` — a prior describe block's active-block
    // fixture would otherwise leak in here. Explicit no-active-block default
    // (#823: the screen now lands on the Recovery tab whenever a block is
    // active, which these tests never intend to exercise).
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock: null, blocks: [], weeks: [], recoveryWeekNumberByNoteId: {},
      refresh: jest.fn(), pendingRecovery: [], recoveryPendingError: null,
      ready: true, loading: false, refreshing: false, stale: false, error: null,
      mutationsAllowed: true, retryRecovery: jest.fn(),
    });
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  // Screen-level signal that a note is actually being shown. A viewed
  // non-current ROUTINE renders its lifecycle actions (`Set as current routine`)
  // in the expanded routine-management body — the `Double-tap to edit` hint was
  // retired there (#724) — while a viewed past-DELOAD note still renders that
  // hint in LogDeloadSection. Either proves the resolved note is mounted.
  const isShowingViewedNote = (component) =>
    hasText(component, 'Set as current routine') || hasText(component, 'Double-tap to edit');

  function mount(props) {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen {...props} />); });
    return component;
  }

  test('an absent target opens nothing and leaves the screen untouched', () => {
    const component = mount({ navNoteId: null, navNoteKey: 0 });
    expect(isShowingViewedNote(component)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a note target shows the requested non-current note', () => {
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    expect(isShowingViewedNote(component)).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a target for the current routine is a no-op: it is already the active card', () => {
    // The previous-routines viewer only ever lists NON-current notes, so opening
    // the current note there would be wrong; it is already on screen above.
    const component = mount({ navNoteId: 'note1', navNoteKey: 1 });
    expect(isShowingViewedNote(component)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a missing target is refused out loud and opens nothing else', () => {
    const component = mount({ navNoteId: 'deleted-note', navNoteKey: 1 });

    expect(isShowingViewedNote(component)).toBe(false);
    expect(alertSpy).toHaveBeenCalledWith(
      'Note not found',
      expect.stringContaining('deleted')
    );
  });

  test('a note target that arrives while notes are loading is applied once loading resolves', () => {
    mockNotes({ notes: [], loading: true });
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    expect(isShowingViewedNote(component)).toBe(false);
    // Deferred, not refused: the note is not "missing", it is not loaded yet.
    expect(alertSpy).not.toHaveBeenCalled();

    mockNotes({ notes: [CURRENT, OTHER], loading: false });
    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });

    expect(isShowingViewedNote(component)).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a repeated render under the same key does not re-apply a consumed intent', () => {
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    expect(isShowingViewedNote(component)).toBe(true);

    // The user collapses the note themselves, then an unrelated re-render
    // arrives carrying the same already-consumed key.
    const header = pressableAround(component.root, t => t.includes('Routine B'));
    render.act(() => { header.props.onPress(); });
    expect(isShowingViewedNote(component)).toBe(false);

    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });

    expect(isShowingViewedNote(component)).toBe(false);
  });

  test('a later key for the same note re-applies the intent', () => {
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    const header = pressableAround(component.root, t => t.includes('Routine B'));
    render.act(() => { header.props.onPress(); });
    expect(isShowingViewedNote(component)).toBe(false);

    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={2} />); });

    expect(isShowingViewedNote(component)).toBe(true);
  });

  // #724 review: keying auto-expand on the request nonce, not viewingNoteId, so a
  // later key for the SAME note reopens routine management after the user has
  // explicitly collapsed the outer disclosure (with the note still selected).
  test('a later key for the same note re-expands routine management after the user collapsed the disclosure', () => {
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    expect(isShowingViewedNote(component)).toBe(true);

    // Collapse the whole routine-management disclosure — not the note — leaving
    // the note still selected behind it.
    const collapse = component.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Hide routines' && typeof n.props.onPress === 'function'
    )[0];
    render.act(() => { collapse.props.onPress(); });
    expect(isShowingViewedNote(component)).toBe(false);

    // A new key for the same already-selected note must reopen the disclosure.
    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={2} />); });
    expect(isShowingViewedNote(component)).toBe(true);
  });

  test('a note target is refused while an editor is open, and leaves the editor alone', () => {
    const component = mount({ navNoteId: null, navNoteKey: 0 });
    render.act(() => {
      findPressableByText(component.root, 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });
    // The read view's inline Edit control disappears in edit mode.
    expect(findPressableByText(component.root, 'Edit')).toBeNull();

    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });

    expect(alertSpy).toHaveBeenCalledWith(
      'Finish your edit first',
      // §12: the copy names the editor's real "Done" control.
      expect.stringContaining('Tap Done')
    );
    expect(isShowingViewedNote(component)).toBe(false);
    // Still in the current-routine editor: the intent touched no editor state.
    expect(findPressableByText(component.root, 'Edit')).toBeNull();
  });

  test('a refusal is terminal for its key and is not replayed once the editor closes', () => {
    const component = mount({ navNoteId: null, navNoteKey: 0 });
    render.act(() => {
      findPressableByText(component.root, 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });
    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });
    expect(alertSpy).toHaveBeenCalledTimes(1);

    // Leaving the editor must not silently perform the navigation the user was
    // already told did not happen.
    render.act(() => {
      findPressableByText(component.root, 'Done').props.onPress({ stopPropagation: jest.fn() });
    });

    expect(isShowingViewedNote(component)).toBe(false);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  // ── the intent selects the view that owns the note (#718 review finding 1) ──
  //
  // Routine and Deload are mutually exclusive and render disjoint sets of notes
  // off the SAME viewingNoteId, so setting viewingNoteId without aligning
  // tabView would leave a correctly resolved note mounted nowhere.

  describe('view alignment with the note that owns the content', () => {
    function withDeloadMode() {
      useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: true });
      mockNotes({ notes: [CURRENT, OTHER, DELOAD], deloadNotes: [DELOAD] });
    }

    test('a routine-note target while the screen is on Deload switches to Routine and shows the note', () => {
      withDeloadMode();
      const component = mount({ navNoteId: null, navNoteKey: 0 });
      showDeloadView(component);
      expect(onDeloadView(component)).toBe(true);

      render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });

      expect(onRoutineView(component)).toBe(true);
      expect(onDeloadView(component)).toBe(false);
      expect(isShowingViewedNote(component)).toBe(true);
    });

    test('a deload-note target while the screen is on Routine switches to Deload and shows the note', () => {
      withDeloadMode();
      const component = mount({ navNoteId: null, navNoteKey: 0 });
      expect(onRoutineView(component)).toBe(true);

      render.act(() => { component.update(<ControlledLogScreen navNoteId="d1" navNoteKey={1} />); });

      expect(onDeloadView(component)).toBe(true);
      expect(onRoutineView(component)).toBe(false);
      // Rendered by LogDeloadSection's past-deloads list, which is the only
      // place a 'Deload · ' note ever appears.
      expect(isShowingViewedNote(component)).toBe(true);
    });

    test('targeting the current routine while on Deload still switches back to Routine', () => {
      // The no-op-for-viewingNoteId path: the current routine is its own card,
      // not a viewer entry, but it is just as hidden behind the Deload view.
      withDeloadMode();
      const component = mount({ navNoteId: null, navNoteKey: 0 });
      showDeloadView(component);
      expect(onDeloadView(component)).toBe(true);

      render.act(() => { component.update(<ControlledLogScreen navNoteId="note1" navNoteKey={1} />); });

      expect(onRoutineView(component)).toBe(true);
      expect(onDeloadView(component)).toBe(false);
      // Still a no-op for the viewer itself: the current note is never opened
      // in the previous-routines list.
      expect(isShowingViewedNote(component)).toBe(false);
      expect(alertSpy).not.toHaveBeenCalled();
    });
  });

  // ── a failed read is not a deletion (#718 review finding 2) ──

  test('a failed notes read keeps the intent pending instead of reporting a deletion', () => {
    mockNotes({ notes: [], error: new Error('read failed') });
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });

    // The note is absent, but only because the read failed — absence is not
    // authoritative here, so nothing may be announced or consumed.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(isShowingViewedNote(component)).toBe(false);

    // The existing ErrorBanner Retry lands a clean read. The SAME key must now
    // resolve, without the caller reissuing a new one.
    mockNotes({ notes: [CURRENT, OTHER] });
    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });

    expect(isShowingViewedNote(component)).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a genuinely deleted note is still reported once the read succeeds', () => {
    // The counterpart to the test above: the "not found" refusal must survive,
    // it simply may not fire off a failed read.
    const component = mount({ navNoteId: 'deleted-note', navNoteKey: 1 });

    expect(alertSpy).toHaveBeenCalledWith(
      'Note not found',
      expect.stringContaining('deleted')
    );
    expect(isShowingViewedNote(component)).toBe(false);
  });
});

// ── honest first-paint and failed-read states (#737) ──────────────────────────
//
// Before this, an unresolved or failed notes read produced the same thing: an
// empty body under a populated header. The three outcomes are now distinct —
// loading paints a placeholder, a failed read paints the retry banner and
// refuses to claim the notebook is empty, and only a verified empty read
// reaches LogEmptyState.
describe('Log loading and failure states (#737)', () => {
  const NOTE = {
    id: 'note1',
    title: 'Routine A',
    raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
    saved_at: '2026-06-01T12:00:00.000Z',
  };

  function mockNotes({ notes = [], loading = false, error = null, refresh = jest.fn() } = {}) {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes,
      currentId: notes.length ? notes[0].id : null,
      currentNote: notes.length ? notes[0] : null,
      deloadNotes: [],
      loading,
      error,
      refresh,
      selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });
    return refresh;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
  });

  const mount = () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    return component;
  };
  const has = (component, testID) => component.root.findAll(n => n.props?.testID === testID).length > 0;
  const emptyStates = (component) => component.root.findAll(n => n.type === LogEmptyState).length;

  test('an unresolved first read paints a labelled placeholder, not a blank body', () => {
    mockNotes({ notes: [], loading: true });
    const component = mount();

    expect(has(component, 'log-skeleton')).toBe(true);
    // Loading is not emptiness.
    expect(emptyStates(component)).toBe(0);
    const skeleton = component.root.find(n => n.props?.testID === 'log-skeleton');
    expect(skeleton.props.accessibilityLabel).toBe('Loading your workout notes');
  });

  test('a refresh over already-loaded notes does not throw the screen back to a placeholder', () => {
    mockNotes({ notes: [NOTE], loading: true });
    const component = mount();

    expect(has(component, 'log-skeleton')).toBe(false);
  });

  test('a failed read shows a retry banner and never claims the notebook is empty', () => {
    const refresh = jest.fn();
    mockNotes({ notes: [], error: new Error('read failed'), refresh });
    const component = mount();

    // The banner is present…
    const banner = component.root.findAll(
      n => n.type === 'Text' && String(n.props.children ?? '').includes('Could not load workout notes.')
    );
    expect(banner.length).toBe(1);
    // …and the "create your first routine" surface is NOT.
    expect(emptyStates(component)).toBe(0);
    expect(has(component, 'log-skeleton')).toBe(false);

    const retry = component.root.find(
      n => typeof n.props?.onPress === 'function'
        && n.findAll(c => c.type === 'Text' && String(c.props.children ?? '') === 'Retry').length > 0
    );
    render.act(() => { retry.props.onPress(); });
    expect(refresh).toHaveBeenCalled();
  });

  test('only a verified empty read reaches the empty state', () => {
    mockNotes({ notes: [], loading: false, error: null });
    const component = mount();

    expect(emptyStates(component)).toBe(1);
    expect(has(component, 'log-skeleton')).toBe(false);
  });
});

// ── the pending-retry window on screen (#737 review) ──────────────────────────
//
// useWorkoutNotes.reload() used to clear `error` on the way in, so tapping the
// ErrorBanner's Retry dropped the banner while `notes` was still empty and
// `loading` already false — and Log fell through to LogEmptyState mid-retry,
// telling a user with a full notebook that they had none. The hook now holds
// the failed state until a read completes; this asserts what that looks like.
describe('Log retry does not flash the empty state (#737 review)', () => {
  const mount = () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    return component;
  };
  const emptyStates = (component) => component.root.findAll(n => n.type === LogEmptyState).length;
  const has = (component, testID) => component.root.findAll(n => n.props?.testID === testID).length > 0;
  const hasBanner = (component) => component.root.findAll(
    n => n.type === 'Text' && String(n.props.children ?? '').includes('Could not load workout notes.')
  ).length > 0;

  function mockNotes({ notes = [], loading = false, error = null } = {}) {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes,
      currentId: notes.length ? notes[0].id : null,
      currentNote: notes.length ? notes[0] : null,
      deloadNotes: [], loading, error,
      refresh: jest.fn(), selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}), add: jest.fn(), remove: jest.fn(),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
  });

  test('a retry still in flight keeps the banner up and the empty state away', () => {
    // Mid-retry the hook holds the shape it had before the retry: the read has
    // not completed, so the last completed read is still the truth.
    mockNotes({ notes: [], loading: false, error: new Error('read failed') });
    const component = mount();

    expect(hasBanner(component)).toBe(true);
    expect(emptyStates(component)).toBe(0);
    expect(has(component, 'log-skeleton')).toBe(false);
  });

  test('once the retry resolves onto a genuinely empty notebook the empty state appears', () => {
    mockNotes({ notes: [], loading: false, error: null });
    const component = mount();

    expect(hasBanner(component)).toBe(false);
    expect(emptyStates(component)).toBe(1);
  });
});

// ── R2b: one date with one meaning, and disclosures that survive (#775) ───────

describe('More Routines: the row date is the routine\'s creation day (#775)', () => {
  const baseProps = {
    handleViewOtherNote: jest.fn(),
    viewingNoteId: null,
    viewingNote: null,
    viewingNoteDayGroups: [],
    viewingHasABWeeks: false,
    viewingEffectiveWeek: null,
    handleToggleViewingWeek: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleEditViewedNote: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    handleCreateRoutine: jest.fn(),
  };

  const renderList = (overrides = {}) => {
    let component;
    render.act(() => {
      component = render.create(<ControlledPreviousRoutines {...baseProps} {...overrides} />);
    });
    return component.root;
  };

  // The row header's own accessible name — never the disclosure's.
  const rowLabels = (root) => root.findAll(
    n => typeof n.type === 'string'
      && n.props
      && typeof n.props.accessibilityLabel === 'string'
      && /^(Expand|Collapse) /.test(n.props.accessibilityLabel)
      && !/routine management$/.test(n.props.accessibilityLabel)
  ).map(n => n.props.accessibilityLabel);

  const subLines = (root) => root.findAll(
    n => n.type === 'Text' && typeof n.props.children === 'string' && /^(Week [AB] · )?Created /.test(n.props.children)
  ).map(n => n.props.children);

  const expectedDate = (iso) => new Date(
    Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))
  ).toLocaleDateString();

  test('the date comes from saved_at, and an edit-stamped updated_at is never read', () => {
    // The exact regression: `updated_at` is the sync conflict cursor, so an
    // edit, a Week A/B tap, a sync, or a restored backup rewrites it. Only
    // saved_at answers "when did I make this routine?".
    const root = renderList({ otherNotes: [{
      id: 'wn_2025-11-02_1', title: 'Push', saved_at: '2026-01-05T00:00:00.000Z',
      updated_at: '2026-08-09T00:00:00.000Z',
    }] });
    expandRoutineManagement(root);

    expect(subLines(root)).toEqual([`Created ${expectedDate('2026-01-05')}`]);
    expect(rowLabels(root)).toEqual([`Expand Push, Created ${expectedDate('2026-01-05')}`]);
  });

  test('with no saved_at the creation day encoded in the note id stands in', () => {
    const root = renderList({ otherNotes: [{
      id: 'wn_2025-11-02_1762000000000', title: 'Legacy', updated_at: '2026-08-09T00:00:00.000Z',
    }] });
    expandRoutineManagement(root);

    expect(subLines(root)).toEqual([`Created ${expectedDate('2025-11-02')}`]);
    expect(rowLabels(root)).toEqual([`Expand Legacy, Created ${expectedDate('2025-11-02')}`]);
  });

  test('with neither, no date is shown or announced — the title still identifies the row', () => {
    const root = renderList({ otherNotes: [{
      id: 'imported-1', title: 'Imported', updated_at: '2026-08-09T00:00:00.000Z',
    }] });
    expandRoutineManagement(root);

    expect(subLines(root)).toEqual([]);
    expect(rowLabels(root)).toEqual(['Expand Imported']);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Imported').length).toBeGreaterThan(0);
  });

  test('the viewed row keeps its Week A/B prefix in front of the creation date', () => {
    const note = { id: 'r1', title: 'AB', raw_text: 'MONDAY\n-Squat\n---\nMONDAY\n-Bench\n', saved_at: '2026-01-05T00:00:00.000Z' };
    const root = renderList({
      otherNotes: [note],
      viewingNoteId: 'r1',
      viewingNote: note,
      viewingHasABWeeks: true,
      viewingEffectiveWeek: 'B',
    });
    expandRoutineManagement(root);

    expect(subLines(root)).toEqual([`Week B · Created ${expectedDate('2026-01-05')}`]);
    expect(rowLabels(root)).toEqual([`Collapse AB, Week B · Created ${expectedDate('2026-01-05')}`]);
  });

  test('the expanded list orders newest created first, undated last in notebook order', () => {
    const otherNotes = [
      { id: 'a', title: 'Undated First', updated_at: '2026-08-09T00:00:00.000Z' },
      { id: 'b', title: 'Oldest', saved_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-08-10T00:00:00.000Z' },
      { id: 'wn_2026-05-05_1', title: 'Id Dated' },
      { id: 'c', title: 'Undated Second' },
      { id: 'd', title: 'Newest', saved_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
    ];
    const root = renderList({ otherNotes });
    expandRoutineManagement(root);
    expect(rowLabels(root).map(l => l.replace(/^Expand /, '').split(',')[0])).toEqual([
      'Newest', 'Id Dated', 'Oldest', 'Undated First', 'Undated Second',
    ]);
  });
});

describe('Recovery weeks read their own notes (#775)', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');
  const { buildDayGroups } = require('../screens/log/logScreenHelpers');
  const { parseWorkoutNote: parse } = require('../lib/parser');

  const BLOCK = {
    id: 'rb775', baseline_note_id: 'baseline', baseline_note_title: 'Push Day',
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };
  const week = (overrides = {}) => ({
    id: 'rw1', block_id: 'rb775', note_id: 'weeknote', week_number: 1,
    completed_at: null, deleted_at: null, ...overrides,
  });
  const WEEK_NOTE = { id: 'weeknote', title: 'Recovery Week Note', raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5' };

  const renderSection = (props = {}) => {
    let component;
    render.act(() => {
      component = render.create(
        <LogRecoverySection blocks={[BLOCK]} weeks={[week()]} notes={[WEEK_NOTE]} {...props} />
      );
    });
    return component.root;
  };

  const rowMain = (root, label) => root.findAll(n => n.props && n.props.accessibilityLabel === label)[0];
  const hasExercise = (root, name) => root.findAll(
    n => n.type === 'Text' && String(n.props.children ?? '').includes(name)
  ).length > 0;

  test('a tapped week renders its note inline, in the row the user tapped', () => {
    const onViewNote = jest.fn();
    const root = renderSection({ onViewNote });

    const row = rowMain(root, 'View Recovery Week Note, Recovery Week 1');
    expect(typeof row.props.onPress).toBe('function');
    expect(hasExercise(root, 'Overhead Press')).toBe(false);
    render.act(() => { row.props.onPress(); });
    expect(onViewNote).toHaveBeenCalledWith(WEEK_NOTE);

    // The owner echoes the selection back through the shared viewer state.
    const viewing = renderSection({
      viewingNoteId: 'weeknote',
      viewingNote: WEEK_NOTE,
      viewingNoteDayGroups: buildDayGroups(parse(WEEK_NOTE.raw_text).sections),
    });
    expect(hasExercise(viewing, 'Overhead Press')).toBe(true);
  });

  // #775 review: `viewingNoteDayGroups` is the SELECTED half of an A/B note, so
  // an inline viewer without the Week switch strands the other week — a
  // regression against the More Routines handoff this replaced.
  test('an A/B recovery-week note keeps its Week switch inline, with the pill contract it has in More Routines', () => {
    const AB_NOTE = {
      id: 'weeknote', title: 'AB Week',
      raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5\n---\nTuesday\n+Lifting\n-Chin Up\n0 5,5,5',
    };
    const onToggleViewingWeek = jest.fn();
    const viewingWeek = (week) => renderSection({
      notes: [AB_NOTE],
      viewingNoteId: 'weeknote',
      viewingNote: AB_NOTE,
      viewingHasABWeeks: true,
      viewingEffectiveWeek: week,
      viewingNoteDayGroups: buildDayGroups(
        parse(week === 'B' ? AB_NOTE.raw_text.split('\n---\n')[1] : AB_NOTE.raw_text.split('\n---\n')[0]).sections
      ),
      onToggleViewingWeek,
    });

    const onA = viewingWeek('A');
    expect(hasExercise(onA, 'Overhead Press')).toBe(true);
    expect(hasExercise(onA, 'Chin Up')).toBe(false);
    const pill = onA.findAll(
      n => n.props && n.props.accessibilityLabel === 'Switch to Week B' && typeof n.props.onPress === 'function'
    )[0];
    expect(pill).toBeTruthy();
    expect(pill.props.accessibilityRole).toBe('button');
    expect(pill.props.accessibilityState).toEqual({ selected: false });
    render.act(() => { pill.props.onPress(); });
    expect(onToggleViewingWeek).toHaveBeenCalledTimes(1);

    // The owner flips the selection; the other half is now readable here.
    const onB = viewingWeek('B');
    expect(hasExercise(onB, 'Chin Up')).toBe(true);
    expect(hasExercise(onB, 'Overhead Press')).toBe(false);
    const back = onB.findAll(
      n => n.props && n.props.accessibilityLabel === 'Switch to Week A' && typeof n.props.onPress === 'function'
    )[0];
    expect(back).toBeTruthy();
    expect(back.props.accessibilityState).toEqual({ selected: true });
  });

  test('a single-week recovery note shows no Week switch', () => {
    const root = renderSection({
      viewingNoteId: 'weeknote',
      viewingNote: WEEK_NOTE,
      viewingNoteDayGroups: buildDayGroups(parse(WEEK_NOTE.raw_text).sections),
    });
    expect(root.findAll(
      n => n.props && /^Switch to Week [AB]$/.test(n.props.accessibilityLabel || '')
    ).length).toBe(0);
  });

  test('an untitled note that exists is still named Untitled Routine and still readable', () => {
    const untitled = { id: 'weeknote', title: '', raw_text: 'Monday\n+Lifting\n-Row\n95 5,5,5' };
    const root = renderSection({ notes: [untitled] });

    const row = rowMain(root, 'View Untitled Routine, Recovery Week 1');
    expect(row).toBeTruthy();
    expect(row.props.accessibilityRole).toBe('button');
    expect(typeof row.props.onPress).toBe('function');
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Note unavailable').length).toBe(0);
  });

  for (const [shape, weekOverrides, notes] of [
    ['a note_id naming a note that is gone', { note_id: 'gone' }, []],
    ['a null note_id', { note_id: null }, [WEEK_NOTE]],
  ]) {
    test(`${shape}: the row says Note unavailable and offers no read action`, () => {
      const onViewNote = jest.fn();
      const onUnlinkWeek = jest.fn();
      const root = renderSection({ weeks: [week(weekOverrides)], notes, onViewNote, onUnlinkWeek });

      const row = rowMain(root, 'Recovery Week 1, note unavailable');
      expect(row).toBeTruthy();
      expect(row.props.onPress).toBeUndefined();
      expect(row.props.accessibilityRole).toBeUndefined();
      expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Note unavailable').length).toBe(1);
      // 'Untitled Routine' stays reserved for notes that exist.
      expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Untitled Routine').length).toBe(0);
      // Nothing is repaired, rewritten, or unlinked just by rendering the row.
      expect(onViewNote).not.toHaveBeenCalled();
      expect(onUnlinkWeek).not.toHaveBeenCalled();
    });

    test(`${shape}: Unlink survives and its confirmation claims nothing about a missing note`, async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const onUnlinkWeek = jest.fn().mockResolvedValue({ ok: true });
      const root = renderSection({ weeks: [week(weekOverrides)], notes, onUnlinkWeek });

      expandManageRecovery(root);
      const unlink = root.findAll(
        n => n.props && n.props.accessibilityLabel === 'Unlink Week 1' && typeof n.props.onPress === 'function'
      )[0];
      expect(unlink).toBeTruthy();
      render.act(() => { unlink.props.onPress(); });

      const [title, message, buttons] = alertSpy.mock.calls[0];
      expect(title).toBe('Unlink Week 1?');
      expect(message).toBe('Week 1 will be removed from this recovery block.');
      expect(message).not.toContain('Untitled Routine');
      expect(message).not.toContain('stays editable');

      await render.act(async () => { await buttons.find(b => b.text === 'Unlink').onPress(); });
      expect(onUnlinkWeek).toHaveBeenCalledWith({ blockId: 'rb775', weekId: 'rw1' });
      alertSpy.mockRestore();
    });
  }

  test('a linked note that exists keeps the full unlink confirmation', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const root = renderSection({ onUnlinkWeek: jest.fn() });
    expandManageRecovery(root);
    const unlink = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Unlink Week 1' && typeof n.props.onPress === 'function'
    )[0];
    render.act(() => { unlink.props.onPress(); });

    expect(alertSpy.mock.calls[0][1]).toBe(
      '"Recovery Week Note" will be removed from this recovery block. The note itself is kept and stays editable.'
    );
    alertSpy.mockRestore();
  });
});

// -- Inline recovery-note editing (#841) -------------------------------------
//
// Both entry points — the explicit `Edit` action and double-tapping the
// expanded note body — must open the SAME inline editor inside this block,
// seeded from the same note and currently viewed A/B week, and must never
// drive the shared full-screen Routine editor (LogScreen owns that gate via
// `editingSource === 'recovery'`; these tests only exercise what
// LogRecoverySection itself renders for a given prop shape). A small
// controlled wrapper stands in for that LogScreen wiring, mirroring
// `ControlledPreviousRoutines` above.
describe('LogRecoverySection: inline recovery-note editing (#841)', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');
  const { buildDayGroups } = require('../screens/log/logScreenHelpers');
  const { parseWorkoutNote: parse } = require('../lib/parser');

  const BLOCK = {
    id: 'rb841', baseline_note_id: 'baseline', baseline_note_title: 'Push Day',
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };
  const week = (overrides = {}) => ({
    id: 'rw1', block_id: 'rb841', note_id: 'weeknote', week_number: 1,
    completed_at: null, deleted_at: null, ...overrides,
  });
  const AB_NOTE = {
    id: 'weeknote', title: 'AB Week',
    raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5\n---\nTuesday\n+Lifting\n-Chin Up\n0 5,5,5',
  };
  const weekAText = AB_NOTE.raw_text.split('\n---\n')[0];
  const weekBText = AB_NOTE.raw_text.split('\n---\n')[1];

  // Stands in for LogScreen: seeds the inline editor from whichever A/B week
  // is currently viewed, exactly as `handleEditRecoveryViewedNote` does, and
  // routes Save/Cancel through the caller's spies before closing.
  function ControlledInlineEdit({ note, onSaveEdit, onCancelEdit, ...props }) {
    const [editingNoteId, setEditingNoteId] = React.useState(null);
    const [editingTitle, setEditingTitle] = React.useState('');
    const [editingText, setEditingText] = React.useState('');
    const [editingWeek, setEditingWeek] = React.useState(null);
    const handleEditNote = () => {
      setEditingNoteId(note.id);
      setEditingTitle(note.title || '');
      setEditingText(props.viewingHasABWeeks ? (
        props.viewingEffectiveWeek === 'B' ? weekBText : weekAText
      ) : note.raw_text);
      setEditingWeek(props.viewingHasABWeeks ? props.viewingEffectiveWeek : null);
    };
    return (
      <LogRecoverySection
        {...props}
        onEditNote={handleEditNote}
        editingNoteId={editingNoteId}
        editingTitle={editingTitle}
        onChangeEditingTitle={setEditingTitle}
        editingText={editingText}
        onChangeEditingText={setEditingText}
        editingHasABWeeks={props.viewingHasABWeeks}
        editingEffectiveWeek={editingWeek}
        onToggleEditingWeek={() => setEditingWeek(w => (w === 'B' ? 'A' : 'B'))}
        onSaveEdit={() => { onSaveEdit?.(); setEditingNoteId(null); }}
        onCancelEdit={() => { onCancelEdit?.(); setEditingNoteId(null); }}
      />
    );
  }

  const renderInline = (overrides = {}) => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledInlineEdit
          note={AB_NOTE}
          blocks={[BLOCK]}
          weeks={[week()]}
          notes={[AB_NOTE]}
          viewingNoteId="weeknote"
          viewingNote={AB_NOTE}
          viewingHasABWeeks
          viewingEffectiveWeek="B"
          viewingNoteDayGroups={buildDayGroups(parse(weekBText).sections)}
          {...overrides}
        />
      );
    });
    return component.root;
  };

  const byLabel = (root, label) => root.findAll(
    n => n.props && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function'
  )[0];
  const titleInput = (root) => root.findAll(
    n => n.props && n.props.accessibilityLabel === 'Recovery note title'
  )[0];
  const textInput = (root) => root.findAll(
    n => n.props && n.props.accessibilityLabel === 'Recovery note text'
  )[0];

  test('the explicit Edit action opens the inline editor seeded from the viewed note and its current A/B week', () => {
    const root = renderInline();
    expect(titleInput(root)).toBeUndefined();

    render.act(() => { byLabel(root, 'Edit').props.onPress(); });

    const title = titleInput(root);
    const text = textInput(root);
    expect(title.props.value).toBe('AB Week');
    expect(text.props.value).toBe(weekBText);
    // Still viewing/editing Week B: the pill offers the switch TO A.
    expect(byLabel(root, 'Switch to Week A')).toBeTruthy();
    expect(byLabel(root, 'Switch to Week B')).toBeUndefined();
  });

  test('double-tapping the expanded note body opens the same inline editor as Edit', () => {
    const root = renderInline();
    // Locate the Pressable wrapping the rendered note body by walking up
    // from a rendered exercise name to its nearest onPress ancestor.
    const anyExerciseText = root.findAll(n => n.type === 'Text' && n.props.children === 'Chin Up')[0];
    let node = anyExerciseText.parent;
    while (node && !(node.props && typeof node.props.onPress === 'function')) node = node.parent;
    expect(node).toBeTruthy();

    render.act(() => { node.props.onPress(); });
    render.act(() => { node.props.onPress(); });

    expect(titleInput(root).props.value).toBe('AB Week');
    expect(textInput(root).props.value).toBe(weekBText);
  });

  // #843 gives the two controls distinct treatments — one 36px outlined
  // `Edit note` control and a 32px A/B segment — rather than matching pill
  // styling, so this pins each control's own documented metric instead of
  // symmetry between them.
  test('Edit note is a 36px outlined control and the A/B segment is 32px', () => {
    const root = renderInline();
    const editBtn = byLabel(root, 'Edit');
    const weekPill = byLabel(root, 'Switch to Week A');
    const flat = (n) => Object.assign({}, ...(Array.isArray(n.props.style) ? n.props.style : [n.props.style]).filter(Boolean));
    expect(flat(editBtn).height).toBe(36);
    expect(flat(editBtn).borderWidth).toBe(1);
    expect(flat(weekPill).height).toBe(32);
  });

  test('Save calls through to the owner and returns the block to read mode without collapsing the week', () => {
    const onSaveEdit = jest.fn();
    const root = renderInline({ onSaveEdit });
    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    expect(titleInput(root)).toBeTruthy();

    render.act(() => { byLabel(root, 'Save recovery note').props.onPress(); });
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(titleInput(root)).toBeUndefined();
    // Still viewing the same week — the row stayed expanded, not collapsed.
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'View AB Week, Recovery Week 1')[0]
      .props.accessibilityState.expanded).toBe(true);
  });

  test('Cancel delegates the close decision and never invokes Save directly', () => {
    const onSaveEdit = jest.fn();
    const onCancelEdit = jest.fn();
    const root = renderInline({ onSaveEdit, onCancelEdit });
    render.act(() => { byLabel(root, 'Edit').props.onPress(); });

    render.act(() => { byLabel(root, 'Cancel editing recovery note').props.onPress(); });
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(titleInput(root)).toBeUndefined();
  });

  test('a save failure keeps the inline editor open with the error visible in the block', () => {
    const root = renderInline({ editingSaveError: 'Save failed' });
    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    expect(titleInput(root)).toBeTruthy();
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Save failed').length).toBe(1);
  });

  // Since viewingNoteId (which week is expanded) and editingNoteId (which
  // note is mid-edit) are independent props, nothing stops LogScreen from
  // moving `viewingNoteId` to a different week while a recovery note is
  // being edited — except this row-level freeze. Without it, switching the
  // viewed week would unmount the inline editor's `isViewingThisNote` branch
  // out from under an unsaved edit, silently discarding no persisted data
  // but stranding the user mid-edit with no visible Save/Cancel.
  test('every week row is frozen — including the one being edited — while a recovery note is mid-edit', () => {
    const otherWeek = { id: 'rw2', block_id: 'rb841', note_id: 'other', week_number: 2, completed_at: null, deleted_at: null };
    const OTHER_NOTE = { id: 'other', title: 'Other Week', raw_text: 'Monday\n+Lifting\n-Row\n95 5,5,5' };
    const root = renderInline({ weeks: [week(), otherWeek], notes: [AB_NOTE, OTHER_NOTE] });

    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    expect(titleInput(root)).toBeTruthy();

    for (const label of ['View AB Week, Recovery Week 1', 'View Other Week, Recovery Week 2']) {
      const row = root.findAll(n => n.props && n.props.accessibilityLabel === label)[0];
      expect(row).toBeTruthy();
      expect(row.props.onPress).toBeUndefined();
      expect(row.props.accessibilityState.disabled).toBe(true);
    }
  });

  test('recovery block and week fields stay unchanged while editing', () => {
    const flatText = (root) => root.findAll(n => n.type === 'Text').map(n => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
    const root = renderInline();
    expect(flatText(root)).toContain('Baseline: Push Day');
    expect(flatText(root)).toContain('Week 1 in progress');
    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    expect(flatText(root)).toContain('Baseline: Push Day');
    expect(flatText(root)).toContain('Week 1 in progress');
  });

  // Automated review finding: `Complete recovery block` unmounts this whole
  // active-block card, and `Unlink Week` removes a week's row outright —
  // either could otherwise fire while a note is mid-edit and take the
  // inline editor's only Save/Cancel down with it. Every lifecycle control
  // locks, not just the two that can unmount something, so the one
  // `actionsLocked` flag keeps a single meaning throughout the card.
  test('every recovery lifecycle action locks while a note is edited inline', () => {
    const root = renderInline({
      onCompleteWeek: jest.fn(),
      onOpenAddWeek: jest.fn(),
      onUnlinkWeek: jest.fn(),
      onCompleteBlock: jest.fn(),
    });
    expect(byLabel(root, 'Complete Week 1').props.accessibilityState.disabled).toBeFalsy();

    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    expect(byLabel(root, 'Complete Week 1').props.accessibilityState.disabled).toBe(true);

    const manageTrigger = root.findAll(
      n => n.props && typeof n.props.accessibilityLabel === 'string'
        && n.props.accessibilityLabel.startsWith('Manage recovery block')
        && typeof n.props.onPress === 'function'
    )[0];
    // The disclosure trigger itself never disables (#780/#789 contract) — a
    // locked user must still be able to open it and see why its contents
    // are unavailable.
    expect(manageTrigger.props.disabled).toBeFalsy();
    render.act(() => { manageTrigger.props.onPress(); });

    expect(byLabel(root, 'Unlink Week 1').props.accessibilityState.disabled).toBe(true);
    expect(byLabel(root, 'End recovery block').props.accessibilityState.disabled).toBe(true);
  });
});

// -- Calm active Recovery card (#789) ---------------------------------------
//
// R4b changes only hierarchy: which fact the card states first, how many
// lifecycle actions are visible at once, and which section owns each control.
// No handler, confirm copy, gate, or calculation moves. These tests drive
// LogRecoverySection directly so the assertions are about the card's own
// structure rather than about LogScreen's wiring.
describe('LogRecoverySection: calm active Recovery hierarchy (#789)', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');
  const { RECOVERY_STALE_MESSAGE } = require('../hooks/entries/recoveryBlockHooks');

  const BLOCK = {
    id: 'rb789', baseline_note_id: 'baseline', baseline_note_title: 'Push/Pull/Legs',
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };
  const WEEK_NOTE = {
    id: 'weeknote', title: 'Recovery Week Note',
    raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5',
  };
  const week = (overrides = {}) => ({
    id: 'rw3', block_id: 'rb789', note_id: 'weeknote', week_number: 3,
    completed_at: null, deleted_at: null, ...overrides,
  });

  const renderSection = (props = {}) => {
    let component;
    render.act(() => {
      component = render.create(
        <LogRecoverySection blocks={[BLOCK]} weeks={[week()]} notes={[WEEK_NOTE]} {...props} />
      );
    });
    return component.root;
  };

  const allText = (root) => root.findAll(n => n.type === 'Text').map(n => {
    const c = n.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });
  const byLabel = (root, label) => root.findAll(n => n.props && n.props.accessibilityLabel === label)[0];
  const trigger = (root) => root.findAll(
    n => n.props && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Manage recovery block')
      && typeof n.props.onPress === 'function'
  )[0];
  // `Counting in normal analytics` IS the Log-surface inclusion control
  // (#843 review) — a tap on the row writes the field directly. There is no
  // separate `RecoveryInclusionToggle` Switch nested under it.
  const inclusionRow = (root) => root.findAll(
    n => n.props && n.props.accessibilityRole === 'switch' && typeof n.props.onPress === 'function'
  )[0];

  test('an open week leads with the state fact and offers exactly one lifecycle action', () => {
    const root = renderSection({ onCompleteWeek: jest.fn(), onOpenAddWeek: jest.fn() });
    const texts = allText(root);

    // The headline is the single fact that matters while logging, and the
    // baseline survives as one de-emphasized caption rather than two rows.
    expect(texts).toContain('Week 3 in progress');
    expect(texts).toContain('Baseline: Push/Pull/Legs');
    expect(texts).not.toContain('Baseline routine');

    // Exactly one lifecycle action is visible by default.
    expect(byLabel(root, 'Complete Week 3')).toBeTruthy();
    expect(byLabel(root, 'Add next recovery week')).toBeUndefined();
    expect(byLabel(root, 'End recovery block')).toBeUndefined();
    expect(byLabel(root, 'Unlink Week 3')).toBeUndefined();
    expect(inclusionRow(root)).toBeUndefined();
  });

  test('a just-completed week says so and swaps the one primary action to Add week', () => {
    const root = renderSection({
      weeks: [week({ completed_at: '2026-05-22T00:00:00.000Z' })],
      onOpenAddWeek: jest.fn(),
    });

    expect(allText(root)).toContain('Week 3 complete — add the next week');
    expect(byLabel(root, 'Add next recovery week')).toBeTruthy();
    expect(byLabel(root, 'Complete Week 3')).toBeUndefined();
  });

  test('a block whose weeks are all unlinked still states an honest headline', () => {
    const root = renderSection({ weeks: [], onOpenAddWeek: jest.fn() });
    expect(allText(root)).toContain('No recovery week yet — add a week');
    expect(byLabel(root, 'Add next recovery week')).toBeTruthy();
  });

  test('Unlink has exactly one owner: the disclosure, never the week row', () => {
    const root = renderSection({ onUnlinkWeek: jest.fn() });

    // The row-level Unlink is gone outright -- not merely relocated alongside a
    // second copy. The row itself still reads its note.
    expect(byLabel(root, 'Unlink Week 3')).toBeUndefined();
    expect(byLabel(root, 'View Recovery Week Note, Recovery Week 3')).toBeTruthy();

    render.act(() => { trigger(root).props.onPress(); });
    const unlinks = root.findAll(n => n.props
      && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Unlink Week')
      && typeof n.props.onPress === 'function');
    expect(unlinks).toHaveLength(1);
    expect(unlinks[0].props.accessibilityLabel).toBe('Unlink Week 3');
  });

  test('the disclosure trigger announces expanded state and reveals all three rare controls', () => {
    const root = renderSection({ onUnlinkWeek: jest.fn(), onCompleteBlock: jest.fn() });
    const control = trigger(root);

    // Named after what it discloses, including the block it belongs to.
    expect(control.props.accessibilityLabel).toBe('Manage recovery block: Push/Pull/Legs');
    expect(control.props.accessibilityRole).toBe('button');
    expect(control.props.accessibilityState).toEqual({ expanded: false });

    render.act(() => { control.props.onPress(); });
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: true });
    expect(byLabel(root, 'Unlink Week 3')).toBeTruthy();
    expect(byLabel(root, 'End recovery block')).toBeTruthy();
    expect(inclusionRow(root)).toBeTruthy();

    // And it collapses again.
    render.act(() => { trigger(root).props.onPress(); });
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: false });
    expect(byLabel(root, 'End recovery block')).toBeUndefined();
  });

  // #843 review: `Counting in normal analytics` IS the Log-surface
  // inclusion control — its live On/Off state is stated on the row itself,
  // with no nested `RecoveryInclusionToggle` Switch. The write path this
  // row's tap drives is covered end to end against real storage by the
  // "Recovery inclusion preference" describe block above.
  test('the Counting in normal analytics row states the live value with no nested switch', () => {
    const root = renderSection({ onUnlinkWeek: jest.fn(), onCompleteBlock: jest.fn() });
    render.act(() => { trigger(root).props.onPress(); });

    const row = byLabel(root, 'Counting in normal analytics: Off');
    expect(row).toBeTruthy();
    expect(row.props.accessibilityRole).toBe('switch');
    expect(row.props.accessibilityState).toEqual({ checked: false, disabled: false, busy: false });
    // No separate Switch control is nested under the row.
    expect(root.findAll(n => n.props && typeof n.props.onValueChange === 'function')).toHaveLength(0);

    // #843 review: the on-demand help toggle must be a SIBLING of the switch
    // Pressable, not nested inside it — a nested Pressable is grouped into
    // its accessible ancestor by VoiceOver, making it unreachable as its own
    // action.
    const helpToggle = root.findAll(
      n => n.props && n.props.accessibilityRole === 'button'
        && typeof n.props.accessibilityLabel === 'string'
        && n.props.accessibilityLabel.includes('counting these weeks in normal analytics')
    )[0];
    expect(helpToggle).toBeTruthy();
    let ancestor = helpToggle.parent;
    let foundSwitchAncestor = false;
    while (ancestor) {
      if (ancestor.props && ancestor.props.accessibilityRole === 'switch') foundSwitchAncestor = true;
      ancestor = ancestor.parent;
    }
    expect(foundSwitchAncestor).toBe(false);
  });

  test('locked mutations disable each control individually and never the disclosure itself', () => {
    // The corrected #780 blocked-mutation contract: disabling the trigger would
    // strand every disclosed control behind a container that cannot be opened.
    const root = renderSection({
      mutationsAllowed: false,
      onCompleteWeek: jest.fn(),
      onUnlinkWeek: jest.fn(),
      onCompleteBlock: jest.fn(),
    });

    const control = trigger(root);
    expect(control.props.disabled).toBeFalsy();
    expect(control.props.accessibilityState.disabled).toBeUndefined();

    expect(byLabel(root, 'Complete Week 3').props.accessibilityState.disabled).toBe(true);

    render.act(() => { control.props.onPress(); });
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: true });
    expect(byLabel(root, 'Unlink Week 3').props.accessibilityState.disabled).toBe(true);
    expect(byLabel(root, 'End recovery block').props.accessibilityState.disabled).toBe(true);
    expect(inclusionRow(root).props.accessibilityState.disabled).toBe(true);
  });

  test('banners stay outside the disclosure so they are announced without expanding anything', () => {
    const root = renderSection({ stateStale: true, onRetryRecovery: jest.fn() });

    expect(allText(root)).toContain(RECOVERY_STALE_MESSAGE);
    expect(byLabel(root, 'Retry recovery')).toBeTruthy();
    // Still collapsed: reading the notice never required opening it.
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: false });
  });

  // #792 review (P2): this component stays mounted for a block's whole
  // lifetime, and completing a block only makes it render no active card — it
  // does not unmount. A boolean `expanded` would survive that gap and hand the
  // NEXT block a disclosure that is already open, exposing Unlink, block
  // completion, and the inclusion switch by default. The state is keyed by
  // block id so any block change reads as collapsed.
  test('a new active block starts collapsed even if the previous one was left expanded', () => {
    const NEXT_BLOCK = {
      ...BLOCK, id: 'rb789next', baseline_note_title: 'Upper/Lower',
      started_at: '2026-09-01T00:00:00.000Z',
    };
    const nextWeek = { ...week(), id: 'rw1next', block_id: NEXT_BLOCK.id, week_number: 1 };

    let component;
    render.act(() => {
      component = render.create(
        <LogRecoverySection
          blocks={[BLOCK]} weeks={[week()]} notes={[WEEK_NOTE]}
          onUnlinkWeek={jest.fn()} onCompleteBlock={jest.fn()}
        />
      );
    });
    const root = component.root;

    render.act(() => { trigger(root).props.onPress(); });
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: true });
    expect(byLabel(root, 'Unlink Week 3')).toBeTruthy();

    // The block is completed: the same mounted component now has no active
    // card at all. Then a second block is started without leaving the tab.
    render.act(() => {
      component.update(
        <LogRecoverySection
          blocks={[{ ...BLOCK, completed_at: '2026-08-01T00:00:00.000Z' }]} weeks={[week()]} notes={[WEEK_NOTE]}
          onUnlinkWeek={jest.fn()} onCompleteBlock={jest.fn()}
        />
      );
    });
    expect(component.toJSON()).toBeNull();

    render.act(() => {
      component.update(
        <LogRecoverySection
          blocks={[{ ...BLOCK, completed_at: '2026-08-01T00:00:00.000Z' }, NEXT_BLOCK]}
          weeks={[nextWeek]} notes={[WEEK_NOTE]}
          onUnlinkWeek={jest.fn()} onCompleteBlock={jest.fn()}
        />
      );
    });

    // The new block owns its own disclosure state, and it is closed.
    expect(allText(root)).toContain('Week 1 in progress');
    expect(trigger(root).props.accessibilityLabel).toBe('Manage recovery block: Upper/Lower');
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: false });
    expect(byLabel(root, 'Unlink Week 1')).toBeUndefined();
    expect(byLabel(root, 'End recovery block')).toBeUndefined();
    expect(inclusionRow(root)).toBeUndefined();

    // And it still opens normally, now scoped to the new block.
    render.act(() => { trigger(root).props.onPress(); });
    expect(byLabel(root, 'Unlink Week 1')).toBeTruthy();
  });
});

// -- Simplified active Recovery panel (#804) --------------------------------
//
// R4b (#789/#792) established WHICH facts and controls the card holds. #804
// only settles how they are presented: the week row stops restating the
// headline's state, the one expected next action becomes the card's only
// accent-filled control, the rare destructive one demotes to a secondary chip,
// and the disclosure adopts the standard MaterialIcons chevron. No handler,
// gate, confirm, or calculation moves — the assertions below therefore pin the
// preserved behavior alongside the new hierarchy.
describe('LogRecoverySection: simplified active Recovery panel (#804)', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');
  const { RECOVERY_STALE_MESSAGE } = require('../hooks/entries/recoveryBlockHooks');
  const { LightColors } = require('../theme/colors');
  const { buildDayGroups } = require('../screens/log/logScreenHelpers');
  const { parseWorkoutNote: parse } = require('../lib/parser');

  const BLOCK = {
    id: 'rb804', baseline_note_id: 'baseline', baseline_note_title: 'Push/Pull/Legs',
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };
  const WEEK_NOTE = {
    id: 'weeknote', title: 'Recovery Week Note',
    raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5',
  };
  const week = (overrides = {}) => ({
    id: 'rw3', block_id: 'rb804', note_id: 'weeknote', week_number: 3,
    completed_at: null, deleted_at: null, ...overrides,
  });

  const renderSection = (props = {}) => {
    let component;
    render.act(() => {
      component = render.create(
        <LogRecoverySection blocks={[BLOCK]} weeks={[week()]} notes={[WEEK_NOTE]} {...props} />
      );
    });
    return component.root;
  };

  const flat = (node) => (Array.isArray(node.props.style)
    ? Object.assign({}, ...node.props.style.filter(Boolean))
    : node.props.style) || {};
  const allText = (root) => root.findAll(n => n.type === 'Text').map(n => {
    const c = n.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });
  const byLabel = (root, label) => root.findAll(n => n.props && n.props.accessibilityLabel === label)[0];
  const trigger = (root) => root.findAll(
    n => n.props && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Manage recovery block')
      && typeof n.props.onPress === 'function'
  )[0];
  const expand = (root) => { render.act(() => { trigger(root).props.onPress(); }); };
  // `Counting in normal analytics` IS the Log-surface inclusion control
  // (#843 review) — no separate `RecoveryInclusionToggle` Switch nested
  // under it.
  const inclusionRow = (root) => root.findAll(
    n => n.props && n.props.accessibilityRole === 'switch' && typeof n.props.onPress === 'function'
  )[0];
  const accentFilled = (root) => root.findAll(
    n => n.props && typeof n.props.onPress === 'function'
      && flat(n).backgroundColor === LightColors.accent
  );

  test('the week row carries the note and its own status, alongside the headline (#836)', () => {
    const root = renderSection();
    const texts = allText(root);

    // #836 corrected #789's original design: the headline only ever
    // describes the CURRENT week, but now every live week — completed
    // history included — renders as its own row. #843 moves status off a
    // repeated text label onto the row's status dot alone; the headline
    // still owns the current-week state fact, and the row's own week label
    // and note title are additional, not a duplicate of it.
    expect(texts).toContain('Week 3 in progress');
    expect(texts).toContain('Week 3');
    expect(texts).toContain('Recovery Week Note');
  });

  test('the week row still reads its note inline, with its accessible name intact', () => {
    const onViewNote = jest.fn();
    const root = renderSection({ onViewNote });

    // A screen-reader user reaches this control out of context, so the label
    // keeps the week number and the read verb even though the visible row no
    // longer repeats them.
    const row = byLabel(root, 'View Recovery Week Note, Recovery Week 3');
    expect(row).toBeTruthy();
    expect(row.props.accessibilityRole).toBe('button');
    expect(flat(row).minHeight).toBeGreaterThanOrEqual(44);

    render.act(() => { row.props.onPress(); });
    expect(onViewNote).toHaveBeenCalledWith(WEEK_NOTE);

    // And the owner's viewer state renders in this card, with the A/B switch.
    const viewing = renderSection({
      viewingNoteId: 'weeknote',
      viewingNote: WEEK_NOTE,
      viewingNoteDayGroups: buildDayGroups(parse(WEEK_NOTE.raw_text).sections),
      viewingHasABWeeks: true,
      viewingEffectiveWeek: 'A',
      onToggleViewingWeek: jest.fn(),
    });
    expect(byLabel(viewing, 'Switch to Week B')).toBeTruthy();
  });

  // #843 review: the compact reading mode must not silently drop a
  // user-entered `*mark`, and must not repeat the note's own day heading
  // (already shown once by the inset surface's own kicker).
  test('compact rendering preserves a marked set and does not duplicate the day heading', () => {
    const markedNote = {
      id: 'weeknote', title: 'Recovery Week Note',
      raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5 *PR',
    };
    const onViewNote = jest.fn();
    const root = renderSection({
      weeks: [week({ note_id: 'weeknote' })],
      notes: [markedNote],
      onViewNote,
      viewingNoteId: 'weeknote',
      viewingNote: markedNote,
      viewingNoteDayGroups: buildDayGroups(parse(markedNote.raw_text).sections),
    });

    expect(allText(root)).toContain('★ PR');
    // "Monday" is this note's one day heading; it must render exactly once
    // (via the inset surface's own uppercase kicker), not a second time from
    // WorkoutContentRenderer's own WorkoutHeading.
    const mondayCount = root.findAll(n => n.type === 'Text'
      && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '')
        .toUpperCase() === 'MONDAY').length;
    expect(mondayCount).toBe(1);
  });

  test('a week with no readable note offers no read affordance at all', () => {
    const root = renderSection({ weeks: [week({ note_id: null })], onViewNote: jest.fn() });

    const row = byLabel(root, 'Recovery Week 3, note unavailable');
    expect(row).toBeTruthy();
    expect(row.props.onPress).toBeUndefined();
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(allText(root)).toContain('Note unavailable');
    // No chevron either: it would advertise a read that cannot happen.
    expect(row.findAll(n => n.props && n.props.name === 'chevron-right')).toHaveLength(0);
  });

  test('the one expected next action is the card\'s only accent-filled control', () => {
    const open = renderSection({ onCompleteWeek: jest.fn() });
    const filled = accentFilled(open);
    expect(filled).toHaveLength(1);
    expect(filled[0].props.accessibilityLabel).toBe('Complete Week 3');

    // It swaps rather than multiplying once the week completes.
    const done = renderSection({
      weeks: [week({ completed_at: '2026-05-22T00:00:00.000Z' })],
      onOpenAddWeek: jest.fn(),
    });
    const swapped = accentFilled(done);
    expect(swapped).toHaveLength(1);
    expect(swapped[0].props.accessibilityLabel).toBe('Add next recovery week');
  });

  test('the rare destructive controls stay secondary and keep a 44dp target', () => {
    const root = renderSection({ onUnlinkWeek: jest.fn(), onCompleteBlock: jest.fn() });
    expand(root);

    // Completing a block is irreversible and happens once per block: an accent
    // fill here would make it the loudest button on the card.
    for (const label of ['Unlink Week 3', 'End recovery block']) {
      const control = byLabel(root, label);
      expect(flat(control).backgroundColor).not.toBe(LightColors.accent);
      expect(flat(control).minHeight).toBeGreaterThanOrEqual(44);
    }
    // Still exactly one accent fill on the card, even with the disclosure open.
    expect(accentFilled(root)).toHaveLength(1);
  });

  test('the disclosure uses the standard chevron, not a text arrow', () => {
    const root = renderSection();
    // The icon renders as a component wrapping its own glyph node, so the name
    // is asserted as the set of disclosure glyphs present, not as a node count.
    const chevrons = (r) => [...new Set(r.findAll(
      n => n.props && /^expand-(more|less)$/.test(n.props.name || '')
    ).map(n => n.props.name))];

    expect(allText(root).join(' ')).not.toMatch(/[▸▾▲▼]/);
    // Every linked week row also uses expand-more/-less now (#843: "never
    // chevron-right for inline expansion"), so with both the trigger and the
    // (unviewed) week row collapsed, the glyph SET is still just 'expand-more'.
    expect(chevrons(root)).toEqual(['expand-more']);
    expect(flat(trigger(root)).minHeight).toBeGreaterThanOrEqual(44);

    expand(root);
    // The trigger is now expanded (expand-less); the week row's own glyph is
    // independent and still collapsed (expand-more).
    expect(chevrons(root)).toEqual(expect.arrayContaining(['expand-less', 'expand-more']));
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: true });
  });

  test('a pending recovery operation still locks every action and stays readable while collapsed', () => {
    const root = renderSection({
      pendingRecovery: [{ id: 'op1' }],
      onCompleteWeek: jest.fn(),
      onUnlinkWeek: jest.fn(),
      onCompleteBlock: jest.fn(),
      onRetryRecovery: jest.fn(),
    });

    expect(allText(root)).toContain('A recovery change is still being applied on this device.');
    expect(byLabel(root, 'Retry recovery')).toBeTruthy();
    expect(byLabel(root, 'Complete Week 3').props.accessibilityState.disabled).toBe(true);

    // The disclosure itself is never disabled, and its contents stay locked.
    expect(trigger(root).props.disabled).toBeFalsy();
    expand(root);
    expect(byLabel(root, 'Unlink Week 3').props.accessibilityState.disabled).toBe(true);
    expect(byLabel(root, 'End recovery block').props.accessibilityState.disabled).toBe(true);
    expect(inclusionRow(root).props.accessibilityState.disabled).toBe(true);
  });

  test('a terminal error explains itself, locks nothing, and offers no retry', () => {
    const root = renderSection({
      pendingRecovery: [],
      pendingRecoveryError: 'That recovery change was cancelled.',
      onCompleteWeek: jest.fn(),
    });

    expect(allText(root)).toContain('That recovery change was cancelled.');
    expect(byLabel(root, 'Retry recovery')).toBeUndefined();
    expect(byLabel(root, 'Complete Week 3').props.accessibilityState.disabled).toBe(false);
  });

  test('a stale snapshot keeps its notice and last-known-good card outside the disclosure', () => {
    const root = renderSection({ stateStale: true, onRetryRecovery: jest.fn() });
    expect(allText(root)).toContain(RECOVERY_STALE_MESSAGE);
    expect(allText(root)).toContain('Week 3 in progress');
    expect(byLabel(root, 'Retry recovery')).toBeTruthy();
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: false });
  });

  test('an unverified first read renders the unknown state and its retry, and a cold load renders nothing', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogRecoverySection blocks={[]} weeks={[]} notes={[]} stateReady={false} stateLoading />
      );
    });
    expect(component.toJSON()).toBeNull();

    let failed;
    render.act(() => {
      failed = render.create(
        <LogRecoverySection
          blocks={[]} weeks={[]} notes={[]}
          stateReady={false} stateError={new Error('read failed')} onRetryRecovery={jest.fn()}
        />
      );
    });
    expect(byLabel(failed.root, 'Retry recovery')).toBeTruthy();
  });
});

describe('Log disclosures and Recovery reads at the screen level (#775)', () => {
  const CURRENT = {
    id: 'note1', title: 'Routine A',
    raw_text: 'Monday\n+Lifting\n-Overhead Press\n95 5,5,5',
    saved_at: '2026-06-01T12:00:00.000Z',
  };
  const OTHER = {
    id: 'r1', title: 'Routine B',
    raw_text: 'Tuesday\n+Lifting\n-Squat\n225 5,5,5',
    saved_at: '2026-05-01T12:00:00.000Z',
  };
  const DELOAD = {
    id: 'd1', title: 'Deload · Week 1',
    raw_text: 'Monday\n+Lifting\n-Chin Up\n0 5,5,5',
    saved_at: '2026-04-01T12:00:00.000Z',
  };
  const BLOCK = {
    id: 'rb775s', baseline_note_id: 'note1', baseline_note_title: 'Routine A',
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };

  const setup = ({ weekNoteId = null, deloadMode = true } = {}) => {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [CURRENT, OTHER, DELOAD], currentId: 'note1', currentNote: CURRENT,
      deloadNotes: [DELOAD], loading: false, error: null,
      refresh: jest.fn(), selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}), add: jest.fn(), remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({
      note: { raw_text: 'Monday\n+Lifting\n-Bench\n95 5,5,5', saved_at: '2026-07-01T00:00:00.000Z' },
      loading: false, save: jest.fn(), clear: jest.fn(),
    });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: deloadMode });
    const weeks = weekNoteId
      ? [{ id: 'rw1', block_id: BLOCK.id, note_id: weekNoteId, week_number: 1, completed_at: null, deleted_at: null }]
      : [];
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock: weekNoteId ? BLOCK : null,
      blocks: weekNoteId ? [BLOCK] : [],
      weeks,
      recoveryWeekNumberByNoteId: weekNoteId ? { [weekNoteId]: 1 } : {},
      refresh: jest.fn(), pendingRecovery: [], recoveryPendingError: null,
      ready: true, loading: false, refreshing: false, stale: false, error: null,
      mutationsAllowed: true,
    });
    useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });
  };

  const mount = (props = {}) => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen {...props} />); });
    return component;
  };

  const hasText = (component, needle) => component.root.findAll(
    n => n.type === 'Text'
      && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '').includes(needle)
  ).length > 0;

  const switchTo = (component, tab) => {
    const toggle = pressableAround(component.root, t => t === tab);
    render.act(() => { toggle.props.onPress(); });
  };

  const routineToggle = (component) => component.root.findAll(
    n => n.props
      && /^(Show|Hide) routines$/.test(n.props.accessibilityLabel || '')
      && typeof n.props.onPress === 'function'
  )[0];
  const routineExpanded = (component) => routineToggle(component).props.accessibilityState.expanded;
  const toggleRoutineManagement = (component) => {
    const toggle = routineToggle(component);
    render.act(() => { toggle.props.onPress(); });
  };

  const deloadToggle = (component) => component.root.findAll(
    n => n.props
      && /^(Expand|Collapse) deload week$/.test(n.props.accessibilityLabel || '')
      && typeof n.props.onPress === 'function'
  )[0];
  const deloadExpanded = (component) => deloadToggle(component).props.accessibilityState.expanded;

  beforeEach(() => {
    jest.clearAllMocks();
    setup();
  });

  test('tapping a Recovery week renders that note in the Recovery card, leaving More Routines alone', () => {
    setup({ weekNoteId: 'r1' });
    // An active block lands on the Recovery tab by default (#823).
    const component = mount();
    expect(hasText(component, 'Squat')).toBe(false);

    const row = component.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'View Routine B, Recovery Week 1' && typeof n.props.onPress === 'function'
    )[0];
    render.act(() => { row.props.onPress(); });

    expect(hasText(component, 'Squat')).toBe(true);
    // The read happened where the tap did: the routine-management disclosure
    // neither opened nor changed state. It only mounts on the Routine tab
    // (#823), so switch there to check it.
    switchTo(component, 'Routine');
    expect(routineExpanded(component)).toBe(false);
  });

  test('an A/B recovery week can be read week by week without leaving the Recovery card', () => {
    // The whole note is never rendered at once — the viewer projects one half —
    // so the inline read is only complete if its Week switch works here (#775
    // review).
    const AB = {
      id: 'ab1', title: 'AB Routine',
      raw_text: 'Monday\n+Lifting\n-Squat\n225 5,5,5\n---\nTuesday\n+Lifting\n-Chin Up\n0 5,5,5',
      saved_at: '2026-05-02T12:00:00.000Z',
    };
    setup({ weekNoteId: 'ab1' });
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [CURRENT, AB, DELOAD], currentId: 'note1', currentNote: CURRENT,
      deloadNotes: [DELOAD], loading: false, error: null,
      refresh: jest.fn(), selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({ ...AB, activeWeek: 'B' }), add: jest.fn(), remove: jest.fn(),
    });
    const component = mount();

    const row = component.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'View AB Routine, Recovery Week 1' && typeof n.props.onPress === 'function'
    )[0];
    render.act(() => { row.props.onPress(); });
    expect(hasText(component, 'Squat')).toBe(true);
    expect(hasText(component, 'Chin Up')).toBe(false);

    const pill = component.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Switch to Week B' && typeof n.props.onPress === 'function'
    )[0];
    expect(pill).toBeTruthy();
    render.act(() => { pill.props.onPress(); });

    expect(hasText(component, 'Chin Up')).toBe(true);
    expect(hasText(component, 'Squat')).toBe(false);
    // Still read in place: the routine-management disclosure never opened.
    switchTo(component, 'Routine');
    expect(routineExpanded(component)).toBe(false);
  });

  test('a recovery week linked to the CURRENT routine is readable too, not an inert press', () => {
    setup({ weekNoteId: 'note1' });
    const component = mount();
    // The active card renders the editor's text, not this note's body.
    expect(hasText(component, 'Overhead Press')).toBe(false);

    const row = component.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'View Routine A, Recovery Week 1' && typeof n.props.onPress === 'function'
    )[0];
    expect(row).toBeTruthy();
    render.act(() => { row.props.onPress(); });

    expect(hasText(component, 'Overhead Press')).toBe(true);
    switchTo(component, 'Routine');
    expect(routineExpanded(component)).toBe(false);
  });

  test('More Routines keeps its disclosure state across Routine→Deload→Routine', () => {
    const component = mount();
    toggleRoutineManagement(component);
    expect(routineExpanded(component)).toBe(true);

    switchTo(component, 'Deload');
    switchTo(component, 'Routine');
    expect(routineExpanded(component)).toBe(true);

    toggleRoutineManagement(component);
    switchTo(component, 'Deload');
    switchTo(component, 'Routine');
    expect(routineExpanded(component)).toBe(false);
  });

  test('a consumed reveal is not replayed by the remount a view switch causes', () => {
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    // The handoff opened the disclosure for its target…
    expect(routineExpanded(component)).toBe(true);
    // …the user closed it again…
    toggleRoutineManagement(component);
    expect(routineExpanded(component)).toBe(false);

    // …and the Routine↔Deload remount must not re-apply the same spent request.
    switchTo(component, 'Deload');
    switchTo(component, 'Routine');
    expect(routineExpanded(component)).toBe(false);
  });

  test('the Deload Week card keeps its disclosure state across Deload→Routine→Deload', () => {
    const component = mount();
    switchTo(component, 'Deload');
    expect(deloadExpanded(component)).toBe(true);

    render.act(() => { deloadToggle(component).props.onPress(); });
    expect(deloadExpanded(component)).toBe(false);

    switchTo(component, 'Routine');
    switchTo(component, 'Deload');
    expect(deloadExpanded(component)).toBe(false);
  });

  test('a deload-note handoff does not reveal More Routines, which owns none of its notes', () => {
    const component = mount({ navNoteId: 'd1', navNoteKey: 1 });
    // The intent switched the screen to the view that owns the note.
    expect(hasText(component, 'More Routines')).toBe(false);

    switchTo(component, 'Routine');
    expect(routineExpanded(component)).toBe(false);
  });
});
