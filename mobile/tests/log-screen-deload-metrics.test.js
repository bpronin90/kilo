import { installRendererCleanup } from './helpers/log-screen';
import React from 'react';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { parseWorkoutNote, weeksSinceLastDeload, sessionsSinceLastDeload } from '../lib/parser';
import { deriveRoutineStatus } from '../lib/data';
import { Alert } from 'react-native';
import { LogDeloadSection } from '../components/LogDeloadSection';
import { finishSheetDismiss, findPressableByText, ControlledLogScreen, mountOtherRoutineEditorHook } from './helpers/log-screen';

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
// Rendered LogDeloadSection: the prompt is prefilled from the pre-deload
// session count, the input is editable, and the confirmed (integer) value is
// what reaches completeDeload.

function mountDeloadSection({ completeDeload, logSessionCount = 5 }) {
  let component;
  render.act(() => {
    component = render.create(
      <LogDeloadSection
        deloadNote={{ raw_text: 'test deload' }}
        deloadLoading={false}
        deloadDayGroups={[]}
        enterDeloadEditor={jest.fn()}
        handleDeloadBodyPress={jest.fn()}
        deloadMode="read"
        completeDeload={completeDeload}
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
        logSessionCount={logSessionCount}
      />
    );
  });
  const root = component.root;
  const ordinalInput = () => root.findAllByType('TextInput').find(ti => ti.props.accessibilityLabel === 'Deload session number');
  return {
    root,
    ordinalInput,
    openPrompt: () => { render.act(() => { root.findByProps({ title: 'Deload complete' }).props.onPress(); }); },
    typeOrdinal: (text) => { render.act(() => { ordinalInput().props.onChangeText(text); }); },
    confirm: async () => {
      const confirm = root.findAll(n => n.props && n.props.accessibilityLabel === 'Confirm deload complete' && typeof n.props.onPress === 'function')[0];
      await render.act(async () => { await confirm.props.onPress(); });
    },
  };
}

describe('deload ordinal prompt: prefill and editability contract (#284)', () => {
  test('prompt is prefilled with logSessionCount and confirming forwards it to completeDeload', async () => {
    const completeDeload = jest.fn();
    const section = mountDeloadSection({ completeDeload, logSessionCount: 5 });
    section.openPrompt();
    expect(section.ordinalInput().props.value).toBe('5');

    await section.confirm();
    expect(completeDeload).toHaveBeenCalledTimes(1);
    expect(completeDeload).toHaveBeenCalledWith({ sessionCount: 5, deloadSessionOrdinal: 5 });
  });

  test('the input is editable and the edited value is parsed as an integer ordinal', async () => {
    const completeDeload = jest.fn();
    const section = mountDeloadSection({ completeDeload, logSessionCount: 5 });
    section.openPrompt();
    section.typeOrdinal('12');
    expect(section.ordinalInput().props.value).toBe('12');

    await section.confirm();
    // The session count stays the real pre-deload count; only the ordinal is edited.
    expect(completeDeload).toHaveBeenCalledWith({ sessionCount: 5, deloadSessionOrdinal: 12 });
  });

  test('an empty or non-positive ordinal is not forwarded and keeps the prompt open', async () => {
    const completeDeload = jest.fn();
    const section = mountDeloadSection({ completeDeload, logSessionCount: 5 });
    section.openPrompt();
    section.typeOrdinal('');
    await section.confirm();
    section.typeOrdinal('0');
    await section.confirm();

    expect(completeDeload).not.toHaveBeenCalled();
    expect(section.ordinalInput()).toBeTruthy();
  });
});

// ── deload date edit: save-flow stuck-state prevention ───────────────────────
// Pressing Done while an autosave is in flight must chain onto the running
// save (not receive undefined), and the save machinery must always settle back
// to "not saving" so a later save can start. Driven through the real hook.

