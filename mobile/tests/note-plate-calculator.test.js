// #1375: rendered note weights are plain text again, and the plate
// calculator's Log entry is Routine actions → Plate calculator, outside the
// note body. Renderer coverage checks props and handler routing; it does not
// claim to prove native gesture arbitration.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Modal, Platform, Text } from 'react-native';
import { parseWorkoutNote } from '../lib/parser';
import { WorkoutContentRenderer } from '../components/WorkoutContentRenderer';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import { SetLine } from '../components/UI';
import { PlateCalculatorModal } from '../components/PlateCalculatorModal';
import { ThemeProvider } from '../theme/ThemeContext';
import { useLogRoutineActions, RoutinePlateCalculator } from '../components/log/LogRoutineActionSheet';
import { LogRoutineHeaderActions } from '../screens/log/LogRoutineHeaderActions';
import { EditorHeaderActions } from '../screens/log/LogScreenContent';

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('../storage/entries', () => ({
  ...jest.requireActual('../storage/entries'),
  loadPlateCalculatorProfile: jest.fn(async () => jest.requireActual('../lib/plateMath').defaultPlateCalculatorProfile()),
  savePlateCalculatorProfile: jest.fn(async () => {}),
}));

const NOTE = '-Squat\n- 225 5,5,5\n-Bench\n- 40kg 10';
const dayGroups = () => [{ heading: null, sections: parseWorkoutNote(NOTE).sections }];
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

let roots = [];
const realOS = Platform.OS;
afterEach(() => {
  roots.forEach(r => act(() => r.unmount()));
  roots = [];
  Platform.OS = realOS;
  jest.useRealTimers();
});
const mount = (el) => {
  let root;
  act(() => { root = renderer.create(el); });
  roots.push(root);
  return root;
};

