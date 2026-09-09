import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  loadProgressionSuggestionsEnabled,
  saveProgressionSuggestionsEnabled,
  loadProgressionSuggestionMutes,
  saveProgressionSuggestionMutes,
  setProgressionSuggestionMuted,
  getProgressionSuggestionSettings,
  hydrateProgressionSuggestionSettings,
  subscribeProgressionSuggestionSettings,
  __resetProgressionSuggestionSettingsForTests,
} from '../storage/entries/settings';

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });

const mockSaveProfile = jest.fn().mockResolvedValue({});
jest.mock('../hooks/useEntries', () => ({
  useFeatureToggles: () => ({
    fatigueTrackingEnabled: false,
    deloadModeEnabled: false,
    setFatigueTrackingEnabled: jest.fn(),
    setDeloadModeEnabled: jest.fn(),
  }),
  useUserProfile: () => ({
    profile: { display_name: 'Ben' },
    save: mockSaveProfile,
    loading: false,
    clear: jest.fn(),
  }),
}));

// Imported after the mock is registered.
const { SettingsScreen } = require('../components/SettingsScreen');

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  __resetProgressionSuggestionSettingsForTests();
});

describe('progression-suggestion mute set storage (#960)', () => {
  test('defaults to an empty set when nothing is stored', async () => {
    expect(await loadProgressionSuggestionMutes()).toEqual([]);
  });

  test('persists and reloads a normalized, deduped set', async () => {
    await saveProgressionSuggestionMutes(['bench press', 'bench press', '  squat  ', 42, null, '']);
    expect(await loadProgressionSuggestionMutes()).toEqual(['bench press', 'squat']);
  });

  test('degrades a malformed stored value to an empty set rather than a wrong one', async () => {
    await AsyncStorage.setItem('kilo_progression_suggestion_mutes', JSON.stringify({ bench: true }));
    expect(await loadProgressionSuggestionMutes()).toEqual([]);
    await AsyncStorage.setItem('kilo_progression_suggestion_mutes', 'not json');
    expect(await loadProgressionSuggestionMutes()).toEqual([]);
  });

  test('setProgressionSuggestionMuted adds and removes a single key', async () => {
    await setProgressionSuggestionMuted('bench press', true);
    expect(await loadProgressionSuggestionMutes()).toEqual(['bench press']);
    await setProgressionSuggestionMuted('squat', true);
    expect(new Set(await loadProgressionSuggestionMutes())).toEqual(new Set(['bench press', 'squat']));
    await setProgressionSuggestionMuted('bench press', false);
    expect(await loadProgressionSuggestionMutes()).toEqual(['squat']);
  });

  test('an empty / blank key is a no-op', async () => {
    await setProgressionSuggestionMuted('', true);
    await setProgressionSuggestionMuted('   ', true);
    expect(await loadProgressionSuggestionMutes()).toEqual([]);
  });

  test('two rapid mutes dispatched in the same tick both land (no lost update)', async () => {
    await hydrateProgressionSuggestionSettings();
    const a = setProgressionSuggestionMuted('bench press', true);
    const b = setProgressionSuggestionMuted('squat', true);
    await Promise.all([a, b]);
    expect(new Set(await loadProgressionSuggestionMutes())).toEqual(new Set(['bench press', 'squat']));
    expect(new Set(getProgressionSuggestionSettings().mutedKeys)).toEqual(new Set(['bench press', 'squat']));
  });
});

describe('progression-suggestion settings cache + subscription (#960)', () => {
  test('hydrate populates the synchronous cache from storage', async () => {
    await saveProgressionSuggestionsEnabled(true);
    await saveProgressionSuggestionMutes(['squat']);
    __resetProgressionSuggestionSettingsForTests();
    expect(getProgressionSuggestionSettings()).toEqual({ enabled: false, mutedKeys: [] });
    await hydrateProgressionSuggestionSettings();
    expect(getProgressionSuggestionSettings()).toEqual({ enabled: true, mutedKeys: ['squat'] });
  });

  test('subscribers are notified on every write and stop after unsubscribe', async () => {
    await hydrateProgressionSuggestionSettings();
    const seen = [];
    const unsubscribe = subscribeProgressionSuggestionSettings((s) => seen.push(s));
    await saveProgressionSuggestionsEnabled(true);
    await saveProgressionSuggestionMutes(['bench press']);
    expect(seen[seen.length - 1]).toEqual({ enabled: true, mutedKeys: ['bench press'] });
    const count = seen.length;
    unsubscribe();
    await saveProgressionSuggestionsEnabled(false);
    expect(seen.length).toBe(count);
  });

  test('the global flag and the mute set are independent: off then on keeps the mutes', async () => {
    await hydrateProgressionSuggestionSettings();
    await saveProgressionSuggestionsEnabled(true);
    await saveProgressionSuggestionMutes(['bench press', 'squat']);
    await saveProgressionSuggestionsEnabled(false);
    expect(getProgressionSuggestionSettings().mutedKeys).toEqual(['bench press', 'squat']);
    await saveProgressionSuggestionsEnabled(true);
    expect(getProgressionSuggestionSettings()).toEqual({
      enabled: true,
      mutedKeys: ['bench press', 'squat'],
    });
    expect(await loadProgressionSuggestionMutes()).toEqual(['bench press', 'squat']);
  });
});

describe('Settings screen — Progression suggestions toggle (#960)', () => {
  async function renderSettings() {
    let root;
    await act(async () => {
      root = renderer.create(
        <SettingsScreen onBack={() => {}} multiplier={1.07} onUpdate={() => {}} />
      );
    });
    return root;
  }

  function findToggle(root) {
    return root.root.findAll(
      (n) => n.props.accessibilityRole === 'switch' && n.props.accessibilityLabel === 'Progression suggestions'
    )[0];
  }

  test('renders one accessible switch, default off', async () => {
    const root = await renderSettings();
    const toggle = findToggle(root);
    expect(toggle).toBeTruthy();
    expect(toggle.props.value).toBe(false);
  });

  test('turning it on persists through the settings store and reads back on', async () => {
    const root = await renderSettings();
    await act(async () => {
      findToggle(root).props.onValueChange(true);
    });
    expect(await loadProgressionSuggestionsEnabled()).toBe(true);
    expect(findToggle(root).props.value).toBe(true);
  });

  test('reflects an already-persisted enabled state after hydrate', async () => {
    await saveProgressionSuggestionsEnabled(true);
    __resetProgressionSuggestionSettingsForTests();
    const root = await renderSettings();
    await act(async () => { await Promise.resolve(); });
    expect(findToggle(root).props.value).toBe(true);
  });
});
