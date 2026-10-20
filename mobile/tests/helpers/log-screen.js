import React from 'react';
import render from 'react-test-renderer';
import { LogScreen } from '../../screens/LogScreen';
import { LogPreviousRoutines } from '../../components/LogPreviousRoutines';
import { useLogCurrentRoutineEditor } from '../../screens/log/useLogCurrentRoutineEditor';
import { useLogOtherRoutineEditor } from '../../screens/log/useLogOtherRoutineEditor';

// ── Undo escape hatch: integration tests ───────────────────────────

// #1329: on iOS a sheet item's action runs once the sheet's Modal reports
// `onDismiss`; fire it the way the native dismissal would.
const finishSheetDismiss = (root) => {
  const modal = root.findAll(n => n.props && typeof n.props.testID === 'string' && /-menu-modal$/.test(n.props.testID) && typeof n.props.onDismiss === 'function')[0];
  render.act(() => { modal.props.onDismiss(); });
};

const openRecoveryManagement = (root) => {
  const entry = root.findAll(n => n.props.testID === 'log-recovery-entry' && n.props.onPress)[0];
  expect(entry).toBeTruthy();
  render.act(() => { entry.props.onPress(); });
};

const findPressableByText = (root, text) => {
  const matches = root.findAll(n => {
    if (n.type !== 'Text') return false;
    const children = n.props.children;
    const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
    return flat.includes(text);
  });
  for (const match of matches) {
    let node = match.parent;
    while (node) {
      if (node.props && typeof node.props.onPress === 'function') return node;
      node = node.parent;
    }
  }
  return null;
};

// #1021: Edit, Copy, Share, and Share as Image on the CURRENT routine card
// live behind its consolidated three-dot menu now (`accessibilityLabel:
// "Routine actions"`), not as standalone pills. Tests that need one of those
// items open the menu first via this helper.
const openCurrentRoutineMenu = (root) => {
  const trigger = root.findAll(
    n => n.props && n.props.accessibilityLabel === 'Routine actions' && typeof n.props.onPress === 'function'
  )[0];
  render.act(() => { trigger.props.onPress({ stopPropagation: jest.fn() }); });
};

// Routine management renders its non-current cards unconditionally (#1021):
// the collection-level Show/Hide Routines disclosure this used to expand is
// gone. Kept as a no-op passthrough so call sites that still name this step
// (many, across this file) do not need individual rewrites.
const expandRoutineManagement = (root) => {
  const header = root.findAll(
    n => n.props
      && (n.props.accessibilityLabel === 'Show routines'
        || n.props.accessibilityLabel === 'Hide routines')
      && typeof n.props.onPress === 'function'
  )[0];
  if (!header) return;
  if (header.props.accessibilityState && header.props.accessibilityState.expanded) return;
  render.act(() => { header.props.onPress(); });
};

// The active Recovery card's rarer controls are collapsed by default (#789):
// `Unlink Week {N}`, `Complete recovery block`, and the analytics-inclusion
// switch render only once the "Manage recovery block" disclosure is expanded.
// Tests that drive those controls open it first. The trigger is never disabled,
// so this works in locked states too — which is the point of the disclosure.
const expandManageRecovery = (root) => {
  const trigger = root.findAll(
    n => n.props
      && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Manage recovery block')
      && typeof n.props.onPress === 'function'
  )[0];
  if (!trigger) return null;
  if (!(trigger.props.accessibilityState && trigger.props.accessibilityState.expanded)) {
    render.act(() => { trigger.props.onPress(); });
  }
  return trigger;
};

// More Routines' disclosure state lives in LogScreen now (#775), so a
// standalone render of the list has to supply it. This harness stands in for
// that owner in the component-level tests below; the screen-level tests drive
// the real one.
function ControlledPreviousRoutines(props) {
  const [expanded, setExpanded] = React.useState(!!props.expanded);
  return (
    <LogPreviousRoutines
      {...props}
      expanded={expanded}
      onToggleExpanded={() => setExpanded(e => !e)}
    />
  );
}

