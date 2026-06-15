// Bootstrap-to-cloud tests (Phase 4 / Task 10).
//
// Covers the roadmap "AsyncStorage Key Mapping" contract:
//   1. Every mapped AsyncStorage key lands in its target cloud table/field.
//   2. Legacy kilo_workout_sessions migrates into note-first workout_notes
//      (raw_text + source_snapshot), never normalized per-set tables.
//   3. A failed bootstrap leaves local AsyncStorage untouched and is retryable.
//   4. Re-running bootstrap for the same user does not duplicate rows (idempotent
//      upserts keyed on the table primary key).
//
// A fake Supabase client records every upsert so we can assert the mapping
// without a live database. AsyncStorage uses the standard jest mock.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  bootstrapFromLocal,
  buildBootstrapPlan,
  synthesizeSessionsNote,
  BootstrapError,
} from '../storage/cloudAdapter';

const USER_ID = '11111111-1111-1111-1111-111111111111';

// ── fake Supabase client ────────────────────────────────────────────────────
//
// Mirrors the supabase-js chain the adapter uses: client.schema(s).from(t).upsert(rows, opts).
// Records calls and lets a test force a per-table failure.
function makeFakeClient({ failTable = null } = {}) {
  const calls = []; // { table, rows, opts }
  const upsertsByTable = {};

  const client = {
    schema(schema) {
      client.lastSchema = schema;
      return {
        from(table) {
          return {
            async upsert(rows, opts) {
              calls.push({ table, rows, opts });
              if (failTable && table === failTable) {
                return { data: null, error: { message: `boom in ${table}` } };
              }
              // Simulate idempotent upsert keyed on primary key: replace rows
              // with the same conflict key instead of appending duplicates.
              const conflict = (opts?.onConflict || 'id').split(',');
              const store = (upsertsByTable[table] = upsertsByTable[table] || []);
              for (const row of rows) {
                const key = conflict.map((c) => row[c]).join('|');
                const idx = store.findIndex(
                  (existing) => conflict.map((c) => existing[c]).join('|') === key
                );
                if (idx >= 0) store[idx] = row;
                else store.push(row);
              }
              return { data: rows, error: null };
            },
          };
        },
      };
    },
  };
  client.calls = calls;
  client.upsertsByTable = upsertsByTable;
  return client;
}

// Full local dataset exercising every mapped AsyncStorage key.
async function seedLocalData() {
  await AsyncStorage.setItem(
    'kilo_weight_entries',
    JSON.stringify([
      {
        id: 'w1',
        entry_type: 'weight',
        date: '2026-06-10',
        logged_at: '2026-06-10T08:00:00.000Z',
        weight_value: 180,
        note: 'morning',
        saved_at: '2026-06-10T08:00:01.000Z',
      },
    ])
  );
  await AsyncStorage.setItem(
    'kilo_weight_goal',
    JSON.stringify({
      target_weight: 170,
      target_date: '2026-12-01',
      start_weight: 185,
      start_date: '2026-01-01',
      saved_at: '2026-06-01T00:00:00.000Z',
      extra_local_field: 'keep-me',
    })
  );
  await AsyncStorage.setItem(
    'kilo_workout_sessions',
    JSON.stringify([
      {
        id: 's1',
        date: '2026-06-01',
        items: [
          { exercise_name: 'Bench', sets: [{ weight_value: 135, rep_count: 5 }] },
        ],
      },
    ])
  );
  await AsyncStorage.setItem(
    'kilo_workout_note',
    JSON.stringify({
      raw_text: '-Squat\n- 225 5,5,5',
      saved_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-02T00:00:00.000Z',
    })
  );
  await AsyncStorage.setItem(
    'kilo_workout_notes',
    JSON.stringify([
      {
        id: 'wn1',
        title: 'Routine A',
        raw_text: '-Deadlift\n- 315 3,3,3',
        saved_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-02T00:00:00.000Z',
        tracked_exercises: ['deadlift'],
        one_k_exercises: { deadlift: true },
        isCurrent: true,
      },
    ])
  );
  await AsyncStorage.setItem('kilo_current_workout_id', JSON.stringify('wn1'));
  await AsyncStorage.setItem('kilo_fatigue_multiplier', JSON.stringify(1.1));
  await AsyncStorage.setItem('kilo_weight_date_edit_enabled', JSON.stringify(true));
  await AsyncStorage.setItem(
    'kilo_workout_deload_note',
    JSON.stringify({
      raw_text: 'deload draft',
      saved_at: '2026-06-05T00:00:00.000Z',
      updated_at: '2026-06-06T00:00:00.000Z',
    })
  );
  await AsyncStorage.setItem(
    'kilo_workout_deload_history',
    JSON.stringify([
      {
        id: 'dl1',
        date: '2026-04-01',
        raw_text: 'old deload',
        saved_at: '2026-04-01T00:00:00.000Z',
        session_count: 12,
        note_id: 'wn_dl_x',
      },
    ])
  );
  await AsyncStorage.setItem(
    'kilo_tracked_lifts',
    JSON.stringify({ bench: true, squat: true })
  );
  await AsyncStorage.setItem('kilo_log_current_collapsed', JSON.stringify(true));
  await AsyncStorage.setItem(
    'kilo_user_profile',
    JSON.stringify({ display_name: 'Ben', unit_system: 'imperial', custom: 'x' })
  );
  await AsyncStorage.setItem('kilo_deload_date_edit_enabled', JSON.stringify(true));
  await AsyncStorage.setItem('kilo_fatigue_tracking_enabled', JSON.stringify(false));
  await AsyncStorage.setItem('kilo_deload_mode_enabled', JSON.stringify(false));
}

