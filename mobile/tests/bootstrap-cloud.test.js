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

import * as Storage from '../storage/entries';
import {
  bootstrapFromLocal,
  buildBootstrapPlan,
  synthesizeSessionsNote,
  BootstrapError,
  setCloudTransport,
  sync,
} from '../storage/cloudAdapter';
import {
  enqueueDirty,
  stampWrite,
  getClientId,
  isTombstone,
  SYNC_TABLES,
  resetClientIdCacheForTests,
  resetStampClockForTests,
} from '../storage/syncQueue';
import { replaceArchivedWeightGoalsRaw } from '../storage/entries/weightGoal';
import { createSupabaseTransport } from '../storage/cloud/transport';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makePagedPullClient(seedRows, { afterFirstPage } = {}) {
  const queries = [];
  const workingRows = seedRows.map((row) => ({
    __kilo_sync_xid: '100',
    ...row,
  }));
  const client = {
    schema(schema) {
      return {
        async rpc(name, params) {
          queries.push({ schema, name, params: { ...params } });
          const secondary = ['user_profile', 'user_health_profile', 'feature_toggles', 'weight_goal']
            .includes(params.p_table)
            ? 'user_id'
            : 'id';
          const boundary = params.p_boundary || 'xid:500';
          const lower = /^xid:(\d+)$/.test(params.p_cursor || '')
            ? BigInt(params.p_cursor.slice(4))
            : 0n;
          const upper = BigInt(boundary.slice(4));
          const eligible = workingRows
            .filter((row) => {
              const xid = BigInt(row.__kilo_sync_xid);
              if (xid < lower || xid >= upper) return false;
              if (!params.p_after_updated_at) return true;
              return (
                row.updated_at > params.p_after_updated_at ||
                (row.updated_at === params.p_after_updated_at &&
                  String(row[secondary]) > String(params.p_after_id))
              );
            })
            .sort(
              (a, b) =>
                a.updated_at.localeCompare(b.updated_at) ||
                String(a[secondary]).localeCompare(String(b[secondary]))
            );
          const page = eligible.slice(0, params.p_limit);
          if (queries.length === 1 && afterFirstPage) afterFirstPage(workingRows);
          return {
            data: {
              rows: page.map((row) => ({ ...row })),
              cursor: boundary,
              has_more: eligible.length > params.p_limit,
            },
            error: null,
          };
        },
      };
    },
  };
  return { client, queries };
}

// ── fake Supabase client ────────────────────────────────────────────────────
//
// Mirrors the supabase-js chain the adapter uses: client.schema(s).from(t).upsert(rows, opts).
// Records calls and lets a test force a per-table failure.
// `remoteRows`: { [table]: row | null } — seeds what a `.select().eq().maybeSingle()`
// call returns for that table, simulating the account's existing cloud state
// (e.g. a `user_profile`/`feature_toggles` row already written by device A).
// `selectFailTable` simulates a select-side error (distinct from `failTable`,
// which simulates an upsert-side error) so restore-failure safety can be
// exercised independently of push-failure safety.
function makeFakeClient({ failTable = null, remoteRows = {}, selectFailTable = null } = {}) {
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
            select() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      if (selectFailTable && table === selectFailTable) {
                        return { data: null, error: { message: `boom selecting ${table}` } };
                      }
                      return { data: remoteRows[table] ?? null, error: null };
                    },
                  };
                },
              };
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

