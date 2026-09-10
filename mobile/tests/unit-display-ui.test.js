// kg display-mode rendering + Settings selector persistence (#441).

import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });

import { SetLine } from '../components/UI';
import { WeightHistoryList } from '../components/WeightHistoryList';
import { SettingsScreen } from '../components/SettingsScreen';
import { setWeightUnitPreference, __resetWeightUnitForTests } from '../lib/unitPreference';

const mockSaveProfile = jest.fn().mockResolvedValue({});
const mockUserProfileState = {
  profile: { display_name: 'Ben' },
  loading: false,
};
jest.mock('../hooks/useEntries', () => ({
  useFeatureToggles: () => ({
    fatigueTrackingEnabled: true,
    deloadModeEnabled: true,
    setFatigueTrackingEnabled: jest.fn(),
    setDeloadModeEnabled: jest.fn(),
  }),
  useUserProfile: () => ({
    profile: mockUserProfileState.profile,
    save: mockSaveProfile,
    loading: mockUserProfileState.loading,
    clear: jest.fn(),
  }),
}));

function allTexts(root) {
  return root.findAllByType('Text').map((t) => {
    const c = t.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });
}

afterEach(() => {
  __resetWeightUnitForTests();
  mockSaveProfile.mockClear();
  mockUserProfileState.profile = { display_name: 'Ben' };
  mockUserProfileState.loading = false;
});

describe('SetLine unit display', () => {
  const sets = [
    { weight_value: 225, rep_count: 5 },
    { weight_value: 225, rep_count: 5 },
    { weight_value: null, rep_count: 10 },
  ];

  test('renders lb by default, identical to the pre-#441 output', async () => {
    let component;
    await act(async () => {
      component = renderer.create(<SetLine sets={sets} />);
    });
    const texts = allTexts(component.root);
    expect(texts).toContain('225 lb');
    expect(texts).toContain('BW');
  });

  test('renders converted kg values when the preference is kg', async () => {
    setWeightUnitPreference('kg');
    let component;
    await act(async () => {
      component = renderer.create(<SetLine sets={sets} />);
    });
    const texts = allTexts(component.root);
    expect(texts).toContain('102.1 kg');
    expect(texts).toContain('BW');
    expect(texts.some((t) => t.includes('lb'))).toBe(false);
  });

  // User-reported item 4: "Kilogram values being announced as pounds."
  // Confirmed defect: the plate-calculator tap's accessibilityLabel
  // hardcoded "pounds" regardless of display preference, so a kg-displayed
  // weight ("102.1 kg" on screen) was announced to a screen reader as
  // "pounds." Fixed: the label now uses the same value/unit shown visually.
  test('the plate-calculator tap announces kilograms, not pounds, when displaying in kg (user item 4)', async () => {
    setWeightUnitPreference('kg');
    let component;
    await act(async () => {
      component = renderer.create(<SetLine sets={sets} />);
    });
    const pressable = component.root.findAll(
      (n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show plate loading')
    )[0];
    expect(pressable).toBeTruthy();
    expect(pressable.props.accessibilityLabel).toBe('Show plate loading for 102.1 kilograms');
    expect(pressable.props.accessibilityLabel).not.toContain('pounds');
  });

  test('the plate-calculator tap still announces pounds when displaying in lb', async () => {
    let component;
    await act(async () => {
      component = renderer.create(<SetLine sets={sets} />);
    });
    const pressable = component.root.findAll(
      (n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show plate loading')
    )[0];
    expect(pressable.props.accessibilityLabel).toBe('Show plate loading for 225 pounds');
  });
});

describe('WeightHistoryList unit display', () => {
  const entries = [
    { id: 'a', weight_value: 185.2, logged_at: '2026-05-24T08:00:00Z', note: '' },
    { id: 'b', weight_value: 186.4, logged_at: '2026-05-23T08:00:00Z', note: '' },
  ];
  const baseProps = {
    entries,
    editingId: null,
    handleEditEntry: jest.fn(),
    handleDelete: jest.fn(),
    getWeightDeltaSeverity: () => 'normal',
    goalInfo: null,
  };

  // WeightHistoryList is collapsed by default (#898); expand to see rows.
  async function expandHistory(component) {
    await act(async () => {
      component.root.findByProps({ accessibilityLabel: 'Expand history' }).props.onPress();
    });
  }

  test('kg mode converts row values and the change delta', async () => {
    setWeightUnitPreference('kg');
    let component;
    await act(async () => {
      component = renderer.create(<WeightHistoryList {...baseProps} />);
    });
    await expandHistory(component);
    const texts = allTexts(component.root);
    expect(texts).toContain('84.0 kg'); // 185.2 lb
    expect(texts).toContain('84.5 kg'); // 186.4 lb → 84.5496 → one decimal
    expect(texts).toContain('-0.5');    // −1.2 lb delta → −0.544 kg → -0.5
  });

  test('lb mode is unchanged', async () => {
    let component;
    await act(async () => {
      component = renderer.create(<WeightHistoryList {...baseProps} />);
    });
    await expandHistory(component);
    const texts = allTexts(component.root);
    expect(texts).toContain('185.2 lb');
    expect(texts).toContain('-1.2');
  });
});

describe('Settings unit selector', () => {
  test('selecting kg persists unit_system: metric on the profile', async () => {
    let component;
    await act(async () => {
      component = renderer.create(
        <SettingsScreen
          onBack={() => {}}
          multiplier={1.07}
          onUpdate={() => {}}
          weightDateEditEnabled={false}
          onUpdateWeightDateEditEnabled={() => {}}
          deloadDateEditEnabled={false}
          onUpdateDeloadDateEditEnabled={() => {}}
        />
      );
    });
    const kgTab = component.root.findAllByProps({ accessibilityLabel: 'Show weights in kilograms' })
      .filter((n) => n.props.onPress)[0];
    await act(async () => {
      await kgTab.props.onPress();
    });
    expect(mockSaveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: 'Ben', unit_system: 'metric' })
    );
  });

  test('selecting lb persists unit_system: imperial', async () => {
    setWeightUnitPreference('kg');
    let component;
    await act(async () => {
      component = renderer.create(
        <SettingsScreen
          onBack={() => {}}
          multiplier={1.07}
          onUpdate={() => {}}
          weightDateEditEnabled={false}
          onUpdateWeightDateEditEnabled={() => {}}
          deloadDateEditEnabled={false}
          onUpdateDeloadDateEditEnabled={() => {}}
        />
      );
    });
    const lbTab = component.root.findAllByProps({ accessibilityLabel: 'Show weights in pounds' })
      .filter((n) => n.props.onPress)[0];
    await act(async () => {
      await lbTab.props.onPress();
    });
    expect(mockSaveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ unit_system: 'imperial' })
    );
  });

  test('does not persist while the profile is still loading', async () => {
    mockUserProfileState.profile = null;
    mockUserProfileState.loading = true;
    let component;
    await act(async () => {
      component = renderer.create(
        <SettingsScreen
          onBack={() => {}}
          multiplier={1.07}
          onUpdate={() => {}}
          weightDateEditEnabled={false}
          onUpdateWeightDateEditEnabled={() => {}}
          deloadDateEditEnabled={false}
          onUpdateDeloadDateEditEnabled={() => {}}
        />
      );
    });
    const kgTab = component.root.findAllByProps({ accessibilityLabel: 'Show weights in kilograms' })
      .filter((n) => n.props.onPress)[0];
    expect(kgTab.props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      await kgTab.props.onPress();
    });
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });
});

