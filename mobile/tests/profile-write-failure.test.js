// Profile writes must not fail silently (#909).
//
// Two flows, both of which used to swallow a rejected write:
//   - the Settings weight-unit selector, which caught and discarded the
//     saveProfile rejection, leaving the tab claiming a persisted choice that
//     reverts on the next launch;
//   - the Profile screen's destructive `Clear All`, which awaited clearAll()
//     with no catch at all — an unhandled rejection, no report, and a screen
//     that stays populated.
//
// These tests drive the real screens with a rejecting hook and assert what the
// user can actually see and reach: the in-place report, a retry that does not
// require switching units and back, a session preference that is not rolled
// back, and an unchanged success path.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });

jest.mock('@react-native-community/datetimepicker', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return ReactLocal.createElement(View, props);
  };
});

// The reminder card's storage/scheduler dependencies are irrelevant here.
jest.mock('../components/ReminderSettingsCard', () => ({ ReminderSettingsCard: () => null }));

jest.mock('../lib/platformAlert', () => ({ Alert: { alert: jest.fn() } }));

const mockSaveProfile = jest.fn();
const mockClearProfile = jest.fn();
const mockProfileState = { profile: { display_name: 'Ben', sex: 'male' }, loading: false };

// The real useUserProfile advances `profile` to the saved record on success and
// leaves it untouched on rejection. The screen's "is this actually stored?"
// check reads that field, so the mock has to behave the same way.
function resolveSave() {
  mockSaveProfile.mockReset().mockImplementation(async (next) => {
    mockProfileState.profile = { ...next };
    return mockProfileState.profile;
  });
}

function rejectSave() {
  mockSaveProfile.mockReset().mockRejectedValue(new Error('offline'));
}

jest.mock('../hooks/useEntries', () => ({
  useFeatureToggles: () => ({
    fatigueTrackingEnabled: true,
    deloadModeEnabled: false,
    setFatigueTrackingEnabled: jest.fn(),
    setDeloadModeEnabled: jest.fn(),
  }),
  useUserProfile: () => ({
    profile: mockProfileState.profile,
    loading: mockProfileState.loading,
    save: mockSaveProfile,
    clear: mockClearProfile,
  }),
}));

import { Alert } from '../lib/platformAlert';
import { SettingsScreen, __resetUnitSaveStateForTests } from '../components/SettingsScreen';
import { ProfileScreen } from '../components/ProfileScreen';
import { getWeightUnit, __resetWeightUnitForTests } from '../lib/unitPreference';

beforeEach(() => {
  __resetWeightUnitForTests();
  __resetUnitSaveStateForTests();
  mockProfileState.profile = { display_name: 'Ben', sex: 'male', unit_system: 'imperial' };
  mockProfileState.loading = false;
  resolveSave();
  mockClearProfile.mockReset().mockResolvedValue(undefined);
  Alert.alert.mockReset();
});

function allTexts(root) {
  return root.findAllByType('Text').map((t) => {
    const c = t.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });
}

function pressableByLabel(root, label) {
  return root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];
}

async function renderSettings() {
  let component;
  await act(async () => {
    component = renderer.create(
      <SettingsScreen onBack={() => {}} multiplier={1.07} onUpdate={() => {}} />
    );
  });
  return component;
}

async function press(node) {
  await act(async () => {
    await node.props.onPress();
  });
}

const REPORT_PREFIX = "Couldn't save the weight unit";

function unitReport(component) {
  return allTexts(component.root).find((t) => t.startsWith(REPORT_PREFIX));
}