// Snapshot of every mapped local key for untouched-after-failure assertions.
const LOCAL_KEYS = [
  'kilo_weight_entries',
  'kilo_weight_goal',
  'kilo_workout_sessions',
  'kilo_workout_note',
  'kilo_workout_notes',
  'kilo_current_workout_id',
  'kilo_fatigue_multiplier',
  'kilo_weight_date_edit_enabled',
  'kilo_workout_deload_note',
  'kilo_workout_deload_history',
  'kilo_tracked_lifts',
  'kilo_log_current_collapsed',
  'kilo_user_profile',
  'kilo_deload_date_edit_enabled',
  'kilo_fatigue_tracking_enabled',
  'kilo_deload_mode_enabled',
];

async function snapshotLocal() {
  const out = {};
  for (const key of LOCAL_KEYS) {
    // eslint-disable-next-line no-await-in-loop
    out[key] = await AsyncStorage.getItem(key);
  }
  return out;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('synthesizeSessionsNote', () => {
  it('returns null when there are no sessions', () => {
    expect(synthesizeSessionsNote([])).toBeNull();
    expect(synthesizeSessionsNote(null)).toBeNull();
  });

  it('synthesizes a parseable note-first raw text from legacy sessions', () => {
    const text = synthesizeSessionsNote([
      {
        date: '2026-06-01',
        items: [
          { exercise_name: 'Bench', sets: [{ weight_value: 135, rep_count: 5 }] },
        ],
      },
    ]);
    expect(text).toContain('-Bench');
    expect(text).toContain('- 135 5');
  });
});

describe('buildBootstrapPlan mapping', () => {
  it('maps every AsyncStorage key to its target table/field', async () => {
    await seedLocalData();
    const { cloudAdapter } = require('../storage/cloudAdapter');
    void cloudAdapter;
    // Read through the adapter's snapshot path by running bootstrap with a fake.
    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);
    const t = client.upsertsByTable;

    // user_profile: pointer + preferences + draft deload note + unpromoted json.
    expect(t.user_profile).toHaveLength(1);
    const profile = t.user_profile[0];
    expect(profile.user_id).toBe(USER_ID);
    expect(profile.current_workout_note_id).toBe('wn1'); // kilo_current_workout_id
    expect(profile.fatigue_multiplier).toBe(1.1); // kilo_fatigue_multiplier
    expect(profile.tracked_lifts).toEqual({ bench: true, squat: true }); // kilo_tracked_lifts
    expect(profile.ui_state.log_current_collapsed).toBe(true); // kilo_log_current_collapsed
    expect(profile.display_name).toBe('Ben'); // kilo_user_profile promoted
    expect(profile.profile_json).toEqual({ custom: 'x' }); // kilo_user_profile unpromoted
    expect(profile.current_deload_note_raw_text).toBe('deload draft'); // kilo_workout_deload_note
    expect(profile.current_deload_note_saved_at).toBe('2026-06-05T00:00:00.000Z');

    // feature_toggles: four boolean settings.
    const toggles = t.feature_toggles[0];
    expect(toggles.weight_date_edit_enabled).toBe(true);
    expect(toggles.deload_date_edit_enabled).toBe(true);
    expect(toggles.fatigue_tracking_enabled).toBe(false);
    expect(toggles.deload_mode_enabled).toBe(false);

    // weight_entries: one row, id preserved.
    expect(t.weight_entries).toHaveLength(1);
    expect(t.weight_entries[0].id).toBe('w1');
    expect(t.weight_entries[0].weight_value).toBe(180);

    // weight_goal: singleton, unpromoted field carried in goal_json.
    expect(t.weight_goal).toHaveLength(1);
    expect(t.weight_goal[0].target_weight).toBe(170);
    expect(t.weight_goal[0].goal_json).toEqual({ extra_local_field: 'keep-me' });

    // deload_history: one row, unknown fields → record_json.
    expect(t.deload_history).toHaveLength(1);
    expect(t.deload_history[0].id).toBe('dl1');
    expect(t.deload_history[0].record_json).toMatchObject({
      session_count: 12,
      note_id: 'wn_dl_x',
    });
  });

  it('migrates legacy kilo_workout_sessions into note-first workout_notes', async () => {
    await seedLocalData();
    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const notes = client.upsertsByTable.workout_notes;
    // notebook item + legacy single note + synthesized sessions note.
    const sessionsNote = notes.find(
      (n) => n.source_snapshot?.async_storage_key === 'kilo_workout_sessions'
    );
    expect(sessionsNote).toBeTruthy();
    expect(sessionsNote.raw_text).toContain('-Bench');
    // Original session array is retained in source_snapshot, not normalized.
    expect(sessionsNote.source_snapshot.sessions).toHaveLength(1);

    // The legacy single note is preserved with its origin marker.
    const legacyNote = notes.find(
      (n) => n.source_snapshot?.async_storage_key === 'kilo_workout_note'
    );
    expect(legacyNote).toBeTruthy();
    expect(legacyNote.raw_text).toContain('-Squat');

    // The notebook item carries through with derived JSON and current pointer.
    const notebookNote = notes.find((n) => n.id === 'wn1');
    expect(notebookNote).toBeTruthy();
    expect(notebookNote.is_current).toBe(true);
    expect(notebookNote.tracked_exercises).toEqual(['deadlift']);

    // No normalized per-set table is written — only the mapped note-first tables.
    const writtenTables = new Set(client.calls.map((c) => c.table));
    expect(writtenTables.has('workout_sessions')).toBe(false);
    expect(writtenTables.has('workout_sets')).toBe(false);
  });
});

