import { installRendererCleanup } from './helpers/log-screen';
import React from 'react';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { openRecoveryManagement, findPressableByText, expandRoutineManagement, expandManageRecovery, ControlledLogScreen } from './helpers/log-screen';

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

// ── Recovery Block start flow (#695) ────────────────────────────────────────

describe('Recovery Block start flow', () => {
  const { LightColors, DarkColors, KUA_PALETTES } = require('../theme/colors');
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
  // #1423: Start now lives on the inactive management screen, reached through
  // the compact `Recovery ›` entry under the current routine.
  const openEntryPoint = (root) => {
    openRecoveryManagement(root);
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
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Recovery').length).toBe(1);

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
        <ThemeContext.Provider value={{ preference: 'dark', mode: 'dark', colors: DarkColors, kuaPalette: KUA_PALETTES.hardCourt.dark, setPreference: jest.fn() }}>
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

    // Now mid-edit: the Routine tab reports disabled and refuses to switch.
    // Deload is not offered at all while Recovery is active (#1423).
    const routineTab = tabButton(root, 'Routine');
    expect(tabButton(root, 'Deload')).toBeNull();
    expect(routineTab.props.disabled).toBe(true);
    expect(routineTab.props.accessibilityState.disabled).toBe(true);

    render.act(() => { routineTab.props.onPress(); });
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
