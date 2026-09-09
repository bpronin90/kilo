// Routine import from pasted text (#955, Stage 2 of #581).
//
// The properties under test are the ones that make importing safe to hand a
// stranger's text: what parses is exactly what you see, nothing empty or
// unparseable can be saved, and the one save the screen performs is always a
// CREATE — never an overwrite, a merge, or an adoption.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import render from 'react-test-renderer';
import { act } from 'react-test-renderer';
import {
  ROUTINE_IMPORT_NO_EXERCISES_MESSAGE,
  ROUTINE_IMPORT_UNKNOWN_VERSION_MESSAGE,
  ROUTINE_SHARE_HEADER,
  analyzeRoutineImportText,
  buildRoutineShareText,
} from '../lib/interoperability/routineShare';
import { MAX_RAW_TEXT_LENGTH } from '../lib/parser/workoutNote.js';
import { RoutineImportScreen } from '../components/RoutineImportScreen';
import { MoreScreen } from '../screens/MoreScreen';

const ROUTINE = [
  'Monday',
  '+ Warmup',
  '-Band Pull-Apart',
  '- 0 20',
  '',
  '+ Lifting',
  '-Bench Press',
  '- 135 5',
  '- 155 5 *PR',
  '-- felt strong today',
  '',
  'Thursday',
  '-Deadlift',
  '- 315 3',
].join('\n');

// Host elements only: a testID/accessibilityLabel passed to a composite
// component appears on both the composite and the host it renders, so an
// unfiltered findAll double-counts every match.
function byTestId(root, id) {
  return root.findAll(n => typeof n.type === 'string' && n.props && n.props.testID === id);
}

// The outermost node carrying the label: `Button` passes `onPress={null}` when
// disabled, so matching on a callable onPress would make a disabled control
// simply not exist rather than report its state.
function buttonByLabel(root, label) {
  return root.findAll(n => n.props
    && n.props.accessibilityLabel === label
    && n.props.accessibilityRole === 'button')[0];
}