describe('bootstrap failure safety', () => {
  it('leaves local AsyncStorage untouched and is retryable on failure', async () => {
    await seedLocalData();
    const before = await snapshotLocal();

    const failing = makeFakeClient({ failTable: 'workout_notes' });
    await expect(bootstrapFromLocal(USER_ID, failing)).rejects.toBeInstanceOf(
      BootstrapError
    );

    // Local data is byte-for-byte unchanged after the failed run.
    const after = await snapshotLocal();
    expect(after).toEqual(before);

    // Retry on a healthy client succeeds from the same untouched local data.
    const healthy = makeFakeClient();
    const result = await bootstrapFromLocal(USER_ID, healthy);
    expect(result.ok).toBe(true);
    expect(healthy.upsertsByTable.workout_notes.length).toBeGreaterThan(0);
  });

  it('rejects when no user id or no client is provided', async () => {
    await expect(bootstrapFromLocal(null, makeFakeClient())).rejects.toBeInstanceOf(
      BootstrapError
    );
    await expect(bootstrapFromLocal(USER_ID, null)).rejects.toBeInstanceOf(
      BootstrapError
    );
  });
});

describe('bootstrap idempotency', () => {
  it('does not duplicate rows when run twice for the same user', async () => {
    await seedLocalData();
    const client = makeFakeClient();

    await bootstrapFromLocal(USER_ID, client);
    const firstCounts = Object.fromEntries(
      Object.entries(client.upsertsByTable).map(([k, v]) => [k, v.length])
    );

    await bootstrapFromLocal(USER_ID, client);
    const secondCounts = Object.fromEntries(
      Object.entries(client.upsertsByTable).map(([k, v]) => [k, v.length])
    );

    // Upserts keyed on the primary key replace rather than append.
    expect(secondCounts).toEqual(firstCounts);
    expect(secondCounts.weight_entries).toBe(1);
    expect(secondCounts.user_profile).toBe(1);
  });
});
