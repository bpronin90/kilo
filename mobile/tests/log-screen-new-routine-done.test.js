import { installRendererCleanup } from './helpers/log-screen';
import React from 'react';
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

// ── New-routine Done must persist the latest draft (#1474) ───────────────────
//
// A new routine's Done used to await ONE save and close. A save that was
// already pending (or edits typed while Done itself awaited persistence) left
// the trailing text/title unpersisted when the editor closed. These tests drive
// both editors with deferred persistence and assert the persisted payloads and
// whether the editor stayed open.
describe('new-routine Done persists trailing edits (#1474)', () => {
  const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
  const { useLogOtherRoutineEditor } = require('../screens/log/useLogOtherRoutineEditor');
  const AsyncStorageMock = require('@react-native-async-storage/async-storage');

  const TEXT_A = 'Monday\n+Lifting\n-Bench Press\n135 5,5,5';
  const TEXT_B = 'Monday\n+Lifting\n-Bench Press\n140 5,5,5';

  let trees = [];
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorageMock.clear();
  });
  afterEach(() => {
    trees.forEach((tree) => render.act(() => { tree.unmount(); }));
    trees = [];
  });

  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  // In-memory note store behind add/update so persisted payloads are inspectable.
  function makeStore() {
    const notes = {};
    let seq = 0;
    const store = {
      notes,
      addGates: [],
      updateGates: [],
      addCalls: [],
      rawTextUpdates: [],
      add: jest.fn(async (title, rawText, opts) => {
        store.addCalls.push({ title, rawText, token: opts && opts.attemptToken });
        const gate = store.addGates.shift();
        if (gate) await gate.promise;
        seq += 1;
        const id = `wn_${seq}`;
        notes[id] = { id, title, raw_text: rawText, updated_at: String(seq) };
        return { ...notes[id] };
      }),
      update: jest.fn(async (id, patch) => {
        if (patch.raw_text !== undefined) {
          store.rawTextUpdates.push({ id, title: patch.title, raw_text: patch.raw_text });
          const gate = store.updateGates.shift();
          if (gate) await gate.promise;
        }
        notes[id] = { ...notes[id], ...patch };
        return { ...notes[id] };
      }),
    };
    return store;
  }

  const flush = async () => {
    await render.act(async () => {
      for (let i = 0; i < 30; i += 1) await Promise.resolve();
    });
  };

  function mountCurrent(store, { followId }) {
    const api = {};
    function Harness() {
      const [text, setText] = React.useState('');
      const [title, setTitle] = React.useState('');
      const [currentId, setCurrentId] = React.useState(null);
      api.hook = useLogCurrentRoutineEditor({
        workoutNoteText: text,
        setWorkoutNoteText: setText,
        workoutNoteTitle: title,
        setWorkoutNoteTitle: setTitle,
        currentId,
        currentNote: currentId ? store.notes[currentId] : null,
        notes: Object.values(store.notes),
        trackedLifts: [],
        update: store.update,
        add: store.add,
        selectCurrent: async (id) => { if (followId) setCurrentId(id); },
        fatigueTrackingEnabled: false,
        notesLoading: false,
        notesError: null,
        otherModalOwnsScreen: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      api.setTitle = setTitle;
      return null;
    }
    let tree;
    render.act(() => { tree = render.create(<Harness />); });
    trees.push(tree);
    render.act(() => { api.hook.enterCurrentEditor(); });
    return {
      type: (text, title) => render.act(() => {
        api.hook.handleCurrentTextChange(text);
        if (title !== undefined) api.setTitle(title);
      }),
      save: () => api.hook.handleSave(),
      done: () => api.hook.handleDoneCurrent(),
      isOpen: () => api.hook.mode === 'edit',
    };
  }

  function mountOther(store) {
    const api = {};
    function Harness() {
      api.hook = useLogOtherRoutineEditor({
        notes: Object.values(store.notes),
        currentId: null,
        currentNote: null,
        deloadHistory: [],
        update: store.update,
        add: store.add,
        remove: jest.fn(),
        selectCurrent: jest.fn(async () => {}),
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
    let tree;
    render.act(() => { tree = render.create(<Harness />); });
    trees.push(tree);
    render.act(() => { api.hook.handleCreateRoutine(); });
    return {
      type: (text, title) => render.act(() => {
        api.hook.setEditingText(text);
        if (title !== undefined) api.hook.setEditingTitle(title);
      }),
      save: () => api.hook.handleSaveOtherNote(),
      done: () => api.hook.handleDoneOther(),
      isOpen: () => api.hook.editingNoteId != null,
    };
  }

  const editors = [
    ['current editor (parent id lags)', (s) => mountCurrent(s, { followId: false })],
    ['current editor (parent id follows)', (s) => mountCurrent(s, { followId: true })],
    ['other editor', (s) => mountOther(s)],
  ];

  describe.each(editors)('%s', (_name, mount) => {
    test('edits made while an earlier save is pending are persisted before Done closes', async () => {
      const store = makeStore();
      const gate = deferred();
      store.addGates.push(gate);
      const editor = mount(store);

      editor.type(TEXT_A, 'Title A');
      let earlier;
      render.act(() => { earlier = editor.save(); });
      editor.type(TEXT_B, 'Title B');
      let done;
      render.act(() => { done = editor.done(); });
      await flush();
      expect(editor.isOpen()).toBe(true);

      await render.act(async () => { gate.resolve(); await earlier; await done; });

      expect(store.add).toHaveBeenCalledTimes(1);
      expect(store.addCalls[0].rawText).toBe(TEXT_A);
      expect(store.rawTextUpdates[store.rawTextUpdates.length - 1]).toEqual(
        { id: 'wn_1', title: 'Title B', raw_text: TEXT_B }
      );
      expect(store.notes.wn_1.raw_text).toBe(TEXT_B);
      expect(editor.isOpen()).toBe(false);
    });

    test('edits made while Done itself awaits persistence are persisted before closing', async () => {
      const store = makeStore();
      const gate = deferred();
      store.addGates.push(gate);
      const editor = mount(store);

      editor.type(TEXT_A, 'Title A');
      let done;
      render.act(() => { done = editor.done(); });
      await flush();
      editor.type(TEXT_B, 'Title B');
      expect(editor.isOpen()).toBe(true);

      await render.act(async () => { gate.resolve(); await done; });

      expect(store.add).toHaveBeenCalledTimes(1);
      expect(store.notes.wn_1).toEqual(expect.objectContaining({ title: 'Title B', raw_text: TEXT_B }));
      expect(editor.isOpen()).toBe(false);
    });

    test('a rejected initial create keeps the editor open; the retry reuses the attempt and closes only on success', async () => {
      const store = makeStore();
      const gate = deferred();
      store.addGates.push(gate);
      const editor = mount(store);

      editor.type(TEXT_A, 'Title A');
      let done;
      render.act(() => { done = editor.done(); });
      await flush();
      gate.reject(new Error('create failed'));
      await render.act(async () => { await done; });
      expect(editor.isOpen()).toBe(true);
      expect(Object.keys(store.notes)).toHaveLength(0);

      editor.type(TEXT_B, 'Title B');
      await render.act(async () => { await editor.done(); });

      expect(store.add).toHaveBeenCalledTimes(2);
      expect(store.addCalls[1].token).toBe(store.addCalls[0].token);
      expect(Object.keys(store.notes)).toEqual(['wn_1']);
      expect(store.notes.wn_1).toEqual(expect.objectContaining({ title: 'Title B', raw_text: TEXT_B }));
      expect(editor.isOpen()).toBe(false);
    });

    test('a rejected trailing write keeps the editor open; the retry updates the same note without a duplicate', async () => {
      const store = makeStore();
      const createGate = deferred();
      const trailingGate = deferred();
      store.addGates.push(createGate);
      store.updateGates.push(trailingGate);
      const editor = mount(store);

      editor.type(TEXT_A, 'Title A');
      let earlier;
      render.act(() => { earlier = editor.save(); });
      editor.type(TEXT_B, 'Title B');
      let done;
      render.act(() => { done = editor.done(); });
      await render.act(async () => { createGate.resolve(); await earlier; });
      await flush();
      trailingGate.reject(new Error('trailing write failed'));
      await render.act(async () => { await done; });
      expect(editor.isOpen()).toBe(true);

      await render.act(async () => { await editor.done(); });

      expect(store.add).toHaveBeenCalledTimes(1);
      expect(Object.keys(store.notes)).toEqual(['wn_1']);
      expect(store.notes.wn_1).toEqual(expect.objectContaining({ title: 'Title B', raw_text: TEXT_B }));
      expect(editor.isOpen()).toBe(false);
    });
  });
});