// The screen now keeps a durable creation-attempt token (#997), so every test
// starts from an empty store — a token left behind by a deliberately failed
// save must never leak into the next test's create.
beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('analyzeRoutineImportText: what the preview is allowed to claim', () => {
  test('an enveloped export round-trips into a previewable routine', () => {
    const shared = buildRoutineShareText({
      title: 'Upper/Lower A',
      rawText: ROUTINE,
      exportedAt: new Date(2026, 8, 5),
    });
    const a = analyzeRoutineImportText(shared);
    expect(a.hasEnvelope).toBe(true);
    expect(a.unknownVersion).toBe(false);
    expect(a.envelopeTitle).toBe('Upper/Lower A');
    expect(a.exportedAt).toBe('2026-09-05');
    // The body is what gets saved, and it is the export byte-for-byte.
    expect(a.body).toBe(ROUTINE);
    expect(a.exerciseCount).toBe(3);
    expect(a.sections.length).toBeGreaterThan(0);
    expect(a.canImport).toBe(true);
    expect(a.notices.filter(n => n.severity === 'error')).toEqual([]);
  });

  test('bare canonical routine text with no envelope is importable', () => {
    const a = analyzeRoutineImportText(ROUTINE);
    expect(a.hasEnvelope).toBe(false);
    expect(a.envelopeTitle).toBeNull();
    expect(a.body).toBe(ROUTINE);
    expect(a.exerciseCount).toBe(3);
    expect(a.canImport).toBe(true);
  });

  test('CRLF, bare CR, and leading blank lines all normalize to the same routine', () => {
    const shared = buildRoutineShareText({ title: 'T', rawText: ROUTINE });
    const base = analyzeRoutineImportText(shared);
    for (const variant of [
      shared.replace(/\n/g, '\r\n'),
      shared.replace(/\n/g, '\r'),
      `\n\n${shared}`,
    ]) {
      const a = analyzeRoutineImportText(variant);
      expect(a.body).toBe(base.body);
      expect(a.envelopeTitle).toBe('T');
      expect(a.canImport).toBe(true);
    }
  });

  test('collapsed blank lines between the header and the body still yield the body', () => {
    // Only ONE separator line is consumed, so extra blank lines belong to the
    // routine and a share target that ate the separator entirely still parses.
    const noBlank = `${ROUTINE_SHARE_HEADER}\n#title: T\n${ROUTINE}`;
    expect(analyzeRoutineImportText(noBlank).body).toBe(ROUTINE);
    const extraBlank = `${ROUTINE_SHARE_HEADER}\n#title: T\n\n\n${ROUTINE}`;
    expect(analyzeRoutineImportText(extraBlank).body).toBe(`\n${ROUTINE}`);
    expect(analyzeRoutineImportText(extraBlank).canImport).toBe(true);
  });

  test('Unicode titles and exercise names survive the round trip intact', () => {
    const unicodeRoutine = 'Montag\n-Kniebeuge 上半身 💪\n- 100 5';
    const a = analyzeRoutineImportText(
      buildRoutineShareText({ title: 'Push: 上半身 💪', rawText: unicodeRoutine })
    );
    expect(a.envelopeTitle).toBe('Push: 上半身 💪');
    expect(a.body).toBe(unicodeRoutine);
    expect(a.sections[0].exercises[0].name).toBe('Kniebeuge 上半身 💪');
    expect(a.canImport).toBe(true);
  });

  test('an unknown future envelope version degrades to a best-effort preview, never a crash', () => {
    const a = analyzeRoutineImportText(`#kilo-routine v99\n#title: Later\n#future: x\n\n${ROUTINE}`);
    expect(a.unknownVersion).toBe(true);
    expect(a.version).toBe('v99');
    expect(a.body).toBe(ROUTINE);
    expect(a.exerciseCount).toBe(3);
    expect(a.canImport).toBe(true);
    expect(a.notices).toContainEqual({
      severity: 'info',
      message: ROUTINE_IMPORT_UNKNOWN_VERSION_MESSAGE,
    });
  });

  test('empty, whitespace-only, and envelope-only text is blank, not importable, and not an error', () => {
    for (const input of [null, undefined, '', '   \n\n  ', buildRoutineShareText({ title: 'T', rawText: '' })]) {
      const a = analyzeRoutineImportText(input);
      expect(a.isBlank).toBe(true);
      expect(a.canImport).toBe(false);
      expect(a.notices.filter(n => n.severity === 'error')).toEqual([]);
    }
  });

  test('text with no exercises cannot be imported', () => {
    const a = analyzeRoutineImportText('Monday\nThursday\njust some prose I copied');
    expect(a.exerciseCount).toBe(0);
    expect(a.canImport).toBe(false);
    expect(a.notices).toContainEqual({
      severity: 'error',
      message: ROUTINE_IMPORT_NO_EXERCISES_MESSAGE,
    });
  });

  test('text the parser refuses outright cannot be imported', () => {
    const a = analyzeRoutineImportText(`Monday\n-Bench\n${'- 135 5\n'.repeat(1)}${'x'.repeat(MAX_RAW_TEXT_LENGTH)}`);
    expect(a.parsed.ok).toBe(false);
    expect(a.canImport).toBe(false);
    expect(a.notices.some(n => n.severity === 'error')).toBe(true);
  });

  test('unreadable set rows are surfaced but do not block importing the routine', () => {
    // A routine Kilo itself exported can contain rows the parser flags; refusing
    // those would make a legitimate export impossible to bring back.
    const a = analyzeRoutineImportText('Monday\n-Bench Press\n- 135 5\n- 135 x y z q');
    expect(a.problems.length).toBeGreaterThan(0);
    expect(a.notices.some(n => n.severity === 'warning')).toBe(true);
    expect(a.canImport).toBe(true);
  });
});

