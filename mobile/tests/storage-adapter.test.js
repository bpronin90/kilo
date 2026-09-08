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

import React from 'react';
import renderer, { act } from 'react-test-renderer';

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
    // The cloud adapter mirrors every local domain method 1:1, plus the one
    // implemented cloud-only capability for this phase: bootstrapFromLocal
    // (Phase 4 / Task 10). Exclude that extra method from the surface mirror.
    const cloudMethods = Object.keys(cloudAdapter).filter(
      (k) => typeof cloudAdapter[k] === 'function' && k !== 'bootstrapFromLocal'
    );
    expect(cloudMethods.sort()).toEqual([...ADAPTER_METHODS].sort());
  });

  it('cloud adapter exposes an implemented bootstrapFromLocal beyond the shell', () => {
    expect(typeof cloudAdapter.bootstrapFromLocal).toBe('function');
    // bootstrapFromLocal is a real implementation, not a not-implemented stub.
    expect(ADAPTER_METHODS).not.toContain('bootstrapFromLocal');
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
  // Phase 4 implemented these cloud methods for real: bootstrap (Task 10) and
  // offline LWW sync for weight entries + workout notes (Task 11). Every OTHER
  // domain method still throws until a later phase wires it through the same
  // mechanism, keeping the cloud surface 1:1 with the local adapter.
  const IMPLEMENTED_CLOUD_METHODS = new Set([
    'sync',
    'loadWeightEntries',
    'saveWeightEntry',
    'updateWeightEntry',
    'deleteWeightEntry',
    'loadWorkoutNotes',
    'saveWorkoutNoteItem',
    'deleteWorkoutNoteItem',
    // The recovery-block domain (#692) became cloud-backed in #693. These
    // delegate to the same storage module local mode uses; the sync engine picks
    // their writes up through the baseline reconciliation rather than a
    // write-time queue hook (see storage/cloudAdapter.js).
    'loadRecoveryBlocks',
    'getActiveRecoveryBlock',
    'createRecoveryBlock',
    'updateRecoveryBlock',
    'completeRecoveryBlock',
    'deleteRecoveryBlock',
    'loadRecoveryBlockWeeks',
    'loadRecoveryWeeksForBlock',
    'addRecoveryWeek',
    'updateRecoveryWeek',
    'completeRecoveryWeek',
    'deleteRecoveryWeek',
  ]);

  it('throws CloudNotImplementedError for every still-unimplemented domain method', () => {
    const unimplemented = ADAPTER_METHODS.filter((m) => !IMPLEMENTED_CLOUD_METHODS.has(m));
    // Guard against the list silently emptying if the surface changes.
    expect(unimplemented.length).toBeGreaterThan(0);
    for (const method of unimplemented) {
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

describe('workout-note add is id-stable after a partial cloud write (#997)', () => {
  const { useWorkoutNotes } = require('../hooks/entries/workoutNoteHooks');
  const storageMode = require('../hooks/entries/storageMode');
  const syncQueue = require('../storage/syncQueue');
  const reminderScheduler = require('../lib/reminderScheduler');
  const { loadWorkoutNotes } = require('../storage/cloud/cloudDomainMethods');

  const TITLE = 'Retry Routine #997';
  const BODY = 'MONDAY\n-Squat 3x5';

  let tree;

  beforeEach(() => {
    setStorageMode(STORAGE_MODES.CLOUD);
    // The initial cloud sync the hook kicks off on mount is not what this test
    // exercises; keep it inert and offline.
    jest.spyOn(storageMode, 'maybeSyncCloud').mockResolvedValue(false);
    jest.spyOn(reminderScheduler, 'reconcileWorkoutReminder').mockResolvedValue();
  });

  afterEach(() => {
    if (tree) act(() => tree.unmount());
    tree = null;
    jest.restoreAllMocks();
  });

  function mountNotes() {
    const ref = { current: null };
    function Probe() {
      ref.current = useWorkoutNotes();
      return null;
    }
    act(() => {
      tree = renderer.create(React.createElement(Probe));
    });
    return ref;
  }

  it('retrying an add whose local write landed but whose cloud enqueue failed reuses the id', async () => {
    const realEnqueue = syncQueue.enqueueDirty;
    let enqueueCalls = 0;
    jest.spyOn(syncQueue, 'enqueueDirty').mockImplementation((table, record) => {
      enqueueCalls += 1;
      if (enqueueCalls === 1) {
        return Promise.reject(new Error('cloud enqueue offline'));
      }
      return realEnqueue(table, record);
    });

    const notes = mountNotes();

    // First attempt: the local write lands, the cloud enqueue rejects, and
    // `add` propagates that failure to the caller.
    await act(async () => {
      await expect(notes.current.add(TITLE, BODY)).rejects.toThrow('cloud enqueue offline');
    });

    const stranded = (await loadWorkoutNotes()).filter((n) => n.title === TITLE);
    expect(stranded).toHaveLength(1);
    const strandedId = stranded[0].id;
    const dirtyAfterFail = (await syncQueue.getDirtyRecords(syncQueue.SYNC_TABLES.WORKOUT_NOTES))
      .filter((r) => r.id === strandedId);
    expect(dirtyAfterFail).toHaveLength(0);

    // Retry with the identical payload: it must complete the original create,
    // not mint a second note.
    let created;
    await act(async () => {
      created = await notes.current.add(TITLE, BODY);
    });
    expect(created.id).toBe(strandedId);

    const afterRetry = (await loadWorkoutNotes()).filter((n) => n.title === TITLE);
    expect(afterRetry).toHaveLength(1);
    expect(afterRetry[0].id).toBe(strandedId);

    const dirtyAfterRetry = (await syncQueue.getDirtyRecords(syncQueue.SYNC_TABLES.WORKOUT_NOTES))
      .filter((r) => r.id === strandedId);
    expect(dirtyAfterRetry).toHaveLength(1);
  });
});
