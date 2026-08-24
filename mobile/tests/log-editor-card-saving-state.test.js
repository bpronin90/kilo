// Regression coverage for PR #882 review finding 4 (P2): a brand-new note's
// FIRST save — the longest-running, non-autosaved path — used to show only a
// disabled "Save" button with no indication anything was happening, because
// the `isSaving`/`noteIsSaving` "Saving…" branch only applied to the
// already-has-an-id case. The Save button itself must now say "Saving…"
// while that first save is in flight.

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
  test('a brand-new CURRENT note shows "Saving…" on the Save button while its first save is in flight', () => {
    let root;
    renderer.act(() => {
      root = renderer.create(
        <CurrentRoutineHarness initialText="Day 1\nSquat 5x5" isSaving noteIsSaving={false} />
      );
    });
    const button = findSaveButton(root.root);
    expect(button).toBeTruthy();
    expect(button.props.title).toBe('Saving…');
    expect(button.props.disabled).toBe(true);
  });

  test('a brand-new CURRENT note shows "Save" (not "Saving…") when idle', () => {
    let root;
    renderer.act(() => {
      root = renderer.create(
        <CurrentRoutineHarness initialText="Day 1\nSquat 5x5" isSaving={false} noteIsSaving={false} />
      );
    });
    const button = findSaveButton(root.root);
    expect(button.props.title).toBe('Save');
    expect(button.props.disabled).toBe(false);
  });

  test('a brand-new OTHER note shows "Saving…" on the Save button while its first save is in flight', () => {
    let root;
    renderer.act(() => {
      root = renderer.create(
        <OtherRoutineHarness initialText="Day 1\nSquat 5x5" isSaving={false} noteIsSaving />
      );
    });
    const button = findSaveButton(root.root);
    expect(button).toBeTruthy();
    expect(button.props.title).toBe('Saving…');
    expect(button.props.disabled).toBe(true);
  });
});