describe('deload date edit: save flow does not get stuck in pending state', () => {
  const { DELOAD_NOTE_PREFIX } = require('../lib/LogScreenHelpers');
  let harness;

  afterEach(() => {
    if (harness) { harness.unmount(); harness = null; }
  });

  const settle = () => render.act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });

  const openNote = (note, extra) => {
    harness = mountOtherRoutineEditorHook({ notes: [note], ...extra });
    render.act(() => { harness.get().handleOpenOtherNote(note); });
  };

  test('a save requested while one is running coalesces onto it and resolves with the real result', async () => {
    const note = { id: 'n1', title: 'R', raw_text: 'A0' };
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const update = jest.fn().mockImplementation(async (id, patch) => {
      await gate;
      return { id, title: patch.title, raw_text: patch.raw_text };
    });
    openNote(note, { update });
    render.act(() => { harness.get().setEditingText('A1'); });

    let first;
    let second;
    render.act(() => { first = harness.get().handleSaveOtherNote(); });
    await settle();
    render.act(() => { second = harness.get().handleSaveOtherNote(); });
    expect(harness.get().noteIsSaving).toBe(true);

    await render.act(async () => { release(); await first; await second; });

    expect(update).toHaveBeenCalledTimes(1);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(harness.get().noteIsSaving).toBe(false);
  });

  test('after a save settles the next save starts (the in-flight guard does not leak)', async () => {
    const note = { id: 'n1', title: 'R', raw_text: 'A0' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ id, title: patch.title, raw_text: patch.raw_text }));
    openNote(note, { update });

    render.act(() => { harness.get().setEditingText('A1'); });
    await render.act(async () => { await harness.get().handleSaveOtherNote(); });
    render.act(() => { harness.get().setEditingText('A2'); });
    await render.act(async () => { await harness.get().handleSaveOtherNote(); });

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith('n1', expect.objectContaining({ raw_text: 'A2' }));
    expect(harness.get().noteIsSaving).toBe(false);
  });

  test('a rejected write resets the saving state, surfaces the failure, and a retry can succeed', async () => {
    const note = { id: 'n1', title: 'R', raw_text: 'A0' };
    let calls = 0;
    const update = jest.fn().mockImplementation(async (id, patch) => {
      calls += 1;
      if (calls === 1) throw new Error('disk full');
      return { id, title: patch.title, raw_text: patch.raw_text };
    });
    openNote(note, { update });
    render.act(() => { harness.get().setEditingText('A1'); });

    let result;
    await render.act(async () => { result = await harness.get().handleSaveOtherNote(); });
    expect(result).toBe(false);
    expect(harness.get().noteIsSaving).toBe(false);
    expect(harness.get().saveError).toBe('Save failed');

    await render.act(async () => { result = await harness.get().handleSaveOtherNote(); });
    expect(result).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith('n1', expect.objectContaining({ raw_text: 'A1' }));
  });

  test('a changed deload date and Session # reach the linked history record before the note is written', async () => {
    const note = { id: 'd1', title: `${DELOAD_NOTE_PREFIX}2026-01-01`, raw_text: 'body', saved_at: '2026-01-01T12:00:00.000Z' };
    const record = { id: 'h1', note_id: 'd1', deload_session_ordinal: 1, completed_at: '2026-01-01T12:00:00.000Z' };
    const update = jest.fn().mockResolvedValue({ id: 'd1', title: note.title, raw_text: 'body', saved_at: '2026-02-02T12:00:00.000Z' });
    const updateDeload = jest.fn().mockResolvedValue(true);
    openNote(note, { update, updateDeload, deloadHistory: [record] });

    render.act(() => { harness.get().setDeloadEditDate('2026-02-02'); });
    render.act(() => { harness.get().setDeloadEditOrdinal('4'); });
    await render.act(async () => { await harness.get().handleSaveOtherNote(); });

    // One consolidated history patch carries both the date and the ordinal.
    expect(updateDeload).toHaveBeenCalledTimes(1);
    expect(updateDeload).toHaveBeenCalledWith('h1', expect.objectContaining({
      completed_at: '2026-02-02T12:00:00.000Z',
      deload_session_ordinal: 4,
    }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateDeload.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  });
});

