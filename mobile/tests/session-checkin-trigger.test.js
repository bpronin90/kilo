import React from 'react';
import render from 'react-test-renderer';
import { sessionDateMapFromNote, sessionsSinceLastDeload } from '../lib/parser';
import { useLogCurrentRoutineEditor } from '../screens/log/useLogCurrentRoutineEditor';

jest.mock('../lib/platformAlert', () => ({ Alert: { alert: jest.fn() } }));

// ── D10 trigger contract, driven through the real hook ───────────────────────
//
// Nothing here stubs the detector or the parser: each note below is real text
// that the shipped parser and deriveSessionCheckIn agree is (or is not) worth
// asking about, so these assert behavior rather than restating the rules.

// Bench held at 185, then a genuine decline at the deepest column: the shape
// that earns a prompt. `columns` extra flat sessions can be prepended to push
// the session index deeper (for cooldown distances).
function decliningNote(extraFlatColumns = 0) {
  const flat = Array(2 + extraFlatColumns).fill('185 8,8,8').join('\n');
  return `Monday\n-Bench\n${flat}\n185 4,4,3`;
}

// The same routine with an ordinary last session.
const CALM_NOTE = 'Monday\n-Bench\n185 8,8,8\n185 8,8,8\n185 8,8,7';

// Three exercises with logged history: 'Skip week' dashes all of them, which is
// exactly the whole-column absence that used to be answered with a prompt.
const SKIPPABLE_NOTE = 'Monday\n-Bench\n135 5,5,5\n135 5,5,5\n135 5,5,5\n'
  + '-Squat\n225 5,5,5\n225 5,5,5\n225 5,5,5\n'
  + '-Row\n95 10,10\n95 10,10\n95 10,10';

const mounted = [];
afterEach(() => {
  render.act(() => { mounted.forEach(c => c.unmount()); });
  mounted.length = 0;
  jest.clearAllMocks();
});

function makeHarness({
  raw = decliningNote(),
  note = {},
  fatigueTrackingEnabled = true,
  notesLoading = false,
  notesError = null,
  otherModalOwnsScreen = false,
  updateImpl,
} = {}) {
  const update = jest.fn().mockImplementation(
    updateImpl || (async (_id, patch) => ({
      id: 'note1',
      title: patch.title || 'Routine',
      raw_text: patch.raw_text !== undefined ? patch.raw_text : raw,
    }))
  );
  let latest = null;
  const props = { fatigueTrackingEnabled, notesLoading, notesError, otherModalOwnsScreen };

  function Harness(overrides) {
    const [text, setText] = React.useState(raw);
    const [title, setTitle] = React.useState('Routine');
    const hook = useLogCurrentRoutineEditor({
      workoutNoteText: text,
      setWorkoutNoteText: setText,
      workoutNoteTitle: title,
      setWorkoutNoteTitle: setTitle,
      currentId: 'note1',
      currentNote: overrides.currentNote,
      notes: [overrides.currentNote],
      // 'Bench' is not a default tracked lift, so track it explicitly.
      trackedLifts: { Bench: true, Squat: true, Row: true },
      update,
      add: jest.fn(),
      selectCurrent: jest.fn(),
      onCheckInPrompt: jest.fn(),
      editorScrollRef: { current: { scrollTo: jest.fn() } },
      readScrollRef: { current: { scrollTo: jest.fn() } },
      ...props,
      ...overrides.gates,
    });
    latest = { hook, getText: () => text };
    return null;
  }

  const initialNote = { id: 'note1', title: 'Routine', raw_text: raw, ...note };
  let root;
  render.act(() => {
    root = render.create(<Harness currentNote={initialNote} gates={{}} />);
    mounted.push(root);
  });

  return {
    get: () => latest,
    update,
    // Re-render with changed gate values and/or a changed stored note.
    rerender: (gates = {}, currentNote = initialNote) => {
      render.act(() => { root.update(<Harness currentNote={currentNote} gates={gates} />); });
    },
    done: async () => {
      await render.act(async () => { await latest.hook.handleDoneCurrent(); });
    },
  };
}

// A prompt is "raised" only when all five fields say so.
function promptState(hook) {
  return {
    open: hook.showCheckInModal,
    data: hook.roughCheckInData,
    sessionIndex: hook.roughSessionIndex,
    noteId: hook.roughNoteId,
    flagged: [...hook.roughFlaggedNames],
  };
}

function expectFullyWithdrawn(hook) {
  const s = promptState(hook);
  expect(s.open).toBe(false);
  expect(s.data).toBeNull();
  expect(s.sessionIndex).toBeNull();
  expect(s.noteId).toBeNull();
  expect(s.flagged).toEqual([]);
}