// #1018: the Appearance and Weight unit selectors share one compact segmented
// style — a transparent ≥44dp target box around a compact visible pill — and
// the explanatory copy is plain language (Theme has none at all).
describe('More settings polish (#1018)', () => {
  const { StyleSheet } = require('react-native');

  async function renderSettings() {
    let component;
    await act(async () => {
      component = renderer.create(
        <SettingsScreen onBack={() => {}} multiplier={1.07} onUpdate={() => {}} />
      );
    });
    return component;
  }

  function tab(root, label) {
    return root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];
  }

  test.each([
    'Show weights in pounds',
    'Show weights in kilograms',
    'Use the light appearance',
    'Follow the device appearance',
  ])('%s is a ≥44dp target box with no pill-height stretch and no visual on the target itself', async (label) => {
    const component = await renderSettings();
    const pressable = tab(component.root, label);
    const style = StyleSheet.flatten(pressable.props.style) || {};

    expect(style.minHeight).toBe(44);
    expect(style.minWidth).toBe(44);
    // The visible treatment lives on the inner pill, not the target.
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();

    const pill = pressable.findAll(
      (n) => n.type === 'View' && (StyleSheet.flatten(n.props.style) || {}).paddingVertical === 6
    )[0];
    expect(pill).toBeTruthy();
    const pillStyle = StyleSheet.flatten(pill.props.style) || {};
    // Compact: the pill is padded, not forced to the target height.
    expect(pillStyle.minHeight).toBeUndefined();
    expect(pillStyle.height).toBeUndefined();
    expect(pillStyle.borderRadius).toBe(8);
  });

  test('Theme has no explanatory line; Weight unit and Fatigue multiplier read plainly', async () => {
    const component = await renderSettings();
    const texts = allTexts(component.root);
    expect(texts).toContain('Theme');
    expect(texts.some((t) => /follow your device/i.test(t) || /Applies everywhere/i.test(t))).toBe(false);
    expect(texts.some((t) => /Shows body weight and lifts in pounds or kilograms\. Your notes and saved data stay in lb\./.test(t))).toBe(true);
    expect(texts.some((t) => /Scales your logged-set strength estimates to produce the Kilo Max shown in Analytics\./.test(t))).toBe(true);
    // The knob multiplies an average of per-set estimates by 1.00–2.00; it does
    // not "adjust Est. Max down", so the copy must not claim that direction.
    expect(texts.some((t) => /Est\. Max down/i.test(t))).toBe(false);
    expect(texts.some((t) => /Deload mode/i.test(t))).toBe(true);
    expect(texts.some((t) => /hidden while a Recovery block is active/i.test(t))).toBe(true);
  });
});
