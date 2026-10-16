import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';

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

// ── id-stable new-note creates (#997) ────────────────────────────────────────
//
// Both Log editors create routines through `add`, which in cloud mode writes
// the local row and only then awaits the cloud enqueue — so a rejection can
// follow a routine that already exists on the device. What these tests pin is
// the CALLER half of the protocol: each editor mints a durable per-attempt
// creation token before the create, retains it when the create fails, restores
// it after an app restart, passes it to `add`, and clears it only once the
// create has fully succeeded. Editing the title or the body before retrying
// must not change the attempt; a genuinely new routine must always get a new
// token, byte-identical text or not.
describe('Log editors: durable creation-attempt tokens for new notes (#997)', () => {
  const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
  const { useLogOtherRoutineEditor } = require('../screens/log/useLogOtherRoutineEditor');
  const creationAttempts = require('../storage/entries/workoutNoteCreationAttempts');
  const { loadWorkoutNoteCreationAttempt } = creationAttempts;
  const { Alert } = require('../lib/platformAlert');
  const AsyncStorageMock = require('@react-native-async-storage/async-storage');

  let trees = [];
  let alertSpy = null;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorageMock.clear();
    // Both editors' revert is reachable only through this confirmation.
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    trees.forEach((tree) => render.act(() => { tree.unmount(); }));
    trees = [];
    if (alertSpy) alertSpy.mockRestore();
    alertSpy = null;
  });

  const CURRENT_TEXT = 'Monday\n+Lifting\n-Bench Press\n135 5,5,5';

  function mountCurrentEditor(overrides = {}) {
    const ref = { current: null };
    function Probe(props) {
      ref.current = useLogCurrentRoutineEditor(props);
      return null;
    }
    const base = {
      workoutNoteText: CURRENT_TEXT,
      setWorkoutNoteText: jest.fn(),
      workoutNoteTitle: 'Fresh Routine',
      setWorkoutNoteTitle: jest.fn(),
      currentId: null,
      currentNote: null,
      notes: [],
      trackedLifts: [],
      update: jest.fn(async () => false),
      add: jest.fn(async () => ({ id: 'wn_created' })),
      selectCurrent: jest.fn(async () => {}),
      fatigueTrackingEnabled: false,
      onCheckInPrompt: jest.fn(),
      notesLoading: false,
      notesError: null,
      otherModalOwnsScreen: false,
      editorScrollRef: { current: { scrollTo: jest.fn() } },
      readScrollRef: { current: { scrollTo: jest.fn() } },
      ...overrides,
    };
    let tree;
    render.act(() => { tree = render.create(<Probe {...base} />); });
    trees.push(tree);
    return {
      ref,
      rerender: (next) => render.act(() => {
        tree.update(<Probe {...{ ...base, ...next }} />);
      }),
    };
  }

  function mountOtherEditor(overrides = {}) {
    const ref = { current: null };
    function Probe(props) {
      ref.current = useLogOtherRoutineEditor(props);
      return null;
    }
    const base = {
      notes: [],
      currentId: null,
      currentNote: null,
      deloadHistory: [],
      update: jest.fn(async () => false),
      add: jest.fn(async () => ({ id: 'wn_created' })),
      remove: jest.fn(),
      selectCurrent: jest.fn(async () => {}),
      updateDeload: jest.fn(),
      deleteDeloadNote: jest.fn(),
      autosaveCurrentTimerRef: { current: null },
      handleSave: jest.fn(),
      currentEditorMode: 'read',
      hasUnsavedCurrent: false,
      editorScrollRef: { current: { scrollTo: jest.fn() } },
      ...overrides,
    };
    let tree;
    render.act(() => { tree = render.create(<Probe {...base} />); });
    trees.push(tree);
    return { ref };
  }

  function attemptTokenOfCall(add, index) {
    const options = add.mock.calls[index][2];
    return options && options.attemptToken;
  }

  // Drive the confirmation the way a real "Clear draft" tap would.
  function pressDestructiveAlertButton() {
    const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
    const destructive = call[2].find((b) => b.style === 'destructive');
    return destructive.onPress();
  }

  describe('the current-routine editor', () => {
    test('a failed create keeps its token; an edited retry reuses it and success retires it', async () => {
      const add = jest.fn()
        .mockRejectedValueOnce(new Error('enqueue failed'))
        .mockResolvedValue({ id: 'wn_created' });
      const editor = mountCurrentEditor({ add });

      let ok;
      await render.act(async () => { ok = await editor.ref.current.handleSave(); });
      expect(ok).toBe(false);
      expect(add).toHaveBeenCalledTimes(1);
      const token = attemptTokenOfCall(add, 0);
      expect(typeof token).toBe('string');
      expect(token).not.toHaveLength(0);
      // Durable, not merely in-memory: this is what a restart reads back.
      await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBe(token);

      // The user fixes the name AND the text before pressing Save again. Same
      // attempt: only the token decides that, never the payload.
      editor.rerender({
        add,
        workoutNoteTitle: 'Renamed Routine',
        workoutNoteText: `${CURRENT_TEXT}\n140 5,5,5`,
      });
      await render.act(async () => { ok = await editor.ref.current.handleSave(); });
      expect(ok).toBe(true);
      expect(add).toHaveBeenCalledTimes(2);
      expect(attemptTokenOfCall(add, 1)).toBe(token);
      expect(add.mock.calls[1][0]).toBe('Renamed Routine');
      expect(add.mock.calls[1][1]).toBe(`${CURRENT_TEXT}\n140 5,5,5`);

      // Only a fully successful create retires the attempt.
      await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBeNull();
    });

    test('the next create mints a new token even with byte-identical title and body', async () => {
      const add = jest.fn(async () => ({ id: 'wn_created' }));
      const editor = mountCurrentEditor({ add });

      await render.act(async () => { await editor.ref.current.handleSave(); });
      await render.act(async () => { await editor.ref.current.handleSave(); });

      expect(add).toHaveBeenCalledTimes(2);
      expect(add.mock.calls[0][0]).toBe(add.mock.calls[1][0]);
      expect(add.mock.calls[0][1]).toBe(add.mock.calls[1][1]);
      expect(attemptTokenOfCall(add, 1)).not.toBe(attemptTokenOfCall(add, 0));
    });

    test('a retry after an app restart completes the same attempt', async () => {
      const failing = jest.fn().mockRejectedValue(new Error('enqueue failed'));
      const first = mountCurrentEditor({ add: failing });
      await render.act(async () => { await first.ref.current.handleSave(); });
      const token = attemptTokenOfCall(failing, 0);

      // Restart: every mounted instance is gone; only storage survives.
      trees.forEach((tree) => render.act(() => { tree.unmount(); }));
      trees = [];
      await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBe(token);

      const add = jest.fn(async () => ({ id: 'wn_created' }));
      const restarted = mountCurrentEditor({ add, workoutNoteTitle: 'Edited After Restart' });
      await render.act(async () => { await restarted.ref.current.handleSave(); });

      expect(attemptTokenOfCall(add, 0)).toBe(token);
      await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBeNull();
    });

    test('a token that cannot be persisted fails the save instead of creating an uncorrelated note', async () => {
      // Creating without a durable token is exactly the uncorrelated create
      // this protocol exists to remove, so the save must fail BEFORE `add`
      // runs — then there is nothing on the device for a retry to duplicate.
      const mint = jest.spyOn(creationAttempts, 'ensureWorkoutNoteCreationAttempt')
        .mockRejectedValue(new Error('device storage unavailable'));
      const add = jest.fn(async () => ({ id: 'wn_created' }));
      const editor = mountCurrentEditor({ add });

      let ok;
      await render.act(async () => { ok = await editor.ref.current.handleSave(); });
      expect(ok).toBe(false);
      expect(add).not.toHaveBeenCalled();
      mint.mockRestore();
    });

    test('discarding the draft abandons the attempt, so the next routine gets its own id', async () => {
      // While an attempt is pending, Save finishes THAT create — which is what
      // makes an edited retry safe — so discarding the new note must also retire
      // the attempt, or the next first routine authored here would be written
      // over the stranded one. The editor's explicit destructive revert is the
      // boundary; the text cannot decide it.
      const failing = jest.fn().mockRejectedValue(new Error('enqueue failed'));
      const editor = mountCurrentEditor({ add: failing });
      await render.act(async () => { await editor.ref.current.handleSave(); });
      const abandoned = attemptTokenOfCall(failing, 0);
      await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBe(abandoned);

      render.act(() => { editor.ref.current.handleUndoCurrent(); });
      await render.act(async () => { await pressDestructiveAlertButton(); });
      await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBeNull();

      const add = jest.fn(async () => ({ id: 'wn_created' }));
      editor.rerender({ add, workoutNoteTitle: 'A Different Routine' });
      await render.act(async () => { await editor.ref.current.handleSave(); });
      expect(attemptTokenOfCall(add, 0)).not.toBe(abandoned);
    });

    test('a discard whose retirement fails changes nothing and keeps the draft', async () => {
      // Clearing the editor while the durable slot still named the attempt would
      // claim a boundary that does not exist: the next routine authored here
      // would complete — and overwrite — the stranded one. So the discard aborts
      // and leaves everything exactly as it was.
      const failing = jest.fn().mockRejectedValue(new Error('enqueue failed'));
      const setWorkoutNoteText = jest.fn();
      const setWorkoutNoteTitle = jest.fn();
      const editor = mountCurrentEditor({ add: failing, setWorkoutNoteText, setWorkoutNoteTitle });
      await render.act(async () => { await editor.ref.current.handleSave(); });
      const token = attemptTokenOfCall(failing, 0);
      setWorkoutNoteText.mockClear();
      setWorkoutNoteTitle.mockClear();

      const release = jest.spyOn(creationAttempts, 'clearWorkoutNoteCreationAttempt')
        .mockRejectedValue(new Error('device storage unavailable'));
      render.act(() => { editor.ref.current.handleUndoCurrent(); });
      let discarded;
      await render.act(async () => { discarded = await pressDestructiveAlertButton(); });
      release.mockRestore();

      expect(discarded).toBe(false);
      // The attempt is still pending and the draft text was not cleared.
      await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBe(token);
      expect(setWorkoutNoteText).not.toHaveBeenCalled();
      expect(setWorkoutNoteTitle).not.toHaveBeenCalled();
    });

    test('a token that cannot be retired fails the save, and the retry completes the same note', async () => {
      // Reporting success while a completed attempt is still in the store would
      // hand this note's id to the NEXT new routine and overwrite it. Failing
      // costs a retry instead — and the retry re-enters the SAME attempt.
      const retire = jest.spyOn(creationAttempts, 'clearWorkoutNoteCreationAttempt')
        .mockRejectedValue(new Error('device storage unavailable'));
      const add = jest.fn(async () => ({ id: 'wn_created' }));
      const editor = mountCurrentEditor({ add });

      let ok;
      await render.act(async () => { ok = await editor.ref.current.handleSave(); });
      expect(ok).toBe(false);
      expect(add).toHaveBeenCalledTimes(1);
      const token = attemptTokenOfCall(add, 0);
      // Still pending, so the retry cannot become a second routine.
      await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBe(token);

      retire.mockRestore();
      await render.act(async () => { ok = await editor.ref.current.handleSave(); });
      expect(ok).toBe(true);
      expect(attemptTokenOfCall(add, 1)).toBe(token);
      await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBeNull();
    });
  });

  describe('the other-routine editor', () => {
    async function openNewNote(editor, seed) {
      await render.act(async () => { editor.ref.current.handleCreateRoutine(seed); });
    }

    test('a failed create keeps its token; an edited retry reuses it and success retires it', async () => {
      const add = jest.fn()
        .mockRejectedValueOnce(new Error('enqueue failed'))
        .mockResolvedValue({ id: 'wn_created' });
      const editor = mountOtherEditor({ add });
      await openNewNote(editor, { title: 'Backlog A', text: 'Monday\n-Row\n95 8,8,8' });

      let ok;
      await render.act(async () => { ok = await editor.ref.current.handleSaveOtherNote(); });
      expect(ok).toBe(false);
      expect(add).toHaveBeenCalledTimes(1);
      const token = attemptTokenOfCall(add, 0);
      expect(typeof token).toBe('string');
      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBe(token);

      // Edit both fields, then retry. Still the same create.
      await render.act(async () => {
        editor.ref.current.setEditingTitle('Backlog A (fixed)');
        editor.ref.current.setEditingText('Monday\n-Row\n105 8,8,8');
      });
      await render.act(async () => { ok = await editor.ref.current.handleSaveOtherNote(); });
      expect(ok).toBe(true);
      expect(add).toHaveBeenCalledTimes(2);
      expect(attemptTokenOfCall(add, 1)).toBe(token);
      expect(add.mock.calls[1][0]).toBe('Backlog A (fixed)');
      expect(add.mock.calls[1][1]).toBe('Monday\n-Row\n105 8,8,8');

      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBeNull();
    });

    test('the next new note mints a new token even with byte-identical title and body', async () => {
      const add = jest.fn(async () => ({ id: 'wn_created' }));
      const editor = mountOtherEditor({ add });
      const seed = { title: 'Same Name', text: 'Monday\n-Row\n95 8,8,8' };

      await openNewNote(editor, seed);
      await render.act(async () => { await editor.ref.current.handleSaveOtherNote(); });
      await openNewNote(editor, seed);
      await render.act(async () => { await editor.ref.current.handleSaveOtherNote(); });

      expect(add).toHaveBeenCalledTimes(2);
      expect(add.mock.calls[0][0]).toBe(add.mock.calls[1][0]);
      expect(add.mock.calls[0][1]).toBe(add.mock.calls[1][1]);
      expect(attemptTokenOfCall(add, 1)).not.toBe(attemptTokenOfCall(add, 0));
    });

    test('a retry after an app restart completes the same attempt', async () => {
      const failing = jest.fn().mockRejectedValue(new Error('enqueue failed'));
      const first = mountOtherEditor({ add: failing });
      await openNewNote(first, { title: 'Interrupted', text: 'Monday\n-Squat\n225 5,5,5' });
      await render.act(async () => { await first.ref.current.handleSaveOtherNote(); });
      const token = attemptTokenOfCall(failing, 0);

      trees.forEach((tree) => render.act(() => { tree.unmount(); }));
      trees = [];
      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBe(token);

      const add = jest.fn(async () => ({ id: 'wn_created' }));
      const restarted = mountOtherEditor({ add });
      await openNewNote(restarted, { title: 'Interrupted (fixed)', text: 'Monday\n-Squat\n235 5,5,5' });
      await render.act(async () => { await restarted.ref.current.handleSaveOtherNote(); });

      expect(attemptTokenOfCall(add, 0)).toBe(token);
      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBeNull();
    });

    test('a token that cannot be persisted fails the save instead of creating an uncorrelated note', async () => {
      const mint = jest.spyOn(creationAttempts, 'ensureWorkoutNoteCreationAttempt')
        .mockRejectedValue(new Error('device storage unavailable'));
      const add = jest.fn(async () => ({ id: 'wn_created' }));
      const editor = mountOtherEditor({ add });
      await openNewNote(editor, { title: 'Backlog', text: 'Monday\n-Row\n95 8,8,8' });

      let ok;
      await render.act(async () => { ok = await editor.ref.current.handleSaveOtherNote(); });
      expect(ok).toBe(false);
      expect(add).not.toHaveBeenCalled();
      mint.mockRestore();
    });

    test('discarding the new note abandons the attempt, so the next routine gets its own id', async () => {
      const failing = jest.fn().mockRejectedValue(new Error('enqueue failed'));
      const editor = mountOtherEditor({ add: failing });
      await openNewNote(editor, { title: 'Routine A', text: 'Monday\n-Row\n95 8,8,8' });
      await render.act(async () => { await editor.ref.current.handleSaveOtherNote(); });
      const abandoned = attemptTokenOfCall(failing, 0);
      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBe(abandoned);

      render.act(() => { editor.ref.current.handleUndoOther(); });
      await render.act(async () => { await pressDestructiveAlertButton(); });
      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBeNull();

      // A genuinely different routine authored in the same editor session.
      const add = jest.fn(async () => ({ id: 'wn_created' }));
      const next = mountOtherEditor({ add });
      await openNewNote(next, { title: 'Routine B', text: 'Tuesday\n-Press\n95 5,5,5' });
      await render.act(async () => { await next.ref.current.handleSaveOtherNote(); });
      expect(attemptTokenOfCall(add, 0)).not.toBe(abandoned);
    });

    test('a discard whose retirement fails changes nothing and keeps the draft', async () => {
      const failing = jest.fn().mockRejectedValue(new Error('enqueue failed'));
      const editor = mountOtherEditor({ add: failing });
      await openNewNote(editor, { title: 'Routine A', text: 'Monday\n-Row\n95 8,8,8' });
      await render.act(async () => { await editor.ref.current.handleSaveOtherNote(); });
      const token = attemptTokenOfCall(failing, 0);

      const release = jest.spyOn(creationAttempts, 'clearWorkoutNoteCreationAttempt')
        .mockRejectedValue(new Error('device storage unavailable'));
      render.act(() => { editor.ref.current.handleUndoOther(); });
      let discarded;
      await render.act(async () => { discarded = await pressDestructiveAlertButton(); });
      release.mockRestore();

      expect(discarded).toBe(false);
      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBe(token);
      // The draft text survives the aborted discard.
      expect(editor.ref.current.editingTitle).toBe('Routine A');
      expect(editor.ref.current.editingText).toBe('Monday\n-Row\n95 8,8,8');
    });

    test('a discard waits for an in-flight create instead of retiring underneath it', async () => {
      // The create still in flight may be the very attempt being retired, so
      // retiring underneath it would let its completion race this boundary.
      let releaseSave;
      const add = jest.fn(() => new Promise((resolve, reject) => {
        releaseSave = { resolve, reject };
      }));
      const editor = mountOtherEditor({ add });
      await openNewNote(editor, { title: 'Routine A', text: 'Monday\n-Row\n95 8,8,8' });

      let savePromise;
      render.act(() => { savePromise = editor.ref.current.handleSaveOtherNote(); });
      await render.act(async () => {});
      expect(add).toHaveBeenCalledTimes(1);
      const token = attemptTokenOfCall(add, 0);

      // Discard is confirmed while the create is still awaiting its cloud write.
      let discardPromise;
      render.act(() => { editor.ref.current.handleUndoOther(); });
      render.act(() => { discardPromise = pressDestructiveAlertButton(); });
      // The attempt is untouched while the create is still in flight.
      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBe(token);

      // The create then FAILS, so the discard is what retires the attempt.
      await render.act(async () => {
        releaseSave.reject(new Error('enqueue failed'));
        await savePromise;
        await discardPromise;
      });
      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBeNull();
    });

    test('a token that cannot be retired fails the save, and the retry completes the same note', async () => {
      const retire = jest.spyOn(creationAttempts, 'clearWorkoutNoteCreationAttempt')
        .mockRejectedValue(new Error('device storage unavailable'));
      const add = jest.fn(async () => ({ id: 'wn_created' }));
      const editor = mountOtherEditor({ add });
      await openNewNote(editor, { title: 'Backlog', text: 'Monday\n-Row\n95 8,8,8' });

      let ok;
      await render.act(async () => { ok = await editor.ref.current.handleSaveOtherNote(); });
      expect(ok).toBe(false);
      expect(add).toHaveBeenCalledTimes(1);
      const token = attemptTokenOfCall(add, 0);
      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBe(token);

      retire.mockRestore();
      await render.act(async () => { ok = await editor.ref.current.handleSaveOtherNote(); });
      expect(ok).toBe(true);
      expect(attemptTokenOfCall(add, 1)).toBe(token);
      await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBeNull();
    });
  });
});
