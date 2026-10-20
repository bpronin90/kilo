// Mounted goal / archive / profile / unit / toggle consumers re-read persisted
// storage after an external write (sync pull, backup import) (#1480).
// Read-only: a refresh never writes, never enqueues dirty rows, never syncs.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockOverrides = {};
jest.mock('../storage/entries', () => {
  const actual = jest.requireActual('../storage/entries');
  const wrap = (name) => (...args) => (mockOverrides[name] || actual[name])(...args);
  return { ...actual, loadUserProfile: wrap('loadUserProfile'), loadWeightGoalResult: wrap('loadWeightGoalResult') };
});

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('../lib/platformAlert', () => ({ Alert: { alert: jest.fn() } }));

import * as Storage from '../storage/entries';
import { ProfileScreen } from '../components/ProfileScreen';
import { useWeightGoalForm } from '../hooks/useWeightGoalForm';
import { secureStorage } from '../storage/secureStorage';
import { saveArchivedWeightGoal } from '../storage/entries/weightGoal';
import * as ProfileStorage from '../storage/entries/profileStorage';
import { useArchivedWeightGoals } from '../hooks/entries/weightHooks';
import { useWeightGoal, useUserProfile, useFeatureToggles, reloadPersistedSettingsDomains } from '../hooks/useEntries';
import { useWeightUnit, __resetWeightUnitForTests, setWeightUnitPreference } from '../lib/unitPreference';

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let latest;
function Probe({ id }) {
  const goal = useWeightGoal();
  const archive = useArchivedWeightGoals();
  const profile = useUserProfile();
  const toggles = useFeatureToggles();
  const unit = useWeightUnit();
  latest[id] = { goal, archive, profile, toggles, unit };
  return null;
}

const mountTwo = async () => {
  let r;
  await act(async () => {
    r = TestRenderer.create(<><Probe id="a" /><Probe id="b" /></>);
  });
  await flush();
  return r;
};

beforeEach(async () => {
  latest = {};
  await AsyncStorage.clear();
  __resetWeightUnitForTests();
  jest.restoreAllMocks();
  Object.keys(mockOverrides).forEach((k) => delete mockOverrides[k]);
});