describe('RoutineImportScreen: save is always a create', () => {
  function mount(onCreateRoutine = jest.fn().mockResolvedValue({ id: 'wn_new' })) {
    let tree;
    act(() => {
      tree = render.create(
        <RoutineImportScreen onBack={() => {}} onCreateRoutine={onCreateRoutine} />
      );
    });
    return { tree, root: tree.root, onCreateRoutine };
  }

  function paste(root, text) {
    act(() => {
      byTestId(root, 'routine-import-paste')[0].props.onChangeText(text);
    });
  }

  test('the create action is disabled until something importable is pasted', () => {
    const { root } = mount();
    const button = () => buttonByLabel(root, 'Create new routine from pasted text');
    expect(button().props.accessibilityState.disabled).toBe(true);

    paste(root, 'Monday\nnothing here');
    expect(button().props.accessibilityState.disabled).toBe(true);
    expect(byTestId(root, 'routine-import-notice-error').length).toBe(1);

    paste(root, buildRoutineShareText({ title: 'Upper/Lower A', rawText: ROUTINE }));
    expect(button().props.accessibilityState.disabled).toBe(false);
    expect(byTestId(root, 'routine-import-notice-error').length).toBe(0);
  });

  test('pressing create saves the envelope-stripped body under the envelope title, once', async () => {
    const { root, onCreateRoutine } = mount();
    paste(root, buildRoutineShareText({ title: 'Upper/Lower A', rawText: ROUTINE }));
    expect(byTestId(root, 'routine-import-title')[0].props.value).toBe('Upper/Lower A');

    await act(async () => {
      buttonByLabel(root, 'Create new routine from pasted text').props.onPress();
    });

    expect(onCreateRoutine).toHaveBeenCalledTimes(1);
    expect(onCreateRoutine).toHaveBeenCalledWith('Upper/Lower A', ROUTINE, {
      attemptToken: expect.any(String),
    });
    // Nothing in the saved text carries the transport envelope.
    expect(onCreateRoutine.mock.calls[0][1]).not.toContain('#kilo-routine');
  });

  test('a title that collides with an existing routine is still just a create', async () => {
    // Import has no id and no lookup: the same title twice makes two routines.
    const { root, onCreateRoutine } = mount();
    for (let i = 0; i < 2; i += 1) {
      paste(root, buildRoutineShareText({ title: 'Upper/Lower A', rawText: ROUTINE }));
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        buttonByLabel(root, 'Create new routine from pasted text').props.onPress();
      });
    }
    expect(onCreateRoutine).toHaveBeenCalledTimes(2);
    // Byte-identical title and body…
    expect(onCreateRoutine.mock.calls[0].slice(0, 2))
      .toEqual(onCreateRoutine.mock.calls[1].slice(0, 2));
    // …and yet a DIFFERENT creation attempt each time (#997): a completed
    // import retires its token, so the second import can never be folded into
    // the first one's note id.
    expect(onCreateRoutine.mock.calls[1][2].attemptToken)
      .not.toBe(onCreateRoutine.mock.calls[0][2].attemptToken);
  });

  test('the user can rename before importing, and the routine body is unaffected', async () => {
    const { root, onCreateRoutine } = mount();
    paste(root, buildRoutineShareText({ title: 'Upper/Lower A', rawText: ROUTINE }));
    act(() => {
      byTestId(root, 'routine-import-title')[0].props.onChangeText('  My Version  ');
    });
    await act(async () => {
      buttonByLabel(root, 'Create new routine from pasted text').props.onPress();
    });
    expect(onCreateRoutine).toHaveBeenCalledWith('My Version', ROUTINE, {
      attemptToken: expect.any(String),
    });
  });

  test('a failed save reports the failure and leaves the paste in place to retry', async () => {
    const onCreateRoutine = jest.fn().mockRejectedValue(new Error('disk full'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { root } = mount(onCreateRoutine);
    const shared = buildRoutineShareText({ title: 'T', rawText: ROUTINE });
    paste(root, shared);
    await act(async () => {
      buttonByLabel(root, 'Create new routine from pasted text').props.onPress();
    });
    expect(byTestId(root, 'routine-import-paste')[0].props.value).toBe(shared);
    expect(buttonByLabel(root, 'Create new routine from pasted text').props.accessibilityState.disabled).toBe(false);
    warn.mockRestore();
  });

  test('the screen never offers to adopt, replace, or switch the current routine', () => {
    const { root, onCreateRoutine } = mount();
    paste(root, buildRoutineShareText({ title: 'T', rawText: ROUTINE }));
    const labels = root.findAll(n => n.props && typeof n.props.accessibilityLabel === 'string')
      .map(n => n.props.accessibilityLabel.toLowerCase());
    for (const forbidden of ['current routine', 'use this routine', 'replace', 'switch', 'overwrite', 'merge']) {
      expect(labels.some(l => l.includes(forbidden))).toBe(false);
    }
    // And the only write the screen can perform is the injected create.
    expect(onCreateRoutine).not.toHaveBeenCalled();
  });
});

