import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { Alert } from 'react-native';
import { finishSheetDismiss, findPressableByText, expandRoutineManagement, expandManageRecovery, ControlledLogScreen } from './helpers/log-screen';

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

// #1329: a non-current routine's Copy/Share/Share as Image/Delete live behind
// its expanded body's More actions sheet; open it before reaching for them.
const openOtherRoutineMenu = (root) => {
  const trigger = root.findAll(n => n.props && n.props.testID === 'log-other-routine-menu-button' && typeof n.props.onPress === 'function')[0];
  render.act(() => { trigger.props.onPress(); });
};

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

  test('completed-only verified state: the Recovery tab is reachable but is not the default view (#1315)', () => {
    // Recovery History (#1315) makes completed blocks reachable in Log. With no
    // active block the Routine tab stays the default; the Recovery tab opens the
    // History selector and the focused block's single Manage card.
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

    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Recovery Blocks').length).toBe(0);
    const tab = findPressableByText(root, 'Recovery');
    expect(tab).toBeTruthy();
    render.act(() => { tab.props.onPress(); });
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Recovery Blocks').length).toBe(1);
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Manage recovery block: Old Baseline Routine').length).toBeGreaterThan(0);
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

    // Not the default view (#1315): the History selector sits behind the Recovery tab.
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Recovery Blocks').length).toBe(0);
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
    openOtherRoutineMenu(root);
    render.act(() => { findPressableByText(root, 'Delete routine').props.onPress(); });
    finishSheetDismiss(root);

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

    // An active block lands on the Recovery tab (#823); More Routines, and so
    // this routine's delete action, only mounts on the Routine tab.
    render.act(() => { pressableAround(root, t => t === 'Routine').props.onPress(); });
    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, week1Note.title).props.onPress(); });
    openOtherRoutineMenu(root);
    render.act(() => { findPressableByText(root, 'Delete routine').props.onPress(); });
    finishSheetDismiss(root);
    expect(alertSpy.mock.calls[0][0]).toBe('Delete this recovery week note?');
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
    openOtherRoutineMenu(root);
    render.act(() => { findPressableByText(root, 'Delete routine').props.onPress(); });
    finishSheetDismiss(root);
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
    openOtherRoutineMenu(root);
    render.act(() => { findPressableByText(root, 'Delete routine').props.onPress(); });
    finishSheetDismiss(root);
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
    openOtherRoutineMenu(root);
    render.act(() => { findPressableByText(root, 'Delete routine').props.onPress(); });
    finishSheetDismiss(root);
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
    openOtherRoutineMenu(root);
    const deleteBtn = findPressableByText(root, 'Delete routine');
    render.act(() => { deleteBtn.props.onPress(); });
    finishSheetDismiss(root);

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
