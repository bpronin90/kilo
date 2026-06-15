// Storage-seam cloud adapter tests (Phase 3 / Task 9).
//
// Covers:
//   1. Local-only mode is the default and resolves to the local adapter.
//   2. The adapter API exposes explicit methods for the AsyncStorage-backed
//      domains the roadmap needs.
//   3. The cloud adapter is a not-implemented shell (no bootstrap/sync).
//   4. A static assertion that screens never import Supabase directly; cloud
//      access must go through the storage seam only.

import fs from 'fs';
import path from 'path';

import {
  getStorageMode,
  setStorageMode,
  getStorageAdapter,
  STORAGE_MODES,
} from '../storage/entries';
import { localAdapter, ADAPTER_METHODS } from '../storage/localAdapter';
import { cloudAdapter, CloudNotImplementedError } from '../storage/cloudAdapter';

afterEach(() => {
  // Restore the default so mode state never leaks between tests.
  setStorageMode(STORAGE_MODES.LOCAL);
});

describe('storage mode selection', () => {
  it('defaults to local mode and the local adapter', () => {
    expect(getStorageMode()).toBe('local');
    expect(getStorageAdapter()).toBe(localAdapter);
    expect(getStorageAdapter().mode).toBe('local');
  });

  it('selects the cloud adapter only when cloud mode is set', () => {
    setStorageMode(STORAGE_MODES.CLOUD);
    expect(getStorageMode()).toBe('cloud');
    expect(getStorageAdapter()).toBe(cloudAdapter);
  });

  it('falls back to local mode on invalid input', () => {
    setStorageMode('bogus');
    expect(getStorageMode()).toBe('local');
    expect(getStorageAdapter()).toBe(localAdapter);
  });
});

describe('adapter surface', () => {
  // Explicit methods the backend roadmap depends on across weight, workouts,
  // deload, settings, profile, and backup domains.
  const REQUIRED_METHODS = [
    'loadWeightEntries',
    'saveWeightEntry',
    'deleteWeightEntry',
    'updateWeightEntry',
    'loadWeightGoal',
    'saveWeightGoal',
    'clearWeightGoal',
    'loadWorkoutNotes',
    'saveWorkoutNoteItem',
    'deleteWorkoutNoteItem',
    'loadCurrentWorkoutId',
    'saveCurrentWorkoutId',
    'setCurrentWorkoutNote',
    'loadDeloadNote',
    'saveDeloadNote',
    'loadDeloadHistory',
    'appendDeloadHistory',
    'loadTrackedLifts',
    'saveTrackedLifts',
    'loadUserProfile',
    'saveUserProfile',
    'clearUserProfile',
    'exportBackup',
    'importBackup',
  ];

  it('local adapter exposes every required domain method', () => {
    for (const method of REQUIRED_METHODS) {
      expect(typeof localAdapter[method]).toBe('function');
    }
  });

  it('cloud shell mirrors the local adapter method surface exactly', () => {
    const cloudMethods = Object.keys(cloudAdapter).filter(
      (k) => typeof cloudAdapter[k] === 'function'
    );
    expect(cloudMethods.sort()).toEqual([...ADAPTER_METHODS].sort());
  });

  it('local adapter delegates to the real local implementation', async () => {
    // Round-trip through the adapter proves it wraps actual storage behavior.
    const entry = {
      id: 'wadapter-1',
      entry_type: 'weight',
      date: '2026-06-15',
      weight_value: 180,
      logged_at: '2026-06-15T12:00:00.000Z',
    };
    await localAdapter.saveWeightEntry(entry);
    const loaded = await localAdapter.loadWeightEntries();
    expect(loaded.some((e) => e.id === 'wadapter-1')).toBe(true);
  });
});

describe('cloud adapter shell', () => {
  it('throws CloudNotImplementedError for every domain method (no bootstrap/sync)', () => {
    for (const method of ADAPTER_METHODS) {
      expect(() => cloudAdapter[method]()).toThrow(CloudNotImplementedError);
    }
  });
});

describe('screens must not import Supabase directly', () => {
  const screensDir = path.resolve(__dirname, '..', 'screens');

  function collectJsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectJsFiles(full));
      } else if (/\.jsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it('no file under screens/** references @supabase or the supabase client', () => {
    const files = collectJsFiles(screensDir);
    expect(files.length).toBeGreaterThan(0);

    const offenders = [];
    // Match a direct SDK import or any import of the supabaseClient seam.
    const forbidden = /@supabase\/|['"][^'"]*supabaseClient['"]/;
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (forbidden.test(src)) {
        offenders.push(path.basename(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