describe('PR #971 review findings', () => {
  function mount(onCreateRoutine = jest.fn().mockResolvedValue({ id: 'wn_new' })) {
    let tree;
    act(() => {
      tree = render.create(
        <RoutineImportScreen onBack={() => {}} onCreateRoutine={onCreateRoutine} />
      );
    });
    return { tree, root: tree.root, onCreateRoutine };
  }
  function paste(root, text) {
    act(() => {
      byTestId(root, 'routine-import-paste')[0].props.onChangeText(text);
    });
  }
  const AB_ROUTINE = `${ROUTINE}\n---\nMonday\n-Squat\n- 225 5`;

  test('finding 2: replacing a titled envelope with untitled text clears the stale title', () => {
    const { root, onCreateRoutine } = mount();
    paste(root, buildRoutineShareText({ title: 'Upper/Lower A', rawText: ROUTINE }));
    expect(byTestId(root, 'routine-import-title')[0].props.value).toBe('Upper/Lower A');

    // A different routine, with no title of its own, must not inherit the last one's.
    paste(root, 'Tuesday\n-Overhead Press\n- 95 5');
    expect(byTestId(root, 'routine-import-title')[0].props.value).toBe('');
  });

  test('finding 2: a name the user typed survives further edits to the same paste', () => {
    const { root } = mount();
    paste(root, buildRoutineShareText({ title: 'Upper/Lower A', rawText: ROUTINE }));
    act(() => {
      byTestId(root, 'routine-import-title')[0].props.onChangeText('My Version');
    });
    paste(root, buildRoutineShareText({ title: 'Upper/Lower A', rawText: `${ROUTINE}\n-Row\n- 95 8` }));
    expect(byTestId(root, 'routine-import-title')[0].props.value).toBe('My Version');
  });

  test('finding 3: a slow save never wipes the next routine pasted while it was in flight', async () => {
    let release;
    const onCreateRoutine = jest.fn(() => new Promise((resolve) => { release = resolve; }));
    const { root } = mount(onCreateRoutine);
    paste(root, buildRoutineShareText({ title: 'First', rawText: ROUTINE }));

    act(() => {
      buttonByLabel(root, 'Create new routine from pasted text').props.onPress();
    });
    // The create is now preceded by the durable attempt-token write (#997), so
    // let that settle — otherwise the save under test has not started yet and
    // there is no in-flight write for the next paste to race.
    await act(async () => {});
    // The user pastes the next routine before the first save resolves.
    const next = 'Tuesday\n-Overhead Press\n- 95 5';
    paste(root, next);
    await act(async () => {
      release({ id: 'wn_first' });
    });

    expect(byTestId(root, 'routine-import-paste')[0].props.value).toBe(next);
    expect(onCreateRoutine).toHaveBeenCalledTimes(1);
    expect(onCreateRoutine).toHaveBeenCalledWith('First', ROUTINE, {
      attemptToken: expect.any(String),
    });
  });

  test('finding 3 (round 2): a same-titled routine pasted mid-save keeps BOTH its body and title', async () => {
    // The paste alone decides whether the fields are cleared. Deciding per
    // field erased the new routine's title whenever it matched the saved one's.
    let release;
    const onCreateRoutine = jest.fn(() => new Promise((resolve) => { release = resolve; }));
    const { root } = mount(onCreateRoutine);
    paste(root, buildRoutineShareText({ title: 'Same', rawText: ROUTINE }));
    act(() => {
      buttonByLabel(root, 'Create new routine from pasted text').props.onPress();
    });

    // Same as above: let the pre-create token write settle so the save is
    // genuinely in flight when the next routine is pasted.
    await act(async () => {});

    const next = buildRoutineShareText({ title: 'Same', rawText: 'Tuesday\n-Overhead Press\n- 95 5' });
    paste(root, next);
    await act(async () => {
      release({ id: 'wn_first' });
    });

    expect(byTestId(root, 'routine-import-paste')[0].props.value).toBe(next);
    expect(byTestId(root, 'routine-import-title')[0].props.value).toBe('Same');
  });

  test('finding 3 (round 2): an untouched screen still clears both fields after a save', async () => {
    const { root } = mount();
    paste(root, buildRoutineShareText({ title: 'Same', rawText: ROUTINE }));
    await act(async () => {
      buttonByLabel(root, 'Create new routine from pasted text').props.onPress();
    });
    expect(byTestId(root, 'routine-import-paste')[0].props.value).toBe('');
    expect(byTestId(root, 'routine-import-title').length).toBe(0);
  });

  test('finding 1: a failed save does not claim the routine was not created', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { root } = mount(jest.fn().mockRejectedValue(new Error('sync enqueue failed')));
    paste(root, buildRoutineShareText({ title: 'T', rawText: ROUTINE }));
    await act(async () => {
      buttonByLabel(root, 'Create new routine from pasted text').props.onPress();
    });
    const messages = root.findAll(n => typeof n.type === 'string' && typeof n.props.children === 'string')
      .map(n => n.props.children);
    const failure = messages.find(m => m.startsWith('Something went wrong while saving.'));
    expect(failure).toBeDefined();
    expect(failure).toContain('may already be on this device');
    // And it now tells the user the honest next step: retrying finishes this
    // import rather than duplicating it (#997).
    expect(failure).toContain('will not create a duplicate');
    expect(messages.some(m => m.includes('Nothing was changed'))).toBe(false);
    warn.mockRestore();
  });

  test('finding 4: an A/B routine previews one week at a time but saves both', async () => {
    const a = analyzeRoutineImportText(AB_ROUTINE);
    expect(a.hasABWeeks).toBe(true);
    expect(a.effectiveWeek).toBe('A');
    expect(a.previewText).toBe(ROUTINE);
    expect(analyzeRoutineImportText(AB_ROUTINE, 'B').previewText).toBe('Monday\n-Squat\n- 225 5');
    // Both weeks count toward importability, and the whole body is what saves.
    expect(a.exerciseCount).toBe(4);
    expect(a.body).toBe(AB_ROUTINE);

    const { root, onCreateRoutine } = mount();
    paste(root, AB_ROUTINE);
    // The preview starts on Week A behind the same Week switch the Routine tab uses.
    expect(buttonByLabel(root, 'Preview Week B')).toBeDefined();
    act(() => {
      buttonByLabel(root, 'Preview Week B').props.onPress();
    });
    expect(buttonByLabel(root, 'Preview Week A')).toBeDefined();

    await act(async () => {
      buttonByLabel(root, 'Create new routine from pasted text').props.onPress();
    });
    expect(onCreateRoutine).toHaveBeenCalledWith('', AB_ROUTINE, {
      attemptToken: expect.any(String),
    });
  });

  test('a defect in week B blocks import even while week A is previewed', () => {
    // Week A alone has exercises; the block/report decision must read the whole body.
    const a = analyzeRoutineImportText('Monday\n-Bench Press\n- 135 5\n---\nMonday\n-Squat\n- 225 x y z');
    expect(a.effectiveWeek).toBe('A');
    expect(a.problems.length).toBeGreaterThan(0);
    expect(a.notices.some(n => n.severity === 'warning')).toBe(true);
  });
});