function checkInWrites(update) {
  return update.mock.calls.filter(([, patch]) => patch && 'session_checkins' in patch);
}

// ── The single trigger site ──────────────────────────────────────────────────

describe('the prompt is raised at exactly one moment: Done, after a verified save', () => {
  test('a rough session asks once the save has landed, and the editor still exits to read mode', async () => {
    const h = makeHarness();
    render.act(() => { h.get().hook.enterCurrentEditor(); });
    expect(h.get().hook.mode).toBe('edit');

    await h.done();

    const s = promptState(h.get().hook);
    expect(s.open).toBe(true);
    expect(s.data.detectors).toEqual(['volume_drop']);
    expect(s.sessionIndex).toBe(2);
    expect(s.noteId).toBe('note1');
    expect(s.flagged).toEqual(['bench']);
    // Done's named effect is "saved and closed": the prompt never blocks,
    // delays or replaces the exit.
    expect(h.get().hook.mode).toBe('read');
    // Raising a prompt is not a write.
    expect(checkInWrites(h.update)).toHaveLength(0);
  });

  test('an ordinary session is completely silent', async () => {
    const h = makeHarness({ raw: CALM_NOTE });
    await h.done();
    expectFullyWithdrawn(h.get().hook);
  });

  test('TL-14 a failed save preempts everything: no detection, no prompt, no record', async () => {
    // The stored note is behind the editor's text, so Done must save first —
    // and that save fails.
    const h = makeHarness({ note: { raw_text: CALM_NOTE }, updateImpl: async () => null });
    render.act(() => { h.get().hook.enterCurrentEditor(); });
    expect(h.get().hook.hasUnsavedCurrent).toBe(true);

    await h.done();

    expectFullyWithdrawn(h.get().hook);
    expect(h.get().hook.saveError).toBe('Save failed');
    expect(checkInWrites(h.update)).toHaveLength(0);
  });

  test('TL-9 Skip week is a declaration, so it never asks', async () => {
    const h = makeHarness({ raw: SKIPPABLE_NOTE });

    await render.act(async () => { await h.get().hook.handleSkipWeek(); });

    // The skip really was applied — this is the exact state that used to be
    // read back as "whole day skipped — you okay?".
    expect(h.get().getText().match(/^-$/gm)).toHaveLength(3);
    expect(h.get().hook.skipWeekStatus).toBe('Skip applied');
    expectFullyWithdrawn(h.get().hook);
    expect(checkInWrites(h.update)).toHaveLength(0);
  });

  test('Remove skip never asks either', async () => {
    const h = makeHarness({ raw: SKIPPABLE_NOTE });
    await render.act(async () => { await h.get().hook.handleSkipWeek(); });
    await render.act(async () => { await h.get().hook.handleUnskipWeek(); });

    expect(h.get().hook.skipWeekStatus).toBe('Skip removed');
    expectFullyWithdrawn(h.get().hook);
  });
});

// ── Gates ────────────────────────────────────────────────────────────────────

describe('gates: a prompt is only ever raised over a verified read the user owns', () => {
  test('row 1 — the feature toggle off means no detection, no prompt, no write', async () => {
    const h = makeHarness({ fatigueTrackingEnabled: false });
    await h.done();
    expectFullyWithdrawn(h.get().hook);
    expect(checkInWrites(h.update)).toHaveLength(0);
  });

  test('row 2 — a read still loading does not prompt', async () => {
    const h = makeHarness({ notesLoading: true });
    await h.done();
    expectFullyWithdrawn(h.get().hook);
  });

  test('TL-15 row 2 — a failed read does not prompt, and the session is eligible after a clean read', async () => {
    const h = makeHarness({ notesError: 'offline' });
    await h.done();
    expectFullyWithdrawn(h.get().hook);

    h.rerender({ notesError: null });
    await h.done();
    expect(h.get().hook.showCheckInModal).toBe(true);
  });

  test('row 4 — a deload note never prompts', async () => {
    const h = makeHarness({ note: { title: 'Deload · Routine' } });
    await h.done();
    expectFullyWithdrawn(h.get().hook);
  });

  test('row 6 — another modal owning the screen at the moment of raise stores no rough state at all', async () => {
    const h = makeHarness({ otherModalOwnsScreen: true });
    await h.done();
    expectFullyWithdrawn(h.get().hook);
    expect(checkInWrites(h.update)).toHaveLength(0);

    // Nothing was written, so the session is still eligible once the screen
    // is free.
    h.rerender({ otherModalOwnsScreen: false });
    expect(h.get().hook.showCheckInModal).toBe(false); // not resurrected on its own
    await h.done();
    expect(h.get().hook.showCheckInModal).toBe(true);
  });

  test('row 7 — a session that already has a record is never asked about again', async () => {
    const h = makeHarness({
      note: { session_checkins: { 2: { status: 'ok', responded_at: '2026-01-01T00:00:00.000Z' } } },
    });
    await h.done();
    expectFullyWithdrawn(h.get().hook);
  });
});