const weightTexts = (root) => root.root.findAll(n => n.type === Text
  && typeof n.props.children === 'string' && / (lb|kg)( \(|$)/.test(n.props.children));
const calculatorInlineControls = (root) => root.root.findAll(n => n.props
  && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show plate loading'));
const calculatorModal = (root) => root.root.findAll(n => n.type === Modal
  && n.props.visible && n.findAll(c => c.props && c.props.accessibilityLabel === 'Close plate calculator').length > 0);

describe('note weights are plain text, never calculator buttons', () => {
  test.each([
    ['full-scale renderer', {}],
    ['compact Recovery renderer', { compact: true }],
  ])('%s', (_label, props) => {
    const root = mount(<WorkoutContentRenderer dayGroups={dayGroups()} {...props} />);
    const weights = weightTexts(root);
    expect(weights.map(w => w.props.children)).toEqual(expect.arrayContaining(['225 lb', '88 lb (40kg)']));
    weights.forEach((w) => {
      expect(w.props.onPress).toBeUndefined();
      expect(w.props.accessibilityRole).toBeUndefined();
    });
    expect(calculatorInlineControls(root)).toHaveLength(0);
    expect(root.root.findAllByType(Modal)).toHaveLength(0);
  });

  test('SetLine keeps selectability and drops the dashed tappable cue', () => {
    const root = mount(<SetLine sets={[{ weight_value: 135, rep_count: 5 }]} selectable />);
    const [weight] = weightTexts(root);
    expect(weight.props.selectable).toBe(true);
    const style = Object.assign({}, ...[].concat(weight.props.style).flat().filter(Boolean));
    expect(style.borderStyle).toBeUndefined();
    expect(style.borderBottomWidth).toBeUndefined();
    let p = weight.parent;
    while (p) { expect(p.props.accessibilityRole).not.toBe('button'); p = p.parent; }
  });
});

function renderCard(overrides = {}) {
  const props = {
    workoutNoteTitle: 'Routine',
    routineRawText: NOTE,
    activeEditText: NOTE,
    dayGroups: dayGroups(),
    handleNoteBodyPress: jest.fn(),
    enterCurrentEditor: jest.fn(),
    handleSkipWeek: jest.fn(),
    toggleCollapsed: jest.fn(),
    isCollapsed: false,
    trackedLifts: {},
    handleToggleTrack: jest.fn(),
    ...overrides,
  };
  return { root: mount(<LogActiveRoutineCard {...props} />), props };
}
const byLabel = (root, label) => root.root.findAll(n => n.props
  && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const openMenu = (root) => act(() => { byLabel(root, 'Routine actions').props.onPress({ stopPropagation: jest.fn() }); });
const chooseCalculator = (root) => act(() => {
  root.root.findAll(n => n.props && n.props.accessibilityRole === 'menuitem'
    && n.props.accessibilityLabel === 'Plate calculator' && n.props.onPress)[0].props.onPress({ stopPropagation: jest.fn() });
});
const menuModal = (root) => root.root.findAll(n => n.type === Modal && typeof n.props.onDismiss === 'function')[0];

describe('active routine card', () => {
  test('a press on a rendered weight reaches only the note-body handler', async () => {
    const { root, props } = renderCard();
    const [weight] = weightTexts(root);
    let owner = weight.parent;
    while (owner && typeof owner.props.onPress !== 'function') owner = owner.parent;
    expect(owner.props.onPress).toBe(props.handleNoteBodyPress);
    act(() => { owner.props.onPress({}); owner.props.onPress({}); });
    expect(props.handleNoteBodyPress).toHaveBeenCalledTimes(2);
    expect(props.enterCurrentEditor).not.toHaveBeenCalled();
    expect(calculatorModal(root)).toHaveLength(0);
  });

  test('Routine actions lists Plate calculator after the skip actions and before Copy', () => {
    const { root } = renderCard();
    openMenu(root);
    const items = root.root.findAll(n => n.props && n.props.accessibilityRole === 'menuitem' && n.props.onPress);
    expect(items.map(i => i.props.accessibilityLabel)).toEqual([
      'Edit routine', 'Skip week', 'Plate calculator', 'Copy routine Routine', 'Share routine', 'Share routine as image',
    ]);
    const item = items[2];
    expect(item.props.accessibilityHint).toBe('Enter a target weight to calculate plates');
  });

  test.each(['android', 'ios'])('%s: header Plate calculator opens the calculator in one tap, outside the note body (#1445)', async (os) => {
    Platform.OS = os;
    const { root, props } = renderCard();
    const button = root.root.findAll(n => n.props && n.props.testID === 'log-plate-calculator-button' && n.props.onPress)[0];
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Plate calculator');
    const noteBody = root.root.findAll(n => n.props && n.props.onPress === props.handleNoteBodyPress)[0];
    expect(noteBody.findAll(n => n.props && n.props.testID === 'log-plate-calculator-button')).toHaveLength(0);
    act(() => { button.props.onPress(); });
    await flush();
    expect(calculatorModal(root)).toHaveLength(1);
    expect(props.handleNoteBodyPress).not.toHaveBeenCalled();
    expect(props.toggleCollapsed).not.toHaveBeenCalled();
  });

  test.each([false, true])('Android: opens the empty calculator without changing a card (collapsed=%s)', async (isCollapsed) => {
    Platform.OS = 'android';
    const { root, props } = renderCard({ isCollapsed });
    openMenu(root);
    chooseCalculator(root);
    await flush();
    expect(calculatorModal(root)).toHaveLength(1);
    const input = root.root.findAll(n => n.props && n.props.testID === 'plate-calculator-target-input')[0];
    expect(input.props.value).toBe('');
    expect(props.toggleCollapsed).not.toHaveBeenCalled();
    expect(props.handleNoteBodyPress).not.toHaveBeenCalled();
    expect(props.enterCurrentEditor).not.toHaveBeenCalled();
    expect(props.handleSkipWeek).not.toHaveBeenCalled();
    // The calculator mounts beside the card, never inside the note body.
    const noteBody = root.root.findAll(n => n.props && n.props.onPress === props.handleNoteBodyPress)[0];
    expect(noteBody.findAll(n => n.props && n.props.testID === 'plate-calculator-target-input')).toHaveLength(0);
  });

  test('iOS: waits for the sheet to dismiss, launches exactly once', async () => {
    Platform.OS = 'ios';
    jest.useFakeTimers();
    const { root } = renderCard();
    openMenu(root);
    chooseCalculator(root);
    await flush();
    expect(calculatorModal(root)).toHaveLength(0);
    act(() => { menuModal(root).props.onDismiss(); });
    await flush();
    expect(calculatorModal(root)).toHaveLength(1);
    act(() => { jest.advanceTimersByTime(1000); menuModal(root).props.onDismiss(); });
    await flush();
    expect(calculatorModal(root)).toHaveLength(1);
    // Closing and reopening starts empty again.
    act(() => { byLabel(root, 'Close plate calculator').props.onPress(); });
    expect(calculatorModal(root)).toHaveLength(0);
  });

  test('iOS: falls back when onDismiss never arrives', async () => {
    Platform.OS = 'ios';
    jest.useFakeTimers();
    const { root } = renderCard();
    openMenu(root);
    chooseCalculator(root);
    act(() => { jest.advanceTimersByTime(699); });
    await flush();
    expect(calculatorModal(root)).toHaveLength(0);
    act(() => { jest.advanceTimersByTime(1); });
    await flush();
    expect(calculatorModal(root)).toHaveLength(1);
  });

  test('iOS: canceling the sheet or unmounting never launches the calculator', async () => {
    Platform.OS = 'ios';
    jest.useFakeTimers();
    const { root } = renderCard();
    openMenu(root);
    act(() => { menuModal(root).props.onRequestClose(); });
    act(() => { menuModal(root).props.onDismiss(); jest.advanceTimersByTime(1000); });
    await flush();
    expect(calculatorModal(root)).toHaveLength(0);

    const second = renderCard();
    openMenu(second.root);
    chooseCalculator(second.root);
    act(() => { second.root.unmount(); });
    roots = roots.filter(r => r !== second.root);
    expect(() => act(() => { jest.advanceTimersByTime(1000); })).not.toThrow();
  });
});

// #1650: the note editor opens the same calculator from its header. LogScreen
// hosts the one modal outside the read-view header, which unmounts in edit mode.
describe('editor Plates entry', () => {
  let setMode;
  function Screen() {
    const [mode, setModeState] = React.useState('read');
    setMode = setModeState;
    const [draft] = React.useState({ text: 'unsaved draft' });
    const actions = useLogRoutineActions({
      workoutNoteTitle: 'Routine', routineRawText: NOTE, activeEditText: NOTE, enterCurrentEditor: jest.fn(),
      isCollapsed: false, toggleCollapsed: jest.fn(),
    });
    const noop = {};
    return (
      <ThemeProvider>
        {mode === 'read' && <LogRoutineHeaderActions actions={actions} hostsCalculator={false} />}
        {mode === 'edit' && (
          <EditorHeaderActions
            otherEditor={noop} deloadEditor={{ deloadMode: null }} currentEditor={{ handleDoneCurrent: jest.fn() }}
            onOpenPlates={actions.openPlates}
          />
        )}
        <Text testID="draft">{draft.text}</Text>
        <RoutinePlateCalculator actions={actions} />
      </ThemeProvider>
    );
  }
  const plates = (root) => root.root.findAll(n => n.props && n.props.testID === 'editor-plate-calculator-button' && n.props.onPress)[0];
  const calcModals = (root) => root.root.findAll(n => n.type === Modal && n.props.visible
    && n.findAll(c => c.props && c.props.accessibilityLabel === 'Close plate calculator').length > 0);

  test('opens and closes one calculator from edit mode without touching the draft', async () => {
    const root = mount(<Screen />);
    expect(plates(root)).toBeUndefined();
    act(() => setMode('edit'));
    expect(plates(root).props.accessibilityLabel).toBe('Plate calculator');
    expect(calcModals(root)).toHaveLength(0);
    act(() => plates(root).props.onPress());
    await flush();
    expect(calcModals(root)).toHaveLength(1);
    act(() => { byLabel(root, 'Close plate calculator').props.onPress(); });
    expect(calcModals(root)).toHaveLength(0);
    expect(root.root.findByProps({ testID: 'draft' }).props.children).toBe('unsaved draft');
  });

  test('stays open across a mode switch and never duplicates the modal', async () => {
    const root = mount(<Screen />);
    act(() => setMode('edit'));
    act(() => plates(root).props.onPress());
    await flush();
    act(() => setMode('read'));
    expect(calcModals(root)).toHaveLength(1);
    expect(root.root.findAllByType(PlateCalculatorModal)).toHaveLength(1);
  });
});
