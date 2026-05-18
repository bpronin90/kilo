import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadWeightEntries,
  saveWeightEntry,
  deleteWeightEntry,
  updateWeightEntry,
  loadWorkoutSessions,
  saveWorkoutSession,
  deleteWorkoutSession,
  loadWorkoutNote,
  saveWorkoutNote,
  saveTrackedExercises,
  clearWorkoutNote,
  migrateWorkoutNote,
} from '../storage/entries';
import { computeWeightTrends } from '../lib/data';
import { parseWorkoutNote } from '../lib/parser';

const W1 = { id: 'w_2026-05-01_1', entry_type: 'weight', date: '2026-05-01', weight_value: 192.0, weight_unit: 'lb', logged_at: '2026-05-01T08:00:00.000Z', saved_at: '2026-05-01T08:00:00.000Z' };
const W2 = { id: 'w_2026-05-02_2', entry_type: 'weight', date: '2026-05-02', weight_value: 191.5, weight_unit: 'lb', logged_at: '2026-05-02T08:00:00.000Z', saved_at: '2026-05-02T08:00:00.000Z' };

const S1 = {
  id: 's_2026-05-01_1', entry_type: 'workout', date: '2026-05-01', saved_at: '2026-05-01T23:00:00.000Z',
  items: [{ exercise_name: 'Squat', result_kind: 'sets', note_text: null, position: 1, sets: [{ set_index: 1, rep_count: 5, weight_value: 225, weight_unit: 'lb', duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null }] }],
};

// Fixture with all optional set fields populated to verify migration fidelity
const S2 = {
  id: 's_2026-05-02_1', entry_type: 'workout', date: '2026-05-02', saved_at: '2026-05-02T23:00:00.000Z',
  items: [
    {
      exercise_name: 'Assisted Pull-up', result_kind: 'sets', note_text: 'grip neutral', position: 1,
      sets: [
        { set_index: 1, rep_count: 8, weight_value: null, weight_unit: null, duration_seconds: null, assistance_value: 20, assistance_unit: 'lb', note_text: 'slow' },
        { set_index: 2, rep_count: 6, weight_value: null, weight_unit: null, duration_seconds: null, assistance_value: 20, assistance_unit: 'lb', note_text: null },
      ],
    },
    {
      exercise_name: 'Plank', result_kind: 'duration', note_text: null, position: 2,
      sets: [{ set_index: 1, rep_count: null, weight_value: null, weight_unit: null, duration_seconds: 45, assistance_value: null, assistance_unit: null, note_text: null }],
    },
  ],
};

beforeEach(() => {
  AsyncStorage.clear();
});

// ── weight entries ────────────────────────────────────────────────────────────

describe('weight entry storage', () => {
  test('loads empty list when storage is empty', async () => {
    const entries = await loadWeightEntries();
    expect(entries).toEqual([]);
  });

  test('saves and retrieves a weight entry', async () => {
    await saveWeightEntry(W1);
    const entries = await loadWeightEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(W1.id);
    expect(entries[0].weight_value).toBe(W1.weight_value);
  });

  test('returns entries sorted newest first', async () => {
    await saveWeightEntry(W1);
    await saveWeightEntry(W2);
    const entries = await loadWeightEntries();
    expect(entries[0].id).toBe(W2.id);
    expect(entries[1].id).toBe(W1.id);
  });

  test('deletes a weight entry by id', async () => {
    await saveWeightEntry(W1);
    await saveWeightEntry(W2);
    await deleteWeightEntry(W1.id);
    const entries = await loadWeightEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(W2.id);
  });

  test('updates weight_value and note for an existing entry', async () => {
    await saveWeightEntry(W1);
    const ok = await updateWeightEntry(W1.id, 190.0, 'Updated note');
    expect(ok).toBe(true);
    const entries = await loadWeightEntries();
    expect(entries[0].weight_value).toBe(190.0);
    expect(entries[0].note).toBe('Updated note');
  });

  test('returns false when updating a non-existent entry', async () => {
    const ok = await updateWeightEntry('no-such-id', 190.0);
    expect(ok).toBe(false);
  });
});

// ── workout sessions ──────────────────────────────────────────────────────────

describe('workout session storage', () => {
  test('loads empty list when storage is empty', async () => {
    const sessions = await loadWorkoutSessions();
    expect(sessions).toEqual([]);
  });

  test('saves and retrieves a workout session', async () => {
    await saveWorkoutSession(S1);
    const sessions = await loadWorkoutSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(S1.id);
    expect(sessions[0].items).toHaveLength(1);
  });

  test('deletes a workout session by id', async () => {
    await saveWorkoutSession(S1);
    await deleteWorkoutSession(S1.id);
    const sessions = await loadWorkoutSessions();
    expect(sessions).toEqual([]);
  });
});

// ── workout routine note ──────────────────────────────────────────────────────

