import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { useLogOtherRoutineEditor } from '../screens/log/useLogOtherRoutineEditor';
import {
  saveWorkoutNoteDraft,
  loadWorkoutNoteDraft,
} from '../storage/entries/workoutNoteDrafts';

// Regression coverage for PR #882 review finding 1: restore was wired only
// into `handleOpenOtherNote` (the deload-section entry point). Every OTHER
// existing-note entry point — Previous Routines' Edit (`handleEditViewedNote`)
// and Recovery's Edit (`handleEditRecoveryViewedNote`), both built from
// `makeHandleEditViewedNote` — must restore a matching draft too, or a draft
// written while editing an ordinary previous/Recovery routine is stranded
// after a restart.

let mountedTrees = [];

function renderHook(props) {
  const ref = { current: null };
  function Probe(p) {
    ref.current = useLogOtherRoutineEditor(p);
    return null;
  }
  let tree;
  act(() => {
    tree = renderer.create(React.createElement(Probe, props));
  });
  mountedTrees.push(tree);
  return { ref, tree };
}

function makeProps(overrides = {}) {
  return {
    notes: [],
    currentId: null,
    currentNote: null,
    deloadHistory: [],
    update: jest.fn(async () => false),
    add: jest.fn(async () => ({ id: 'new-id' })),
    remove: jest.fn(async () => {}),
    selectCurrent: jest.fn(async () => {}),
    updateDeload: jest.fn(async () => {}),
    deleteDeloadNote: jest.fn(async () => {}),
    autosaveCurrentTimerRef: { current: null },
    handleSave: jest.fn(async () => true),
    currentEditorMode: 'read',
    hasUnsavedCurrent: false,
    editorScrollRef: { current: { scrollTo: jest.fn() } },
    ...overrides,
  };
}

async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }
}

describe('useLogOtherRoutineEditor — draft restore wiring (#880 / PR #882 finding 1)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mountedTrees = [];
  });
  afterEach(() => {
    mountedTrees.forEach((tree) => act(() => tree.unmount()));
    mountedTrees = [];
  });

  test('restores a draft when opening an ordinary Previous Routines note via Edit (handleEditViewedNote)', async () => {
    const note = { id: 'note-1', title: 'Leg Day', raw_text: 'Squat 5x5', updated_at: '2026-08-01T00:00:00.000Z' };
    await saveWorkoutNoteDraft('other:note-1', {
      title: 'Leg Day (draft)',
      raw_text: 'Squat 5x5\nLeg Press 3x10',
      baseUpdatedAt: note.updated_at,
    });

    const { ref } = renderHook(makeProps({ notes: [note] }));

    act(() => { ref.current.handleViewOtherNote(note); });
    await act(async () => { ref.current.handleEditViewedNote(); });
    await flush();

    expect(ref.current.editingTitle).toBe('Leg Day (draft)');
    expect(ref.current.editingText).toBe('Squat 5x5\nLeg Press 3x10');
  });

  test('restores a draft when opening a Recovery note via Edit (handleEditRecoveryViewedNote)', async () => {
    const note = { id: 'note-2', title: 'Recovery Week 1', raw_text: 'Walk 30min', updated_at: '2026-08-05T00:00:00.000Z' };
    await saveWorkoutNoteDraft('recovery:note-2', {
      title: 'Recovery Week 1',
      raw_text: 'Walk 30min\nStretch 10min',
      baseUpdatedAt: note.updated_at,
    });

    const { ref } = renderHook(makeProps({ notes: [note] }));

    act(() => { ref.current.handleViewRecoveryNote(note); });
    await act(async () => { ref.current.handleEditRecoveryViewedNote(); });
    await flush();

    expect(ref.current.editingText).toBe('Walk 30min\nStretch 10min');
  });

  // #880 revised body (reversal): a revision mismatch must NEVER delete the
  // draft. It stays stored and recoverable.
  test('never auto-applies a stale draft, but RETAINS it, when opened via handleEditViewedNote', async () => {
    const staleBase = '2026-07-01T00:00:00.000Z';
    await saveWorkoutNoteDraft('other:note-1', {
      title: 'Leg Day (stale draft)',
      raw_text: 'STALE',
      baseUpdatedAt: staleBase,
    });
    const note = { id: 'note-1', title: 'Leg Day', raw_text: 'Squat 5x5 (updated elsewhere)', updated_at: '2026-08-10T00:00:00.000Z' };

    const { ref } = renderHook(makeProps({ notes: [note] }));
    act(() => { ref.current.handleViewOtherNote(note); });
    await act(async () => { ref.current.handleEditViewedNote(); });
    await flush();

    expect(ref.current.editingText).not.toBe('STALE');
    expect(ref.current.editingText).toBe('Squat 5x5 (updated elsewhere)');
    const retained = await loadWorkoutNoteDraft('other:note-1');
    expect(retained).not.toBeNull();
    expect(retained.raw_text).toBe('STALE');
  });

  // The deload-section entry point (handleOpenOtherNote) already had restore
  // before the review — pinned here so it never regresses relative to the
  // other two entry points.
  test('still restores via the deload-section entry point (handleOpenOtherNote)', async () => {
    const note = { id: 'note-3', title: 'Push Day', raw_text: 'Bench 3x5', updated_at: '2026-08-01T00:00:00.000Z' };
    await saveWorkoutNoteDraft('other:note-3', {
      title: 'Push Day (draft)',
      raw_text: 'Bench 3x5\nOHP 3x5',
      baseUpdatedAt: note.updated_at,
    });

    const { ref } = renderHook(makeProps({ notes: [note], deloadHistory: [] }));
    await act(async () => { ref.current.handleOpenOtherNote(note); });
    await flush();

    expect(ref.current.editingText).toBe('Bench 3x5\nOHP 3x5');
  });
});
