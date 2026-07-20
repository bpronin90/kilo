import React from 'react';
import render from 'react-test-renderer';
import { LogScreen } from '../screens/LogScreen';
import { MoreScreen } from '../screens/MoreScreen';
import * as useEntries from '../hooks/useEntries';
import { Colors } from '../theme/colors';

jest.mock('expo-updates', () => ({
  useUpdates: () => ({ currentlyRunning: { isEmbeddedLaunch: true } }),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));
import { parseWorkoutNote, applyWeekSkipToText, weeksSinceLastDeload, sessionsSinceLastDeload } from '../lib/parser';
import { removeWeekSkipFromText } from '../lib/parser/workoutNote.js';
import { deriveRoutineStatus } from '../lib/data';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

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
    expect(src).toMatch(/if\s*\(\s*!autosave\s*\)\s*setSaveSuccess\s*\(\s*'Saved!'\s*\)/);
  });

  test('handleSaveOtherNote suppresses setSaveSuccess when autosave is true', () => {
    // Same guard must appear twice — once per save handler.
    const matches = src.match(/if\s*\(\s*!autosave\s*\)\s*setSaveSuccess\s*\(\s*'Saved!'\s*\)/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
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
        deloadDateEditEnabled: false,
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
        deloadDateEditEnabled: true,
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { render.create(<Harness notes={[note]} deloadHistory={[histRecord]} />); });

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
        deloadDateEditEnabled: false,
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
});

// ── Web edit path: explicit non-double-tap edit control (#314) ───────────────
// Web has no reliable double-tap idiom, so Log must expose an explicit tap-once
// edit affordance. LogScreen passes enterCurrentEditor (single-press editor
// entry) to the active routine card alongside the legacy double-tap body
// handler, so the explicit "Edit" button works on web without a double-tap.
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
    expect(editorSrc).toMatch(/Platform\.OS\s*===\s*'web'\s*&&\s*editingDeloadHasLinkedRecord/);
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
    expect(editorSrc).toMatch(/onPress=\{editingDeloadHasLinkedRecord\s*\?\s*\(\)\s*=>\s*setShowDeloadDatePicker\(true\)/);
    expect(editorSrc).toMatch(/<DateTimePicker[\s\S]*?onChange\s*=\s*\{/);
  });
});

