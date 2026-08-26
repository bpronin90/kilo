// Persistence and transport for tracked-span activation records (#893).
//
// The records are a SIBLING of `tracked_lifts`, never folded into it, and the
// whole argument for that shape is a compatibility one: an older build must be
// able to round-trip this data — through the cloud and through a backup file —
// without losing a single Track flag. These tests drive the real storage layer
// and the real sync engine against an in-memory transport, and the old-client
// cases are modelled by stripping the field the way an old build actually would.

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as Storage from '../storage/entries';
import { setCloudTransport } from '../storage/cloudAdapter';
import { sync } from '../storage/cloud/syncAdapter';
import { buildBootstrapPlan } from '../storage/cloud/bootstrapPlan';
import { buildCloudExport, importBackup, IMPORT_MODES } from '../storage/entries/backupImport';
import {
  SYNC_TABLES,
  isTombstone,
  resetClientIdCacheForTests,
  resetStampClockForTests,
} from '../storage/syncQueue';
import { __resetSyncQueue } from '../storage/syncRecovery';

const RECORD = {
  anchor: 12,
  at: '2026-08-26T14:03:11.204Z',
  witness: { headings: ['Squat'], sessions: '[[1,5,225,"lb"],[2,5,225,"lb"]]' },
};

function makeFakeCloud() {
  const tables = {};
  for (const table of Object.values(SYNC_TABLES)) tables[table] = new Map();
  const singletons = new Set([
    SYNC_TABLES.USER_PROFILE,
    SYNC_TABLES.USER_HEALTH_PROFILE,
    SYNC_TABLES.FEATURE_TOGGLES,
    SYNC_TABLES.WEIGHT_GOAL,
  ]);

  let lastServerMs = 0;
  function serverNow(table) {
    let maxMs = Math.max(lastServerMs, Date.now());
    for (const row of tables[table].values()) {
      const ms = Date.parse(row.updated_at || 0);
      if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
    }
    lastServerMs = maxMs + 1;
    return new Date(lastServerMs).toISOString();
  }

  // Models an older build's server: it simply has no such column, so anything
  // named `tracked_lift_activations` is dropped on write and never served.
  let dropActivationsColumn = false;

  const transport = {
    async pull(table, cursor) {
      const rows = [...tables[table].values()];
      const changed = cursor ? rows.filter((r) => (r.updated_at || '') >= cursor) : rows;
      const sorted = changed.sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
      // eslint-disable-next-line no-unused-vars
      const served = sorted.map(({ client_id: _c, ...row }) => row);
      if (!singletons.has(table)) return served;
      // eslint-disable-next-line no-unused-vars
      return served.map(({ id: _id, ...row }) => row);
    },
    async push(table, records) {
      const written = [];
      for (const rec of records) {
        // eslint-disable-next-line no-unused-vars
        const { client_id: _clientId, ...row } = rec;
        if (dropActivationsColumn) delete row.tracked_lift_activations;
        const stored = { ...row, updated_at: serverNow(table) };
        tables[table].set(rec.id, stored);
        written.push(singletons.has(table) ? { ...stored, id: undefined } : stored);
      }
      return written;
    },
  };

  return {
    transport,
    dropColumn: () => { dropActivationsColumn = true; },
    remoteRows: (table) => [...tables[table].values()],
    liveRemoteRows: (table) => [...tables[table].values()].filter((r) => !isTombstone(r)),
    seedRemote: (table, row) => tables[table].set(row.id, row),
  };
}

let cloud;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetClientIdCacheForTests();
  resetStampClockForTests();
  __resetSyncQueue();
  cloud = makeFakeCloud();
  setCloudTransport(cloud.transport);
});

afterEach(() => {
  setCloudTransport(null);
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
  __resetSyncQueue();
});

// ─────────────────────────────────────────────────────────────────────────────
// Local persistence
// ─────────────────────────────────────────────────────────────────────────────

