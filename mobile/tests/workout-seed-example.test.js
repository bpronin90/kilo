// Empty-note seed example (#785, R6b-1 — parent #781).
//
// An empty editor shows the four-line WORKOUT_SEED_EXAMPLE_TEXT below the
// input; one tap inserts it verbatim with the caret at the end and hides the
// block; emptying the note restores it. Deliberately kept separate from
// WORKOUT_SYNTAX_EXAMPLE_TEXT (the seven-line teaching example), and never
// wired into the deload editor.

import React from 'react';
import renderer from 'react-test-renderer';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';
import {
  WORKOUT_SEED_EXAMPLE_TEXT,
  WORKOUT_SYNTAX_EXAMPLE_LINES,
  WORKOUT_SYNTAX_EXAMPLE_TEXT,
} from '../components/WorkoutSyntaxReference';
import { parseWorkoutNote } from '../lib/parser';

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

const noop = () => {};

function findByText(root, text) {
  return root.findAll(n => {
    if (n.type !== 'Text') return false;
    const children = n.props.children;
    const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
    return flat === text;
  });
}

function hasText(root, text) {
  return root.findAll(n => {
    if (n.type !== 'Text') return false;
    const children = n.props.children;
    const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
    return flat.includes(text);
  }).length > 0;
}

function findSeedButton(root) {
  return root.findAll(
    n => n.props && n.props.accessibilityLabel === 'Insert example workout note'
      && typeof n.props.onPress === 'function'
  )[0] || null;
}

// Current-routine editor: no editingNoteId, driven by activeEditText /
// handleCurrentTextChange (the "no note open yet" slot).
function CurrentRoutineHarness(props) {
  const [text, setText] = React.useState(props.initialText ?? '');
  return (
    <LogScreenEditorCard
      deloadMode={null}
      isEditingDeloadNote={false}
      editingNoteId={null}
      currentId="cur1"
      activeEditText={text}
      handleCurrentTextChange={setText}
      editingText=""
      setEditingText={noop}
      workoutNoteTitle="Push Day"
      setWorkoutNoteTitle={noop}
      editingTitle=""
      setEditingTitle={noop}
      handleSave={noop}
      isSaving={false}
      noteIsSaving={false}
      handleSaveOtherNote={noop}
      handleSwitchCurrent={noop}
      handleDeleteRoutine={noop}
      handleDeleteDeloadNoteFromEditor={noop}
      {...props}
    />
  );
}

// Other-routine (new/backlog) editor: editingNoteId set, driven by
// editingText / setEditingText.
function OtherRoutineHarness(props) {
  const [text, setText] = React.useState(props.initialText ?? '');
  return (
    <LogScreenEditorCard
      deloadMode={null}
      isEditingDeloadNote={false}
      editingNoteId="new"
      currentId={null}
      activeEditText=""
      handleCurrentTextChange={noop}
      editingText={text}
      setEditingText={setText}
      workoutNoteTitle=""
      setWorkoutNoteTitle={noop}
      editingTitle="Backlog"
      setEditingTitle={noop}
      handleSave={noop}
      isSaving={false}
      noteIsSaving={false}
      handleSaveOtherNote={noop}
      handleSwitchCurrent={noop}
      handleDeleteRoutine={noop}
      handleDeleteDeloadNoteFromEditor={noop}
      {...props}
    />
  );
}

function DeloadHarness(props) {
  const [text, setText] = React.useState(props.initialText ?? '');
  return (
    <LogScreenEditorCard
      deloadMode="edit"
      deloadEditText={text}
      setDeloadEditText={setText}
      handleSaveDeload={noop}
      isSaving={false}
      handleDeleteDeloadNoteFromEditor={noop}
      handleDeleteRoutine={noop}
      handleSave={noop}
      noteIsSaving={false}
      handleSaveOtherNote={noop}
      handleSwitchCurrent={noop}
      {...props}
    />
  );
}

