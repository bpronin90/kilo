import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';

import { useLogCurrentRoutineEditor } from '../screens/log/useLogCurrentRoutineEditor';
import { Alert } from '../lib/platformAlert';
import * as Storage from '../storage/entries';
import {
  SYNC_TABLES,
  enqueueDirty,
  getDirtyRecords,
  clearDirty,
} from '../storage/syncQueue';
import {
  SYNC_PHASE,
  markFailed,
  markComplete,
  resetPhase,
} from '../storage/syncRecovery';
import {
  saveWorkoutNoteDraft,
  loadWorkoutNoteDraft,
  loadWorkoutNoteDrafts,
} from '../storage/entries/workoutNoteDrafts';

// performRevertCurrent is only reachable through the confirmation Alert
// handleUndoCurrent raises — drive it the way a real "Clear draft" /
// "Revert this edit" tap would, by capturing the destructive button's
// onPress from the mocked Alert.
function pressDestructiveAlertButton() {
  const call = Alert.alert.mock.calls[Alert.alert.mock.calls.length - 1];
  const buttons = call[2];
  const destructive = buttons.find((b) => b.style === 'destructive');
  return destructive.onPress();
}

// Hook-level integration coverage for #880's cheap-draft pipeline in the
// CURRENT-routine editor, plus regression tests for the four PR #882 review
// findings (restore wiring, the save-in-flight race, draft-table atomicity,
// and the first-save "Saving…" gap — the latter two are exercised in
// workout-note-drafts.test.js and a component-level assertion respectively;
// this file covers what only the hook itself can exercise).

// Every mounted tree is tracked and unmounted in afterEach — otherwise a
// previous test's hook instance (and its AppState listener / pending
// timers) stays live and can shadow the current test's, e.g. by matching
// first in a `mock.calls.find(...)` lookup.
let mountedTrees = [];

function renderHook(props) {
  const ref = { current: null };
  function Probe(p) {
    ref.current = useLogCurrentRoutineEditor(p);
    return null;
  }
  let tree;
  act(() => {
    tree = renderer.create(React.createElement(Probe, props));
  });
  mountedTrees.push(tree);
  return { ref, tree, rerender: (next) => act(() => tree.update(React.createElement(Probe, next))) };
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }
}