describe('mounted domain refresh (#1480)', () => {
  it('every mounted consumer shows externally written values without remounting', async () => {
    const r = await mountTwo();
    expect(latest.a.goal.goal).toBeNull();
    expect(latest.a.unit).toBe('lb');

    await Storage.saveWeightGoal({ target_weight: 170, target_date: '2026-12-01' });
    await saveArchivedWeightGoal({ id: 'g1', target_weight: 180, archived_at: '2026-01-01', saved_at: '2026-01-01' });
    await Storage.saveUserProfile({ display_name: 'Ben', unit_system: 'metric' });
    await Storage.saveFatigueTrackingEnabled(true);

    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();

    ['a', 'b'].forEach((id) => {
      expect(latest[id].goal.goal.target_weight).toBe(170);
      expect(latest[id].archive.archivedGoals.map((g) => g.id)).toEqual(['g1']);
      expect(latest[id].profile.profile.unit_system).toBe('metric');
      expect(latest[id].unit).toBe('kg');
      expect(latest[id].toggles.fatigueTrackingEnabled).toBe(true);
    });
    r.unmount();
  });

  it('an absent/deleted goal and profile clear the mounted consumers; repeated refresh is stable', async () => {
    await Storage.saveWeightGoal({ target_weight: 170 });
    await Storage.saveUserProfile({ unit_system: 'metric' });
    const r = await mountTwo();
    expect(latest.b.goal.goal.target_weight).toBe(170);
    expect(latest.b.unit).toBe('kg');

    await Storage.clearWeightGoal();
    await Storage.clearUserProfile();
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { reloadPersistedSettingsDomains(); });
      await flush();
    }
    expect(latest.a.goal.goal).toBeNull();
    expect(latest.b.goal.goal).toBeNull();
    expect(latest.a.profile.profile).toBeNull();
    expect(latest.b.unit).toBe('lb');
    r.unmount();
  });

  it('refresh never writes storage', async () => {
    const r = await mountTwo();
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    const multiSet = jest.spyOn(AsyncStorage, 'multiSet');
    setItem.mockClear();
    multiSet.mockClear();
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(setItem).not.toHaveBeenCalled();
    expect(multiSet).not.toHaveBeenCalled();
    r.unmount();
  });

  // Real storage layer (#1480): the lenient loaders turn a failed or corrupt
  // read into null/default, which a refresh must not adopt as "absent".
  const failures = {
    'getItem rejects': () => Promise.reject(new Error('keystore unavailable')),
    'corrupt JSON': () => Promise.resolve('{not json'),
  };
  Object.entries(failures).forEach(([label, fail]) => {
    it(`keeps last durable profile, unit, archive, goal and toggles when the read fails (${label})`, async () => {
      await Storage.saveWeightGoal({ target_weight: 170 });
      await saveArchivedWeightGoal({ id: 'g1', target_weight: 180, archived_at: '2026-01-01', saved_at: '2026-01-01' });
      await Storage.saveUserProfile({ display_name: 'Ben', unit_system: 'metric' });
      await Storage.saveFatigueTrackingEnabled(true);
      await Storage.saveDeloadModeEnabled(true);
      const r = await mountTwo();
      await act(async () => { reloadPersistedSettingsDomains(); });
      await flush();
      expect(latest.a.unit).toBe('kg');
      expect(latest.a.toggles.deloadModeEnabled).toBe(true);
      const real = secureStorage.getItem.bind(secureStorage);
      jest.spyOn(secureStorage, 'getItem').mockImplementation((key) => (
        /profile|archived|goal|fatigue|deload/.test(key) ? fail() : real(key)));
      await act(async () => { reloadPersistedSettingsDomains(); });
      await flush();
      ['a', 'b'].forEach((id) => {
        expect(latest[id].profile.profile.display_name).toBe('Ben');
        expect(latest[id].unit).toBe('kg');
        expect(latest[id].archive.archivedGoals.map((g) => g.id)).toEqual(['g1']);
        expect(latest[id].goal.goal.target_weight).toBe(170);
        expect(latest[id].toggles.fatigueTrackingEnabled).toBe(true);
        expect(latest[id].toggles.deloadModeEnabled).toBe(true);
      });
      r.unmount();
    });
  });

  it('a stale slower profile read cannot overwrite a newer one', async () => {
    await Storage.saveUserProfile({ display_name: 'old' });
    const r = await mountTwo();
    const slow = deferred();
    const real = secureStorage.getItem.bind(secureStorage);
    const spy = jest.spyOn(secureStorage, 'getItem').mockImplementation((key) => (
      /profile/.test(key) ? slow.promise : real(key)));
    await act(async () => { reloadPersistedSettingsDomains(); });
    spy.mockImplementation(real);
    await Storage.saveUserProfile({ display_name: 'new' });
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(latest.a.profile.profile.display_name).toBe('new');
    await act(async () => { slow.resolve(JSON.stringify({ display_name: 'old' })); });
    await flush();
    expect(latest.a.profile.profile.display_name).toBe('new');
    r.unmount();
  });

  it('unmounting during a read neither throws nor applies the result', async () => {
    const r = await mountTwo();
    const slow = deferred();
    mockOverrides.loadWeightGoalResult = () => slow.promise;
    await act(async () => { reloadPersistedSettingsDomains(); });
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { r.unmount(); });
    await act(async () => { slow.resolve({ ok: true, goal: { target_weight: 1 }, error: null }); });
    await flush();
    expect(errors).not.toHaveBeenCalled();
  });

  it('an explicit unit choice made while the refresh read is in flight wins', async () => {
    await Storage.saveUserProfile({ unit_system: 'metric' });
    const r = await mountTwo();
    const slow = deferred();
    jest.spyOn(ProfileStorage, 'loadUserProfileStrict').mockImplementation(() => slow.promise);
    await act(async () => { reloadPersistedSettingsDomains(); });
    await act(async () => { setWeightUnitPreference('lb'); });
    await act(async () => { slow.resolve({ unit_system: 'metric' }); });
    await flush();
    expect(latest.a.unit).toBe('lb');
    r.unmount();
  });
});

