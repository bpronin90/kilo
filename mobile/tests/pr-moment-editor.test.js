import React from 'react';
import render from 'react-test-renderer';
import { useLogCurrentRoutineEditor } from '../screens/log/useLogCurrentRoutineEditor';

jest.mock('../lib/platformAlert', () => ({ Alert: { alert: jest.fn() } }));

// Real module by default; individual tests swap loadRecoveryExcludedNoteIds
// to a rejecting mock to exercise the "boundary unready" suppression path
// without breaking the (independent) save path's own recovery-boundary read.
jest.mock('../hooks/entries/recoveryBlockHooks', () => {
  const actual = jest.requireActual('../hooks/entries/recoveryBlockHooks');
  return { ...actual, loadRecoveryExcludedNoteIds: jest.fn(actual.loadRecoveryExcludedNoteIds) };
});
// eslint-disable-next-line import/first
import { loadRecoveryExcludedNoteIds } from '../hooks/entries/recoveryBlockHooks';

// Hook-level integration coverage for #577 Contract 3's two previously-open
// gaps: A/B active-week mid-session handling, and the PR-moment pipeline
// exercised end to end through the real hook (not just the pure
// lib/prMoment.js/deriveTrackedPROccurrences unit tests).

const mounted = [];
afterEach(() => {
  render.act(() => { mounted.forEach((c) => c.unmount()); });
  mounted.length = 0;
  jest.clearAllMocks();
  // mockRejectedValue (sticky, unlike -Once) must not bleed into later
  // tests — clearAllMocks resets call history but not a configured
  // resolved/rejected implementation.
  loadRecoveryExcludedNoteIds.mockImplementation(
    jest.requireActual('../hooks/entries/recoveryBlockHooks').loadRecoveryExcludedNoteIds
  );
});

function makeHarness({ raw, note = {}, updateImpl, notes: notesOverride } = {}) {
  const update = jest.fn().mockImplementation(
    updateImpl || (async (_id, patch) => ({
      id: 'note1',
      title: patch.title || 'Routine',
      raw_text: patch.raw_text !== undefined ? patch.raw_text : raw,
      activeWeek: patch.activeWeek !== undefined ? patch.activeWeek : undefined,
    }))
  );
  let latest = null;

  function Harness({ currentNote }) {
    const [text, setText] = React.useState(raw);
    const [title, setTitle] = React.useState('Routine');
    const hook = useLogCurrentRoutineEditor({
      workoutNoteText: text,
      setWorkoutNoteText: setText,
      workoutNoteTitle: title,
      setWorkoutNoteTitle: setTitle,
      currentId: 'note1',
      currentNote,
      notes: notesOverride || [currentNote],
      trackedLifts: { bench: true },
      trackedLiftActivations: {},
      reconcileTrackedLiftActivations: jest.fn(async () => {}),
      update,
      add: jest.fn(),
      selectCurrent: jest.fn(),
      fatigueTrackingEnabled: false,
      onCheckInPrompt: jest.fn(),
      notesLoading: false,
      notesError: null,
      otherModalOwnsScreen: false,
      editorScrollRef: { current: { scrollTo: jest.fn() } },
      readScrollRef: { current: { scrollTo: jest.fn() } },
    });
    latest = { hook, setText, setTitle };
    return null;
  }

  const initialNote = { id: 'note1', title: 'Routine', raw_text: raw, ...note };
  let root;
  render.act(() => {
    root = render.create(<Harness currentNote={initialNote} />);
    mounted.push(root);
  });

  return {
    get: () => latest,
    update,
    enter: async () => { await render.act(async () => { latest.hook.enterCurrentEditor(); }); },
    setText: async (v) => { await render.act(async () => { latest.setText(v); }); },
    toggleWeek: async () => { await render.act(async () => { await latest.hook.handleToggleWeek(); }); },
    done: async () => { await render.act(async () => { await latest.hook.handleDoneCurrent(); }); },
  };
}

describe('PR-moment pipeline through the real hook (#577)', () => {
  test('appending a set that beats the prior best celebrates after Done', async () => {
    const raw = '-Bench\n135 5';
    const h = makeHarness({ raw });
    await h.enter();
    await h.setText('-Bench\n135 5\n200 5');
    await h.done();
    expect(h.get().hook.prMoment).not.toBeNull();
    expect(h.get().hook.prMoment.exerciseKey).toBeTruthy();
    expect(h.get().hook.prMoment.weight_value).toBe(200);
  });

  test('autosave (without Done) never surfaces prMoment', async () => {
    const raw = '-Bench\n135 5';
    const h = makeHarness({ raw });
    await h.enter();
    // handleCurrentTextChange isn't exercised here — a plain setText plus a
    // manual save call stands in for "autosave completed" without going
    // through Done, which is the property under test: compute != display.
    await h.setText('-Bench\n135 5\n200 5');
    await render.act(async () => { await h.get().hook.handleSave({ autosave: true }); });
    expect(h.get().hook.prMoment).toBeNull();
  });

  test('an unready/failed recovery-boundary read suppresses the celebration for that Done (never a guess)', async () => {
    const raw = '-Bench\n135 5';
    const h = makeHarness({ raw });
    await h.enter();
    await h.setText('-Bench\n135 5\n200 5');
    // Both handleSave's own (independently-tolerant) boundary read and
    // computePendingPRCandidate's must see the failure — mockRejectedValue
    // (not -Once) so it applies regardless of call order between the two.
    loadRecoveryExcludedNoteIds.mockRejectedValue(new Error('boundary read failed'));
    await h.done();
    expect(h.get().hook.prMoment).toBeNull();
  });

  test('dismissing a released PR moment clears it', async () => {
    const raw = '-Bench\n135 5';
    const h = makeHarness({ raw });
    await h.enter();
    await h.setText('-Bench\n135 5\n200 5');
    await h.done();
    expect(h.get().hook.prMoment).not.toBeNull();
    render.act(() => { h.get().hook.clearPRMoment(); });
    expect(h.get().hook.prMoment).toBeNull();
  });
});

describe('A/B active-week mid-session switch (#577 gap fix)', () => {
  const weekA = '-Bench\n135 5';
  const weekB = '-Bench\n135 5\n200 5';
  const raw = `${weekA}\n---\n${weekB}`;

  test('switching the active week mid-session suppresses that Done — no cross-week comparison', async () => {
    const h = makeHarness({ raw, note: { activeWeek: 'A' } });
    await h.enter();
    expect(h.get().hook.hasABWeeks).toBe(true);
    expect(h.get().hook.effectiveActiveWeek).toBe('A');

    await h.toggleWeek();
    expect(h.get().hook.effectiveActiveWeek).toBe('B');

    await h.done();
    // Week B's own text (135 5, 200 5) would read as a real PR if compared
    // against week A's baseline (135 5) — but baseline and current no
    // longer describe the same week, so it must never celebrate.
    expect(h.get().hook.prMoment).toBeNull();
  });

  test('staying on the same active week through Done still celebrates normally', async () => {
    const h = makeHarness({ raw: `${weekA}\n---\n${weekA}`, note: { activeWeek: 'A' } });
    await h.enter();
    await h.setText(`${weekB}\n---\n${weekA}`); // only week A's (active) text changes
    await h.done();
    expect(h.get().hook.prMoment).not.toBeNull();
  });
});
