import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { PlateCalculatorModal } from '../components/PlateCalculatorModal';
import { ThemeProvider } from '../theme/ThemeContext';
import { defaultPlateCalculatorProfile } from '../lib/plateMath';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

const mockLoad = jest.fn();
const mockSave = jest.fn(async () => {});
jest.mock('../storage/entries', () => ({
  loadPlateCalculatorProfile: (...args) => mockLoad(...args),
  savePlateCalculatorProfile: (...args) => mockSave(...args),
}));

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function joinedText(node) {
  return (node.children || []).filter((c) => typeof c === 'string').join('');
}

function findByText(root, text) {
  return root.findAll((n) => n.type === 'Text' && joinedText(n).includes(text));
}

// User-reported item 2: "Unit switching overwriting the wrong equipment
// profile." Confirmed defect: the unit toggle is reachable while an
// inventory edit is in progress (it renders above, not inside, the editing
// branch), and switching units did not reset the in-progress `editing`/
// `draft` state — so a draft seeded from the OLD unit's profile, if Saved
// after switching, would write the OLD unit's numeric values into the NEW
// unit's profile slot. Fixed: switching units now always discards any
// in-progress edit.
describe('PlateCalculatorModal — switching units discards an in-progress edit (user item 2)', () => {
  test('switching from lb to kg mid-edit exits edit mode instead of carrying the lb draft into the kg profile', async () => {
    mockLoad.mockResolvedValue(defaultPlateCalculatorProfile());
    let root;
    await act(async () => {
      root = renderer.create(
        <ThemeProvider>
          <PlateCalculatorModal visible weightLb={225} onClose={() => {}} />
        </ThemeProvider>
      );
    });
    await flush();

    // Enter edit mode for lb (the default active unit).
    const editLinkText = findByText(root.root, 'Edit lb bar')[0];
    expect(editLinkText).toBeTruthy();
    let editLinkPressable = editLinkText.parent;
    while (editLinkPressable && typeof editLinkPressable.props.onPress !== 'function') {
      editLinkPressable = editLinkPressable.parent;
    }
    expect(editLinkPressable).toBeTruthy();
    act(() => { editLinkPressable.props.onPress(); });

    // Confirm we're now showing the edit form (a "Save" action exists).
    expect(findByText(root.root, 'Save').length).toBeGreaterThan(0);

    // Switch to kg mid-edit.
    const kgToggle = root.root.find((n) => n.props.accessibilityLabel === 'Use kg bar and plates');
    act(() => { kgToggle.props.onPress(); });
    await flush();

    // Edit mode must be exited — no Save/Cancel edit-form buttons visible —
    // rather than carrying the lb draft over and letting it be saved into
    // profiles.kg.
    expect(findByText(root.root, 'Save').length).toBe(0);
    expect(findByText(root.root, 'Edit kg bar').length).toBe(1);

    act(() => { root.unmount(); });
  });

  test('the persisted save when switching units only ever changes activeUnit, never the profiles themselves', async () => {
    mockSave.mockClear();
    mockLoad.mockResolvedValue(defaultPlateCalculatorProfile());
    let root;
    await act(async () => {
      root = renderer.create(
        <ThemeProvider>
          <PlateCalculatorModal visible weightLb={225} onClose={() => {}} />
        </ThemeProvider>
      );
    });
    await flush();

    const kgToggle = root.root.find((n) => n.props.accessibilityLabel === 'Use kg bar and plates');
    act(() => { kgToggle.props.onPress(); });
    await flush();

    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0][0];
    const defaults = defaultPlateCalculatorProfile();
    expect(saved.activeUnit).toBe('kg');
    expect(saved.profiles).toEqual(defaults.profiles); // unchanged

    act(() => { root.unmount(); });
  });
});

