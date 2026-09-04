import React from 'react';
import renderer, { act } from 'react-test-renderer';
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
