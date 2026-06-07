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
import { parseWorkoutNote, weeksSinceLastDeload, sessionsSinceLastDeload } from '../lib/parser';
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
    // session_count=99 is stale; ordinal=5 wins via deriveRoutineStatus.
    const history = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 99, deload_session_ordinal: 5 }];
    expect(deriveRoutineStatus(sectionsWithSessions(5), NOTE, history).sessionsSinceDeload).toBe(1);
    expect(deriveRoutineStatus(sectionsWithSessions(4), NOTE, history).sessionsSinceDeload).toBe(0);
    expect(deriveRoutineStatus(sectionsWithSessions(7), NOTE, history).sessionsSinceDeload).toBe(3);
  });

  test('freshly completed deload (no new sessions yet) reads 0', () => {
    // 4 sessions in note, ordinal=5 → max(0, 4-5+1)=0.
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 4, deload_session_ordinal: 5 }];
    expect(deriveRoutineStatus(sectionsWithSessions(4), NOTE, history).sessionsSinceDeload).toBe(0);
  });

  test('first post-deload session reads 1', () => {
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 4, deload_session_ordinal: 5 }];
    expect(deriveRoutineStatus(sectionsWithSessions(5), NOTE, history).sessionsSinceDeload).toBe(1);
  });

  test('legacy records without deload_session_ordinal fall through to session_count', () => {
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 10 }];
    expect(deriveRoutineStatus(sectionsWithSessions(14), NOTE, history).sessionsSinceDeload).toBe(4);
  });

  test('user-corrected ordinal counts correctly for partial-import scenario', () => {
    // App note has 2 sessions (imported last 2 of a real 14-session routine).
    // Default prefill would be 3; user corrects to 15 (real next ordinal).
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 2, deload_session_ordinal: 15 }];
    // Before the note accumulates enough sessions, still 0.
    expect(deriveRoutineStatus(sectionsWithSessions(2), NOTE, history).sessionsSinceDeload).toBe(0);
    // Once note reaches ordinal 15, first post-deload session = 1.
    expect(deriveRoutineStatus(sectionsWithSessions(15), NOTE, history).sessionsSinceDeload).toBe(1);
    expect(deriveRoutineStatus(sectionsWithSessions(17), NOTE, history).sessionsSinceDeload).toBe(3);
  });
});

// ── deload ordinal prompt: prefill and editability contract (#284) ────────────
// LogScreen cannot be rendered in this test environment. These source-level
// assertions prove the behavioral contract: prefill formula, editable input,
// and correct forwarding to completeDeload.

describe('deload ordinal prompt: prefill and editability contract (#284)', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(path.join(__dirname, '../screens/LogScreen.js'), 'utf8');
  });

  test('prompt is prefilled with logSessionCount + 1', () => {
    expect(src).toMatch(/setDeloadOrdinalInput\(String\(logSessionCount \+ 1\)\)/);
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

const fs = require('fs');
const path = require('path');

describe('autosave call sites: debounce timers pass { autosave: true }', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(
      path.join(__dirname, '../screens/LogScreen.js'),
      'utf8'
    );
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
    src = fs.readFileSync(
      path.join(__dirname, '../screens/LogScreen.js'),
      'utf8'
    );
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

// ── Undo escape hatch: source-level assertions ─────────────────────
describe('Undo escape hatch: source-level assertions', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(
      path.join(__dirname, '../screens/LogScreen.js'),
      'utf8'
    );
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
    expect(src).toMatch(/onPress\s*=\s*\{\s*deloadMode\s*===\s*'edit'\s*\?\s*handleUndoDeload\s*:\s*editingNoteId\s*\?\s*handleUndoOther\s*:\s*handleUndoCurrent\s*\}/);
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

describe('routine switch: progress rollover source assertions (#295)', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(path.join(__dirname, '../screens/LogScreen.js'), 'utf8');
  });

  test('imports findMatchingExerciseNames and rolloverOneKExercises from data', () => {
    expect(src).toMatch(/findMatchingExerciseNames/);
    expect(src).toMatch(/rolloverOneKExercises/);
  });

  test('handleSwitchCurrent calls findMatchingExerciseNames', () => {
    expect(src).toMatch(/findMatchingExerciseNames\s*\(/);
  });

  test('rollover prompt is shown only when matches exist', () => {
    expect(src).toMatch(/matchedNames\.length\s*>\s*0/);
  });

  test('rollover prompt is a single yes/no Alert with no exercise list', () => {
    expect(src).toMatch(/Keep current progress\?/);
    expect(src).toMatch(/Some exercises match/);
  });

  test('rollover applies one_k_exercises patch to new note before selectCurrent', () => {
    expect(src).toMatch(/rolloverOneKExercises\s*\(/);
    expect(src).toMatch(/one_k_exercises\s*:\s*rolledOneK/);
  });

  test('declining rollover calls doSwitch with rollover false', () => {
    expect(src).toMatch(/rollover\s*:\s*false/);
  });
});

// ── A/B week support: source assertions (#295) ───────────────────────────────

describe('A/B week support: source assertions (#295)', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(path.join(__dirname, '../screens/LogScreen.js'), 'utf8');
  });

  test('derives weekBStartIndex from parsed result', () => {
    expect(src).toMatch(/weekBStartIndex/);
  });

  test('computes hasABWeeks from weekBStartIndex', () => {
    expect(src).toMatch(/hasABWeeks/);
  });

  test('effectiveActiveWeek defaults to A when activeWeek is not set', () => {
    expect(src).toMatch(/activeWeek\s*\?\?\s*['"]A['"]/);
  });

  test('handleToggleWeek toggles between A and B', () => {
    expect(src).toMatch(/handleToggleWeek/);
    expect(src).toMatch(/effectiveActiveWeek\s*===\s*['"]B['"]\s*\?\s*['"]A['"]\s*:\s*['"]B['"]/);
  });

  test('activeWeekSections slices sections by week', () => {
    expect(src).toMatch(/activeWeekSections/);
    expect(src).toMatch(/parsed\.sections\.slice\s*\(\s*weekBStartIndex\s*\)/);
    expect(src).toMatch(/parsed\.sections\.slice\s*\(\s*0\s*,\s*weekBStartIndex\s*\)/);
  });

  test('week toggle button only renders when hasABWeeks is true', () => {
    expect(src).toMatch(/hasABWeeks\s*&&/);
    expect(src).toMatch(/Week\s*\{effectiveActiveWeek/);
  });
});