function ControlledLogScreen(props) {
  const [text, setText] = React.useState(props.initialText || 'Monday\n+Lifting\n-Bench\n135 5,5,5');
  const [title, setTitle] = React.useState(props.initialTitle || 'Routine A');
  return (
    <LogScreen
      workoutNoteText={props.workoutNoteText !== undefined ? props.workoutNoteText : text}
      setWorkoutNoteText={props.setWorkoutNoteText || setText}
      workoutNoteTitle={props.workoutNoteTitle !== undefined ? props.workoutNoteTitle : title}
      setWorkoutNoteTitle={props.setWorkoutNoteTitle || setTitle}
      isCollapsed={false}
      toggleCollapsed={jest.fn()}
      onSaveWorkout={jest.fn()}
      onCheckInPrompt={jest.fn()}
      {...props}
    />
  );
}

// Mounts the real current-routine editor hook behind a stateful text/title
// owner (what LogScreen provides). `get()` returns the latest hook value;
// `unmount()` runs effect cleanup so debounce timers never outlive the test.
function mountCurrentRoutineEditorHook({ update, note, ...overrides }) {
  let latest = null;
  function Harness() {
    const [text, setText] = React.useState(note.raw_text);
    const [title, setTitle] = React.useState(note.title);
    latest = useLogCurrentRoutineEditor({
      workoutNoteText: text,
      setWorkoutNoteText: setText,
      workoutNoteTitle: title,
      setWorkoutNoteTitle: setTitle,
      currentId: note.id,
      currentNote: note,
      notes: [note],
      trackedLifts: [],
      update,
      add: jest.fn(),
      selectCurrent: jest.fn(),
      fatigueTrackingEnabled: false,
      notesLoading: false,
      notesError: null,
      otherModalOwnsScreen: false,
      editorScrollRef: { current: { scrollTo: jest.fn() } },
      readScrollRef: { current: { scrollTo: jest.fn() } },
      ...overrides,
    });
    return null;
  }
  let renderer;
  render.act(() => { renderer = render.create(<Harness />); });
  return {
    get: () => latest,
    unmount: () => { render.act(() => { renderer.unmount(); }); },
  };
}

// Same for the non-current ("other") routine editor hook.
function mountOtherRoutineEditorHook({ notes, update, updateDeload, deloadHistory = [], ...overrides }) {
  let latest = null;
  function Harness() {
    latest = useLogOtherRoutineEditor({
      notes,
      currentId: 'other',
      currentNote: { id: 'other' },
      deloadHistory,
      update,
      add: jest.fn(),
      remove: jest.fn(),
      selectCurrent: jest.fn(),
      updateDeload: updateDeload || jest.fn(),
      deleteDeloadNote: jest.fn(),
      autosaveCurrentTimerRef: { current: null },
      handleSave: jest.fn(),
      currentEditorMode: 'read',
      hasUnsavedCurrent: false,
      editorScrollRef: { current: { scrollTo: jest.fn() } },
      ...overrides,
    });
    return null;
  }
  let renderer;
  render.act(() => { renderer = render.create(<Harness />); });
  return {
    get: () => latest,
    unmount: () => { render.act(() => { renderer.unmount(); }); },
  };
}

export { mountCurrentRoutineEditorHook, mountOtherRoutineEditorHook, finishSheetDismiss, openRecoveryManagement, findPressableByText, openCurrentRoutineMenu, expandRoutineManagement, expandManageRecovery, ControlledPreviousRoutines, ControlledLogScreen };

// Some legacy cases leave renderers mounted. Each suite owns those renderers
// so pending editor effects cannot survive into the next case or Jest shutdown.
export function installRendererCleanup() {
  const create = render.create;
  let mounted;
  beforeEach(() => {
    mounted = [];
    jest.spyOn(render, 'create').mockImplementation((...args) => {
      const renderer = create(...args);
      mounted.push(renderer);
      return renderer;
    });
  });
  afterEach(async () => {
    await render.act(async () => {
      for (const renderer of mounted) renderer.unmount();
    });
    render.create = create;
  });
}
