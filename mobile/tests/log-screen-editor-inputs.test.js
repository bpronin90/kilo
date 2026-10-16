import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import { Modal } from 'react-native';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';
import { findPressableByText } from './helpers/log-screen';

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

describe('LogScreenEditorCard syntax-sensitive inputs have autocorrect disabled', () => {
  const mockHandlers = {
    handleSaveDeload: jest.fn(),
    handleCurrentTextChange: jest.fn(),
    handleSaveOtherNote: jest.fn(),
    handleSave: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleDeleteDeloadNoteFromEditor: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    setDeloadEditText: jest.fn(),
    setEditingTitle: jest.fn(),
    setWorkoutNoteTitle: jest.fn(),
    setDeloadEditDate: jest.fn(),
    setShowDeloadDatePicker: jest.fn(),
    setDeloadEditOrdinal: jest.fn(),
    setEditingText: jest.fn(),
  };

  test('deload note TextInput has autoCorrect={false}, autoCapitalize="none", spellCheck={false}', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogScreenEditorCard
          deloadMode="edit"
          deloadEditText="test deload"
          isSaving={false}
          saveSuccess={false}
          editingNoteId={null}
          isEditingDeloadNote={false}
          workoutNoteTitle="Test"
          editingTitle=""
          editingDeloadHasLinkedRecord={false}
          deloadEditDate=""
          deloadEditOrdinal=""
          showDeloadDatePicker={false}
          editingNote={null}
          editingText=""
          activeEditText="test"
          currentId={null}
          {...mockHandlers}
        />
      );
    });
    const root = component.root;
    const textInputs = root.findAllByType('TextInput');

    // Find the deload note input (first TextInput in deload edit mode)
    const deloadNoteInput = textInputs.find(ti =>
      ti.props.value === 'test deload' && ti.props.multiline
    );
    expect(deloadNoteInput).toBeTruthy();
    expect(deloadNoteInput.props.autoCorrect).toBe(false);
    expect(deloadNoteInput.props.autoCapitalize).toBe('none');
    expect(deloadNoteInput.props.spellCheck).toBe(false);
  });

  test('routine title TextInput has autoCorrect={false}, autoCapitalize="none", spellCheck={false}', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogScreenEditorCard
          deloadMode="read"
          deloadEditText=""
          isSaving={false}
          saveSuccess={false}
          editingNoteId={null}
          isEditingDeloadNote={false}
          workoutNoteTitle="Test Routine"
          editingTitle=""
          editingDeloadHasLinkedRecord={false}
          deloadEditDate=""
          deloadEditOrdinal=""
          showDeloadDatePicker={false}
          editingNote={null}
          editingText=""
          activeEditText="test"
          currentId={null}
          {...mockHandlers}
        />
      );
    });
    const root = component.root;
    const textInputs = root.findAllByType('TextInput');

    // Find the title input
    const titleInput = textInputs.find(ti =>
      ti.props.placeholder && ti.props.placeholder.includes('Routine Name')
    );
    expect(titleInput).toBeTruthy();
    expect(titleInput.props.autoCorrect).toBe(false);
    expect(titleInput.props.autoCapitalize).toBe('none');
    expect(titleInput.props.spellCheck).toBe(false);
  });

  test('main workout note TextInput has autoCorrect={false}, autoCapitalize="none", spellCheck={false}', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogScreenEditorCard
          deloadMode="read"
          deloadEditText=""
          isSaving={false}
          saveSuccess={false}
          editingNoteId={null}
          isEditingDeloadNote={false}
          workoutNoteTitle="Test"
          editingTitle=""
          editingDeloadHasLinkedRecord={false}
          deloadEditDate=""
          deloadEditOrdinal=""
          showDeloadDatePicker={false}
          editingNote={null}
          editingText=""
          activeEditText="Monday\n+Lifting\n-Bench\n135 5,5,5"
          currentId={null}
          {...mockHandlers}
        />
      );
    });
    const root = component.root;
    const textInputs = root.findAllByType('TextInput');

    // Should find title and main note TextInputs
    expect(textInputs.length).toBeGreaterThanOrEqual(2);

    // Find the main note editor: the multiline TextInput that's not the title
    // Title has placeholder "Routine Name", main note has the example placeholder
    const noteInput = textInputs.find(ti =>
      ti.props.multiline && (!ti.props.placeholder || !ti.props.placeholder.includes('Routine Name'))
    );

    expect(noteInput).toBeTruthy();
    expect(noteInput.props.autoCorrect).toBe(false);
    expect(noteInput.props.autoCapitalize).toBe('none');
    expect(noteInput.props.spellCheck).toBe(false);
  });

  test('deload session number TextInput has autoCorrect={false}, autoCapitalize="none", spellCheck={false}', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogScreenEditorCard
          deloadMode="read"
          deloadEditText=""
          isSaving={false}
          saveSuccess={false}
          editingNoteId={null}
          isEditingDeloadNote={true}
          workoutNoteTitle="Test"
          editingTitle="Deload: 2026-07-23"
          editingDeloadHasLinkedRecord={true}
          deloadEditDate="2026-07-23"
          deloadEditOrdinal="5"
          showDeloadDatePicker={false}
          editingNote={null}
          editingText=""
          activeEditText=""
          currentId={null}
          {...mockHandlers}
        />
      );
    });
    const root = component.root;

    // Reveal the compact "Date · <value>" secondary row (#764) so the Session #
    // field (shown alongside the date once revealed) is on screen.
    const dateToggle = findPressableByText(root, 'Date ·');
    expect(dateToggle).toBeTruthy();
    render.act(() => {
      dateToggle.props.onPress();
    });

    const textInputs = root.findAllByType('TextInput');

    // Find the session number input
    const sessionInput = textInputs.find(ti =>
      ti.props.placeholder === 'Session number' && ti.props.keyboardType === 'number-pad'
    );
    expect(sessionInput).toBeTruthy();
    expect(sessionInput.props.autoCorrect).toBe(false);
    expect(sessionInput.props.autoCapitalize).toBe('none');
    expect(sessionInput.props.spellCheck).toBe(false);
  });
});