describe('workout note storage', () => {
  test('returns null when no note has been saved', async () => {
    const note = await loadWorkoutNote();
    expect(note).toBeNull();
  });

  test('saves and retrieves raw text without modification', async () => {
    await saveWorkoutNote('Squat 225 5,5,5\nRDL 185 8,8');
    const note = await loadWorkoutNote();
    expect(note.raw_text).toBe('Squat 225 5,5,5\nRDL 185 8,8');
  });

  test('overwrites previous note on save, not appends', async () => {
    await saveWorkoutNote('first note');
    await saveWorkoutNote('second note');
    const note = await loadWorkoutNote();
    expect(note.raw_text).toBe('second note');
  });

  test('preserves original saved_at across overwrites', async () => {
    await saveWorkoutNote('first note');
    const first = await loadWorkoutNote();
    await saveWorkoutNote('second note');
    const second = await loadWorkoutNote();
    expect(second.saved_at).toBe(first.saved_at);
  });

  test('returned note includes saved_at and updated_at timestamps', async () => {
    const saved = await saveWorkoutNote('some note');
    expect(saved.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(saved.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('clear removes the note', async () => {
    await saveWorkoutNote('some content');
    await clearWorkoutNote();
    const note = await loadWorkoutNote();
    expect(note).toBeNull();
  });

  test('weight entries are unaffected by workout note operations', async () => {
    await saveWeightEntry(W1);
    await saveWorkoutNote('Deadlift 315 4,4,4');
    await clearWorkoutNote();
    const entries = await loadWeightEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(W1.id);
  });

  test('saves and retrieves tracked exercises', async () => {
    await saveWorkoutNote('Squat 225 5,5,5');
    await saveTrackedExercises(['Squat']);
    const note = await loadWorkoutNote();
    expect(note.tracked_exercises).toEqual(['Squat']);
    expect(note.raw_text).toBe('Squat 225 5,5,5');
  });

  test('preserves tracked exercises when updating raw text', async () => {
    await saveWorkoutNote('Squat 225 5,5,5');
    await saveTrackedExercises(['Squat']);
    await saveWorkoutNote('Squat 225 5,5,5\nBench 135 5,5,5');
    const note = await loadWorkoutNote();
    expect(note.tracked_exercises).toEqual(['Squat']);
  });
});

// ── weight trends ─────────────────────────────────────────────────────────────

describe('computeWeightTrends', () => {
  // Use local-time constructor (year, month-0, day) to avoid UTC-midnight shift in tests.
  // REF = 2026-05-16. 7-day window: May 10–16 inclusive. 30-day window: Apr 17–May 16.
  const REF = new Date(2026, 4, 16);

  test('returns nulls for empty entries', () => {
    expect(computeWeightTrends([], REF)).toEqual({ avg7: null, avg30: null, paceFlag: null });
  });

  test('computes 7-day average from entries within 7 days', () => {
    const entries = [
      { date: '2026-05-15', weight_value: 192 },
      { date: '2026-05-13', weight_value: 190 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.avg7).toBeCloseTo(191);
  });

  test('includes entry on the 7-day boundary date', () => {
    const entries = [{ date: '2026-05-10', weight_value: 191 }];
    const result = computeWeightTrends(entries, REF);
    expect(result.avg7).toBeCloseTo(191);
  });

  test('excludes entry one day before the 7-day boundary', () => {
    const entries = [
      { date: '2026-05-15', weight_value: 192 },
      { date: '2026-05-09', weight_value: 180 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.avg7).toBeCloseTo(192);
  });

  test('computes 30-day average including entries beyond 7 days', () => {
    const entries = [
      { date: '2026-05-15', weight_value: 192 },
      { date: '2026-04-20', weight_value: 188 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.avg30).toBeCloseTo(190);
    expect(result.avg7).toBeCloseTo(192);
  });

  test('includes entry on the 30-day boundary date', () => {
    const entries = [{ date: '2026-04-17', weight_value: 190 }];
    const result = computeWeightTrends(entries, REF);
    expect(result.avg30).toBeCloseTo(190);
    expect(result.avg7).toBeNull();
  });

  test('excludes entry one day before the 30-day boundary', () => {
    const entries = [
      { date: '2026-05-15', weight_value: 192 },
      { date: '2026-04-16', weight_value: 180 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.avg30).toBeCloseTo(192);
  });

  test('flags gain pace above 0.5 lb per week from 7-day window', () => {
    // Both entries within 7-day window (May 10–16): 2 lb gain over 4 days ≈ 3.5 lb/week
    const entries = [
      { date: '2026-05-15', weight_value: 194 },
      { date: '2026-05-11', weight_value: 192 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.paceFlag).toBe('gain');
  });

  test('flags loss pace above 0.5 lb per week from 7-day window', () => {
    const entries = [
      { date: '2026-05-15', weight_value: 190 },
      { date: '2026-05-11', weight_value: 192 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.paceFlag).toBe('loss');
  });

  test('returns null paceFlag for change below 0.5 lb per week', () => {
    const entries = [
      { date: '2026-05-15', weight_value: 192.2 },
      { date: '2026-05-11', weight_value: 192.0 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.paceFlag).toBeNull();
  });

  test('returns null paceFlag with a single entry', () => {
    const entries = [{ date: '2026-05-15', weight_value: 192 }];
    expect(computeWeightTrends(entries, REF).paceFlag).toBeNull();
  });

  test('falls back to 30-day window for pace when 7-day has only one entry', () => {
    // May 15 in 7-day window, Apr 20 only in 30-day; pace computed from 30-day
    const entries = [
      { date: '2026-05-15', weight_value: 194 },
      { date: '2026-04-20', weight_value: 187 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.paceFlag).toBe('gain');
  });
});

// ── unified persistence ───────────────────────────────────────────────────────

describe('unified persistence — note as canonical source', () => {
  test('saved note raw_text is parseable into exercise sections', async () => {
    const raw = 'Monday\n-Squat\n225 5,5,5\n-Bench\n135 8,8,8';
    await saveWorkoutNote(raw);
    const note = await loadWorkoutNote();
    const { sections } = parseWorkoutNote(note.raw_text);
    expect(sections.length).toBeGreaterThan(0);
    const names = sections.flatMap(s => s.exercises.map(e => e.name));
    expect(names).toContain('Squat');
    expect(names).toContain('Bench');
  });

  test('editing note raw_text changes parsed exercise output consistently', async () => {
    await saveWorkoutNote('Monday\n-Squat\n225 5,5,5');
    await saveWorkoutNote('Monday\n-Squat\n225 5,5,5\n-Deadlift\n315 3,3,3');
    const note = await loadWorkoutNote();
    const { sections } = parseWorkoutNote(note.raw_text);
    const names = sections.flatMap(s => s.exercises.map(e => e.name));
    expect(names).toContain('Squat');
    expect(names).toContain('Deadlift');
  });

  test('tracked exercises survive a note text update', async () => {
    await saveWorkoutNote('Squat 225 5,5,5');
    await saveTrackedExercises(['Squat', 'Bench']);
    await saveWorkoutNote('Squat 225 5,5,5\nBench 135 8,8,8');
    const note = await loadWorkoutNote();
    expect(note.tracked_exercises).toEqual(['Squat', 'Bench']);
    expect(note.raw_text).toContain('Bench');
  });

  test('legacy sessions-only install migrates to a non-empty, persistently loadable note', async () => {
    await saveWorkoutSession(S1);
    const migrated = await migrateWorkoutNote();
    const reloaded = await loadWorkoutNote();
    expect(reloaded).not.toBeNull();
    expect(reloaded.raw_text).toBe(migrated.raw_text);
    expect(reloaded.raw_text.length).toBeGreaterThan(0);
  });

  test('migration is idempotent — second call with existing note returns same raw_text', async () => {
    await saveWorkoutSession(S1);
    const first = await migrateWorkoutNote();
    const second = await migrateWorkoutNote();
    expect(second.raw_text).toBe(first.raw_text);
    expect(second.saved_at).toBe(first.saved_at);
  });

  test('migrated note raw_text preserves exercise names and weights from sessions', async () => {
    await saveWorkoutSession(S1);
    const migrated = await migrateWorkoutNote();
    expect(migrated.raw_text).toContain('Squat');
    expect(migrated.raw_text).toContain('225');
  });
});

// ── workout note migration ────────────────────────────────────────────────────

describe('migrateWorkoutNote', () => {
  test('returns null when both stores are empty', async () => {
    const result = await migrateWorkoutNote();
    expect(result).toBeNull();
  });

  test('synthesizes a note from existing sessions and saves it', async () => {
    await saveWorkoutSession(S1);
    const result = await migrateWorkoutNote();
    expect(result).not.toBeNull();
    expect(result.raw_text).toContain('2026-05-01');
    expect(result.raw_text).toContain('Squat');
    expect(result.raw_text).toContain('225');
  });

  test('is a no-op when a note already exists', async () => {
    await saveWorkoutNote('existing note');
    await saveWorkoutSession(S1);
    const result = await migrateWorkoutNote();
    expect(result.raw_text).toBe('existing note');
  });

  test('migrated note is then loadable via loadWorkoutNote', async () => {
    await saveWorkoutSession(S1);
    await migrateWorkoutNote();
    const note = await loadWorkoutNote();
    expect(note).not.toBeNull();
    expect(note.raw_text).toContain('Squat');
  });

  test('preserves assistance_value and assistance_unit in migrated text', async () => {
    await saveWorkoutSession(S2);
    const result = await migrateWorkoutNote();
    expect(result.raw_text).toContain('assist:20 lb');
  });

  test('preserves set-level note_text in migrated text', async () => {
    await saveWorkoutSession(S2);
    const result = await migrateWorkoutNote();
    expect(result.raw_text).toContain('[slow]');
  });

  test('preserves item-level note_text in migrated text', async () => {
    await saveWorkoutSession(S2);
    const result = await migrateWorkoutNote();
    expect(result.raw_text).toContain('grip neutral');
  });

  test('preserves duration_seconds in migrated text', async () => {
    await saveWorkoutSession(S2);
    const result = await migrateWorkoutNote();
    expect(result.raw_text).toContain('45s');
  });
});