// ── Deload date editor: native picker and web fallback (#314) ────────────────
// The native @react-native-community/datetimepicker has no usable web
// rendering, so the Log deload-date editor must render a real DOM
// <input type="date"> on web while keeping the native Pressable + picker path.
// Both are driven through the rendered LogScreenEditorCard.
describe('Log deload date editor: native picker and web DOM input (#314)', () => {
  const { Platform } = require('react-native');
  const { LogScreenEditorCard } = require('../components/LogScreenEditorCard');
  const { DELOAD_NOTE_PREFIX } = require('../lib/LogScreenHelpers');
  const noop = () => {};

  let spies;
  let platformSpy;
  afterEach(() => { if (platformSpy) { platformSpy.restore(); platformSpy = null; } });

  const setPlatform = (os) => { platformSpy = jest.replaceProperty(Platform, 'OS', os); };

  function mountEditor({ linked = true } = {}) {
    spies = {
      setDeloadEditDate: jest.fn(),
      setDeloadEditOrdinal: jest.fn(),
      setEditingTitle: jest.fn(),
      setShowDeloadDatePicker: jest.fn(),
    };
    function Harness() {
      const [showPicker, setShowPicker] = React.useState(false);
      const [isLinked, setIsLinked] = React.useState(linked);
      spies.setLinked = setIsLinked;
      return (
        <LogScreenEditorCard
          deloadMode={null}
          isEditingDeloadNote
          editingNoteId="d1"
          currentId="cur"
          activeEditText=""
          handleCurrentTextChange={noop}
          editingText="body"
          setEditingText={noop}
          workoutNoteTitle=""
          setWorkoutNoteTitle={noop}
          editingTitle={`${DELOAD_NOTE_PREFIX}2026-01-01`}
          setEditingTitle={spies.setEditingTitle}
          editingDeloadHasLinkedRecord={isLinked}
          deloadEditDate="2026-01-01"
          setDeloadEditDate={spies.setDeloadEditDate}
          deloadEditOrdinal="3"
          setDeloadEditOrdinal={spies.setDeloadEditOrdinal}
          showDeloadDatePicker={showPicker}
          setShowDeloadDatePicker={(v) => { spies.setShowDeloadDatePicker(v); setShowPicker(v); }}
          handleSave={noop}
          handleSaveOtherNote={noop}
          handleSwitchCurrent={noop}
          handleDeleteRoutine={noop}
          handleDeleteDeloadNoteFromEditor={noop}
        />
      );
    }
    let component;
    render.act(() => { component = render.create(<Harness />); });
    return component.root;
  }

  const byLabel = (root, label, startsWith = false) => root.findAll(n => n.props
    && typeof n.props.onPress === 'function'
    && typeof n.props.accessibilityLabel === 'string'
    && (startsWith ? n.props.accessibilityLabel.startsWith(label) : n.props.accessibilityLabel === label))[0];
  const openDateRow = (root) => { render.act(() => { byLabel(root, 'Date,', true).props.onPress(); }); };
  const sessionInput = (root) => root.findAll(n => n.props && n.props.accessibilityLabel === 'Deload session number' && typeof n.props.onChangeText === 'function')[0];

  test('the date and Session # controls stay hidden until the date row is opened, and only for a linked record', () => {
    const root = mountEditor();
    expect(sessionInput(root)).toBeUndefined();
    openDateRow(root);
    expect(sessionInput(root)).toBeTruthy();

    // Without a linked history record the row stays visible but inert.
    const unlinked = mountEditor({ linked: false });
    const row = unlinked.findAll(n => n.props && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Date,'))[0];
    expect(row.props.accessibilityState.disabled).toBe(true);
    expect(row.props.onPress).toBeUndefined();
    expect(sessionInput(unlinked)).toBeUndefined();
  });

  test('losing the linked record while the row is open removes the date and Session # controls', () => {
    const root = mountEditor();
    openDateRow(root);
    expect(sessionInput(root)).toBeTruthy();

    render.act(() => { spies.setLinked(false); });
    expect(sessionInput(root)).toBeUndefined();
    expect(byLabel(root, 'Deload date')).toBeUndefined();
  });

  test('the Session # input strips non-numeric characters before updating', () => {
    const root = mountEditor();
    openDateRow(root);
    render.act(() => { sessionInput(root).props.onChangeText('1a2-3 '); });
    expect(spies.setDeloadEditOrdinal).toHaveBeenCalledWith('123');
  });

  test('native: the date control opens the picker and a picked date updates date and title', () => {
    setPlatform('android');
    const root = mountEditor();
    openDateRow(root);
    expect(root.findAll(n => n.type === 'input')).toHaveLength(0);
    expect(root.findAll(n => n.props && n.props.testID === 'mock-datetimepicker')).toHaveLength(0);

    render.act(() => { byLabel(root, 'Deload date').props.onPress(); });
    expect(spies.setShowDeloadDatePicker).toHaveBeenLastCalledWith(true);
    const picker = root.findAll(n => n.props && n.props.testID === 'mock-datetimepicker')[0];
    expect(picker).toBeTruthy();
    // The picker reports through onChange (not the web-only onValueChange).
    expect(typeof picker.props.onChange).toBe('function');
    expect(picker.props.onValueChange).toBeUndefined();
    // Future dates cannot be picked, and the picker opens on the stored date.
    expect(picker.props.maximumDate).toBeInstanceOf(Date);
    expect(picker.props.maximumDate.getTime()).toBeLessThanOrEqual(Date.now());
    expect(picker.props.value).toEqual(new Date(2026, 0, 1));

    render.act(() => { picker.props.onChange({}, new Date(2026, 1, 3)); });
    expect(spies.setDeloadEditDate).toHaveBeenCalledWith('2026-02-03');
    expect(spies.setEditingTitle).toHaveBeenCalledWith(`${DELOAD_NOTE_PREFIX}2026-02-03`);
    expect(spies.setShowDeloadDatePicker).toHaveBeenLastCalledWith(false);

    // Dismissing without a date changes nothing.
    spies.setDeloadEditDate.mockClear();
    render.act(() => { byLabel(root, 'Deload date').props.onPress(); });
    const reopened = root.findAll(n => n.props && n.props.testID === 'mock-datetimepicker')[0];
    render.act(() => { reopened.props.onChange({}, undefined); });
    expect(spies.setDeloadEditDate).not.toHaveBeenCalled();
  });

  test('web: renders a real date <input> capped at today that writes back through the existing setters', () => {
    setPlatform('web');
    const root = mountEditor();
    openDateRow(root);
    expect(byLabel(root, 'Deload date')).toBeUndefined();

    const input = root.findAll(n => n.type === 'input')[0];
    expect(input).toBeTruthy();
    expect(input.props.type).toBe('date');
    expect(input.props.value).toBe('2026-01-01');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(input.props.max).toBe(today);

    render.act(() => { input.props.onChange({ target: { value: '2026-02-03' } }); });
    expect(spies.setDeloadEditDate).toHaveBeenCalledWith('2026-02-03');
    expect(spies.setEditingTitle).toHaveBeenCalledWith(`${DELOAD_NOTE_PREFIX}2026-02-03`);

    // Clearing the field must not wipe the stored date.
    spies.setDeloadEditDate.mockClear();
    render.act(() => { input.props.onChange({ target: { value: '' } }); });
    expect(spies.setDeloadEditDate).not.toHaveBeenCalled();
  });
});

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
  // #1329: Delete active deload lives in the card's More deload actions sheet.
  const openDeloadMenu = (root) => {
    const trigger = root.findAll(n => n.props && n.props.accessibilityLabel === 'More deload actions' && typeof n.props.onPress === 'function')[0];
    render.act(() => { trigger.props.onPress(); });
  };

  test('cancel leaves the active deload unchanged', () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    openDeloadTab(root);
    openDeloadMenu(root);

    render.act(() => { findPressableByText(root, 'Delete active deload').props.onPress(); });
    finishSheetDismiss(root);
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete active deload?',
      'This will remove the active deload and cannot be undone.',
      expect.any(Array),
    );
    const cancel = alertSpy.mock.calls[0][2].find(button => button.text === 'Cancel');
    expect(cancel.onPress).toBeUndefined();
    expect(clearDeloadNote).not.toHaveBeenCalled();
    openDeloadMenu(root);
    expect(findPressableByText(root, 'Delete active deload')).toBeTruthy();
  });

  test('confirm clears the active deload and returns to Generate deload', async () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    openDeloadTab(root);
    openDeloadMenu(root);
    render.act(() => { findPressableByText(root, 'Delete active deload').props.onPress(); });
    finishSheetDismiss(root);

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

// ── LogScreen wiring to the deload surfaces ─────────────────────────────────
// The section and editor card are covered above in isolation; these mount the
// real LogScreen so a dropped or misrouted prop between the screen, its hooks
// and those surfaces is caught.
describe('LogScreen wires the deload surfaces to its hooks', () => {
  const { DELOAD_NOTE_PREFIX } = require('../lib/LogScreenHelpers');
  let update;
  let completeDeload;
  let updateDeload;

  const THREE_SESSIONS = 'Monday\n+Lifting\n-Bench\n135 5,5,5\n135 5,5,5\n135 5,5,5';
  const currentNote = {
    id: 'note1', title: 'Routine A', raw_text: THREE_SESSIONS, saved_at: '2026-06-01T12:00:00.000Z',
  };
  const deloadNote = {
    id: 'd1', title: `${DELOAD_NOTE_PREFIX}2026-01-01`, raw_text: 'old deload body', saved_at: '2026-01-01T12:00:00.000Z',
  };
  const record = { id: 'h1', note_id: 'd1', deload_session_ordinal: 4, completed_at: '2026-01-01T12:00:00.000Z' };

  beforeEach(() => {
    jest.clearAllMocks();
    update = jest.fn().mockImplementation(async (id, patch) => ({ id, ...deloadNote, ...patch }));
    completeDeload = jest.fn();
    updateDeload = jest.fn().mockResolvedValue(true);
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote, deloadNote], currentId: 'note1', currentNote, deloadNotes: [deloadNote],
      loading: false, error: null, refresh: jest.fn(), selectCurrent: jest.fn(), update, add: jest.fn(), remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({
      note: { raw_text: 'deload note text', saved_at: '2026-06-01T12:00:00.000Z' }, loading: false, save: jest.fn(), clear: jest.fn(),
    });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [record], completeDeload, deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload,
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: true });
  });

  const mount = () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen initialText={THREE_SESSIONS} />); });
    const root = component.root;
    render.act(() => { findPressableByText(root, 'Deload').props.onPress(); });
    return root;
  };
  const sessionInput = (root) => root.findAll(n => n.props && n.props.accessibilityLabel === 'Deload session number' && typeof n.props.onChangeText === 'function')[0];

  test('Deload complete forwards the screen\'s session count and the edited ordinal to completeDeload', async () => {
    const root = mount();
    render.act(() => { root.findByProps({ title: 'Deload complete' }).props.onPress(); });
    const prefill = sessionInput(root).props.value;
    expect(prefill).toBe('3');

    render.act(() => { sessionInput(root).props.onChangeText('42'); });
    const confirm = root.findAll(n => n.props && n.props.accessibilityLabel === 'Confirm deload complete' && typeof n.props.onPress === 'function')[0];
    await render.act(async () => { await confirm.props.onPress(); });

    expect(completeDeload).toHaveBeenCalledWith({ sessionCount: Number(prefill), deloadSessionOrdinal: 42 });
  });

  test('editing a past deload\'s Session # in the editor reaches the linked history record on Done', async () => {
    const root = mount();
    render.act(() => { findPressableByText(root, deloadNote.title).props.onPress(); });
    const body = findPressableByText(root, 'old deload body');
    render.act(() => { body.props.onPress(); body.props.onPress(); });

    const dateRow = root.findAll(n => n.props && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Date,') && typeof n.props.onPress === 'function')[0];
    render.act(() => { dateRow.props.onPress(); });
    expect(sessionInput(root).props.value).toBe('4');
    render.act(() => { sessionInput(root).props.onChangeText('9x'); });
    // Pick a new date through the native picker the screen wires in.
    render.act(() => { root.findAll(n => n.props && n.props.accessibilityLabel === 'Deload date' && typeof n.props.onPress === 'function')[0].props.onPress(); });
    const picker = root.findAll(n => n.props && n.props.testID === 'mock-datetimepicker')[0];
    render.act(() => { picker.props.onChange({}, new Date(2026, 1, 3)); });
    await render.act(async () => { await findPressableByText(root, 'Done').props.onPress(); });

    expect(updateDeload).toHaveBeenCalledWith('h1', expect.objectContaining({ deload_session_ordinal: 9, completed_at: '2026-02-03T12:00:00.000Z' }));
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

// ── #989: deload generation freezes working context; completion witnesses it ──
//
// Generating a deload calls captureDeloadWorkingContext against the current
// routine's parsed sections + stable id and stores the frozen snapshot beside
// the active deload. Completing it calls buildDeloadReentryRecord so the new
// history record carries pre_deload_context; a missing snapshot degrades to the
// legacy record shape.
describe('deload re-entry context capture and completion (#989)', () => {
  const { useLogDeloadEditor } = require('../screens/log/useLogDeloadEditor');
  const RealStorage = jest.requireActual('../storage/entries');
  const { useDeloadHistory: realUseDeloadHistory } = jest.requireActual('../hooks/entries/deloadHooks');

  const ROUTINE_AT_DELOAD = [
    'Monday',
    '+LIFTING EXERCISE',
    '-Bench 3x5',
    '185 5,5,5',
    '185 5,5,5',
    '185 5,5,5',
  ].join('\n');
  const ROUTINE_FIRST_BACK = ROUTINE_AT_DELOAD + '\n185 5,5,5';

  let renderer;
  afterEach(() => {
    if (renderer) { render.act(() => renderer.unmount()); renderer = null; }
  });

  async function clearStore() {
    await require('@react-native-async-storage/async-storage').clear();
  }

  test('generating a deload passes a v1 working-context snapshot keyed to the current routine id', async () => {
    await clearStore();
    const save = jest.fn().mockResolvedValue({});
    let api = null;
    function Harness() {
      api = useLogDeloadEditor({
        deloadNote: null,
        saveDeloadNote: save,
        workoutNoteText: ROUTINE_AT_DELOAD,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        currentId: 'wn_src',
      });
      return null;
    }
    render.act(() => { renderer = render.create(<Harness />); });
    await render.act(async () => { await api.handleGenerateDeload(); });

    expect(save).toHaveBeenCalledTimes(1);
    const [text, ctx] = save.mock.calls[0];
    expect(typeof text).toBe('string');
    expect(ctx).toMatchObject({ version: 1, source_note_id: 'wn_src' });
    expect(ctx.exercises.bench).toMatchObject({ working_weight_lb: 185 });
  });

  test('completing a deload writes pre_deload_context witnessed against the current source routine', async () => {
    await clearStore();
    const { captureDeloadWorkingContext } = jest.requireActual('../lib/parser/deloadHistory');
    const { parseWorkoutNote } = jest.requireActual('../lib/parser');

    const frozen = captureDeloadWorkingContext(parseWorkoutNote(ROUTINE_AT_DELOAD).sections, 'wn_src');
    await RealStorage.saveDeloadNote('Deload week text', frozen);
    await RealStorage.saveCurrentWorkoutId('wn_src');
    await RealStorage.saveWorkoutNoteItem({
      id: 'wn_src', title: 'Routine', raw_text: ROUTINE_AT_DELOAD,
      saved_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
      tracked_exercises: [], one_k_exercises: null,
    });

    let hook = null;
    function Harness() { hook = realUseDeloadHistory(); return null; }
    render.act(() => { renderer = render.create(<Harness />); });

    let record;
    await render.act(async () => {
      record = await hook.completeDeload({ sessionCount: 3, deloadSessionOrdinal: 1 });
    });

    expect(record.pre_deload_context).toMatchObject({ version: 1, source_note_id: 'wn_src' });
    expect(record.pre_deload_context.exercises.bench).toMatchObject({ working_weight_lb: 185 });

    const persisted = await RealStorage.loadDeloadHistory();
    expect(persisted.find(r => r.id === record.id).pre_deload_context.version).toBe(1);
  });

  test('completing with no frozen snapshot degrades to the legacy record shape', async () => {
    await clearStore();
    await RealStorage.saveDeloadNote('Deload week text'); // no working_context
    await RealStorage.saveCurrentWorkoutId('wn_src');
    await RealStorage.saveWorkoutNoteItem({
      id: 'wn_src', title: 'Routine', raw_text: ROUTINE_AT_DELOAD,
      saved_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
      tracked_exercises: [], one_k_exercises: null,
    });

    let hook = null;
    function Harness() { hook = realUseDeloadHistory(); return null; }
    render.act(() => { renderer = render.create(<Harness />); });

    let record;
    await render.act(async () => {
      record = await hook.completeDeload({ sessionCount: 3, deloadSessionOrdinal: 1 });
    });
    expect(record).not.toHaveProperty('pre_deload_context');
    expect(record.session_count).toBe(3);
  });

  test('witnesses against the routine the deload was generated from, not the current routine', async () => {
    await clearStore();
    const { captureDeloadWorkingContext } = jest.requireActual('../lib/parser/deloadHistory');
    const { parseWorkoutNote } = jest.requireActual('../lib/parser');

    // Generated from wn_A (has Bench). The user then switched the current
    // routine to wn_B (Squat only, no Bench).
    const frozen = captureDeloadWorkingContext(parseWorkoutNote(ROUTINE_AT_DELOAD).sections, 'wn_A');
    await RealStorage.saveDeloadNote('Deload week text', frozen);
    await RealStorage.saveWorkoutNoteItem({
      id: 'wn_A', title: 'A', raw_text: ROUTINE_AT_DELOAD,
      saved_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
      tracked_exercises: [], one_k_exercises: null,
    });
    await RealStorage.saveWorkoutNoteItem({
      id: 'wn_B', title: 'B', raw_text: 'Monday\n+LIFTING EXERCISE\n-Squat 3x5\n315 5,5,5',
      saved_at: '2026-06-02T00:00:00.000Z', updated_at: '2026-06-02T00:00:00.000Z',
      tracked_exercises: [], one_k_exercises: null,
    });
    await RealStorage.saveCurrentWorkoutId('wn_B');

    let hook = null;
    function Harness() { hook = realUseDeloadHistory(); return null; }
    render.act(() => { renderer = render.create(<Harness />); });

    let record;
    await render.act(async () => {
      record = await hook.completeDeload({ sessionCount: 3, deloadSessionOrdinal: 1 });
    });

    expect(record.pre_deload_context.source_note_id).toBe('wn_A');
    // The boundary came from wn_A's Bench, not wn_B (which has no Bench).
    expect(record.pre_deload_context.exercises.bench).toMatchObject({ working_weight_lb: 185 });
    expect(record.pre_deload_context.exercises).not.toHaveProperty('squat');
  });

  test('degrades to the legacy shape when the snapshot source routine no longer exists', async () => {
    await clearStore();
    const { captureDeloadWorkingContext } = jest.requireActual('../lib/parser/deloadHistory');
    const { parseWorkoutNote } = jest.requireActual('../lib/parser');
    const frozen = captureDeloadWorkingContext(parseWorkoutNote(ROUTINE_AT_DELOAD).sections, 'wn_gone');
    await RealStorage.saveDeloadNote('Deload week text', frozen);
    await RealStorage.saveCurrentWorkoutId('wn_other');
    await RealStorage.saveWorkoutNoteItem({
      id: 'wn_other', title: 'Other', raw_text: ROUTINE_AT_DELOAD,
      saved_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
      tracked_exercises: [], one_k_exercises: null,
    });

    let hook = null;
    function Harness() { hook = realUseDeloadHistory(); return null; }
    render.act(() => { renderer = render.create(<Harness />); });

    let record;
    await render.act(async () => {
      record = await hook.completeDeload({ sessionCount: 3, deloadSessionOrdinal: 1 });
    });
    expect(record).not.toHaveProperty('pre_deload_context');
  });
});
