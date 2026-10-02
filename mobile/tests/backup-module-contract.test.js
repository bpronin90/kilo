// Backup module contract + adversarial fixtures (issue #1060).
//
// #1060 split the ~1,359-line backupImport.js into three cohesive modules
// (backupValidation.js, backupExport.js, backupRestore.js) with backupImport.js
// kept as the public barrel, and the ~650-line BackupScreen.js into a component
// plus backup/BackupActions.js and backup/backupStyles.js. The split is
// behavior-only, so this file pins the two things a split most easily breaks:
//
//   1. The PUBLIC BOUNDARY. Every caller and test imports the engine through
//      backupImport.js (and the storage barrel entries.js re-exports from it).
//      The barrel must re-export the exact same function objects the sub-modules
//      define, and IMPORT_MODES must keep its frozen { LOCAL, CLOUD } value.
//
//   2. The STATE-TRANSITION INVARIANTS the card enumerates, exercised with
//      adversarial payloads: foreign/stale identity, malformed version/records,
//      unknown fields, partial writes, an interrupted replace, and a clean
//      restoration. These are the boundaries where a partial refactor would
//      silently widen acceptance or corrupt local data.
//
// Storage is the in-memory AsyncStorage mock (jest config moduleNameMapper), the
// same backing store backup-import.test.js uses. Tests run in LOCAL mode unless
// they explicitly opt into CLOUD.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  exportBackup,
  buildCloudExport,
  hydrateProfileFromCloud,
  importBackup,
  IMPORT_MODES,
} from '../storage/entries/backupImport';
import * as backupExport from '../storage/entries/backupExport';
import * as backupRestore from '../storage/entries/backupRestore';
import * as backupValidation from '../storage/entries/backupValidation';

import { setStorageMode, STORAGE_MODES } from '../storage/entries';
import { WEIGHT_KEY, WORKOUT_NOTES_KEY } from '../storage/entries/keys';
import { loadWeightEntriesRaw } from '../storage/entries/weightEntries';
import { loadCurrentWorkoutId } from '../storage/entries/workoutNotes';
import { loadUserProfile } from '../storage/entries/profileStorage';
import { loadFatigueMultiplier } from '../storage/entries/settings';

// recoveryStorage is wrapped so a single test can make ONE write reject
// mid-restore (the interrupted-replace fixture) while every other test uses the
// real implementation. The factory delegates to the actual module by default,
// so reads and the block write stay real.
jest.mock('../storage/entries/recoveryStorage', () => {
  const actual = jest.requireActual('../storage/entries/recoveryStorage');
  return {
    __esModule: true,
    ...actual,
    replaceRecoveryBlockWeeksRaw: jest.fn((...args) => actual.replaceRecoveryBlockWeeksRaw(...args)),
  };
});
import {
  loadRecoveryBlocksRaw,
  loadRecoveryBlockWeeksRaw,
  replaceRecoveryBlockWeeksRaw,
} from '../storage/entries/recoveryStorage';

const ISO = '2026-07-01T08:00:00.000Z';

function weightRow(id, weight_value, date) {
  return {
    id,
    entry_type: 'weight',
    weight_value,
    date,
    logged_at: `${date}T08:00:00.000Z`,
  };
}

// A fully-valid v4 payload: one weight entry, one live note, and a recovery
// block + membership that satisfy every cross-record invariant (one active
// block, one live membership per note, unique ordinal, live note reference).
function cleanV4Payload(overrides = {}) {
  return {
    version: '4',
    exported_at: '2026-07-10T00:00:00.000Z',
    weight_entries: [weightRow('w1', 180, '2026-07-01')],
    workout_notes: [{ id: 'n1', title: 'Routine A', raw_text: 'Squat 100x5', saved_at: ISO }],
    current_workout_id: 'n1',
    weight_goal: null,
    fatigue_multiplier: 1.07,
    deload_history: [],
    recovery_blocks: [
      {
        id: 'b1',
        baseline_note_id: 'nb1',
        baseline: null,
        include_in_normal_analytics: false,
        started_at: ISO,
      },
    ],
    recovery_block_weeks: [
      { id: 'wk1', block_id: 'b1', note_id: 'n1', week_number: 1 },
    ],
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  setStorageMode(STORAGE_MODES.LOCAL);
  replaceRecoveryBlockWeeksRaw.mockClear();
});

