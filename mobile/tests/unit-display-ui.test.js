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

  test('kg mode converts row values and the change delta', async () => {
    setWeightUnitPreference('kg');
    let component;
    await act(async () => {
      component = renderer.create(<WeightHistoryList {...baseProps} />);
    });
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