describe('Settings weight unit — failed save is reported in place', () => {
  test('a rejected save reports the failure next to the control, naming both the session unit and the stored one', async () => {
    rejectSave();
    const component = await renderSettings();

    await press(pressableByLabel(component.root, 'Show weights in kilograms'));

    const message = unitReport(component);
    expect(message).toBeDefined();
    expect(message).toContain('kg applies for this session');
    expect(message).toContain('the app will open in lb until this saves');
  });

  test('the session preference is not rolled back and the selected tab still matches it', async () => {
    rejectSave();
    const component = await renderSettings();

    await press(pressableByLabel(component.root, 'Show weights in kilograms'));

    expect(getWeightUnit()).toBe('kg');
    const kgTab = pressableByLabel(component.root, 'Show weights in kilograms');
    expect(kgTab.props.accessibilityState.selected).toBe(true);
  });

  test('Retry is reachable from the report and re-attempts the same unit', async () => {
    rejectSave();
    const component = await renderSettings();
    await press(pressableByLabel(component.root, 'Show weights in kilograms'));

    resolveSave();
    await press(pressableByLabel(component.root, 'Retry'));

    expect(mockSaveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ unit_system: 'metric' })
    );
    expect(unitReport(component)).toBeUndefined();
    expect(getWeightUnit()).toBe('kg');
  });

  test('re-tapping the already-selected tab retries, without switching to the other unit first', async () => {
    rejectSave();
    const component = await renderSettings();
    await press(pressableByLabel(component.root, 'Show weights in kilograms'));
    expect(mockSaveProfile).toHaveBeenCalledTimes(1);

    await press(pressableByLabel(component.root, 'Show weights in kilograms'));

    expect(mockSaveProfile).toHaveBeenCalledTimes(2);
    expect(mockSaveProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ unit_system: 'metric' })
    );
  });

  test('a successful save reports nothing, and re-tapping the selected tab stays a no-op', async () => {
    const component = await renderSettings();

    await press(pressableByLabel(component.root, 'Show weights in kilograms'));
    expect(mockSaveProfile).toHaveBeenCalledTimes(1);
    expect(unitReport(component)).toBeUndefined();

    await press(pressableByLabel(component.root, 'Show weights in kilograms'));
    expect(mockSaveProfile).toHaveBeenCalledTimes(1);
  });

  test('switching to the other unit after a failure persists that unit and clears the report', async () => {
    rejectSave();
    const component = await renderSettings();
    await press(pressableByLabel(component.root, 'Show weights in kilograms'));

    resolveSave();
    await press(pressableByLabel(component.root, 'Show weights in pounds'));

    expect(mockSaveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ unit_system: 'imperial' })
    );
    expect(getWeightUnit()).toBe('lb');
    expect(unitReport(component)).toBeUndefined();
  });
});

// Both cases below come from the #909 review of af745361.
describe('Settings weight unit — the report tracks what is stored, not one screen mount', () => {
  test('leaving and re-entering Settings still reports the unsaved unit, and re-tapping it retries', async () => {
    rejectSave();
    const first = await renderSettings();
    await press(pressableByLabel(first.root, 'Show weights in kilograms'));
    expect(unitReport(first)).toBeDefined();

    // MoreScreen unmounts SettingsScreen on Back; the module-level preference
    // survives, so the report about it has to survive too.
    await act(async () => { first.unmount(); });
    const second = await renderSettings();

    expect(getWeightUnit()).toBe('kg');
    expect(unitReport(second)).toBeDefined();

    resolveSave();
    await press(pressableByLabel(second.root, 'Show weights in kilograms'));
    expect(mockSaveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ unit_system: 'metric' })
    );
    expect(unitReport(second)).toBeUndefined();
  });

  test('failing to write the unit that is already stored promises no reversion', async () => {
    rejectSave();
    const component = await renderSettings();
    // lb is what is stored; go to kg (fails), then back to lb (also fails).
    await press(pressableByLabel(component.root, 'Show weights in kilograms'));
    expect(unitReport(component)).toBeDefined();

    await press(pressableByLabel(component.root, 'Show weights in pounds'));

    // The write failed, but lb is the stored value: nothing will revert, so
    // there is nothing to claim.
    expect(getWeightUnit()).toBe('lb');
    expect(unitReport(component)).toBeUndefined();
  });

  test('a profile whose stored unit was never written by this screen is not misreported as a failed save', async () => {
    // e.g. syncAdapter merging a pulled unit_system straight into the profile.
    mockProfileState.profile = { display_name: 'Ben', unit_system: 'metric' };
    const component = await renderSettings();

    expect(getWeightUnit()).toBe('lb');
    expect(unitReport(component)).toBeUndefined();
  });
});

describe('Profile Clear All — failed clear is reported and changes nothing', () => {
  async function renderProfile() {
    let component;
    await act(async () => {
      component = renderer.create(<ProfileScreen onBack={() => {}} />);
    });
    return component;
  }

  // `Clear All` opens a confirm; the destructive button's onPress is the flow
  // under test.
  function confirmClear() {
    const [, , buttons] = Alert.alert.mock.calls[0];
    return buttons.find((b) => b.text === 'Clear All');
  }

  test('a rejected clear reports the failure, leaves the profile on screen, and does not reject', async () => {
    mockClearProfile.mockRejectedValue(new Error('storage failure'));
    const component = await renderProfile();

    await press(pressableByLabel(component.root, 'Clear All'));
    const confirm = confirmClear();
    await act(async () => {
      // Resolving rather than rejecting is the point: the old code let this
      // escape as an unhandled rejection.
      await expect(confirm.onPress()).resolves.toBeUndefined();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Failed to clear profile.');
    expect(pressableByLabel(component.root, 'Male').props.accessibilityState.selected).toBe(true);
    expect(getWeightUnit()).toBe('lb');
  });

  test('a successful clear empties the screen and resets the display unit', async () => {
    const component = await renderProfile();

    await press(pressableByLabel(component.root, 'Clear All'));
    await act(async () => {
      await confirmClear().onPress();
    });

    expect(mockClearProfile).toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1); // only the confirm
    expect(pressableByLabel(component.root, 'Male').props.accessibilityState.selected).toBe(false);
    expect(getWeightUnit()).toBe('lb');
  });
});