describe('Supabase sync transport cursor contract', () => {
  it('pulls every equal-timestamp collection row with commit-safe keyset pages', async () => {
    const at = '2026-07-17T12:00:00.000Z';
    const rows = Array.from({ length: 1005 }, (_unused, index) => ({
      id: `row-${String(1004 - index).padStart(4, '0')}`,
      updated_at: at,
    }));
    const fake = makePagedPullClient(rows);
    const transport = createSupabaseTransport(() => fake.client);

    const pulled = await transport.pull(SYNC_TABLES.WEIGHT_ENTRIES, at);
    const meta = pulled.pop().__kilo_pull_meta;

    expect(pulled).toHaveLength(1005);
    expect(pulled.map((row) => row.id)).toEqual(
      [...pulled.map((row) => row.id)].sort()
    );
    expect(meta.cursor).toBe('xid:500');
    expect(fake.queries).toHaveLength(2);
    expect(fake.queries[0]).toMatchObject({
      schema: 'kilo',
      name: 'pull_sync_changes',
      params: {
        p_table: SYNC_TABLES.WEIGHT_ENTRIES,
        p_cursor: at,
        p_boundary: null,
        p_after_updated_at: null,
        p_after_id: null,
        p_limit: 1000,
      },
    });
    expect(fake.queries[1].params).toMatchObject({
      p_boundary: 'xid:500',
      p_after_updated_at: at,
      p_after_id: 'row-0999',
    });
  });

  it('uses the singleton primary key as the stable keyset continuation', async () => {
    const fake = makePagedPullClient([
      { user_id: USER_ID, updated_at: '2026-07-17T12:00:00.000Z' },
    ]);
    const transport = createSupabaseTransport(() => fake.client);

    const pulled = await transport.pull(SYNC_TABLES.USER_PROFILE, null);

    expect(pulled[0]).toEqual({
      user_id: USER_ID,
      updated_at: '2026-07-17T12:00:00.000Z',
    });
    expect(pulled[1].__kilo_pull_meta.row_xids).toEqual({ [USER_ID]: '100' });
  });

  it('does not skip an unvisited row when a prior page row is deleted', async () => {
    const at = '2026-07-17T12:00:00.000Z';
    const rows = Array.from({ length: 1001 }, (_unused, index) => ({
      id: `row-${String(index).padStart(4, '0')}`,
      updated_at: at,
    }));
    const fake = makePagedPullClient(rows, {
      afterFirstPage(workingRows) {
        workingRows.splice(
          workingRows.findIndex((row) => row.id === 'row-0000'),
          1
        );
        workingRows.push({
          id: 'row-concurrent',
          updated_at: at,
          __kilo_sync_xid: '600',
        });
      },
    });
    const transport = createSupabaseTransport(() => fake.client);

    const pulled = await transport.pull(SYNC_TABLES.WEIGHT_ENTRIES, null);
    pulled.pop();

    expect(pulled).toHaveLength(1001);
    expect(pulled.some((row) => row.id === 'row-1000')).toBe(true);
    expect(pulled.some((row) => row.id === 'row-concurrent')).toBe(false);
  });

  it('returns the server-stamped upsert representation without device metadata', async () => {
    const calls = [];
    const serverRow = {
      user_id: USER_ID,
      id: 'weight-ack',
      weight_value: 180,
      updated_at: '2026-07-17T12:00:00.000Z',
    };
    const client = {
      auth: {
        async getUser() {
          return { data: { user: { id: USER_ID } }, error: null };
        },
      },
      schema() {
        return {
          from(table) {
            return {
              upsert(rows, options) {
                calls.push({ table, rows, options });
                return {
                  async select() {
                    return { data: [serverRow], error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
    const transport = createSupabaseTransport(() => client);

    await expect(
      transport.push(SYNC_TABLES.WEIGHT_ENTRIES, [
        {
          id: 'weight-ack',
          weight_value: 180,
          updated_at: '2099-01-01T00:00:00.000Z',
          client_id: 'future-device',
        },
      ])
    ).resolves.toEqual([serverRow]);
    expect(calls[0].rows).toEqual([
      { user_id: USER_ID, id: 'weight-ack', weight_value: 180 },
    ]);
  });
});

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

    // user_profile: account settings ONLY. The six health values moved to the
    // consent-gated user_health_profile table in #487, and a consent-capable client
    // must not write them here: it would be an ungated health write, and the
    // contract migration drops those columns outright.
    expect(t.user_profile).toHaveLength(1);
    const profile = t.user_profile[0];
    expect(profile.user_id).toBe(USER_ID);
    expect(profile.ui_state.log_current_collapsed).toBe(true); // kilo_log_current_collapsed
    expect(profile.display_name).toBe('Ben'); // kilo_user_profile promoted
    expect(profile.unit_system).toBe('imperial'); // kilo_user_profile promoted
    expect(profile).not.toHaveProperty('profile_json'); // allowlist: no arbitrary keys leave the device

    for (const healthColumn of [
      'current_workout_note_id',
      'fatigue_multiplier',
      'tracked_lifts',
      'current_deload_note_raw_text',
      'current_deload_note_saved_at',
      'current_deload_note_updated_at',
    ]) {
      expect(profile).not.toHaveProperty(healthColumn);
    }

    // user_health_profile: the six Art. 9 health values, in their own gated table.
    expect(t.user_health_profile).toHaveLength(1);
    const health = t.user_health_profile[0];
    expect(health.user_id).toBe(USER_ID);
    expect(health.current_workout_note_id).toBe('wn1'); // kilo_current_workout_id
    expect(health.fatigue_multiplier).toBe(1.1); // kilo_fatigue_multiplier
    expect(health.tracked_lifts).toEqual({ bench: true, squat: true }); // kilo_tracked_lifts
    expect(health.current_deload_note_raw_text).toBe('deload draft'); // kilo_workout_deload_note
    expect(health.current_deload_note_saved_at).toBe('2026-06-05T00:00:00.000Z');

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

    // weight_goal: singleton; allowlist (issue #475) drops unpromoted keys.
    expect(t.weight_goal).toHaveLength(1);
    expect(t.weight_goal[0].target_weight).toBe(170);
    expect(t.weight_goal[0].goal_json).toBeNull();
    expect(t.weight_goal[0]).not.toHaveProperty('extra_local_field');

    // deload_history: one row, allowlisted fitness-metadata keys → record_json.
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
    // notebook item + synthesized sessions note (legacy kilo_workout_note is
    // skipped because kilo_workout_notes is non-empty — notebook-first guard).
    const sessionsNote = notes.find(
      (n) => n.source_snapshot?.async_storage_key === 'kilo_workout_sessions'
    );
    expect(sessionsNote).toBeTruthy();
    expect(sessionsNote.raw_text).toContain('-Bench');
    // Original session array is retained in source_snapshot, not normalized.
    expect(sessionsNote.source_snapshot.sessions).toHaveLength(1);

    // The legacy single note is NOT imported when workoutNotes is non-empty.
    const legacyNote = notes.find(
      (n) => n.source_snapshot?.async_storage_key === 'kilo_workout_note'
    );
    expect(legacyNote).toBeUndefined();

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

describe('profile upload allowlist (issue #471)', () => {
  it('does not include unknown profile keys in the cloud row', async () => {
    await AsyncStorage.setItem(
      'kilo_user_profile',
      JSON.stringify({
        display_name: 'Test',
        unit_system: 'metric',
        age: 35,
        gender: 'female',
        height_cm: 170,
        blood_type: 'A+',
        __sentinel__: 'should-not-upload',
        custom: 'x',
      })
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const profile = client.upsertsByTable.user_profile[0];
    expect(profile).not.toHaveProperty('profile_json');
    expect(profile).not.toHaveProperty('age');
    expect(profile).not.toHaveProperty('gender');
    expect(profile).not.toHaveProperty('height_cm');
    expect(profile).not.toHaveProperty('blood_type');
    expect(profile).not.toHaveProperty('__sentinel__');
    expect(profile).not.toHaveProperty('custom');
  });

  it('uploads display_name and unit_system from the local profile', async () => {
    await AsyncStorage.setItem(
      'kilo_user_profile',
      JSON.stringify({ display_name: 'Alice', unit_system: 'metric' })
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const profile = client.upsertsByTable.user_profile[0];
    expect(profile.display_name).toBe('Alice');
    expect(profile.unit_system).toBe('metric');
    expect(profile).not.toHaveProperty('profile_json');
  });

  it('sets display_name and unit_system to null when absent from profile', async () => {
    await AsyncStorage.setItem('kilo_user_profile', JSON.stringify({ custom: 'only-unknown' }));

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const profile = client.upsertsByTable.user_profile[0];
    expect(profile.display_name).toBeNull();
    expect(profile.unit_system).toBeNull();
    expect(profile).not.toHaveProperty('profile_json');
  });
});

describe('weight-goal upload allowlist (issue #475)', () => {
  it('does not include an unknown key added to the local weight-goal object', async () => {
    await AsyncStorage.setItem(
      'kilo_weight_goal',
      JSON.stringify({
        target_weight: 170,
        target_date: '2026-12-01',
        start_weight: 185,
        start_date: '2026-01-01',
        saved_at: '2026-06-01T00:00:00.000Z',
        __sentinel__: 'should-not-upload',
        notes: 'private goal notes',
      })
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const goal = client.upsertsByTable.weight_goal[0];
    expect(goal.target_weight).toBe(170);
    expect(goal.goal_json).toBeNull();
    expect(goal).not.toHaveProperty('__sentinel__');
    expect(goal).not.toHaveProperty('notes');
  });

  it('uploads only the promoted named columns from the local weight-goal object', async () => {
    await AsyncStorage.setItem(
      'kilo_weight_goal',
      JSON.stringify({
        target_weight: 160,
        target_date: '2026-11-01',
        start_weight: 190,
        start_date: '2026-02-01',
        saved_at: '2026-06-15T00:00:00.000Z',
      })
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const goal = client.upsertsByTable.weight_goal[0];
    expect(goal.target_weight).toBe(160);
    expect(goal.target_date).toBe('2026-11-01');
    expect(goal.start_weight).toBe(190);
    expect(goal.start_date).toBe('2026-02-01');
    expect(goal.saved_at).toBe('2026-06-15T00:00:00.000Z');
    expect(goal.goal_json).toBeNull();
  });
});

describe('deload-history upload allowlist (issue #475)', () => {
  it('does not include an unknown key added to a local deload record', async () => {
    await AsyncStorage.setItem(
      'kilo_workout_deload_history',
      JSON.stringify([
        {
          id: 'dl_unknown',
          date: '2026-04-01',
          raw_text: 'deload note',
          saved_at: '2026-04-01T00:00:00.000Z',
          session_count: 8,
          note_id: 'wn_dl_y',
          completed_at: '2026-04-02T00:00:00.000Z',
          deload_session_ordinal: 3,
          generated_at: '2026-04-01T00:00:00.000Z',
          __sentinel__: 'should-not-upload',
          coach_comment: 'private note',
        },
      ])
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const record = client.upsertsByTable.deload_history[0];
    expect(record.id).toBe('dl_unknown');
    // Allowlisted fitness-metadata keys are preserved.
    expect(record.record_json).toEqual({
      session_count: 8,
      note_id: 'wn_dl_y',
      completed_at: '2026-04-02T00:00:00.000Z',
      deload_session_ordinal: 3,
      generated_at: '2026-04-01T00:00:00.000Z',
    });
    // Unknown keys never leave the device.
    expect(record.record_json).not.toHaveProperty('__sentinel__');
    expect(record.record_json).not.toHaveProperty('coach_comment');
  });

  it('sets record_json to null when a deload record has no allowlisted keys', async () => {
    await AsyncStorage.setItem(
      'kilo_workout_deload_history',
      JSON.stringify([
        {
          id: 'dl_bare',
          date: '2026-03-01',
          raw_text: 'bare deload note',
          saved_at: '2026-03-01T00:00:00.000Z',
          __sentinel__: 'should-not-upload',
        },
      ])
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const record = client.upsertsByTable.deload_history[0];
    expect(record.id).toBe('dl_bare');
    expect(record.record_json).toBeNull();
  });
});

describe('phantom Routine 1 prevention (issue #443)', () => {
  it('does not create a phantom Routine 1 when workoutNotes is non-empty and workoutNote has different content', async () => {
    // User already has a notebook with their current routine.
    await AsyncStorage.setItem(
      'kilo_workout_notes',
      JSON.stringify([
        {
          id: 'wn_current',
          title: 'Stretch Transition',
          raw_text: '-Squat\n- 225 5,5,5\n-RDL\n- 185 8,8',
          saved_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-10T00:00:00.000Z',
          tracked_exercises: ['Squat'],
          one_k_exercises: null,
          isCurrent: true,
        },
      ])
    );
    await AsyncStorage.setItem('kilo_current_workout_id', JSON.stringify('wn_current'));
    // Legacy kilo_workout_note still exists with DIFFERENT (older) content.
    await AsyncStorage.setItem(
      'kilo_workout_note',
      JSON.stringify({
        raw_text: '-Bench\n- 135 5,5,5',
        saved_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-02T00:00:00.000Z',
      })
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const notes = client.upsertsByTable.workout_notes;
    const phantom = notes.find(
      (n) => n.source_snapshot?.async_storage_key === 'kilo_workout_note'
    );
    expect(phantom).toBeUndefined();

    // Only the notebook entry should be present.
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe('wn_current');
  });

  it('does not create a phantom Routine 1 when workoutNotes is non-empty and workoutNote has identical content', async () => {
    // After local migration: workoutNotes has the migrated entry, kilo_workout_note still present.
    const noteText = '-Squat\n- 225 5,5,5';
    await AsyncStorage.setItem(
      'kilo_workout_notes',
      JSON.stringify([
        {
          id: 'wn_migrated',
          title: 'Routine 1',
          raw_text: noteText,
          saved_at: '2026-05-01T00:00:00.000Z',
          updated_at: '2026-05-02T00:00:00.000Z',
          tracked_exercises: [],
          one_k_exercises: null,
          isCurrent: true,
        },
      ])
    );
    await AsyncStorage.setItem('kilo_current_workout_id', JSON.stringify('wn_migrated'));
    await AsyncStorage.setItem(
      'kilo_workout_note',
      JSON.stringify({
        raw_text: noteText,
        saved_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-02T00:00:00.000Z',
      })
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const notes = client.upsertsByTable.workout_notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe('wn_migrated');
    // No phantom legacy entry.
    const legacy = notes.find(
      (n) => n.source_snapshot?.async_storage_key === 'kilo_workout_note'
    );
    expect(legacy).toBeUndefined();
  });

  it('imports the legacy note when workoutNotes is empty (no notebook yet)', async () => {
    // No notebook entries — legacy-only install.
    await AsyncStorage.setItem(
      'kilo_workout_note',
      JSON.stringify({
        raw_text: '-Deadlift\n- 315 3,3,3',
        saved_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-02T00:00:00.000Z',
      })
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const notes = client.upsertsByTable.workout_notes;
    const legacyRow = notes.find(
      (n) => n.source_snapshot?.async_storage_key === 'kilo_workout_note'
    );
    expect(legacyRow).toBeTruthy();
    expect(legacyRow.title).toBe('Routine 1');
    expect(legacyRow.raw_text).toBe('-Deadlift\n- 315 3,3,3');
  });

  it('preserves legacy saved_at as the date provenance for the imported row', async () => {
    await AsyncStorage.setItem(
      'kilo_workout_note',
      JSON.stringify({
        raw_text: '-Press\n- 95 5,5,5',
        saved_at: '2026-03-15T10:00:00.000Z',
        updated_at: '2026-03-20T12:00:00.000Z',
      })
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const legacyRow = client.upsertsByTable.workout_notes.find(
      (n) => n.source_snapshot?.async_storage_key === 'kilo_workout_note'
    );
    expect(legacyRow).toBeTruthy();
    // Date provenance: saved_at from legacy note is preserved.
    expect(legacyRow.saved_at).toBe('2026-03-15T10:00:00.000Z');
    expect(legacyRow.updated_at).toBe('2026-03-20T12:00:00.000Z');
  });

  it('sets saved_at to null when legacy note has no saved_at', async () => {
    await AsyncStorage.setItem(
      'kilo_workout_note',
      JSON.stringify({ raw_text: '-OHP\n- 75 8,8,8' })
    );

    const client = makeFakeClient();
    await bootstrapFromLocal(USER_ID, client);

    const legacyRow = client.upsertsByTable.workout_notes.find(
      (n) => n.source_snapshot?.async_storage_key === 'kilo_workout_note'
    );
    expect(legacyRow).toBeTruthy();
    expect(legacyRow.saved_at).toBeNull();
    // updated_at falls back to bootstrap time when absent.
    expect(legacyRow.updated_at).toBeTruthy();
  });
});

describe('phantom Routine 1 ownership-upload regression (issue #501)', () => {
  const PHANTOM_ID = `wn_legacy_${USER_ID}`;

  // buildBootstrapPlan is the pure boundary the ownership "Upload It Into My
  // Account" path pushes through. These assert the uploaded workout_notes row
  // shape directly, independent of the sync path.

  it('does NOT resurrect a locally-tombstoned legacy phantom on upload', async () => {
    const snapshot = {
      workoutNotes: [
        {
          id: 'wn_real',
          title: 'Summer 2026 Routine',
          raw_text: '-Bench\n- 185 5,5,5',
          updated_at: '2026-06-15T00:00:00.000Z',
        },
        // A legacy phantom the #458 cleanup already tombstoned in the notebook.
        {
          id: PHANTOM_ID,
          title: 'Routine 1',
          raw_text: '-Squat\n- 225 5,5,5',
          saved_at: '2026-05-01T00:00:00.000Z',
          updated_at: '2026-05-03T00:00:00.000Z',
          deleted_at: '2026-05-03T00:00:00.000Z',
          source_snapshot: { async_storage_key: 'kilo_workout_note' },
        },
      ],
      workoutNote: null,
      workoutSessions: [],
      currentWorkoutId: 'wn_real',
    };

    const plan = buildBootstrapPlan(snapshot, USER_ID);
    const phantom = plan.workout_notes.find((n) => n.id === PHANTOM_ID);
    expect(phantom).toBeTruthy();
    // Stays a tombstone: not revived into a fresh live cloud row by the upsert.
    expect(phantom.deleted_at).toBe('2026-05-03T00:00:00.000Z');
    // Provenance preserved so the sync guard can still recognize it.
    expect(phantom.source_snapshot).toEqual({ async_storage_key: 'kilo_workout_note' });
  });

  it('preserves legacy provenance when a LIVE legacy phantom is re-uploaded', async () => {
    const snapshot = {
      workoutNotes: [
        { id: 'wn_real', title: 'Summer 2026 Routine', raw_text: '-Bench\n- 185 5', updated_at: '2026-06-15T00:00:00.000Z' },
        {
          id: PHANTOM_ID,
          title: 'Routine 1',
          raw_text: '-Squat\n- 225 5,5,5',
          updated_at: '2026-05-02T00:00:00.000Z',
          source_snapshot: { async_storage_key: 'kilo_workout_note' },
        },
      ],
      workoutNote: null,
      workoutSessions: [],
      currentWorkoutId: 'wn_real',
    };

    const plan = buildBootstrapPlan(snapshot, USER_ID);
    const phantom = plan.workout_notes.find((n) => n.id === PHANTOM_ID);
    // source_snapshot must NOT be nulled; deleted_at stays null (still live).
    expect(phantom.source_snapshot).toEqual({ async_storage_key: 'kilo_workout_note' });
    expect(phantom.deleted_at).toBeNull();
  });

  it('leaves a legitimate user-authored note untouched (no provenance, live)', async () => {
    const snapshot = {
      workoutNotes: [
        {
          id: 'wn_2026-06-01_123',
          title: 'Routine 1',
          raw_text: '-Press\n- 95 5,5,5',
          updated_at: '2026-06-15T00:00:00.000Z',
        },
      ],
      workoutNote: null,
      workoutSessions: [],
      currentWorkoutId: 'wn_2026-06-01_123',
    };

    const plan = buildBootstrapPlan(snapshot, USER_ID);
    const note = plan.workout_notes.find((n) => n.id === 'wn_2026-06-01_123');
    expect(note.source_snapshot).toBeNull();
    expect(note.deleted_at).toBeNull();
  });

  // End-to-end: real bootstrap upsert + real sync + repeated launch, sharing one
  // in-memory store, reproduces the full reported path and proves convergence.
  describe('end-to-end upload → sync → restart', () => {
    // A store both a Supabase-client-shaped facade (bootstrap) and a transport
    // (sync) write into, so the phantom bootstrap produces is the one sync pulls.
    // A server trigger stamps updated_at on every write (as Postgres does), while
    // the client-supplied deleted_at survives verbatim.
    function makeSharedCloud() {
      const tables = {};
      for (const table of Object.values(SYNC_TABLES)) tables[table] = new Map();
      let lastMs = 0;
      const serverNow = (table) => {
        let maxMs = Math.max(lastMs, Date.now());
        for (const row of tables[table].values()) {
          const ms = Date.parse(row.updated_at || 0);
          if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
        }
        lastMs = maxMs + 1;
        return new Date(lastMs).toISOString();
      };
      const applyUpsert = (table, rows) => {
        for (const rec of rows) {
          const { client_id: _c, ...row } = rec; // eslint-disable-line no-unused-vars
          tables[table].set(row.id, { ...row, updated_at: serverNow(table) });
        }
      };
      const transport = {
        async pull(table, cursor) {
          const rows = [...tables[table].values()];
          const changed = cursor ? rows.filter((r) => (r.updated_at || '') >= cursor) : rows;
          return changed
            .sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''))
            .map(({ client_id: _c, ...row }) => row); // eslint-disable-line no-unused-vars
        },
        async push(table, records) { applyUpsert(table, records); },
      };
      const client = {
        schema() {
          return {
            from(table) {
              return {
                async upsert(rows) { applyUpsert(table, rows); return { data: rows, error: null }; },
                select() {
                  return { eq() { return { async maybeSingle() { return { data: null, error: null }; } }; } };
                },
              };
            },
          };
        },
      };
      return { tables, transport, client, remoteRow: (t, id) => tables[t].get(id) };
    }

    beforeEach(() => {
      resetClientIdCacheForTests();
      resetStampClockForTests();
      Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    });

    afterEach(() => {
      setCloudTransport(null);
      Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    });

    it('does not surface a phantom Routine 1 after Upload It Into My Account + sync + restart', async () => {
      // Local notebook (owned by the account): a real note plus a legacy phantom
      // the prior #458 cleanup tombstoned locally.
      await AsyncStorage.setItem(
        'kilo_workout_notes',
        JSON.stringify([
          {
            id: 'wn_real',
            title: 'Summer 2026 Routine',
            raw_text: '-Bench\n- 185 5,5,5',
            saved_at: '2026-06-01T00:00:00.000Z',
            updated_at: '2026-06-15T00:00:00.000Z',
            isCurrent: true,
          },
          {
            id: PHANTOM_ID,
            title: 'Routine 1',
            raw_text: '-Squat\n- 225 5,5,5',
            saved_at: '2026-05-01T00:00:00.000Z',
            updated_at: '2026-05-03T00:00:00.000Z',
            deleted_at: '2026-05-03T00:00:00.000Z',
            source_snapshot: { async_storage_key: 'kilo_workout_note' },
          },
        ])
      );
      await AsyncStorage.setItem('kilo_current_workout_id', JSON.stringify('wn_real'));

      const shared = makeSharedCloud();
      setCloudTransport(shared.transport);

      // "Upload It Into My Account": bootstrap uploads the whole local notebook.
      await bootstrapFromLocal(USER_ID, shared.client);
      // Ongoing sync runs immediately after (confirmOwnershipUpload → runInitialSync).
      await sync();

      // The phantom must never be user-visible after the upload/sync path.
      let notes = await Storage.loadWorkoutNotes();
      const visible = notes.filter((n) => !n.deleted_at);
      expect(visible.find((n) => n.id === PHANTOM_ID)).toBeUndefined();
      expect(visible.find((n) => n.id === 'wn_real')).toBeTruthy();

      // Cloud converged to a tombstone; the user's real note is live.
      expect(isTombstone(shared.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID))).toBe(true);
      expect(isTombstone(shared.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'wn_real'))).toBe(false);

      // Restart: repeated sync stays idempotent — no phantom returns.
      await sync();
      await sync();
      notes = await Storage.loadWorkoutNotes();
      expect(notes.filter((n) => !n.deleted_at).find((n) => n.id === PHANTOM_ID)).toBeUndefined();
      expect(isTombstone(shared.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID))).toBe(true);
    });
  });
});

describe('weight-entry and deload tombstone upload regression (issue #513)', () => {
  // buildBootstrapPlan is the pure boundary the ownership "Upload It Into My
  // Account" path pushes through. Same mechanism as the #501 notes fix: a
  // builder that drops deleted_at re-upserts a locally-deleted record as a
  // fresh LIVE row that wins LWW on every device.

  it('does NOT resurrect a locally-tombstoned weight entry on upload', () => {
    const snapshot = {
      weightEntries: [
        {
          id: 'we_live',
          entry_type: 'weight',
          date: '2026-06-10',
          weight_value: 181,
          updated_at: '2026-06-10T08:00:00.000Z',
        },
        {
          id: 'we_deleted',
          entry_type: 'weight',
          date: '2026-06-11',
          weight_value: 305,
          updated_at: '2026-06-12T09:00:00.000Z',
          deleted_at: '2026-06-12T09:00:00.000Z',
        },
      ],
    };

    const plan = buildBootstrapPlan(snapshot, USER_ID);
    const dead = plan.weight_entries.find((e) => e.id === 'we_deleted');
    expect(dead).toBeTruthy();
    // Stays a tombstone: not revived into a fresh live cloud row by the upsert.
    expect(dead.deleted_at).toBe('2026-06-12T09:00:00.000Z');
    const live = plan.weight_entries.find((e) => e.id === 'we_live');
    expect(live.deleted_at).toBeNull();
  });

  it('does NOT resurrect a locally-tombstoned deload record on upload', () => {
    const snapshot = {
      deloadHistory: [
        {
          id: 'dl_deleted',
          date: '2026-05-20',
          raw_text: 'deload note',
          saved_at: '2026-05-20T00:00:00.000Z',
          deleted_at: '2026-05-21T00:00:00.000Z',
        },
      ],
    };

    const plan = buildBootstrapPlan(snapshot, USER_ID);
    const dead = plan.deload_history.find((r) => r.id === 'dl_deleted');
    expect(dead).toBeTruthy();
    expect(dead.deleted_at).toBe('2026-05-21T00:00:00.000Z');
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

// ── clean-install cloud restore (issues #481/#482/#483) ─────────────────────
//
// bootstrapFromLocal previously only ever pushed the local snapshot to the
// cloud; user_profile and feature_toggles (the two singleton tables carrying
// current routine, tracked lifts, fatigue multiplier, unit system, ui_state,
// and feature toggles) were never read back. These tests cover the
// download-and-hydrate direction added to close that gap: a clean install
// restores that state from an account's existing cloud rows, restoration
// never clobbers a device that already has real local data, and the restore
// is idempotent.

const REMOTE_PROFILE = Object.freeze({
  user_id: USER_ID,
  display_name: 'Cloud Ben',
  unit_system: 'metric',
  current_workout_note_id: 'wn_cloud_1',
  fatigue_multiplier: 1.12,
  tracked_lifts: { bench: true, deadlift: true },
  ui_state: { log_current_collapsed: true },
  updated_at: '2026-07-01T00:00:00.000Z',
});

const REMOTE_TOGGLES = Object.freeze({
  user_id: USER_ID,
  weight_date_edit_enabled: true,
  deload_date_edit_enabled: true,
  fatigue_tracking_enabled: false,
  deload_mode_enabled: false,
  updated_at: '2026-07-01T00:00:00.000Z',
});

describe('clean-install cloud restore (#481/#482/#483)', () => {
  it('hydrates current routine, tracked lifts, fatigue multiplier, unit system, ui_state, and feature toggles on a clean install', async () => {
    // Nothing local at all — a genuinely fresh install signing into an
    // account that already bootstrapped from another device.
    const client = makeFakeClient({
      remoteRows: { user_profile: REMOTE_PROFILE, feature_toggles: REMOTE_TOGGLES },
    });

    const result = await bootstrapFromLocal(USER_ID, client);
    expect(result.ok).toBe(true);

    expect(await Storage.loadCurrentWorkoutId()).toBe('wn_cloud_1');
    expect(await Storage.loadFatigueMultiplier()).toBe(1.12);
    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true, deadlift: true });
    expect(await Storage.loadWorkoutCollapsed()).toBe(true);
    const profile = await Storage.loadUserProfile();
    expect(profile.display_name).toBe('Cloud Ben');
    expect(profile.unit_system).toBe('metric');
    expect(await Storage.loadWeightDateEditEnabled()).toBe(true);
    expect(await Storage.loadDeloadDateEditEnabled()).toBe(true);
    expect(await Storage.loadFatigueTrackingEnabled()).toBe(false);
    expect(await Storage.loadDeloadModeEnabled()).toBe(false);
  });

  it('does not restore anything when the account has no cloud rows yet (first-ever bootstrap)', async () => {
    const client = makeFakeClient({
      remoteRows: { user_profile: null, feature_toggles: null },
    });

    await bootstrapFromLocal(USER_ID, client);

    expect(await Storage.loadCurrentWorkoutId()).toBeNull();
    expect(await Storage.loadTrackedLifts()).toEqual({});
    expect(await Storage.loadUserProfile()).toBeNull();
  });

  it('never overwrites a device that already has real local data, even if the cloud row differs', async () => {
    // Device already has its own local routine/tracked lifts/profile — not a
    // clean install, so isCleanLocalState must gate the download off entirely.
    await seedLocalData();
    const localBefore = await snapshotLocal();

    const client = makeFakeClient({
      remoteRows: { user_profile: REMOTE_PROFILE, feature_toggles: REMOTE_TOGGLES },
    });
    await bootstrapFromLocal(USER_ID, client);

    // Local storage is byte-for-byte unchanged by the restore attempt — only
    // the (unrelated) push side of bootstrap ran.
    const localAfter = await snapshotLocal();
    expect(localAfter).toEqual(localBefore);

    // The push still reflects this device's own (pre-existing) local values,
    // not the divergent cloud row. The health values live in user_health_profile
    // since #487; user_profile carries account settings only.
    expect(client.upsertsByTable.user_health_profile[0].current_workout_note_id).toBe('wn1');
    expect(client.upsertsByTable.user_health_profile[0].fatigue_multiplier).toBe(1.1);
  });

  it('is idempotent: running bootstrap twice does not change hydrated values or duplicate upserts', async () => {
    const client = makeFakeClient({
      remoteRows: { user_profile: REMOTE_PROFILE, feature_toggles: REMOTE_TOGGLES },
    });

    await bootstrapFromLocal(USER_ID, client);
    const firstCurrentId = await Storage.loadCurrentWorkoutId();
    const firstTracked = await Storage.loadTrackedLifts();

    await bootstrapFromLocal(USER_ID, client);
    const secondCurrentId = await Storage.loadCurrentWorkoutId();
    const secondTracked = await Storage.loadTrackedLifts();

    expect(secondCurrentId).toBe(firstCurrentId);
    expect(secondTracked).toEqual(firstTracked);
    expect(client.upsertsByTable.user_profile).toHaveLength(1);
    expect(client.upsertsByTable.feature_toggles).toHaveLength(1);
  });

  it('surfaces a select failure as a retryable BootstrapError and leaves local storage untouched', async () => {
    const client = makeFakeClient({
      remoteRows: { user_profile: REMOTE_PROFILE, feature_toggles: REMOTE_TOGGLES },
      selectFailTable: 'user_profile',
    });

    await expect(bootstrapFromLocal(USER_ID, client)).rejects.toBeInstanceOf(BootstrapError);

    // Nothing was hydrated and nothing was pushed.
    expect(await Storage.loadCurrentWorkoutId()).toBeNull();
    expect(client.upsertsByTable.user_profile).toBeUndefined();

    // Retry against a healthy client succeeds from the same untouched state.
    const healthy = makeFakeClient({
      remoteRows: { user_profile: REMOTE_PROFILE, feature_toggles: REMOTE_TOGGLES },
    });
    const result = await bootstrapFromLocal(USER_ID, healthy);
    expect(result.ok).toBe(true);
    expect(await Storage.loadCurrentWorkoutId()).toBe('wn_cloud_1');
  });

  it('restores routine-scoped analytics (session count) from the restored current routine, without re-entering anything', async () => {
    const {
      getNoteSections,
    } = require('../hooks/entries/noteSections');
    const { deriveRoutineStatus } = require('../lib/data');

    const remoteNote = {
      user_id: USER_ID,
      id: 'wn_cloud_1',
      title: 'Restored Routine',
      raw_text: '-Bench\n- 135 5,5,5\n- 145 5,5,5',
      saved_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
      tracked_exercises: ['Bench'],
      one_k_exercises: null,
      skip_markers: null,
      attendance_flags: null,
      exercise_classifications: null,
      session_checkins: null,
      is_current: true,
      source_snapshot: null,
      client_id: 'device-a',
      deleted_at: null,
    };

    const client = makeFakeClient({
      remoteRows: { user_profile: REMOTE_PROFILE, feature_toggles: REMOTE_TOGGLES },
    });
    // 1. Bootstrap restores the current-routine pointer (user_profile row).
    await bootstrapFromLocal(USER_ID, client);
    expect(await Storage.loadCurrentWorkoutId()).toBe('wn_cloud_1');

    // 2. The workout-notes row itself restores via the existing bidirectional
    //    sync() pull (SYNC_TABLES.WORKOUT_NOTES) — unchanged by this issue,
    //    exercised here only to prove the two combine into working analytics.
    setCloudTransport({
      async pull(table) {
        return table === 'workout_notes' ? [remoteNote] : [];
      },
      async push() {},
    });
    try {
      await sync();
    } finally {
      setCloudTransport(null);
    }

    const notes = await Storage.loadWorkoutNotes();
    const currentId = await Storage.loadCurrentWorkoutId();
    const currentNote = notes.find((n) => n.id === currentId);
    expect(currentNote).toBeTruthy();

    const currentSections = getNoteSections(currentNote);
    const status = deriveRoutineStatus(currentSections, currentNote, []);
    // Two logged Bench sessions in the restored note's raw_text, without the
    // user re-entering or re-tracking anything on this device.
    expect(status.sessionsLogged).toBeGreaterThan(0);
  });
});

// ── fatigue projection after bootstrap (issue #498) ─────────────────────────
//
// Bootstrap pushes workout_notes (including their session_checkins), but never
// wrote the derived fatigue_checkins projection. The ongoing sync that follows
// bootstrap now derives it from the just-bootstrapped canonical notes, so an
// account with existing session_checkins ends up with populated fatigue_checkins.
describe('fatigue projection populates after bootstrap (issue #498)', () => {
  it('derives and pushes fatigue_checkins from existing note session_checkins', async () => {
    resetClientIdCacheForTests();
    resetStampClockForTests();

    const CHECKIN = {
      status: 'rough',
      reasons: ['fatigued'],
      responded_at: '2026-06-02T08:00:00.000Z',
      note: 'tough',
      exercises_skipped: 0,
      volume_decline_pct: null,
      flagged: [],
      detectors: [],
    };
    await AsyncStorage.setItem(
      'kilo_workout_notes',
      JSON.stringify([
        {
          id: 'wn1',
          title: 'Routine A',
          raw_text: '-Squat\n- 225 5,5,5',
          saved_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-02T00:00:00.000Z',
          session_checkins: { '0': CHECKIN },
          isCurrent: true,
        },
      ])
    );

    // Bootstrap uploads the canonical note; it does not itself write the projection.
    await bootstrapFromLocal(USER_ID, makeFakeClient());

    // The ongoing sync after bootstrap derives fatigue_checkins from the note.
    const pushed = {};
    setCloudTransport({
      async pull() {
        return [];
      },
      async push(table, records) {
        pushed[table] = (pushed[table] || []).concat(records);
      },
    });
    try {
      await sync();
    } finally {
      setCloudTransport(null);
    }

    expect(pushed.fatigue_checkins).toHaveLength(1);
    const row = pushed.fatigue_checkins[0];
    expect(row.id).toBe('fc_wn1_0');
    expect(row.workout_note_id).toBe('wn1');
    expect(row.session_date).toBe('2026-06-02');
    expect(row.status).toBe('rough');
    expect(row.reasons).toEqual(['fatigued']);
  });
});

// ── sync adapter: archived_weight_goals transport ───────────────────────────
//
// Proves that archived_weight_goals is processed by the sync adapter (pushed
// to and pulled from the transport layer), not merely accumulated in the dirty
// queue. Uses an injected fake transport so no network or Supabase client is
// needed.

describe('sync adapter: archived_weight_goals transport', () => {
  let pushed;
  let remoteRows;
  let fakeTransport;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
    resetStampClockForTests();
    pushed = {};
    remoteRows = {};
    fakeTransport = {
      async pull(table, _cursor) {
        return remoteRows[table] || [];
      },
      async push(table, records) {
        pushed[table] = (pushed[table] || []).concat(records);
      },
    };
    setCloudTransport(fakeTransport);
  });

  afterEach(() => {
    setCloudTransport(null);
  });

  it('pushes dirty archived goals to the transport layer on sync()', async () => {
    const clientId = await getClientId();
    const base = {
      id: 'ag_sync_test_1',
      target_weight: 175,
      archived_at: '2026-09-02T08:00:00.000Z',
      saved_at: '2026-09-02T08:00:00.000Z',
    };
    const stamped = stampWrite(base, clientId);
    // Simulate what archiveGoal does: write to local list and enqueue dirty.
    await replaceArchivedWeightGoalsRaw([stamped]);
    await enqueueDirty(SYNC_TABLES.ARCHIVED_WEIGHT_GOALS, stamped);

    const results = await sync();

    // sync() returns one result per table; the archived_weight_goals pass exists.
    const agResult = results.find((r) => r.table === SYNC_TABLES.ARCHIVED_WEIGHT_GOALS);
    expect(agResult).toBeTruthy();
    expect(agResult.pushed).toBe(1);

    // The fake transport received the archived goal in its push call.
    expect(pushed[SYNC_TABLES.ARCHIVED_WEIGHT_GOALS]).toHaveLength(1);
    expect(pushed[SYNC_TABLES.ARCHIVED_WEIGHT_GOALS][0].id).toBe('ag_sync_test_1');
  });

  it('pulls remote archived goals into local storage on sync()', async () => {
    const clientId = await getClientId();
    const remote = stampWrite(
      {
        id: 'ag_remote_1',
        target_weight: 180,
        archived_at: '2026-10-01T08:00:00.000Z',
        saved_at: '2026-10-01T08:00:00.000Z',
      },
      clientId
    );
    remoteRows[SYNC_TABLES.ARCHIVED_WEIGHT_GOALS] = [remote];

    await sync();

    const { loadArchivedWeightGoalsRaw: readRaw } = require('../storage/entries/weightGoal');
    const local = await readRaw();
    expect(local.some((r) => r.id === 'ag_remote_1')).toBe(true);
  });

  it('sync() processes archived_weight_goals in addition to weight_entries and workout_notes', async () => {
    const results = await sync();
    const tables = results.map((r) => r.table);
    expect(tables).toContain(SYNC_TABLES.WEIGHT_ENTRIES);
    expect(tables).toContain(SYNC_TABLES.WORKOUT_NOTES);
    expect(tables).toContain(SYNC_TABLES.ARCHIVED_WEIGHT_GOALS);
  });
});