// #577 review (Codex, post-freeze) finding 3: Save must normalize ONCE and
// use the same result for both component state and persistence — never
// publish the raw, unvalidated draft to state while persistence
// independently normalizes a second time.
describe('PlateCalculatorModal — Save normalizes once, before both state and persistence (user item 3 / Codex finding 3)', () => {
  async function openAndEnterEdit() {
    mockLoad.mockResolvedValue(defaultPlateCalculatorProfile());
    let root;
    await act(async () => {
      root = renderer.create(
        <ThemeProvider>
          <PlateCalculatorModal visible weightLb={225} onClose={() => {}} />
        </ThemeProvider>
      );
    });
    await flush();
    const editLinkText = findByText(root.root, 'Edit lb bar')[0];
    let editLinkPressable = editLinkText.parent;
    while (editLinkPressable && typeof editLinkPressable.props.onPress !== 'function') {
      editLinkPressable = editLinkPressable.parent;
    }
    act(() => { editLinkPressable.props.onPress(); });
    return root;
  }

  test('an empty bar-weight field (Number("") === 0, invalid) normalizes to the SAME default in both state and the persisted save', async () => {
    mockSave.mockClear();
    const root = await openAndEnterEdit();

    const barInput = root.root.find((n) => n.props.accessibilityLabel === 'Bar weight in lb');
    act(() => { barInput.props.onChangeText(''); });
    const saveText = findByText(root.root, 'Save')[0];
    let saveBtn = saveText.parent;
    while (saveBtn && typeof saveBtn.props.onPress !== 'function') saveBtn = saveBtn.parent;
    act(() => { saveBtn.props.onPress(); });

    expect(mockSave).toHaveBeenCalledTimes(1);
    const persisted = mockSave.mock.calls[0][0];
    const defaults = defaultPlateCalculatorProfile();
    // Invalid input normalizes to the hard default bar weight — and,
    // critically, the SAME value the modal now displays.
    expect(persisted.profiles.lb.barWeight).toBe(defaults.profiles.lb.barWeight);
    expect(findByText(root.root, `${defaults.profiles.lb.barWeight}`).length).toBeGreaterThan(0);

    act(() => { root.unmount(); });
  });

  test('an excessive plate count normalizes identically in state and the persisted save (falls back to the default inventory, not a mismatched raw value)', async () => {
    mockSave.mockClear();
    const root = await openAndEnterEdit();

    // The default lb profile's largest plate (45) accepts a count input;
    // set it to something far beyond MAX_COUNT_PER_SIZE (50).
    const countInput = root.root.find((n) => n.props.accessibilityLabel === '45 lb plates available per side');
    act(() => { countInput.props.onChangeText('999'); });
    const saveText = findByText(root.root, 'Save')[0];
    let saveBtn = saveText.parent;
    while (saveBtn && typeof saveBtn.props.onPress !== 'function') saveBtn = saveBtn.parent;
    act(() => { saveBtn.props.onPress(); });

    expect(mockSave).toHaveBeenCalledTimes(1);
    const persisted = mockSave.mock.calls[0][0];
    const defaults = defaultPlateCalculatorProfile();
    // The whole inventory list is invalid (one entry exceeds
    // MAX_COUNT_PER_SIZE) and falls back to the default lb inventory —
    // identically in both what was saved and what the modal now shows.
    expect(persisted.profiles.lb.platesPerSide).toEqual(defaults.profiles.lb.platesPerSide);
    // Re-open the edit form and confirm the DISPLAYED draft (seeded from
    // component state, not re-read from storage) also reflects the
    // fallback default — proving state and persistence agree, not just
    // that persistence alone was correct.
    const editLinkAgain = findByText(root.root, 'Edit lb bar')[0];
    let editBtnAgain = editLinkAgain.parent;
    while (editBtnAgain && typeof editBtnAgain.props.onPress !== 'function') editBtnAgain = editBtnAgain.parent;
    act(() => { editBtnAgain.props.onPress(); });
    const reopenedCountInput = root.root.find((n) => n.props.accessibilityLabel === '45 lb plates available per side');
    const defaultCount45 = defaults.profiles.lb.platesPerSide.find((p) => p.size === 45).count;
    expect(reopenedCountInput.props.value).toBe(String(defaultCount45));

    act(() => { root.unmount(); });
  });

  test('saving zero for every denomination preserves an editable empty inventory', async () => {
    mockSave.mockClear();
    const root = await openAndEnterEdit();

    const countInputs = root.root.findAll((n) => (
      typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.endsWith('plates available per side')
    ));
    expect(countInputs.length).toBeGreaterThan(0);
    act(() => {
      countInputs.forEach((input) => input.props.onChangeText('0'));
    });

    const saveText = findByText(root.root, 'Save')[0];
    let saveBtn = saveText.parent;
    while (saveBtn && typeof saveBtn.props.onPress !== 'function') saveBtn = saveBtn.parent;
    act(() => { saveBtn.props.onPress(); });

    const persisted = mockSave.mock.calls[0][0];
    expect(persisted.profiles.lb.platesPerSide.every((plate) => plate.count === 0)).toBe(true);

    const editLinkAgain = findByText(root.root, 'Edit lb bar')[0];
    let editBtnAgain = editLinkAgain.parent;
    while (editBtnAgain && typeof editBtnAgain.props.onPress !== 'function') editBtnAgain = editBtnAgain.parent;
    act(() => { editBtnAgain.props.onPress(); });
    const reopenedInputs = root.root.findAll((n) => (
      typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.endsWith('plates available per side')
    ));
    expect(reopenedInputs.every((input) => input.props.value === '0')).toBe(true);

    act(() => { root.unmount(); });
  });

  test('keeps the inventory actions reachable with a keyboard-avoiding scroll container', async () => {
    const root = await openAndEnterEdit();

    expect(root.root.findAllByType(KeyboardAvoidingView)).toHaveLength(1);
    const editScroll = root.root.findAllByType(ScrollView);
    expect(editScroll).toHaveLength(1);
    expect(editScroll[0].props.keyboardShouldPersistTaps).toBe('handled');
    expect(findByText(root.root, 'Save')).toHaveLength(1);
    expect(findByText(root.root, 'Cancel')).toHaveLength(1);

    act(() => { root.unmount(); });
  });
});
