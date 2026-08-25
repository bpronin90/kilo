// Regression coverage for PR #882 review finding 4 (P2): a brand-new note's
// FIRST save — the longest-running, non-autosaved path — used to show only a
// disabled "Save" button with no indication anything was happening. The
// reserved status region now carries one non-duplicated "Saving…" label while
// the button remains a stable Save action.

import React from 'react';
import renderer from 'react-test-renderer';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';

jest.mock('@react-native-community/datetimepicker', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return ReactMock.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

const noop = () => {};

function findSaveButton(root) {
  return root.findAll(
    (n) => n.type === 'Button' || (n.props && typeof n.props.onPress === 'function' && n.props.title != null)
  ).find((n) => ['Save', 'Saving…'].includes(n.props.title));
}

function CurrentRoutineHarness(props) {
  const [text, setText] = React.useState(props.initialText ?? '');
  return (
    <LogScreenEditorCard
      deloadMode={null}
      isEditingDeloadNote={false}
      editingNoteId={null}
      currentId={null}
      activeEditText={text}
      handleCurrentTextChange={setText}
      editingText=""
      setEditingText={noop}
      workoutNoteTitle="New Routine"
      setWorkoutNoteTitle={noop}
      editingTitle=""
      setEditingTitle={noop}
      handleSave={noop}
      handleSaveOtherNote={noop}
      handleSwitchCurrent={noop}
      handleDeleteRoutine={noop}
      handleDeleteDeloadNoteFromEditor={noop}
      {...props}
    />
  );
}

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
      handleSaveOtherNote={noop}
      handleSwitchCurrent={noop}
      handleDeleteRoutine={noop}
      handleDeleteDeloadNoteFromEditor={noop}
      {...props}
    />
  );
}

describe('LogScreenEditorCard — first-save "Saving…" state (#880 / PR #882 finding 4)', () => {
  // Every mounted tree is unmounted afterward — an un-unmounted tree keeps
  // its effects (and any timers) live past the end of the test, which has
  // been observed to disturb hook-order-sensitive state in an unrelated
  // module when other suites render LogScreen later in the same run.
  let roots = [];
  afterEach(() => {
    roots.forEach((root) => renderer.act(() => root.unmount()));
    roots = [];
  });

  const savingLabels = (root) => root.findAll(
    (node) => node.type === 'Text' && node.props.children === 'Saving…',
  );

  test('a brand-new CURRENT note shows one "Saving…" status while its first save is in flight', () => {
    let root;
    renderer.act(() => {
      root = renderer.create(
        <CurrentRoutineHarness initialText="Day 1\nSquat 5x5" isSaving noteIsSaving={false} saveStatus="saving" />
      );
    });
    roots.push(root);
    const button = findSaveButton(root.root);
    expect(button).toBeTruthy();
    expect(button.props.title).toBe('Save');
    expect(button.props.disabled).toBe(true);
    expect(savingLabels(root.root)).toHaveLength(1);
  });

  test('a brand-new CURRENT note shows "Save" (not "Saving…") when idle', () => {
    let root;
    renderer.act(() => {
      root = renderer.create(
        <CurrentRoutineHarness initialText="Day 1\nSquat 5x5" isSaving={false} noteIsSaving={false} saveStatus={null} />
      );
    });
    roots.push(root);
    const button = findSaveButton(root.root);
    expect(button.props.title).toBe('Save');
    expect(button.props.disabled).toBe(false);
    expect(savingLabels(root.root)).toHaveLength(0);
  });

  test('an older in-flight write disables Save but cannot claim Saving… for newer visible text', () => {
    let root;
    renderer.act(() => {
      root = renderer.create(
        <CurrentRoutineHarness
          initialText="newer visible text"
          isSaving
          noteIsSaving={false}
          saveStatus={null}
        />
      );
    });
    roots.push(root);
    const button = findSaveButton(root.root);
    expect(button.props.title).toBe('Save');
    expect(button.props.disabled).toBe(true);
    expect(savingLabels(root.root)).toHaveLength(0);
  });

  test('a brand-new OTHER note shows one "Saving…" status while its first save is in flight', () => {
    let root;
    renderer.act(() => {
      root = renderer.create(
        <OtherRoutineHarness initialText="Day 1\nSquat 5x5" isSaving={false} noteIsSaving saveStatus="saving" />
      );
    });
    roots.push(root);
    const button = findSaveButton(root.root);
    expect(button).toBeTruthy();
    expect(button.props.title).toBe('Save');
    expect(button.props.disabled).toBe(true);
    expect(savingLabels(root.root)).toHaveLength(1);
  });
});
