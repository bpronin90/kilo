// Log tab action-hierarchy cleanup (#1329): an unsaved routine has no Delete,
// Save names its difference from Done, More Routines and the active Deload card
// keep one filled action with the rest behind a sheet, and More Routines opens
// on its newest few routines.

import React from 'react';
import renderer from 'react-test-renderer';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';
import { LogPreviousRoutines } from '../components/LogPreviousRoutines';
import { LogDeloadSection } from '../components/LogDeloadSection';

jest.mock('@react-native-community/datetimepicker', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return ReactMock.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const noop = () => {};
let roots = [];
afterEach(() => {
  roots.forEach(root => renderer.act(() => root.unmount()));
  roots = [];
});
const mount = (el) => {
  let root;
  renderer.act(() => { root = renderer.create(el); });
  roots.push(root);
  return root;
};
const texts = (root) => root.root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join(''));
const byTitle = (root, title) => root.root.findAll(n => n.props && n.props.title === title && typeof n.props.onPress === 'function')[0];
const byLabel = (root, label) => root.root.findAll(n => n.props && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const tap = (root, label) => renderer.act(() => { byLabel(root, label).props.onPress(); });

function EditorCard(props) {
  return (
    <LogScreenEditorCard
      deloadMode={null}
      isEditingDeloadNote={false}
      editingNoteId="new"
      currentId="cur"
      activeEditText=""
      handleCurrentTextChange={noop}
      editingText=""
      setEditingText={noop}
      workoutNoteTitle=""
      setWorkoutNoteTitle={noop}
      editingTitle="Draft"
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

describe('New Routine editor (#1329)', () => {
  test('an unsaved other routine offers Clear draft and no Delete routine', () => {
    const root = mount(<EditorCard />);
    expect(texts(root)).toContain('Clear draft');
    expect(texts(root)).not.toContain('Delete routine');
  });

  test('the current editor with no current routine is unsaved too', () => {
    const root = mount(<EditorCard editingNoteId={null} currentId={null} />);
    expect(texts(root)).toContain('Clear draft');
    expect(texts(root)).not.toContain('Delete routine');
  });

  test('a saved routine keeps Revert this edit and Delete routine', () => {
    const handleDeleteRoutine = jest.fn();
    const root = mount(<EditorCard editingNoteId="r1" handleDeleteRoutine={handleDeleteRoutine} />);
    expect(texts(root)).toEqual(expect.arrayContaining(['Revert this edit', 'Delete routine']));
    renderer.act(() => { byTitle(root, 'Delete routine').props.onPress(); });
    expect(handleDeleteRoutine).toHaveBeenCalledWith('r1', 'Draft', false);
  });

  test('a deload record keeps Delete deload record', () => {
    const root = mount(<EditorCard editingNoteId="d1" isEditingDeloadNote />);
    expect(texts(root)).toContain('Delete deload record');
  });

  test('Save routine names its difference from Done and calls the same save handler', () => {
    const handleSaveOtherNote = jest.fn();
    const root = mount(<EditorCard handleSaveOtherNote={handleSaveOtherNote} />);
    expect(texts(root)).toContain('Saves and keeps editing. Done saves and closes.');
    renderer.act(() => { byTitle(root, 'Save routine').props.onPress(); });
    expect(handleSaveOtherNote).toHaveBeenCalledTimes(1);
  });
});

const note = (id, title, day) => ({ id, title, raw_text: `MONDAY\n-${title}\n`, saved_at: `2026-0${day}-01T00:00:00.000Z` });
const NOTES = [note('n1', 'One', 1), note('n2', 'Two', 2), note('n3', 'Three', 3), note('n4', 'Four', 4), note('n5', 'Five', 5)];

function Routines(props) {
  return (
    <LogPreviousRoutines
      otherNotes={NOTES}
      handleViewOtherNote={noop}
      viewingNoteId={null}
      viewingNote={null}
      viewingNoteDayGroups={[]}
      handleToggleViewingWeek={noop}
      handleSwitchCurrent={noop}
      handleEditViewedNote={noop}
      handleDeleteRoutine={noop}
      handleCreateRoutine={noop}
      {...props}
    />
  );
}
const rowTitles = (root) => root.root
  .findAll(n => typeof n.type === 'string' && typeof n.props.accessibilityLabel === 'string' && /^(Expand|Collapse) /.test(n.props.accessibilityLabel))
  .map(n => n.props.accessibilityLabel.replace(/^(Expand|Collapse) /, '').split(',')[0]);

describe('More Routines (#1329)', () => {
  test('lists the newest three until Show all, then every routine, and Show fewer folds it back', () => {
    const root = mount(<Routines />);
    expect(rowTitles(root)).toEqual(['Five', 'Four', 'Three']);
    renderer.act(() => { root.root.findAll(n => n.props.testID === 'log-more-routines-show-all' && n.props.onPress)[0].props.onPress(); });
    expect(rowTitles(root)).toEqual(['Five', 'Four', 'Three', 'Two', 'One']);
    expect(texts(root)).toContain('Show fewer');
    renderer.act(() => { root.root.findAll(n => n.props.testID === 'log-more-routines-show-all' && n.props.onPress)[0].props.onPress(); });
    expect(rowTitles(root)).toEqual(['Five', 'Four', 'Three']);
  });

  test('a viewed (navigation-targeted) older routine always renders', () => {
    const root = mount(<Routines viewingNoteId="n1" viewingNote={NOTES[0]} />);
    expect(rowTitles(root)).toEqual(['Five', 'Four', 'Three', 'One']);
  });

  test('three or fewer routines show no Show all control', () => {
    const root = mount(<Routines otherNotes={NOTES.slice(0, 3)} />);
    expect(root.root.findAll(n => n.props.testID === 'log-more-routines-show-all')).toHaveLength(0);
  });

  test('an expanded routine shows Set as current, Edit, and More actions; the rest live in the sheet', () => {
    const handleDeleteRoutine = jest.fn();
    const onShareRoutine = jest.fn();
    const root = mount(
      <Routines
        otherNotes={[NOTES[0]]} viewingNoteId="n1" viewingNote={NOTES[0]}
        handleDeleteRoutine={handleDeleteRoutine} onShareRoutine={onShareRoutine}
      />
    );
    const visible = texts(root);
    expect(visible).toEqual(expect.arrayContaining(['Set as current routine', 'Edit routine']));
    for (const hidden of ['Copy', 'Share', 'Share as Image', 'Delete routine']) expect(visible).not.toContain(hidden);
    tap(root, 'More actions for One');
    expect(texts(root)).toEqual(expect.arrayContaining(['Copy', 'Share', 'Share as Image', 'Delete routine']));
    tap(root, 'Share routine One');
    expect(onShareRoutine).toHaveBeenCalledWith({ title: 'One', rawText: NOTES[0].raw_text });
    tap(root, 'More actions for One');
    tap(root, 'Delete routine One');
    expect(handleDeleteRoutine).toHaveBeenCalledWith('n1', 'One', false);
  });
});

function Deload(props) {
  return (
    <LogDeloadSection
      deloadNote={{ raw_text: 'MONDAY\n-Squat\n', saved_at: '2026-06-01T12:00:00.000Z' }}
      deloadLoading={false}
      deloadDayGroups={[]}
      enterDeloadEditor={noop}
      handleDeloadBodyPress={noop}
      deloadMode="read"
      completeDeload={noop}
      clearDeloadNote={noop}
      handleGenerateDeload={noop}
      isGenerating={false}
      workoutNoteText="MONDAY\n-Squat\n"
      deloadNotes={[]}
      deloadHistory={[]}
      deleteDeloadNote={noop}
      deleteDeload={noop}
      viewingNoteId={null}
      handleViewOtherNote={noop}
      handleOpenOtherNote={noop}
      logSessionCount={3}
      {...props}
    />
  );
}

describe('Active Deload card (#1329)', () => {
  test('Deload complete and Edit are visible; Regenerate and Delete live in the sheet', () => {
    const handleGenerateDeload = jest.fn();
    const root = mount(<Deload handleGenerateDeload={handleGenerateDeload} />);
    expect(texts(root)).toEqual(expect.arrayContaining(['Deload complete', 'Edit']));
    expect(texts(root)).not.toContain('Regenerate deload');
    expect(texts(root)).not.toContain('Delete active deload');
    tap(root, 'More deload actions');
    expect(texts(root)).toEqual(expect.arrayContaining(['Regenerate deload', 'Delete active deload']));
    tap(root, 'Regenerate deload');
    expect(handleGenerateDeload).toHaveBeenCalledTimes(1);
  });

  test('Regenerate reads Generating… and is disabled while a generation runs', () => {
    const handleGenerateDeload = jest.fn();
    const root = mount(<Deload isGenerating handleGenerateDeload={handleGenerateDeload} />);
    tap(root, 'More deload actions');
    const item = root.root.findAll(n => n.props && n.props.accessibilityLabel === 'Generating…' && n.props.accessibilityRole === 'menuitem')[0];
    expect(item.props.accessibilityState).toEqual({ disabled: true });
    expect(item.props.onPress).toBeUndefined();
    expect(handleGenerateDeload).not.toHaveBeenCalled();
  });
});