// ── Withdrawal (§3.3) ────────────────────────────────────────────────────────

describe('withdrawal is a state transition, not a visibility change', () => {
  async function raised(overrides) {
    const h = makeHarness(overrides);
    await h.done();
    expect(h.get().hook.showCheckInModal).toBe(true);
    return h;
  }

  test('toggling the feature off with the sheet open clears all five fields and writes nothing', async () => {
    const h = await raised();
    h.rerender({ fatigueTrackingEnabled: false });
    expectFullyWithdrawn(h.get().hook);
    expect(checkInWrites(h.update)).toHaveLength(0);
  });

  test('re-enabling the feature does not resurrect the sheet, but a later Done asks again', async () => {
    const h = await raised();
    h.rerender({ fatigueTrackingEnabled: false });
    h.rerender({ fatigueTrackingEnabled: true });
    expect(h.get().hook.showCheckInModal).toBe(false);
    expect(h.get().hook.roughCheckInData).toBeNull();

    await h.done();
    expect(h.get().hook.showCheckInModal).toBe(true);
  });

  test('the recovery-block modal taking the screen withdraws the sheet, and closing it does not bring it back', async () => {
    const h = await raised();
    h.rerender({ otherModalOwnsScreen: true });
    expectFullyWithdrawn(h.get().hook);
    expect(checkInWrites(h.update)).toHaveLength(0);

    h.rerender({ otherModalOwnsScreen: false });
    expect(h.get().hook.showCheckInModal).toBe(false);

    await h.done();
    expect(h.get().hook.showCheckInModal).toBe(true);
  });

  test('the add-week modal taking the screen withdraws it just the same', async () => {
    const h = await raised();
    // LogScreen derives one predicate from both modals (asserted below), so
    // this is the add-week half of the same transition.
    h.rerender({ otherModalOwnsScreen: true });
    expectFullyWithdrawn(h.get().hook);
    h.rerender({ otherModalOwnsScreen: false });
    expect(h.get().hook.showCheckInModal).toBe(false);
    expect(checkInWrites(h.update)).toHaveLength(0);
  });

  test('a read failing while the sheet is open withdraws it without writing', async () => {
    const h = await raised();
    h.rerender({ notesError: 'offline' });
    expectFullyWithdrawn(h.get().hook);
    expect(checkInWrites(h.update)).toHaveLength(0);
  });

  test('withdrawal never returns the editor to edit mode', async () => {
    const h = await raised();
    expect(h.get().hook.mode).toBe('read');
    h.rerender({ otherModalOwnsScreen: true });
    expect(h.get().hook.mode).toBe('read');
  });
});

// ── Cooldown (§4.2) ──────────────────────────────────────────────────────────