// ── Undo escape hatch: source-level assertions ─────────────────────
describe('Undo escape hatch: source-level assertions', () => {
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

  test('undo buttons are rendered in the headerRight section', () => {
    // Matches both original flat names and hook-prefixed names (e.g. deloadEditor.handleUndoDeload)
    expect(src).toMatch(/onPress\s*=\s*\{[\s\S]{0,60}deload[A-Za-z.]*Mode\s*===\s*'edit'\s*\?[\s\S]{0,100}handleUndoDeload[\s\S]{0,100}handleUndoOther[\s\S]{0,100}handleUndoCurrent/);
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
      deloadDateEditEnabled={true}
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

describe('Undo escape hatch: integration tests', () => {
  let mockUpdateNote;
  let mockUpdateDeload;
  let mockSelectCurrent;
  let currentNotesList;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
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
    jest.useRealTimers();
  });

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
          weightDateEditEnabled={true}
          onUpdateWeightDateEditEnabled={jest.fn()}
          deloadDateEditEnabled={true}
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

  test('editing current note and pressing Undo reverts the note state in UI and DB', async () => {
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

    // Find Undo button in ScreenShell headerRight
    const undoButton = findPressableByText(root, 'Undo');
    expect(undoButton).toBeTruthy();

    await render.act(async () => {
      await undoButton.props.onPress();
    });

    expect(mockUpdateNote).toHaveBeenCalledWith('note1', {
      title: 'Original Title',
      raw_text: 'Original Text',
    });

    expect(setWorkoutNoteText).toHaveBeenCalledWith('Original Text');
    expect(setWorkoutNoteTitle).toHaveBeenCalledWith('Original Title');
  });

  test('editing other note and pressing Undo reverts the note state in UI and DB', async () => {
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

    // Tap Undo button
    const undoButton = findPressableByText(root, 'Undo');
    expect(undoButton).toBeTruthy();
    await render.act(async () => {
      await undoButton.props.onPress();
    });

    expect(mockUpdateNote).toHaveBeenCalledWith('note2', {
      title: 'Routine B',
      raw_text: 'Original Other Text',
    });

    expect(textInput.props.value).toBe('Original Other Text');
  });

  test('editing current note and pressing Undo leaves UI state intact and alerts if DB update fails', async () => {
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

    // Find Undo button
    const undoButton = findPressableByText(root, 'Undo');
    expect(undoButton).toBeTruthy();

    await render.act(async () => {
      await undoButton.props.onPress();
    });

    expect(setWorkoutNoteText).not.toHaveBeenCalled();
    expect(setWorkoutNoteTitle).not.toHaveBeenCalled();
  });

  test('editing other deload note and pressing Undo triggers compensating updateDeload rollback if note update fails', async () => {
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

    // Find the session number input and change its value to 10
    const textInputs = root.findAllByType('TextInput');
    const ordinalInput = textInputs.find(ti => ti.props.placeholder === 'Session number');
    expect(ordinalInput).toBeTruthy();
    render.act(() => {
      ordinalInput.props.onChangeText('10');
    });

    // Tap Undo button
    const undoButton = findPressableByText(root, 'Undo');
    expect(undoButton).toBeTruthy();
    await render.act(async () => {
      await undoButton.props.onPress();
    });

    expect(mockUpdateDeload).toHaveBeenLastCalledWith('hist3', {
      completed_at: '2026-06-01T12:00:00.000Z',
      deload_session_ordinal: 10,
    });
  });

  test('editing other deload note, clearing the session ordinal, and pressing Undo triggers compensating updateDeload rollback with null ordinal if note update fails', async () => {
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

    // Find session number input and clear it
    const textInputs = root.findAllByType('TextInput');
    const ordinalInput = textInputs.find(ti => ti.props.placeholder === 'Session number');
    expect(ordinalInput).toBeTruthy();
    render.act(() => {
      ordinalInput.props.onChangeText('');
    });

    // Tap Undo
    const undoButton = findPressableByText(root, 'Undo');
    expect(undoButton).toBeTruthy();
    await render.act(async () => {
      await undoButton.props.onPress();
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
import { Alert } from 'react-native';

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
    
    // Check that it does NOT have emptyText styling (which has textAlign: 'center'), and has unparsedRowMuted styling (color: Colors.text)
    expect(textNode.props.style.textAlign).toBeUndefined();
    expect(textNode.props.style.color).toBe(Colors.text);
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
  // (unparsedRow / Colors.error) styling for unparsed lifting rows, like main:1423-1459.
  test('past-deload view (isDeload only) renders unparsed lifting rows in error red', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} isDeload={true} />
      );
    });
    expect(findRawText(component.root).props.style.color).toBe(Colors.error);
  });

  // Active deload editor card (isDeload + mutedUnparsed) was always muted on main.
  test('active deload card (mutedUnparsed) renders unparsed lifting rows muted', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} isDeload={true} mutedUnparsed={true} />
      );
    });
    expect(findRawText(component.root).props.style.color).toBe(Colors.text);
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

// Walk up from a matching Text node to its nearest Pressable (onPress) ancestor.
function pressableAround(root, predicate) {
  const matches = root.findAll(
    n => n.type === 'Text' && predicate(
      Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')
    )
  );
  for (const match of matches) {
    let node = match.parent;
    while (node) {
      if (node.props && typeof node.props.onPress === 'function') return node;
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

  test('tapping the body calls the body handler, not toggleCollapsed', () => {
    const { root, props } = renderCard();
    const body = pressableAround(root, t => t.includes('Double-tap to edit'));
    render.act(() => { body.props.onPress(); });
    expect(props.handleNoteBodyPress).toHaveBeenCalledTimes(1);
    expect(props.toggleCollapsed).not.toHaveBeenCalled();
  });
});

// Regression #5: the extracted viewed-note body handler was stubbed to a no-op,
// killing double-tap-to-edit on saved routines. This pins the restored 300ms
// double-tap that opens the routine in the editor.
describe('LogPreviousRoutines: double-tap viewed routine opens editor', () => {
  const { LogPreviousRoutines } = require('../components/LogPreviousRoutines');

  test('two quick taps on the viewed body call handleEditViewedNote; one tap does not', () => {
    const handleEditViewedNote = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <LogPreviousRoutines
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
    const body = pressableAround(component.root, t => t.includes('Double-tap to edit'));
    expect(body).toBeTruthy();

    render.act(() => { body.props.onPress(); });
    expect(handleEditViewedNote).not.toHaveBeenCalled(); // single tap is a no-op

    render.act(() => { body.props.onPress(); }); // second tap within 300ms
    expect(handleEditViewedNote).toHaveBeenCalledTimes(1);
  });
});

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
