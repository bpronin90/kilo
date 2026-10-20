import { installRendererCleanup, mountCurrentRoutineEditorHook, mountOtherRoutineEditorHook } from './helpers/log-screen';
import React from 'react';
import render from 'react-test-renderer';
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

// ── autosave vs explicit save: observable contract ──────────────────────────
// The debounce timers must save through the autosave path, which persists the
// text WITHOUT raising the "Saved on device" confirmation (raising it on every
// pause in typing made the status region flicker). An explicit save must still
// confirm, and must confirm as a device-local save, never a cloud-sync claim.
// These drive the real hooks on fake timers and assert the persisted payload
// and the user-visible saveSuccess state rather than how the call sites spell
// the option.

describe('autosave debounce versus explicit save (behavior)', () => {
  const { AUTOSAVE_DEBOUNCE_MS } = require('../lib/LogScreenHelpers');
  let harness;

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    if (harness) { harness.unmount(); harness = null; }
    jest.useRealTimers();
  });

  const echoUpdate = () => jest.fn().mockImplementation(async (id, patch) => ({
    id, title: patch.title, raw_text: patch.raw_text,
  }));
  const elapse = (ms) => render.act(async () => { jest.advanceTimersByTime(ms); });

  test('current routine: the debounce timer persists the draft without a saved confirmation; explicit Save confirms as device-local', async () => {
    const update = echoUpdate();
    harness = mountCurrentRoutineEditorHook({
      update, note: { id: 'note1', title: 'Routine A', raw_text: 'ORIGINAL', activeWeek: null },
    });

    render.act(() => { harness.get().enterCurrentEditor(); });
    render.act(() => { harness.get().handleCurrentTextChange('TYPED'); });
    // Nothing is written before the debounce elapses.
    await elapse(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(update).not.toHaveBeenCalled();

    await elapse(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith('note1', expect.objectContaining({ raw_text: 'TYPED' }));
    expect(harness.get().saveSuccess).toBe('');

    render.act(() => { harness.get().handleCurrentTextChange('EXPLICIT'); });
    await render.act(async () => { await harness.get().handleSave(); });
    expect(update).toHaveBeenLastCalledWith('note1', expect.objectContaining({ raw_text: 'EXPLICIT' }));
    expect(harness.get().saveSuccess).toBe('Saved on device');
  });

  test('other routine: the debounce timer persists the draft without a saved confirmation; explicit Save confirms as device-local', async () => {
    const note = { id: 'n1', title: 'R', raw_text: 'A0' };
    const update = echoUpdate();
    harness = mountOtherRoutineEditorHook({ notes: [note], update });

    render.act(() => { harness.get().handleOpenOtherNote(note); });
    render.act(() => { harness.get().setEditingText('TYPED'); });
    await elapse(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(update).not.toHaveBeenCalled();

    await elapse(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith('n1', expect.objectContaining({ raw_text: 'TYPED' }));
    expect(harness.get().saveSuccess).toBe('');

    render.act(() => { harness.get().setEditingText('EXPLICIT'); });
    await render.act(async () => { await harness.get().handleSaveOtherNote(); });
    expect(update).toHaveBeenLastCalledWith('n1', expect.objectContaining({ raw_text: 'EXPLICIT' }));
    expect(harness.get().saveSuccess).toBe('Saved on device');
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