afterEach(() => {
  setStorageMode(STORAGE_MODES.LOCAL);
});

describe('public boundary is preserved (#1060)', () => {
  test('backupImport.js re-exports the exact sub-module implementations', () => {
    // Identity, not just "defined": a barrel that redefined these would drift
    // from the module the rest of the app and the mock seams target.
    expect(exportBackup).toBe(backupExport.exportBackup);
    expect(buildCloudExport).toBe(backupExport.buildCloudExport);
    expect(hydrateProfileFromCloud).toBe(backupExport.hydrateProfileFromCloud);
    expect(importBackup).toBe(backupRestore.importBackup);
    expect(IMPORT_MODES).toBe(backupRestore.IMPORT_MODES);
  });

  test('IMPORT_MODES keeps its frozen storage-mode values', () => {
    expect(IMPORT_MODES).toEqual({ LOCAL: 'local', CLOUD: 'cloud' });
    expect(Object.isFrozen(IMPORT_MODES)).toBe(true);
  });

  test('the validation module exposes the primitives the restore gate composes', () => {
    for (const name of [
      'validateWeightEntries',
      'validateDeloadHistory',
      'validateRecoveryBlocks',
      'validateRecoveryWeeks',
      'validateRecoveryInvariants',
      'validateFatigueMultiplier',
      'validateCloudBlock',
    ]) {
      expect(typeof backupValidation[name]).toBe('function');
    }
    expect(backupValidation.BACKUP_VERSION).toBe('4');
  });
});

describe('clean restoration (#1060)', () => {
  test('a valid v4 payload restores every collection and round-trips through export', async () => {
    const result = await importBackup(cleanV4Payload());
    expect(result).toEqual({ ok: true, mode: 'local', queued: 0 });

    expect(await loadWeightEntriesRaw()).toEqual([weightRow('w1', 180, '2026-07-01')]);
    expect(await loadCurrentWorkoutId()).toBe('n1');
    expect((await loadRecoveryBlocksRaw()).map((b) => b.id)).toEqual(['b1']);
    expect((await loadRecoveryBlockWeeksRaw()).map((w) => w.id)).toEqual(['wk1']);

    // Export parity: the snapshot the restore produced re-exports at the current
    // format version and preserves the restored weight entry payload.
    const exported = await exportBackup();
    expect(exported.version).toBe('4');
    expect(exported.weight_entries).toEqual([weightRow('w1', 180, '2026-07-01')]);
  });

  test('post-restore workout notes carry no derived parser cache', async () => {
    // Cache invalidation contract: an imported note that smuggles in the
    // device-local derived cache (#813) must have it stripped on the way in, not
    // re-persisted. raw_text is preserved.
    await importBackup(
      cleanV4Payload({
        workout_notes: [
          { id: 'n1', title: 'Routine A', raw_text: 'Squat 100x5', saved_at: ISO, derived_sections: [{ stale: true }] },
        ],
      }),
    );
    const stored = JSON.parse(await AsyncStorage.getItem(WORKOUT_NOTES_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0].raw_text).toBe('Squat 100x5');
    expect(stored[0].derived_sections).toBeUndefined();
  });
});