function makeBaseProps(overrides = {}) {
  let workoutNoteText = overrides.workoutNoteText ?? '';
  let workoutNoteTitle = overrides.workoutNoteTitle ?? '';
  const setWorkoutNoteText = jest.fn((v) => { workoutNoteText = v; });
  const setWorkoutNoteTitle = jest.fn((v) => { workoutNoteTitle = v; });
  return {
    get workoutNoteText() { return workoutNoteText; },
    get workoutNoteTitle() { return workoutNoteTitle; },
    setWorkoutNoteText,
    setWorkoutNoteTitle,
    currentId: null,
    currentNote: null,
    notes: [],
    trackedLifts: [],
    update: jest.fn(async () => false),
    add: jest.fn(async () => ({ id: 'note-1' })),
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
}

// react-test-renderer re-renders a Probe function component with fresh
// closures each call, so the "live" props object used by the hook must be
// mutated in place (not replaced) for setWorkoutNoteText/Title to actually
// move the value the NEXT render sees — mirroring how the real LogScreen
// component holds workoutNoteText/Title in its own useState.
function makeLiveProps(overrides = {}) {
  // workoutNoteText/Title seed `state` below, not `makeBaseProps`'s object —
  // that object already defines them as getter-only accessor properties, and
  // merging plain values of the same name into it throws.
  const { workoutNoteText: seedText, workoutNoteTitle: seedTitle, ...baseOverrides } = overrides;
  const props = makeBaseProps(baseOverrides);
  const state = { text: seedText ?? '', title: seedTitle ?? '' };
  // Stable jest.fn instances, shared across every build() — otherwise
  // assertions against `live.props.setWorkoutNoteText` would target a
  // different mock than the one the hook actually calls after a rerender.
  const setWorkoutNoteText = jest.fn((v) => { state.text = v; });
  const setWorkoutNoteTitle = jest.fn((v) => { state.title = v; });
  props.setWorkoutNoteText = setWorkoutNoteText;
  props.setWorkoutNoteTitle = setWorkoutNoteTitle;
  return {
    build: () => ({
      ...props,
      workoutNoteText: state.text,
      workoutNoteTitle: state.title,
      setWorkoutNoteText,
      setWorkoutNoteTitle,
    }),
    state,
    props,
  };
}

describe('useLogCurrentRoutineEditor — durable drafts (#880)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    resetPhase(SYNC_PHASE.SYNC);
    jest.useFakeTimers();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    AppState.addEventListener.mockClear();
    mountedTrees = [];
  });
  afterEach(() => {
    mountedTrees.forEach((tree) => act(() => tree.unmount()));
    mountedTrees = [];
    jest.useRealTimers();
    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    Alert.alert.mockRestore();
  });

  test('rapid typing on a brand-new note persists a cheap draft without any expensive save call', async () => {
    const live = makeLiveProps();
    const { ref, rerender } = renderHook(live.build());

    act(() => { ref.current.enterCurrentEditor(); });

    // Simulate 5 rapid keystrokes, each well inside the 400ms draft debounce
    // and the multi-second AUTOSAVE_DEBOUNCE_MS.
    const keystrokes = ['D', 'Da', 'Day', 'Day 1', 'Day 1\nSquat'];
    for (const text of keystrokes) {
      live.state.text = text;
      // eslint-disable-next-line no-await-in-loop
      rerender(live.build());
      act(() => { jest.advanceTimersByTime(50); });
    }

    // Before the draft debounce elapses: no expensive save has been
    // triggered (new notes never autosave — that's the audited gap), and
    // nothing has been persisted as a draft yet.
    expect(live.props.add).not.toHaveBeenCalled();
    expect(live.props.update).not.toHaveBeenCalled();
    expect(await loadWorkoutNoteDraft('current:new')).toBeNull();

    // Let the cheap draft debounce (400ms) elapse.
    await act(async () => { jest.advanceTimersByTime(500); });
    await flush();

    const draft = await loadWorkoutNoteDraft('current:new');
    expect(draft.raw_text).toBe('Day 1\nSquat');
    // Still no expensive save triggered by typing alone.
    expect(live.props.add).not.toHaveBeenCalled();
    expect(live.props.update).not.toHaveBeenCalled();
  });

  test('restores a draft on entering the editor when it matches the canonical note version', async () => {
    const note = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
    await saveWorkoutNoteDraft('current:note-1', {
      title: 'Push Day (draft)',
      raw_text: 'Bench 3x5\nOHP 3x5',
      baseUpdatedAt: note.updated_at,
    });

    const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note] });
    const { ref, rerender } = renderHook(live.build());

    await act(async () => { ref.current.enterCurrentEditor(); });
    await flush();
    rerender(live.build());

    expect(live.props.setWorkoutNoteText).toHaveBeenCalledWith('Bench 3x5\nOHP 3x5');
    expect(live.props.setWorkoutNoteTitle).toHaveBeenCalledWith('Push Day (draft)');
  });

  // #880 revised body (reversal): a revision mismatch must NEVER delete the
  // draft — that text is the interrupted work this issue exists to protect.
  // It is never auto-applied over newer canonical content, but it stays
  // stored and recoverable until an explicit discard/revert or a superseding
  // successful save.
  test('never auto-applies a stale draft, but RETAINS it (does not delete) on a revision mismatch', async () => {
    const staleNote = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
    await saveWorkoutNoteDraft('current:note-1', {
      title: 'Push Day (draft)',
      raw_text: 'STALE TEXT FROM AN OLDER VERSION',
      baseUpdatedAt: '2026-07-01T00:00:00.000Z', // older than the canonical note below
    });

    // Canonical note has since moved on (e.g. synced from another device).
    const currentNote = { ...staleNote, raw_text: 'Bench 3x5 (updated elsewhere)', updated_at: '2026-08-15T00:00:00.000Z' };
    const live = makeLiveProps({ currentId: 'note-1', currentNote, notes: [currentNote] });
    const { ref } = renderHook(live.build());

    await act(async () => { ref.current.enterCurrentEditor(); });
    await flush();

    // The stale draft must never have been applied to the live editor —
    // canonical content is shown by default.
    expect(live.props.setWorkoutNoteText).not.toHaveBeenCalledWith('STALE TEXT FROM AN OLDER VERSION');
    // But it MUST still be there afterward, recoverable, not deleted.
    const retained = await loadWorkoutNoteDraft('current:note-1');
    expect(retained).not.toBeNull();
    expect(retained.raw_text).toBe('STALE TEXT FROM AN OLDER VERSION');
  });

  test('a save-in-flight race never deletes text typed after the snapshot was taken (regression: PR #882 finding 2)', async () => {
    const note = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
    let resolveUpdate;
    const update = jest.fn(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note], update });
    live.state.text = 'Bench 3x5';
    const { ref, rerender } = renderHook(live.build());
    act(() => { ref.current.enterCurrentEditor(); });

    // Kick off a save of the CURRENT text ('Bench 3x5') and let it hang
    // in flight (update() has not resolved yet).
    let savePromise;
    act(() => { savePromise = ref.current.handleSave(); });

    // While that save is in flight, the user keeps typing. The 400ms draft
    // timer fires and persists this NEWER text.
    live.state.text = 'Bench 3x5\nRow 3x8 (typed during save)';
    rerender(live.build());
    await act(async () => { jest.advanceTimersByTime(500); });
    await flush();
    const draftWhileInFlight = await loadWorkoutNoteDraft('current:note-1');
    expect(draftWhileInFlight.raw_text).toBe('Bench 3x5\nRow 3x8 (typed during save)');

    // Now the in-flight save (of the OLDER snapshot) resolves successfully.
    await act(async () => {
      resolveUpdate({ id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5' });
      await savePromise;
    });
    await flush();

    // The newer draft must survive: it does not match what was actually
    // saved, so the success-path cleanup must NOT have deleted it.
    const draftAfterSave = await loadWorkoutNoteDraft('current:note-1');
    expect(draftAfterSave).not.toBeNull();
    expect(draftAfterSave.raw_text).toBe('Bench 3x5\nRow 3x8 (typed during save)');
  });

  test('a matching draft IS cleared once the save that persisted the same text resolves', async () => {
    const note = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
    const update = jest.fn(async (id, patch) => ({ id, title: patch.title, raw_text: patch.raw_text }));
    const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note], update });
    live.state.text = 'Bench 3x5\nRow 3x8';
    const { ref, rerender } = renderHook(live.build());
    act(() => { ref.current.enterCurrentEditor(); });
    rerender(live.build());

    // The cheap draft lands first (400ms), matching exactly what will be saved.
    await act(async () => { jest.advanceTimersByTime(500); });
    await flush();
    expect((await loadWorkoutNoteDraft('current:note-1')).raw_text).toBe('Bench 3x5\nRow 3x8');

    await act(async () => { await ref.current.handleSave(); });
    await flush();

    expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();
  });

  test('a failed save (sync/write failure) leaves the local draft untouched, so a later retry has something to recover', async () => {
    const note = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
    const update = jest.fn(async () => false); // simulates a write/sync failure
    const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note], update });
    live.state.text = 'Bench 3x5\nRow 3x8';
    const { ref, rerender } = renderHook(live.build());
    act(() => { ref.current.enterCurrentEditor(); });
    rerender(live.build());

    await act(async () => { jest.advanceTimersByTime(500); });
    await flush();
    expect((await loadWorkoutNoteDraft('current:note-1')).raw_text).toBe('Bench 3x5\nRow 3x8');

    const ok = await act(async () => ref.current.handleSave());
    expect(ok).toBe(false);
    await flush();

    // The failed save must not have cleared the draft — it is still the
    // only durable copy of this text until a retry succeeds.
    const draft = await loadWorkoutNoteDraft('current:note-1');
    expect(draft).not.toBeNull();
    expect(draft.raw_text).toBe('Bench 3x5\nRow 3x8');
  });

  test('backgrounding flushes the pending draft immediately instead of waiting out the debounce', async () => {
    const live = makeLiveProps();
    const { ref, rerender } = renderHook(live.build());
    act(() => { ref.current.enterCurrentEditor(); });

    live.state.text = 'Day 1\nSquat 5x5';
    rerender(live.build());

    // Advance well under the 400ms draft debounce — nothing persisted yet.
    act(() => { jest.advanceTimersByTime(50); });
    expect(await loadWorkoutNoteDraft('current:new')).toBeNull();

    // Find the AppState 'change' listener the hook registered and fire it,
    // exactly as the OS does when the app backgrounds.
    const call = AppState.addEventListener.mock.calls.find(([event]) => event === 'change');
    expect(call).toBeTruthy();
    const [, handler] = call;
    await act(async () => { handler('background'); });
    await flush();

    const draft = await loadWorkoutNoteDraft('current:new');
    expect(draft.raw_text).toBe('Day 1\nSquat 5x5');
  });

  test('discard/revert on a brand-new note clears its draft', async () => {
    const live = makeLiveProps();
    const { ref, rerender } = renderHook(live.build());
    act(() => { ref.current.enterCurrentEditor(); });
    live.state.text = 'Day 1\nSquat 5x5';
    rerender(live.build());
    await act(async () => { jest.advanceTimersByTime(500); });
    await flush();
    expect(await loadWorkoutNoteDraft('current:new')).not.toBeNull();

    act(() => { ref.current.handleUndoCurrent(); });
    await act(async () => { await pressDestructiveAlertButton(); });
    await flush();

    expect(await loadWorkoutNoteDraft('current:new')).toBeNull();
  });

  test('explicit revert on an existing note clears its draft', async () => {
    const note = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
    const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note] });
    const { ref, rerender } = renderHook(live.build());
    act(() => { ref.current.enterCurrentEditor(); });
    live.state.text = 'Bench 3x5\nExtra set';
    rerender(live.build());
    await act(async () => { jest.advanceTimersByTime(500); });
    await flush();
    expect(await loadWorkoutNoteDraft('current:note-1')).not.toBeNull();

    act(() => { ref.current.handleUndoCurrent(); });
    await act(async () => { await pressDestructiveAlertButton(); });
    await flush();

    expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();
  });

  // #880 revised body — BLOCKER 2 regression coverage: a stale/conflicting
  // draft must be retained (not deleted) on a revision mismatch, and stay
  // recoverable until EXPLICIT discard/revert clears it.
  test('a mismatched (retained) draft is cleared by explicit discard/revert, not by the mismatch itself', async () => {
    const note = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
    await saveWorkoutNoteDraft('current:note-1', {
      title: 'stale',
      raw_text: 'STALE TEXT',
      baseUpdatedAt: '2026-07-01T00:00:00.000Z', // predates the note above
    });
    const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note] });
    const { ref } = renderHook(live.build());

    await act(async () => { ref.current.enterCurrentEditor(); });
    await flush();
    // Retained, not deleted, by opening the editor.
    expect(await loadWorkoutNoteDraft('current:note-1')).not.toBeNull();

    act(() => { ref.current.handleUndoCurrent(); });
    await act(async () => { await pressDestructiveAlertButton(); });
    await flush();

    // NOW it is gone — cleared by the explicit discard, not by the earlier
    // mismatch.
    expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();
  });

  // #880 revised body — BLOCKER 2: a mismatched draft is naturally superseded
  // once the user resumes editing (based on canonical content) and saves.
  // Typing must not do that cleanup early: the stale conflict and the fresh
  // session coexist until canonical persistence succeeds.
  test('a mismatched (retained) draft is superseded once the user edits canonical content again and saves', async () => {
    const note = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
    await saveWorkoutNoteDraft('current:note-1', {
      title: 'stale',
      raw_text: 'STALE TEXT',
      baseUpdatedAt: '2026-07-01T00:00:00.000Z',
    });
    const update = jest.fn(async (id, patch) => ({ id, title: patch.title, raw_text: patch.raw_text }));
    const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note], update });
    const { ref, rerender } = renderHook(live.build());

    await act(async () => { ref.current.enterCurrentEditor(); });
    await flush();
    // Canonical content shown — the stale draft was never applied.
    expect(live.state.text).toBe('');

    // The editor actually opens on canonical text via LogScreen's own state
    // (out of this hook's control in production); simulate that here, then
    // the user edits further.
    live.state.text = 'Bench 3x5\nRow 3x8';
    rerender(live.build());
    await act(async () => { jest.advanceTimersByTime(500); });
    await flush();

    const beforeSave = await loadWorkoutNoteDrafts('current:note-1');
    expect(beforeSave.map((draft) => draft.raw_text)).toEqual(
      expect.arrayContaining(['STALE TEXT', 'Bench 3x5\nRow 3x8']),
    );

    await act(async () => { await ref.current.handleSave(); });
    await flush();

    expect(update).toHaveBeenCalled();
    expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();
  });

  // #880 revised body — BLOCKER 1: `Saved` is bound to the exact snapshot it
  // describes and must never show for text that has since diverged from it.
  describe('Saved is bound to an exact text snapshot (BLOCKER 1)', () => {
    test('Saved never shows for text typed after a completed save, even inside the old success-banner window', async () => {
      const note = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
      const update = jest.fn(async (id, patch) => ({ id, title: patch.title, raw_text: patch.raw_text }));
      const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note], update, workoutNoteTitle: 'Push Day', workoutNoteText: 'Bench 3x5' });
      const { ref, rerender } = renderHook(live.build());
      act(() => { ref.current.enterCurrentEditor(); });

      // An explicit (non-autosave) save shows "Saved on device".
      await act(async () => { await ref.current.handleSave(); });
      await flush();
      rerender(live.build());
      expect(ref.current.saveSuccess).toBe('Saved on device');

      // The user immediately types more, well inside the 2s success-banner
      // window.
      live.state.text = 'Bench 3x5\nRow 3x8';
      rerender(live.build());

      // The banner must be gone the instant the live text no longer matches
      // what was actually saved — not still showing "Saved on device" for
      // text that was never saved.
      expect(ref.current.saveSuccess).toBe('');
    });

    test('an older in-flight write resolving after newer text is visible does not show Saved', async () => {
      const note = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
      let resolveUpdate;
      const update = jest.fn(() => new Promise((resolve) => { resolveUpdate = resolve; }));
      const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note], update, workoutNoteTitle: 'Push Day', workoutNoteText: 'Bench 3x5' });
      const { ref, rerender } = renderHook(live.build());
      act(() => { ref.current.enterCurrentEditor(); });

      let savePromise;
      act(() => { savePromise = ref.current.handleSave(); });
      // Let the save's internal chain progress up to (and pause at) the
      // `await update(...)` call, mirroring the working save-in-flight-race
      // test above.
      await flush(4);
      expect(ref.current.saveStatus).toBe('saving');

      // Newer text arrives while that save is still in flight.
      live.state.text = 'Bench 3x5\nRow 3x8 (typed during save)';
      rerender(live.build());
      expect(ref.current.saveSuccess).toBe('');
      expect(ref.current.saveStatus).toBeNull();

      // The OLDER write now resolves.
      await act(async () => {
        resolveUpdate({ id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5' });
        await savePromise;
      });
      await flush();
      rerender(live.build());

      // It must NOT have produced a Saved banner for the newer, unsaved text.
      expect(ref.current.saveSuccess).toBe('');
    });

    test('typing during the debounce window never shows a stale Saved for the earlier text', async () => {
      const note = { id: 'note-1', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
      const update = jest.fn(async (id, patch) => ({ id, title: patch.title, raw_text: patch.raw_text }));
      const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note], update, workoutNoteTitle: 'Push Day', workoutNoteText: 'Bench 3x5' });
      const { ref, rerender } = renderHook(live.build());
      act(() => { ref.current.enterCurrentEditor(); });

      await act(async () => { await ref.current.handleSave(); });
      await flush();
      rerender(live.build());
      expect(ref.current.saveSuccess).toBe('Saved on device');

      // Type again, then let a debounce window pass WITHOUT a new save
      // completing (autosave hasn't fired yet — still well inside
      // AUTOSAVE_DEBOUNCE_MS).
      live.state.text = 'Bench 3x5\nOHP 3x5';
      rerender(live.build());
      act(() => { jest.advanceTimersByTime(400); });
      rerender(live.build());

      expect(ref.current.saveSuccess).toBe('');
    });
  });

  test('an open editor follows queue, retry failure, and storage-mode convergence changes', async () => {
    const note = {
      id: 'note-1',
      title: 'Push Day',
      raw_text: 'Bench 3x5',
      updated_at: '2026-08-01T00:00:00.000Z',
    };
    const live = makeLiveProps({
      currentId: note.id,
      currentNote: note,
      notes: [note],
      workoutNoteTitle: note.title,
      workoutNoteText: note.raw_text,
    });
    const { ref, rerender } = renderHook(live.build());
    act(() => { ref.current.enterCurrentEditor(); });
    expect(ref.current.pendingConvergence).toBe(false);

    // The editor stays mounted across sign-in/cloud activation. A parent
    // render re-evaluates mode, and subsequent queue/recovery notifications
    // continue updating this same editor instance.
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    rerender(live.build());
    await flush();
    expect(ref.current.pendingConvergence).toBe(false);

    await act(async () => {
      await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, { id: note.id, ...note });
    });
    await flush();
    expect(ref.current.pendingConvergence).toBe(true);
    expect(ref.current.saveStatus).toBe('pending');

    const dirty = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
    await act(async () => { await clearDirty(SYNC_TABLES.WORKOUT_NOTES, dirty); });
    await flush();
    expect(ref.current.pendingConvergence).toBe(false);

    act(() => { markFailed(SYNC_PHASE.SYNC, new Error('retry later')); });
    await flush();
    expect(ref.current.pendingConvergence).toBe(true);
    expect(ref.current.saveStatus).toBe('pending');

    act(() => { markComplete(SYNC_PHASE.SYNC); });
    await flush();
    expect(ref.current.pendingConvergence).toBe(false);
  });

  // Before/after rapid-typing measurement the issue's Verification list asks
  // for. Uses a 20-keystroke burst, each 30ms apart (well inside both the
  // 400ms draft debounce and the 800ms AUTOSAVE_DEBOUNCE_MS), against an
  // EXISTING note (the case the pre-#880 code already autosaved).
  test('measurement: a 20-keystroke burst on an EXISTING note costs exactly 1 expensive save + 1 cheap draft write, not 20 of either', async () => {
    const note = { id: 'note-1', title: 'Push Day', raw_text: 'B', updated_at: '2026-08-01T00:00:00.000Z' };
    const update = jest.fn(async (id, patch) => ({ id, title: patch.title, raw_text: patch.raw_text }));
    const live = makeLiveProps({ currentId: 'note-1', currentNote: note, notes: [note], update });
    live.state.text = 'B';
    const { ref, rerender } = renderHook(live.build());
    act(() => { ref.current.enterCurrentEditor(); });

    for (let i = 0; i < 20; i++) {
      live.state.text += 'x';
      // eslint-disable-next-line no-await-in-loop
      rerender(live.build());
      act(() => { jest.advanceTimersByTime(30); }); // 20 * 30ms = 600ms of typing
    }

    // BEFORE #880: this is exactly what AUTOSAVE_DEBOUNCE_MS already gave —
    // pinned here as the baseline, not a new claim.
    expect(update).not.toHaveBeenCalled();

    // Let both debounces (400ms draft, 800ms autosave) elapse from the last
    // keystroke, interleaving fake-timer advances with real microtask
    // draining so the draft write's own async storage-lock chain and the
    // autosave's (longer) chain both fully settle in the right order.
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { jest.advanceTimersByTime(150); });
      // eslint-disable-next-line no-await-in-loop
      await flush(2);
    }
    await flush();

    // AFTER #880: exactly one expensive save call for the whole burst — the
    // cheap draft pipeline added a SEPARATE, cheap write, not extra calls to
    // the expensive path.
    expect(update).toHaveBeenCalledTimes(1);
    const draft = await loadWorkoutNoteDraft('current:note-1');
    // The matching draft is cleared once the (single) real save that
    // persisted the same text resolves — see the compare-and-clear tests
    // above — so by this point there is deliberately no draft left over.
    expect(draft).toBeNull();
  });

  // Same burst against a BRAND-NEW note: the pre-#880 baseline is 0 writes of
  // ANY kind (the audited data-loss gap); #880 adds exactly 1 cheap draft
  // write and still 0 expensive calls.
  test('measurement: the same 20-keystroke burst on a BRAND-NEW note costs 0 expensive calls, 1 cheap draft write (was 0 writes of any kind before #880)', async () => {
    const live = makeLiveProps();
    const { ref, rerender } = renderHook(live.build());
    act(() => { ref.current.enterCurrentEditor(); });

    for (let i = 0; i < 20; i++) {
      live.state.text += 'x';
      // eslint-disable-next-line no-await-in-loop
      rerender(live.build());
      act(() => { jest.advanceTimersByTime(30); });
    }

    expect(live.props.add).not.toHaveBeenCalled();
    expect(await loadWorkoutNoteDraft('current:new')).toBeNull(); // nothing durable yet, mid-burst

    await act(async () => { jest.advanceTimersByTime(900); });
    await flush();

    expect(live.props.add).not.toHaveBeenCalled(); // still 0 — new notes never autosave
    const draft = await loadWorkoutNoteDraft('current:new');
    expect(draft).not.toBeNull(); // but now durable on disk, which it never was before #880
    expect(draft.raw_text).toBe(live.state.text);
  });
});