// ── editor-reachable workout syntax help (#584) ─────────────────────────────

describe('LogScreenEditorCard workout syntax help button', () => {
  const mockHandlers = {
    handleSaveDeload: jest.fn(),
    handleCurrentTextChange: jest.fn(),
    handleSaveOtherNote: jest.fn(),
    handleSave: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleDeleteDeloadNoteFromEditor: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    setDeloadEditText: jest.fn(),
    setEditingTitle: jest.fn(),
    setWorkoutNoteTitle: jest.fn(),
    setDeloadEditDate: jest.fn(),
    setShowDeloadDatePicker: jest.fn(),
    setDeloadEditOrdinal: jest.fn(),
    setEditingText: jest.fn(),
  };

  function renderEditor(overrides = {}) {
    let component;
    render.act(() => {
      component = render.create(
        <LogScreenEditorCard
          deloadMode="read"
          deloadEditText=""
          isSaving={false}
          saveSuccess={false}
          editingNoteId={null}
          isEditingDeloadNote={false}
          workoutNoteTitle="Test"
          editingTitle=""
          editingDeloadHasLinkedRecord={false}
          deloadEditDate=""
          deloadEditOrdinal=""
          showDeloadDatePicker={false}
          editingNote={null}
          editingText=""
          activeEditText="Monday\n-Bench\n135 5,5,5"
          currentId={null}
          {...mockHandlers}
          {...overrides}
        />
      );
    });
    return component;
  }

  function findSyntaxHelpButton(root) {
    return root.findAll(
      node => node.props?.accessibilityLabel === 'Workout syntax help' && typeof node.props?.onPress === 'function'
    )[0];
  }

  test('a "Workout syntax help" button is reachable from the editor', () => {
    const component = renderEditor();
    const button = findSyntaxHelpButton(component.root);
    expect(button).toBeTruthy();
  });

  test('the standing bordered session-alignment block is gone (#863)', () => {
    const message = 'Uneven exercise histories do not line up: Bench — 2 entries; Deadlift — 1 entry.';
    const component = renderEditor({
      sessionAlignmentIssue: { code: 'uneven_session_entries', message },
    });
    expect(component.root.findAll(n => n.props?.testID === 'session-alignment-warning').length).toBe(0);
  });

  test('tapping the button opens the modal, and the close control closes it', () => {
    const component = renderEditor();
    const root = component.root;

    // Modal starts closed: WorkoutSyntaxModal returns null when not visible.
    expect(root.findAllByType(Modal).length).toBe(0);

    render.act(() => {
      findSyntaxHelpButton(root).props.onPress();
    });

    const modal = root.findByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(typeof modal.props.onRequestClose).toBe('function');

    const closeBtn = root.findAll(
      node => node.props?.accessibilityLabel === 'Close workout syntax help' && typeof node.props?.onPress === 'function'
    )[0];
    expect(closeBtn).toBeTruthy();

    render.act(() => {
      closeBtn.props.onPress();
    });

    expect(root.findAllByType(Modal).length).toBe(0);
  });

  test('Modal onRequestClose (Android back) also closes it without altering editor text', () => {
    const component = renderEditor();
    const root = component.root;

    render.act(() => {
      findSyntaxHelpButton(root).props.onPress();
    });

    render.act(() => {
      root.findByType(Modal).props.onRequestClose();
    });

    expect(root.findAllByType(Modal).length).toBe(0);
    expect(mockHandlers.handleCurrentTextChange).not.toHaveBeenCalled();
    expect(mockHandlers.setEditingText).not.toHaveBeenCalled();
  });

  test('opening and closing the syntax help modal preserves unsaved editor text', () => {
    const component = renderEditor({ activeEditText: 'Unsaved draft text\n-Squat\n' });
    const root = component.root;

    const noteInputBefore = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === 'Unsaved draft text\n-Squat\n');
    expect(noteInputBefore).toBeTruthy();

    render.act(() => {
      findSyntaxHelpButton(root).props.onPress();
    });
    render.act(() => {
      root.findByType(Modal).props.onRequestClose();
    });

    const noteInputAfter = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === 'Unsaved draft text\n-Squat\n');
    expect(noteInputAfter).toBeTruthy();
    expect(mockHandlers.handleCurrentTextChange).not.toHaveBeenCalled();
  });
});