describe('malformed version / records fail closed with no write (#1060)', () => {
  test('an unsupported version is rejected by the exact message', async () => {
    const result = await importBackup({ version: '999', weight_entries: [] });
    expect(result).toEqual({
      ok: false,
      error: 'Unsupported backup version: 999',
    });
  });

  test('a malformed weight record is rejected and local data is left untouched', async () => {
    // Pre-seed a real local weight entry, then attempt a bad import. "Validation
    // runs before any write" means the seed must survive verbatim.
    await AsyncStorage.setItem(WEIGHT_KEY, JSON.stringify([weightRow('seed', 200, '2026-06-01')]));

    const result = await importBackup({
      version: '3',
      weight_entries: [{ id: 'w1', entry_type: 'weight', date: '2026-01-01', logged_at: ISO }],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid backup: weight entry missing weight_value');
    expect(await loadWeightEntriesRaw()).toEqual([weightRow('seed', 200, '2026-06-01')]);
  });

  test('an impossible calendar timestamp is rejected before any recovery write', async () => {
    const result = await importBackup(
      cleanV4Payload({
        recovery_blocks: [
          { id: 'b1', baseline_note_id: 'nb1', baseline: null, started_at: '2026-02-30T00:00:00.000Z' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/recovery block b1 started_at must be an ISO instant with an explicit offset/);
    expect(await loadRecoveryBlocksRaw()).toEqual([]);
  });
});

describe('unknown fields are ignored, never persisted (#1060)', () => {
  test('an unknown cloud profile key cannot reach local storage', async () => {
    // Field allowlist (ingress): saveUserProfile is rebuilt from PROFILE_ALLOWLIST,
    // so a hand-edited backup key is dropped while known fields are kept.
    const result = await importBackup(
      cleanV4Payload({
        cloud: {
          user_profile: { display_name: 'Kilo', height_cm: 180, injected_admin: true },
        },
      }),
    );
    expect(result.ok).toBe(true);

    const profile = await loadUserProfile();
    expect(profile.display_name).toBe('Kilo');
    expect(profile.height_cm).toBe(180);
    expect(profile.injected_admin).toBeUndefined();
  });

  test('an unknown top-level key is tolerated and does not fail the import', async () => {
    const result = await importBackup(cleanV4Payload({ some_future_field: { anything: 1 } }));
    expect(result.ok).toBe(true);
  });
});

describe('partial write / half payload never reports success (#1060)', () => {
  test('a recovery half-payload (blocks without memberships) is rejected with no write', async () => {
    const payload = cleanV4Payload();
    delete payload.recovery_block_weeks;

    const result = await importBackup(payload);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      'Invalid backup: recovery_blocks present without recovery_block_weeks; a recovery backup carries both collections or neither',
    );
    // Nothing from the payload reached storage: not the blocks, not the notes.
    expect(await loadRecoveryBlocksRaw()).toEqual([]);
    expect(await loadWeightEntriesRaw()).toEqual([]);
  });

  test('a live membership pointing at a note the backup does not carry is rejected', async () => {
    const result = await importBackup(
      cleanV4Payload({
        recovery_block_weeks: [{ id: 'wk1', block_id: 'b1', note_id: 'ghost', week_number: 1 }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/references workout note ghost, which this backup does not carry as a live note/);
  });
});

describe('interrupted replace does not report success (#1060)', () => {
  test('a write that throws mid-restore propagates instead of returning ok', async () => {
    // The membership write is the last collection write in the local recovery
    // path; forcing it to reject models a connection/storage failure after the
    // blocks are already on disk. importBackup must NOT swallow it into a success
    // result - "never report success early" is the whole point of the ordering.
    replaceRecoveryBlockWeeksRaw.mockRejectedValueOnce(new Error('storage lost mid-restore'));

    await expect(importBackup(cleanV4Payload())).rejects.toThrow('storage lost mid-restore');
  });
});

describe('identity binding on cloud export/hydration (#1060)', () => {
  test('buildCloudExport binds the explicit account and omits email by default', async () => {
    const artifact = await buildCloudExport({ account: { id: 'acct-1', email: 'user@example.invalid' } });
    expect(artifact.cloud.cloud_export_format).toBe('cloud-1');
    expect(artifact.cloud.account).toEqual({ id: 'acct-1' });
    expect(artifact.cloud.account.email).toBeUndefined();
    // Still a strict superset of the plain backup shape.
    expect(artifact.version).toBe('4');
  });

  test('buildCloudExport includes email only on explicit opt-in, and is null with no account', async () => {
    const withEmail = await buildCloudExport({
      account: { id: 'acct-1', email: 'user@example.invalid' },
      includeEmail: true,
    });
    expect(withEmail.cloud.account).toEqual({ id: 'acct-1', email: 'user@example.invalid' });

    const anonymous = await buildCloudExport();
    expect(anonymous.cloud.account).toBeNull();
  });

  test('hydrateProfileFromCloud drops a tampered fatigue multiplier but keeps valid fields', async () => {
    // Stale/foreign identity guard: a corrupted cloud row cannot push a NaN/absurd
    // value into local fatigue calculations, while its valid fields still hydrate.
    const before = await loadFatigueMultiplier();
    const result = await hydrateProfileFromCloud(
      { fatigue_multiplier: 1e9, display_name: 'Kilo', unit_system: 'metric' },
      null,
    );
    expect(result).toEqual({ ok: true });
    expect(await loadFatigueMultiplier()).toBe(before);
    expect((await loadUserProfile()).display_name).toBe('Kilo');
  });
});