// Pristine form copies follow the persisted data; dirty drafts survive (#1480).
describe('form copies of refreshed data (#1480)', () => {
  const sexSelected = (root, label) =>
    root.findAll((n) => n.props?.accessibilityLabel === label && n.props?.accessibilityState)[0]
      .props.accessibilityState.selected;
  const press = (root, label) =>
    root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];

  const renderProfile = async () => {
    let r;
    await act(async () => { r = TestRenderer.create(<ProfileScreen onBack={() => {}} />); });
    await flush();
    return r;
  };

  it('ProfileScreen: a pristine form follows an external profile change', async () => {
    await Storage.saveUserProfile({ sex: 'male' });
    const r = await renderProfile();
    expect(sexSelected(r.root, 'Male')).toBe(true);
    await Storage.saveUserProfile({ sex: 'female' });
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(sexSelected(r.root, 'Female')).toBe(true);
    expect(sexSelected(r.root, 'Male')).toBe(false);
    r.unmount();
  });

  it('ProfileScreen: a dirty draft survives a refresh', async () => {
    await Storage.saveUserProfile({ sex: 'male' });
    const r = await renderProfile();
    await act(async () => { press(r.root, 'Female').props.onPress(); });
    await Storage.saveUserProfile({ sex: 'male', display_name: 'Other' });
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(sexSelected(r.root, 'Female')).toBe(true);
    r.unmount();
  });

  it('ProfileScreen: external deletion clears a pristine form', async () => {
    await Storage.saveUserProfile({ sex: 'male' });
    const r = await renderProfile();
    await Storage.clearUserProfile();
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(sexSelected(r.root, 'Male')).toBe(false);
    r.unmount();
  });

  function GoalProbe({ out }) {
    const { goal } = useWeightGoal();
    out.form = useWeightGoalForm(goal, jest.fn(), jest.fn(), jest.fn(), true, undefined, 'lb', goal);
    return null;
  }
  const renderGoal = async () => {
    const out = {};
    let r;
    await act(async () => { r = TestRenderer.create(<GoalProbe out={out} />); });
    await flush();
    return { out, r };
  };

  it('goal form: pristine seed follows external replacement and deletion', async () => {
    await Storage.saveWeightGoal({ target_weight: 170, target_date: '2026-12-01' });
    const { out, r } = await renderGoal();
    expect(out.form.goalTargetWeight).toBe('170');
    await Storage.saveWeightGoal({ target_weight: 160, target_date: '2026-11-01' });
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(out.form.goalTargetWeight).toBe('160');
    await Storage.clearWeightGoal();
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(out.form.goalTargetWeight).toBe('');
    r.unmount();
  });

  it('goal form: a draft typed while editing survives a refresh', async () => {
    await Storage.saveWeightGoal({ target_weight: 170, target_date: '2026-12-01' });
    const { out, r } = await renderGoal();
    await act(async () => { out.form.startEditGoal(); });
    await act(async () => { out.form.setGoalTargetWeight('155'); });
    await Storage.clearWeightGoal();
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(out.form.goalTargetWeight).toBe('155');
    r.unmount();
  });

  it('goal form: a creation-form draft survives an external goal arriving', async () => {
    const { out, r } = await renderGoal();
    await act(async () => { out.form.setGoalTargetWeight('155'); });
    await Storage.saveWeightGoal({ target_weight: 180, target_date: '2026-12-01' });
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(out.form.goalTargetWeight).toBe('155');
    r.unmount();
  });

  it('goal form: a dirty date or manual start also keeps the creation draft', async () => {
    const { out, r } = await renderGoal();
    await act(async () => { out.form.setGoalStartWeight('190'); });
    await Storage.saveWeightGoal({ target_weight: 180, target_date: '2026-12-01' });
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(out.form.goalStartWeight).toBe('190');
    expect(out.form.goalTargetWeight).toBe('');
    r.unmount();
  });

  it('goal form: a pristine creation form adopts an external goal', async () => {
    const { out, r } = await renderGoal();
    await Storage.saveWeightGoal({ target_weight: 180, target_date: '2026-12-01' });
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(out.form.goalTargetWeight).toBe('180');
    expect(out.form.goalTargetDate).toBe('2026-12-01');
    r.unmount();
  });

  it('goal form: an edit-mode draft survives an external replacement', async () => {
    await Storage.saveWeightGoal({ target_weight: 170, target_date: '2026-12-01' });
    const { out, r } = await renderGoal();
    await act(async () => { out.form.startEditGoal(); });
    await act(async () => { out.form.setGoalTargetWeight('155'); });
    await Storage.saveWeightGoal({ target_weight: 160, target_date: '2026-11-01' });
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(out.form.goalTargetWeight).toBe('155');
    r.unmount();
  });

  it('goal form: cancel resets the baseline so the form follows the persisted goal again', async () => {
    await Storage.saveWeightGoal({ target_weight: 170, target_date: '2026-12-01' });
    const { out, r } = await renderGoal();
    await act(async () => { out.form.startEditGoal(); });
    await act(async () => { out.form.setGoalTargetWeight('155'); });
    await act(async () => { out.form.cancelEditGoal(); });
    expect(out.form.goalTargetWeight).toBe('170');
    await Storage.saveWeightGoal({ target_weight: 160, target_date: '2026-11-01' });
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(out.form.goalTargetWeight).toBe('160');
    r.unmount();
  });
});
