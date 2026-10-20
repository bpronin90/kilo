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

import * as Storage from '../storage/entries';
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

  it('a read rejection keeps the last durable values and does not throw', async () => {
    await Storage.saveUserProfile({ unit_system: 'metric' });
    const r = await mountTwo();
    jest.spyOn(ProfileStorage, 'loadUserProfile').mockRejectedValue(new Error('read failed'));
    mockOverrides.loadUserProfile = () => Promise.reject(new Error('read failed'));
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(latest.a.profile.profile.unit_system).toBe('metric');
    expect(latest.a.unit).toBe('kg');
    r.unmount();
  });

  it('a stale slower profile read cannot overwrite a newer one', async () => {
    await Storage.saveUserProfile({ display_name: 'old' });
    const r = await mountTwo();
    const slow = deferred();
    mockOverrides.loadUserProfile = () => slow.promise;
    await act(async () => { reloadPersistedSettingsDomains(); });
    delete mockOverrides.loadUserProfile;
    await Storage.saveUserProfile({ display_name: 'new' });
    await act(async () => { reloadPersistedSettingsDomains(); });
    await flush();
    expect(latest.a.profile.profile.display_name).toBe('new');
    await act(async () => { slow.resolve({ display_name: 'old' }); });
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
    jest.spyOn(ProfileStorage, 'loadUserProfile').mockImplementation(() => slow.promise);
    await act(async () => { reloadPersistedSettingsDomains(); });
    await act(async () => { setWeightUnitPreference('lb'); });
    await act(async () => { slow.resolve({ unit_system: 'metric' }); });
    await flush();
    expect(latest.a.unit).toBe('lb');
    r.unmount();
  });
});
