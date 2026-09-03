// #938: the numeric/symbol accessory row for the workout-note editor.
// Covers the shared canonical-insertion helper, the row's own 44dp/a11y
// contract, and the focus-gated wiring in both the full-screen editor
// (LogScreenEditorCard) and the Recovery inline editor (LogRecoverySection).
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import {
  WorkoutNoteKeypad,
  insertKeypadKey,
  WORKOUT_NOTE_KEYPAD_KEYS,
} from '../components/WorkoutNoteKeypad';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';
import { LogRecoverySection } from '../components/LogRecoverySection';

jest.mock('@react-native-community/datetimepicker', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return ReactMock.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

const noop = () => {};

const mounted = [];
afterEach(() => {
  act(() => { mounted.forEach((c) => { try { c.unmount(); } catch (_e) { /* already gone */ } }); });
  mounted.length = 0;
});

function mount(element) {
  let component;
  act(() => { component = renderer.create(element); });
  mounted.push(component);
  return component;
}

const KEY_LABEL = /^Insert (?:[0-9]|space|comma|hyphen|asterisk|new line)$/;

function keypadKeys(root) {
  return root.findAll(
    (n) => n.props
      && typeof n.props.accessibilityLabel === 'string'
      && KEY_LABEL.test(n.props.accessibilityLabel)
      && typeof n.props.onPress === 'function'
  );
}

function pressKey(root, a11yLabel) {
  const key = keypadKeys(root).find((n) => n.props.accessibilityLabel === a11yLabel);
  if (!key) throw new Error(`no keypad key "${a11yLabel}"`);
  act(() => key.props.onPress());
}

// ── insertKeypadKey ──────────────────────────────────────────────────────────

describe('insertKeypadKey', () => {
  test('inserts at a collapsed caret and collapses the caret after it', () => {
    expect(insertKeypadKey('ab', { start: 1, end: 1 }, '5')).toEqual({
      text: 'a5b',
      selection: { start: 2, end: 2 },
    });
  });

  test('replaces a non-empty selection, exactly like a hardware keystroke', () => {
    expect(insertKeypadKey('12345', { start: 1, end: 4 }, '*')).toEqual({
      text: '1*5',
      selection: { start: 2, end: 2 },
    });
  });

  test('inserts a newline as the literal "\\n"', () => {
    expect(insertKeypadKey('ab', { start: 2, end: 2 }, '\n')).toEqual({
      text: 'ab\n',
      selection: { start: 3, end: 3 },
    });
  });

  test('a missing selection is treated as a caret at the end of the text', () => {
    expect(insertKeypadKey('abc', null, ' ')).toEqual({
      text: 'abc ',
      selection: { start: 4, end: 4 },
    });
    expect(insertKeypadKey('abc', undefined, ',')).toEqual({
      text: 'abc,',
      selection: { start: 4, end: 4 },
    });
  });

  test('clamps an out-of-range or reversed selection into the text', () => {
    expect(insertKeypadKey('abc', { start: -5, end: 99 }, '-')).toEqual({
      text: '-',
      selection: { start: 1, end: 1 },
    });
    expect(insertKeypadKey('abcd', { start: 3, end: 1 }, 'x')).toEqual({
      text: 'axd',
      selection: { start: 2, end: 2 },
    });
  });

  test('non-string text is treated as empty', () => {
    expect(insertKeypadKey(undefined, null, '7')).toEqual({
      text: '7',
      selection: { start: 1, end: 1 },
    });
  });
});

// ── WorkoutNoteKeypad component ─────────────────────────────────────────────

describe('WorkoutNoteKeypad', () => {
  test('renders nothing while not visible', () => {
    const root = mount(<WorkoutNoteKeypad visible={false} onKeyPress={noop} />);
    expect(root.toJSON()).toBeNull();
  });

  test('exposes digits 0-9 plus space, comma, hyphen, asterisk, and newline', () => {
    const root = mount(<WorkoutNoteKeypad visible onKeyPress={noop} />);
    const labels = keypadKeys(root.root).map((n) => n.props.accessibilityLabel);
    expect(labels).toEqual([
      'Insert 1', 'Insert 2', 'Insert 3', 'Insert 4', 'Insert 5',
      'Insert 6', 'Insert 7', 'Insert 8', 'Insert 9', 'Insert 0',
      'Insert space', 'Insert comma', 'Insert hyphen', 'Insert asterisk', 'Insert new line',
    ]);
    expect(WORKOUT_NOTE_KEYPAD_KEYS).toHaveLength(15);
  });

  test('every key is a >=44x44dp button that announces once', () => {
    const root = mount(<WorkoutNoteKeypad visible onKeyPress={noop} />);
    for (const key of keypadKeys(root.root)) {
      expect(key.props.accessibilityRole).toBe('button');
      const flat = StyleSheet.flatten(key.props.style) || {};
      expect(flat.minWidth).toBeGreaterThanOrEqual(44);
      expect(flat.minHeight).toBeGreaterThanOrEqual(44);
      const label = key.findByType(require('react-native').Text);
      expect(label.props.accessible).toBe(false);
    }
  });

  test('a press reports the literal string it inserts', () => {
    const onKeyPress = jest.fn();
    const root = mount(<WorkoutNoteKeypad visible onKeyPress={onKeyPress} />);
    pressKey(root.root, 'Insert 7');
    pressKey(root.root, 'Insert space');
    pressKey(root.root, 'Insert comma');
    pressKey(root.root, 'Insert hyphen');
    pressKey(root.root, 'Insert asterisk');
    pressKey(root.root, 'Insert new line');
    expect(onKeyPress.mock.calls.map((c) => c[0])).toEqual(['7', ' ', ',', '-', '*', '\n']);
  });
});

// ── LogScreenEditorCard wiring ─────────────────────────────────────────────

function findNoteInput(root) {
  return root.findAll(
    (n) => n.props
      && typeof n.props.placeholder === 'string'
      && n.props.placeholder.includes('Monday')
      && n.props.multiline
  )[0];
}

function CurrentRoutineHarness(props) {
  const [text, setText] = React.useState(props.initialText ?? '');
  return (
    <LogScreenEditorCard
      deloadMode={null}
      isEditingDeloadNote={false}
      editingNoteId={null}
      currentId="cur1"
      activeEditText={text}
      handleCurrentTextChange={(next) => { setText(next); props.onText?.(next); }}
      editingText=""
      setEditingText={noop}
      workoutNoteTitle="Routine A"
      setWorkoutNoteTitle={noop}
      editingTitle=""
      setEditingTitle={noop}
      handleSave={noop}
      handleSaveOtherNote={noop}
      handleSwitchCurrent={noop}
      handleDeleteRoutine={noop}
      handleDeleteDeloadNoteFromEditor={noop}
      handleRevertEdit={noop}
      {...props}
    />
  );
}

describe('LogScreenEditorCard: numeric/symbol accessory row', () => {
  test('the row appears only while the note input is focused', () => {
    const root = mount(<CurrentRoutineHarness />);
    expect(keypadKeys(root.root)).toHaveLength(0);

    act(() => { findNoteInput(root.root).props.onFocus(); });
    expect(keypadKeys(root.root)).toHaveLength(15);

    act(() => { findNoteInput(root.root).props.onBlur(); });
    expect(keypadKeys(root.root)).toHaveLength(0);
  });

  test('a key inserts canonical text at the caret through the normal change path', () => {
    const onText = jest.fn();
    const root = mount(<CurrentRoutineHarness initialText={'ab'} onText={onText} />);
    const input = findNoteInput(root.root);
    act(() => { input.props.onFocus(); });
    act(() => { input.props.onSelectionChange({ nativeEvent: { selection: { start: 1, end: 1 } } }); });

    pressKey(root.root, 'Insert 5');
    expect(onText).toHaveBeenLastCalledWith('a5b');
    expect(findNoteInput(root.root).props.value).toBe('a5b');

    pressKey(root.root, 'Insert new line');
    // caret advanced to 2 after the first insert, so the newline lands there
    expect(onText).toHaveBeenLastCalledWith('a5\nb');
  });

  test('the row never sets keyboardType on the note input', () => {
    const root = mount(<CurrentRoutineHarness />);
    act(() => { findNoteInput(root.root).props.onFocus(); });
    expect(findNoteInput(root.root).props.keyboardType).toBeUndefined();
  });
});

// ── LogRecoverySection parity ─────────────────────────────────────────────

const RECOVERY_BLOCK = {
  id: 'rb', baseline_note_id: 'baseline', baseline_note_title: 'Push Day',
  started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
};
const RECOVERY_WEEK = {
  id: 'rw', block_id: 'rb', note_id: 'weeknote', week_number: 1,
  completed_at: null, deleted_at: null,
};

function renderRecovery(overrides = {}) {
  const text = overrides.editingText ?? 'Monday\n-Bench\n95 5,5,5';
  const note = { id: 'weeknote', title: 'Recovery Week 1', raw_text: text };
  const onChangeEditingText = jest.fn();
  const component = mount(
    React.createElement(LogRecoverySection, {
      blocks: [RECOVERY_BLOCK], weeks: [RECOVERY_WEEK], notes: [note],
      viewingNoteId: 'weeknote', viewingNote: note,
      editingNoteId: 'weeknote', editingTitle: 'Recovery Week 1', editingText: text,
      onChangeEditingText,
      onChangeEditingTitle: noop, onEditorInteraction: noop,
      onSaveEdit: noop, onCancelEdit: noop,
      ...overrides,
    })
  );
  return { root: component.root, onChangeEditingText };
}

function findRecoveryNoteInput(root) {
  return root.findAll((n) => n.props?.accessibilityLabel === 'Recovery note text')[0];
}

describe('LogRecoverySection: numeric/symbol accessory row parity', () => {
  test('the row is focus-gated on the inline note input', () => {
    const { root } = renderRecovery();
    expect(keypadKeys(root)).toHaveLength(0);

    act(() => { findRecoveryNoteInput(root).props.onFocus(); });
    expect(keypadKeys(root)).toHaveLength(15);

    act(() => { findRecoveryNoteInput(root).props.onBlur(); });
    expect(keypadKeys(root)).toHaveLength(0);
  });

  test('a key inserts the same canonical text via onChangeEditingText', () => {
    const { root, onChangeEditingText } = renderRecovery({ editingText: 'xy' });
    const input = findRecoveryNoteInput(root);
    act(() => { input.props.onFocus(); });
    act(() => { input.props.onSelectionChange({ nativeEvent: { selection: { start: 1, end: 1 } } }); });
    pressKey(root, 'Insert comma');
    expect(onChangeEditingText).toHaveBeenLastCalledWith('x,y');
  });
});