describe('empty workout note seed example (#785)', () => {
  test('an initially empty current-routine editor shows the four-line seed', () => {
    let component;
    renderer.act(() => { component = renderer.create(<CurrentRoutineHarness />); });
    const root = component.root;
    expect(findSeedButton(root)).toBeTruthy();
    for (const line of WORKOUT_SEED_EXAMPLE_TEXT.split('\n')) {
      expect(hasText(root, line)).toBe(true);
    }
  });

  test('a note emptied by deletion restores the seed block', () => {
    let component;
    renderer.act(() => { component = renderer.create(<CurrentRoutineHarness initialText="Monday" />); });
    const root = component.root;
    expect(findSeedButton(root)).toBeNull();

    const input = root.findAll(n => n.props && n.props.multiline === true && n.props.placeholder)[0];
    renderer.act(() => { input.props.onChangeText(''); });
    expect(findSeedButton(root)).toBeTruthy();
  });

  test('a whitespace-only note is treated as empty and shows the seed', () => {
    let component;
    renderer.act(() => { component = renderer.create(<CurrentRoutineHarness initialText={'   \n  '} />); });
    expect(findSeedButton(component.root)).toBeTruthy();
  });

  test('one tap inserts the seed verbatim, places the caret at the end, and hides the block', () => {
    let component;
    renderer.act(() => { component = renderer.create(<CurrentRoutineHarness />); });
    const root = component.root;

    renderer.act(() => { findSeedButton(root).props.onPress(); });

    const input = root.findAll(n => n.props && n.props.multiline === true && n.props.placeholder)[0];
    expect(input.props.value).toBe(WORKOUT_SEED_EXAMPLE_TEXT);
    expect(input.props.selection).toEqual({
      start: WORKOUT_SEED_EXAMPLE_TEXT.length,
      end: WORKOUT_SEED_EXAMPLE_TEXT.length,
    });
    expect(findSeedButton(root)).toBeNull();
  });

  test('tap then undo (clearing the draft back to empty) brings the seed block back', () => {
    let component;
    renderer.act(() => { component = renderer.create(<CurrentRoutineHarness />); });
    const root = component.root;

    renderer.act(() => { findSeedButton(root).props.onPress(); });
    let input = root.findAll(n => n.props && n.props.multiline === true && n.props.placeholder)[0];
    expect(input.props.value).toBe(WORKOUT_SEED_EXAMPLE_TEXT);

    renderer.act(() => { input.props.onChangeText(''); });
    input = root.findAll(n => n.props && n.props.multiline === true && n.props.placeholder)[0];
    expect(input.props.value).toBe('');
    expect(input.props.selection).toBeUndefined();
    expect(findSeedButton(root)).toBeTruthy();
  });

  test('tap then immediate navigation away — the constant is stable to re-derive from, no crash on unmount', () => {
    let component;
    renderer.act(() => { component = renderer.create(<CurrentRoutineHarness />); });
    renderer.act(() => { findSeedButton(component.root).props.onPress(); });
    expect(() => renderer.act(() => { component.unmount(); })).not.toThrow();
  });

  test('the other-routine (new/backlog) editor gets the same seed behavior', () => {
    let component;
    renderer.act(() => { component = renderer.create(<OtherRoutineHarness />); });
    const root = component.root;
    const btn = findSeedButton(root);
    expect(btn).toBeTruthy();
    renderer.act(() => { btn.props.onPress(); });
    const input = root.findAll(n => n.props && n.props.multiline === true && n.props.placeholder)[0];
    expect(input.props.value).toBe(WORKOUT_SEED_EXAMPLE_TEXT);
    expect(findSeedButton(root)).toBeNull();
  });

  test('the deload editor never shows the seed block, empty or not', () => {
    let component;
    renderer.act(() => { component = renderer.create(<DeloadHarness />); });
    expect(findSeedButton(component.root)).toBeNull();
    expect(hasText(component.root, 'Tap to try this example:')).toBe(false);
  });

  test('the seed button names its effect and has a 44dp target', () => {
    let component;
    renderer.act(() => { component = renderer.create(<CurrentRoutineHarness />); });
    const btn = findSeedButton(component.root);
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toBe('Insert example workout note');
    const flat = [].concat(btn.props.style).filter(Boolean);
    expect(flat.some(s => s && s.minHeight === 44)).toBe(true);
  });

  test('no onboarding flag or extra state is persisted — only the editor draft setter is called', () => {
    let component;
    // The mock must stay the same instance across the re-render the state
    // update triggers, so create it once via a ref rather than per render.
    const setterRef = React.createRef();
    function Wrapper() {
      const [text, setText] = React.useState('');
      if (!setterRef.current) setterRef.current = jest.fn(setText);
      return (
        <LogScreenEditorCard
          deloadMode={null}
          isEditingDeloadNote={false}
          editingNoteId={null}
          currentId="cur1"
          activeEditText={text}
          handleCurrentTextChange={setterRef.current}
          editingText=""
          setEditingText={noop}
          workoutNoteTitle="Push Day"
          setWorkoutNoteTitle={noop}
          editingTitle=""
          setEditingTitle={noop}
          handleSave={noop}
          isSaving={false}
          noteIsSaving={false}
          handleSaveOtherNote={noop}
          handleSwitchCurrent={noop}
          handleDeleteRoutine={noop}
          handleDeleteDeloadNoteFromEditor={noop}
        />
      );
    }
    renderer.act(() => { component = renderer.create(<Wrapper />); });
    renderer.act(() => { findSeedButton(component.root).props.onPress(); });
    expect(setterRef.current).toHaveBeenCalledTimes(1);
    expect(setterRef.current).toHaveBeenCalledWith(WORKOUT_SEED_EXAMPLE_TEXT);
  });

  test('the inserted text parses cleanly: one exercise, one session entry, zero unparsed rows', () => {
    const parsed = parseWorkoutNote(WORKOUT_SEED_EXAMPLE_TEXT);
    expect(parsed.ok).toBe(true);
    const exercises = parsed.sections.flatMap(s => s.exercises);
    expect(exercises).toHaveLength(1);
    expect(exercises[0].name).toBe('Bench');
    expect(exercises[0].session_entries).toHaveLength(1);
    expect(exercises[0].unparsed_rows).toHaveLength(0);
  });

  test('the seed constant is separate from, and shorter than, the teaching example', () => {
    expect(WORKOUT_SEED_EXAMPLE_TEXT).toBe('Monday\n+Lifting\n-Bench\n135 5,5,5');
    expect(WORKOUT_SEED_EXAMPLE_TEXT).not.toBe(WORKOUT_SYNTAX_EXAMPLE_TEXT);
    // The teaching example remains byte-unchanged: seven lines, untouched.
    expect(WORKOUT_SYNTAX_EXAMPLE_LINES).toHaveLength(7);
    expect(WORKOUT_SYNTAX_EXAMPLE_TEXT).toBe(WORKOUT_SYNTAX_EXAMPLE_LINES.join('\n'));
  });
});