describe('local persistence', () => {
  test('flags and records round-trip independently', async () => {
    await Storage.saveTrackedLifts({ squat: true });
    await Storage.saveTrackedLiftActivations({ squat: RECORD });
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true });
    expect(await Storage.loadTrackedLiftActivations()).toEqual({ squat: RECORD });
  });

  test('a device that has never activated anything reads an empty map, not a failure', async () => {
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
  });

  test('a malformed record is dropped rather than trusted', async () => {
    // Each of these would move a real progression boundary if honored. Dropping
    // one degrades that exercise to legacy full-history behavior, which is the
    // safe direction; keeping it could produce a wrong comparison.
    await Storage.saveTrackedLiftActivations({
      good: RECORD,
      negative: { ...RECORD, anchor: -1 },
      fractional: { ...RECORD, anchor: 2.5 },
      stringAnchor: { ...RECORD, anchor: '3' },
      noWitness: { anchor: 4, at: RECORD.at, witness: null },
      brokenWitness: { anchor: 4, at: RECORD.at, witness: { headings: ['A'] } },
      notAnObject: 7,
    });
    const loaded = await Storage.loadTrackedLiftActivations();
    expect(Object.keys(loaded)).toEqual(['good']);
  });

  test('anchor 0 with a null witness is valid — it excludes nothing', async () => {
    const neutral = { anchor: 0, at: RECORD.at, witness: null };
    await Storage.saveTrackedLiftActivations({ 'new lift': neutral });
    expect(await Storage.loadTrackedLiftActivations()).toEqual({ 'new lift': neutral });
  });

  test('corrupt JSON on disk reads as empty, never as a throw', async () => {
    await AsyncStorage.setItem('kilo_tracked_lift_activations', '{not json');
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cloud sync
// ─────────────────────────────────────────────────────────────────────────────

describe('cloud sync', () => {
  test('records ride the same health row as the flags and reach the cloud with them', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    await Storage.saveTrackedLifts({ squat: true });
    await Storage.saveTrackedLiftActivations({ squat: RECORD });
    await sync();

    const [row] = cloud.liveRemoteRows(SYNC_TABLES.USER_HEALTH_PROFILE);
    expect(row.tracked_lifts).toEqual({ squat: true });
    expect(row.tracked_lift_activations).toEqual({ squat: RECORD });
  });

  test('a pulled winner applies both, so flags and records cannot desynchronize', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    cloud.seedRemote(SYNC_TABLES.USER_HEALTH_PROFILE, {
      id: 'self',
      tracked_lifts: { bench: true },
      tracked_lift_activations: { bench: RECORD },
      updated_at: '2099-01-01T00:00:00.000Z',
    });
    await sync();

    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true });
    expect(await Storage.loadTrackedLiftActivations()).toEqual({ bench: RECORD });
  });

  test('a pulled winner from an OLDER client leaves local records alone rather than clearing them', async () => {
    // The compatibility case the sibling-column shape exists for. An old build
    // writes the row with no such column at all; that absence is not a value and
    // must not be applied as one.
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    await Storage.saveTrackedLifts({ squat: true });
    await Storage.saveTrackedLiftActivations({ squat: RECORD });
    await sync();

    // Now the other device — an older build — writes the row last. Its upsert
    // names five columns and not this one.
    cloud.seedRemote(SYNC_TABLES.USER_HEALTH_PROFILE, {
      id: 'self',
      tracked_lifts: { squat: true, bench: true },
      updated_at: '2099-01-01T00:00:00.000Z',
    });
    await sync();

    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true, bench: true });
    expect(await Storage.loadTrackedLiftActivations()).toEqual({ squat: RECORD });
  });

  test('an explicitly EMPTY record map is a real value and is applied', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    await Storage.saveTrackedLifts({ squat: true });
    await Storage.saveTrackedLiftActivations({ squat: RECORD });
    await sync();

    cloud.seedRemote(SYNC_TABLES.USER_HEALTH_PROFILE, {
      id: 'self',
      tracked_lifts: { squat: true },
      tracked_lift_activations: {},
      updated_at: '2099-01-01T00:00:00.000Z',
    });
    await sync();

    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
  });

  test('a malformed record arriving from the cloud is normalized on the way in', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    cloud.seedRemote(SYNC_TABLES.USER_HEALTH_PROFILE, {
      id: 'self',
      tracked_lifts: { squat: true, bench: true },
      tracked_lift_activations: { squat: RECORD, bench: { anchor: 'lots' } },
      updated_at: '2099-01-01T00:00:00.000Z',
    });
    await sync();

    expect(await Storage.loadTrackedLiftActivations()).toEqual({ squat: RECORD });
    // The flag survives; only the unusable record is dropped, so `bench` falls
    // back to legacy full-history progression rather than losing its Track.
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true, bench: true });
  });

  test('an OLD SERVER that drops the column costs the records but never a Track flag', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    cloud.dropColumn();
    await Storage.saveTrackedLifts({ squat: true, bench: true });
    await Storage.saveTrackedLiftActivations({ squat: RECORD });
    await sync();

    const [row] = cloud.liveRemoteRows(SYNC_TABLES.USER_HEALTH_PROFILE);
    expect(row.tracked_lift_activations).toBeUndefined();
    expect(row.tracked_lifts).toEqual({ squat: true, bench: true });
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true, bench: true });
  });

  test('an offline toggle reaches the cloud on the next pass', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    setCloudTransport(null);
    await Storage.saveTrackedLifts({ squat: true });
    await Storage.saveTrackedLiftActivations({ squat: RECORD });

    setCloudTransport(cloud.transport);
    await sync();
    const [row] = cloud.liveRemoteRows(SYNC_TABLES.USER_HEALTH_PROFILE);
    expect(row.tracked_lift_activations).toEqual({ squat: RECORD });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

describe('bootstrap', () => {
  test('the uploaded health row carries the records beside the flags', () => {
    const plan = buildBootstrapPlan(
      {
        weightEntries: [], workoutSessions: [], workoutNotes: [], deloadHistory: [],
        recoveryBlocks: [], recoveryBlockWeeks: [],
        currentWorkoutId: null, fatigueMultiplier: 1.07,
        trackedLifts: { squat: true },
        trackedLiftActivations: { squat: RECORD },
        deloadNote: null, weightGoal: null, userProfile: null,
        logCurrentCollapsed: false, weightDateEditEnabled: false,
        deloadDateEditEnabled: false, fatigueTrackingEnabled: true, deloadModeEnabled: true,
      },
      'user-1'
    );
    const [row] = plan.user_health_profile;
    expect(row.tracked_lifts).toEqual({ squat: true });
    expect(row.tracked_lift_activations).toEqual({ squat: RECORD });
  });

  test('a device with no records uploads an empty map, not undefined', () => {
    const plan = buildBootstrapPlan(
      {
        weightEntries: [], workoutSessions: [], workoutNotes: [], deloadHistory: [],
        recoveryBlocks: [], recoveryBlockWeeks: [],
        currentWorkoutId: null, fatigueMultiplier: 1.07,
        trackedLifts: {}, deloadNote: null, weightGoal: null, userProfile: null,
        logCurrentCollapsed: false, weightDateEditEnabled: false,
        deloadDateEditEnabled: false, fatigueTrackingEnabled: true, deloadModeEnabled: true,
      },
      'user-1'
    );
    expect(plan.user_health_profile[0].tracked_lift_activations).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backup export / import
// ─────────────────────────────────────────────────────────────────────────────

describe('backup export and import', () => {
  test('export then import restores both flags and records', async () => {
    await Storage.saveTrackedLifts({ squat: true });
    await Storage.saveTrackedLiftActivations({ squat: RECORD });

    const payload = await buildCloudExport();
    expect(payload.cloud.tracked_lift_activations).toEqual({ squat: RECORD });

    await AsyncStorage.clear();
    const result = await importBackup(payload, IMPORT_MODES.REPLACE);
    expect(result.ok).toBe(true);
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true });
    expect(await Storage.loadTrackedLiftActivations()).toEqual({ squat: RECORD });
  });

  test('an OLDER backup with no records imports cleanly and leaves flags intact', async () => {
    await Storage.saveTrackedLifts({ squat: true });
    await Storage.saveTrackedLiftActivations({ squat: RECORD });
    const payload = await buildCloudExport();
    delete payload.cloud.tracked_lift_activations;

    await AsyncStorage.clear();
    const result = await importBackup(payload, IMPORT_MODES.REPLACE);
    expect(result.ok).toBe(true);
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true });
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
  });

  test('a NEW backup opened by an old build keeps every flag: the records sit outside tracked_lifts', async () => {
    await Storage.saveTrackedLifts({ squat: true, bench: true });
    await Storage.saveTrackedLiftActivations({ squat: RECORD });
    const payload = await buildCloudExport();

    // What an old build sees and acts on. It hard-filters tracked_lifts to
    // booleans, so this assertion is the whole reason the records are a sibling:
    // every value here is still a boolean.
    expect(Object.values(payload.cloud.tracked_lifts).every(v => typeof v === 'boolean')).toBe(true);
    expect(payload.cloud.tracked_lifts).toEqual({ squat: true, bench: true });
  });

  test('a tampered record is rejected by validation rather than written', async () => {
    await Storage.saveTrackedLifts({ squat: true });
    const payload = await buildCloudExport();
    payload.cloud.tracked_lift_activations = { squat: { anchor: -5 } };

    const result = await importBackup(payload, IMPORT_MODES.REPLACE);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tracked_lift_activations\.squat\.anchor/);
  });

  test('a record whose witness is the wrong shape is rejected', async () => {
    await Storage.saveTrackedLifts({ squat: true });
    const payload = await buildCloudExport();
    payload.cloud.tracked_lift_activations = { squat: { anchor: 3, witness: { headings: 'Squat', sessions: 'x' } } };

    const result = await importBackup(payload, IMPORT_MODES.REPLACE);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/witness\.headings/);
  });
});