describe('cooldown: at most one prompt per three session indices', () => {
  // A record at `key`, as a prompt would have written it.
  const record = (key) => ({
    [key]: { status: 'ok', reasons: [], responded_at: '2026-01-01T00:00:00.000Z' },
  });

  // decliningNote(n) has its rough session at index n + 2.
  async function askedAtDistance(distance) {
    const extra = distance; // session index 2 + distance, last key at 2
    const h = makeHarness({
      raw: decliningNote(extra),
      note: { session_checkins: record(2) },
    });
    await h.done();
    return h;
  }

  test('distance 1 is inside the window: no prompt, but the exercises are still marked inline', async () => {
    const h = await askedAtDistance(1);
    expect(h.get().hook.showCheckInModal).toBe(false);
    expect(h.get().hook.roughCheckInData).toBeNull();
    // Only the interruption is withheld; the evidence stays visible.
    expect([...h.get().hook.roughFlaggedNames]).toEqual(['bench']);
    expect(h.get().hook.roughSessionIndex).toBe(3);
  });

  test('distance 2 is still inside the window', async () => {
    const h = await askedAtDistance(2);
    expect(h.get().hook.showCheckInModal).toBe(false);
    expect(h.get().hook.roughSessionIndex).toBe(4);
  });

  test('distance 3 is outside the window and asks', async () => {
    const h = await askedAtDistance(3);
    expect(h.get().hook.showCheckInModal).toBe(true);
    expect(h.get().hook.roughSessionIndex).toBe(5);
  });

  test('the window is measured from the last session ASKED about, not the last rough one', async () => {
    // Records at 0 and 2; the rough session is 4. The nearest key at or below
    // it is 2, so 4 − 2 = 2 → still silent even though session 3 was never
    // asked about.
    const h = makeHarness({
      raw: decliningNote(2),
      note: { session_checkins: { ...record(0), ...record(2) } },
    });
    await h.done();
    expect(h.get().hook.roughSessionIndex).toBe(4);
    expect(h.get().hook.showCheckInModal).toBe(false);
  });

  test('orphan keys above the current session are ignored, never consulted and never deleted', async () => {
    // Text was cut down or hand-edited, leaving a record above the deepest
    // column. It must not suppress the current session.
    const h = makeHarness({
      raw: decliningNote(),
      note: { session_checkins: record(7) },
    });
    await h.done();
    expect(h.get().hook.roughSessionIndex).toBe(2);
    expect(h.get().hook.showCheckInModal).toBe(true);
    // Reading the map is not editing it.
    expect(checkInWrites(h.update)).toHaveLength(0);
  });

  test('after Remove skip re-keys the records, the cooldown reads the re-keyed map', async () => {
    // Three sessions of real work plus a skipped fourth column, with a record
    // at that skipped column (3) and one at 0. Removing the skip drops key 3;
    // key 0 survives, so the now-deepest session 2 is 2 away and stays silent.
    const raw = 'Monday\n-Bench\n185 8,8,8\n185 8,8,8\n185 4,4,3\n-';
    const h = makeHarness({
      raw,
      note: {
        session_checkins: { ...record(0), ...record(3) },
        // An outstanding 'Skip week' press, so removal needs no confirmation.
        skip_markers: { universal_skip_count: 1 },
      },
    });

    await render.act(async () => { await h.get().hook.handleUnskipWeek(); });

    const patch = h.update.mock.calls.map(([, p]) => p).filter(p => p.session_checkins).pop();
    expect(Object.keys(patch.session_checkins)).toEqual(['0']);
  });
});

// ── Screen wiring ────────────────────────────────────────────────────────────
// There is no ownership manager in the app: the check-in, the recovery-block
// modal and the add-week modal are sibling <Modal>s. Ownership is therefore a
// predicate LogScreen derives from the two state variables it already keeps,
// and it has to reach the hook — a render-side gate alone would leave the
// prompt state set and let the sheet return.

describe('LogScreen supplies the ownership predicate and the toggle gate', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../screens/LogScreen.js'), 'utf8'
  );

  test('ownership covers both the recovery-block modal and the add-week modal', () => {
    expect(src).toMatch(/const otherModalOwnsScreen = !!recoveryModal \|\| addWeekModalOpen;/);
  });

  test('the predicate and the verified-read state are passed into the editor hook', () => {
    const hookCall = src.slice(
      src.indexOf('useLogCurrentRoutineEditor({'),
      src.indexOf('const deloadEditor')
    );
    expect(hookCall).toContain('otherModalOwnsScreen');
    expect(hookCall).toContain('notesLoading');
    expect(hookCall).toContain('notesError');
    expect(hookCall).toContain('fatigueTrackingEnabled');
  });

  test('the Log check-in modal is gated on the feature toggle, as the Analytics one is', () => {
    expect(src).toMatch(/visible=\{fatigueTrackingEnabled && currentEditor\.showCheckInModal\}/);
  });
});

// ── The deload-gauge coupling, asserted rather than compensated for ──────────

describe('fewer prompts means fewer dated sessions, and that is the shipped fallback', () => {
  const deloadHistory = [{ completed_at: '2026-01-10T00:00:00.000Z', session_count: 4 }];

  test('a session that was prompted and answered dates itself, and the gauge counts from there', () => {
    const note = {
      session_checkins: {
        3: { status: 'ok', responded_at: '2026-01-09T12:00:00.000Z' },
        4: { status: null, responded_at: '2026-01-12T12:00:00.000Z' },
      },
    };
    const dateMap = sessionDateMapFromNote(note);
    expect(dateMap.size).toBe(2);
    // Session 3 is the last one on or before the deload day, so sessions 4+
    // are the ones since.
    expect(sessionsSinceLastDeload(6, deloadHistory, dateMap)).toBe(2);
  });

  test('a never-prompted note has no dates and falls back to the stored session_count', () => {
    const dateMap = sessionDateMapFromNote({ session_checkins: {} });
    expect(dateMap.size).toBe(0);
    expect(sessionsSinceLastDeload(6, deloadHistory, dateMap)).toBe(2);
  });

  test('a dismissal still dates its session, so dismissing is not the same as never asking', () => {
    const dismissed = { session_checkins: { 3: { status: null, responded_at: '2026-01-09T12:00:00.000Z' } } };
    expect(sessionDateMapFromNote(dismissed).get(3)).toBe('2026-01-09');
  });
});