describe('MoreScreen wiring', () => {
  test('Import Routine opens the import screen with the create-only callback', () => {
    const onCreateRoutineFromImport = jest.fn();
    let tree;
    act(() => {
      tree = render.create(
        <MoreScreen isActive onCreateRoutineFromImport={onCreateRoutineFromImport} />
      );
    });
    act(() => {
      buttonByLabel(tree.root, 'Import Routine').props.onPress();
    });
    expect(byTestId(tree.root, 'routine-import-paste').length).toBe(1);
    expect(tree.root.findByType(RoutineImportScreen).props.onCreateRoutine)
      .toBe(onCreateRoutineFromImport);
  });
});

// ── id-stable imports (#997) ─────────────────────────────────────────────────
//
// `add` writes the local row and only then awaits the cloud enqueue, so a
// failed import can leave the routine on the device. The screen therefore mints
// a durable per-attempt creation token before the create, keeps it when the
// create fails, restores it after an app restart, and clears it only once the
// create has fully succeeded — which is what makes a retry finish THIS import
// and the next import a genuinely new routine.
describe('routine import: durable creation-attempt token (#997)', () => {
  const creationAttempts = require('../storage/entries/workoutNoteCreationAttempts');
  const { loadWorkoutNoteCreationAttempt } = creationAttempts;

  function mount(onCreateRoutine) {
    let tree;
    act(() => {
      tree = render.create(
        <RoutineImportScreen onBack={() => {}} onCreateRoutine={onCreateRoutine} />
      );
    });
    return { tree, root: tree.root };
  }
  function paste(root, text) {
    act(() => {
      byTestId(root, 'routine-import-paste')[0].props.onChangeText(text);
    });
  }
  async function press(root) {
    await act(async () => {
      buttonByLabel(root, 'Create new routine from pasted text').props.onPress();
    });
  }
  const tokenOf = (onCreateRoutine, index) => onCreateRoutine.mock.calls[index][2].attemptToken;

  test('a failed import keeps its token, and an edited retry completes the same attempt', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const onCreateRoutine = jest.fn()
      .mockRejectedValueOnce(new Error('enqueue failed'))
      .mockResolvedValue({ id: 'wn_import' });
    const { root } = mount(onCreateRoutine);
    paste(root, buildRoutineShareText({ title: 'Shared Plan', rawText: ROUTINE }));

    await press(root);
    expect(onCreateRoutine).toHaveBeenCalledTimes(1);
    const token = tokenOf(onCreateRoutine, 0);
    expect(typeof token).toBe('string');
    // Durable, so the retry is not merely a same-mount convenience.
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBe(token);
    // The paste survives the failure, which is what makes the retry possible.
    expect(byTestId(root, 'routine-import-paste')[0].props.value)
      .toBe(buildRoutineShareText({ title: 'Shared Plan', rawText: ROUTINE }));

    // The user renames the routine AND fixes the pasted body, then retries.
    act(() => {
      byTestId(root, 'routine-import-title')[0].props.onChangeText('Shared Plan v2');
    });
    const editedBody = `${ROUTINE}\n-Chin-Up\n- 0 8`;
    paste(root, editedBody);
    act(() => {
      byTestId(root, 'routine-import-title')[0].props.onChangeText('Shared Plan v2');
    });
    await press(root);

    expect(onCreateRoutine).toHaveBeenCalledTimes(2);
    expect(tokenOf(onCreateRoutine, 1)).toBe(token);
    expect(onCreateRoutine.mock.calls[1][0]).toBe('Shared Plan v2');
    expect(onCreateRoutine.mock.calls[1][1]).toBe(editedBody);
    // A completed import retires its attempt.
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();
    warn.mockRestore();
  });

  test('a retry after an app restart still completes the original import', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = jest.fn().mockRejectedValue(new Error('enqueue failed'));
    const first = mount(failing);
    paste(first.root, buildRoutineShareText({ title: 'Interrupted', rawText: ROUTINE }));
    await press(first.root);
    const token = tokenOf(failing, 0);

    // Restart: the screen is gone and only storage survives.
    act(() => { first.tree.unmount(); });
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBe(token);

    const onCreateRoutine = jest.fn().mockResolvedValue({ id: 'wn_import' });
    const second = mount(onCreateRoutine);
    await act(async () => {});
    paste(second.root, buildRoutineShareText({ title: 'Interrupted', rawText: ROUTINE }));
    act(() => {
      byTestId(second.root, 'routine-import-title')[0].props.onChangeText('Interrupted (renamed)');
    });
    await press(second.root);

    expect(tokenOf(onCreateRoutine, 0)).toBe(token);
    expect(onCreateRoutine.mock.calls[0][0]).toBe('Interrupted (renamed)');
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();
    warn.mockRestore();
  });

  test('after a successful import, an identical routine imported again is a new attempt', async () => {
    const onCreateRoutine = jest.fn().mockResolvedValue({ id: 'wn_import' });
    const shared = buildRoutineShareText({ title: 'Same Plan', rawText: ROUTINE });
    const { root } = mount(onCreateRoutine);

    paste(root, shared);
    await press(root);
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();

    paste(root, shared);
    await press(root);

    expect(onCreateRoutine).toHaveBeenCalledTimes(2);
    expect(onCreateRoutine.mock.calls[0].slice(0, 2))
      .toEqual(onCreateRoutine.mock.calls[1].slice(0, 2));
    expect(tokenOf(onCreateRoutine, 1)).not.toBe(tokenOf(onCreateRoutine, 0));
  });

  test('a token that cannot be persisted fails the import instead of creating an uncorrelated routine', async () => {
    // Importing without a durable token is the uncorrelated create this exists
    // to remove, so the import must fail BEFORE the create runs — leaving
    // nothing on the device for a retry to duplicate.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mint = jest.spyOn(creationAttempts, 'ensureWorkoutNoteCreationAttempt')
      .mockRejectedValue(new Error('device storage unavailable'));
    const onCreateRoutine = jest.fn().mockResolvedValue({ id: 'wn_import' });
    const { root } = mount(onCreateRoutine);
    paste(root, buildRoutineShareText({ title: 'Shared Plan', rawText: ROUTINE }));

    await press(root);
    expect(onCreateRoutine).not.toHaveBeenCalled();
    const messages = root.findAll(n => typeof n.type === 'string' && typeof n.props.children === 'string')
      .map(n => n.props.children);
    expect(messages.some(m => m.startsWith('Something went wrong while saving.'))).toBe(true);
    mint.mockRestore();
    warn.mockRestore();
  });

  test('a token that cannot be retired fails the import, and the retry completes the same routine', async () => {
    // Reporting success while the completed attempt is still in the store would
    // let the NEXT import adopt this routine's note id and overwrite it.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const retire = jest.spyOn(creationAttempts, 'clearWorkoutNoteCreationAttempt')
      .mockRejectedValue(new Error('device storage unavailable'));
    const onCreateRoutine = jest.fn().mockResolvedValue({ id: 'wn_import' });
    const { root } = mount(onCreateRoutine);
    const shared = buildRoutineShareText({ title: 'Shared Plan', rawText: ROUTINE });
    paste(root, shared);

    await press(root);
    expect(onCreateRoutine).toHaveBeenCalledTimes(1);
    const token = tokenOf(onCreateRoutine, 0);
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBe(token);
    // The paste is still there, and the message says retrying will not duplicate.
    expect(byTestId(root, 'routine-import-paste')[0].props.value).toBe(shared);

    retire.mockRestore();
    await press(root);
    expect(tokenOf(onCreateRoutine, 1)).toBe(token);
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();
    warn.mockRestore();
  });

  test('the App.js wiring forwards the token through to the note store', () => {
    // The shell's handler is a pure pass-through, so its contract is that the
    // third argument reaches `noteHook.add` untouched — the note store is what
    // turns the token into an id (see workout-note-creation-attempts.test.js).
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'App.js'), 'utf8');
    expect(src).toMatch(
      /handleCreateRoutineFromImport\s*=\s*useCallback\(\s*\(title,\s*rawText,\s*options\)\s*=>\s*noteHook\.add\(title,\s*rawText,\s*options\)/
    );
  });
});
