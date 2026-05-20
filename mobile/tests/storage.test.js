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
  saveOneKExercises,
  clearWorkoutNote,
  migrateWorkoutNote,
  exportBackup,
  importBackup,
  loadWorkoutNotes,
  saveWorkoutNoteItem,
  deleteWorkoutNoteItem,
  loadCurrentWorkoutId,
  saveCurrentWorkoutId,
  clearCurrentWorkoutId,
  loadWeightGoal,
  saveWeightGoal,
  clearWeightGoal,
  migrateToNotebook,
  setCurrentWorkoutNote,
} from '../storage/entries';
import { computeWeightTrends, computeWeightGoal, computeCalorieEstimate } from '../lib/data';
import { parseWorkoutNote, buildSessionsFromNote } from '../lib/parser';

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

// Fixture: weighted exercise with set-level note_text (mixed case)
const S_MIXED = {
  id: 's_mixed_1', entry_type: 'workout', date: '2026-05-03', saved_at: '2026-05-03T23:00:00.000Z',
  items: [{
    exercise_name: 'Bench Press', result_kind: 'sets', note_text: 'paused reps', position: 1,
    sets: [
      { set_index: 1, rep_count: 5, weight_value: 185, weight_unit: 'lb', duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: 'slow' },
      { set_index: 2, rep_count: 5, weight_value: 185, weight_unit: 'lb', duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null },
    ],
  }],
};

// Two sessions: Squat in both, RDL only in session 2
const S_SKIP_A = {
  id: 's_skip_a', entry_type: 'workout', date: '2026-05-10', saved_at: '2026-05-10T23:00:00.000Z',
  items: [{ exercise_name: 'Squat', result_kind: 'sets', note_text: null, position: 1,
    sets: [{ set_index: 1, rep_count: 5, weight_value: 225, weight_unit: 'lb', duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null }] }],
};
const S_SKIP_B = {
  id: 's_skip_b', entry_type: 'workout', date: '2026-05-11', saved_at: '2026-05-11T23:00:00.000Z',
  items: [
    { exercise_name: 'Squat', result_kind: 'sets', note_text: null, position: 1,
      sets: [{ set_index: 1, rep_count: 5, weight_value: 230, weight_unit: 'lb', duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null }] },
    { exercise_name: 'RDL', result_kind: 'sets', note_text: null, position: 2,
      sets: [{ set_index: 1, rep_count: 8, weight_value: 185, weight_unit: 'lb', duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null }] },
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

  // Regression: entries sorted by logged_at (insertion time) rather than date field.
  // A backdated entry logged today appears first by logged_at but is older by date.
  test('flags gain correctly when entries arrive oldest-first (logged_at order)', () => {
    // oldest date listed first — simulates backdated entry logged before newer one
    const entries = [
      { date: '2026-05-11', weight_value: 192 },
      { date: '2026-05-15', weight_value: 194 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.paceFlag).toBe('gain');
  });

  test('flags loss correctly when entries arrive oldest-first (logged_at order)', () => {
    const entries = [
      { date: '2026-05-11', weight_value: 192 },
      { date: '2026-05-15', weight_value: 190 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.paceFlag).toBe('loss');
  });

  test('returns null paceFlag for neutral change regardless of entry order', () => {
    const entries = [
      { date: '2026-05-11', weight_value: 192.0 },
      { date: '2026-05-15', weight_value: 192.2 },
    ];
    const result = computeWeightTrends(entries, REF);
    expect(result.paceFlag).toBeNull();
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

  test('legacy sessions-only install migrates to a parseable note with correct exercises', async () => {
    await saveWorkoutSession(S1);
    const migrated = await migrateWorkoutNote();
    const { sections } = parseWorkoutNote(migrated.raw_text);
    const names = sections.flatMap(s => s.exercises.map(e => e.name));
    expect(names).toContain('Squat');
  });

  test('migration is idempotent — second call with existing note returns same raw_text', async () => {
    await saveWorkoutSession(S1);
    const first = await migrateWorkoutNote();
    const second = await migrateWorkoutNote();
    expect(second.raw_text).toBe(first.raw_text);
    expect(second.saved_at).toBe(first.saved_at);
  });

  test('migrated note sets are parseable with correct weights', async () => {
    await saveWorkoutSession(S1);
    const migrated = await migrateWorkoutNote();
    const { sections } = parseWorkoutNote(migrated.raw_text);
    const allSets = sections.flatMap(s => s.exercises.flatMap(e => e.sets));
    const squatSets = allSets.filter(s => s.weight_value === 225);
    expect(squatSets.length).toBeGreaterThan(0);
  });

  test('migrated non-weight exercise produces unparsed session entry, not a skip', async () => {
    await saveWorkoutSession(S2);
    const migrated = await migrateWorkoutNote();
    const { sessions } = buildSessionsFromNote(migrated.raw_text);
    expect(sessions.length).toBeGreaterThan(0);
    const assistedEntry = sessions[0].entries.find(e => e.exercise_name === 'Assisted Pull-up');
    expect(assistedEntry).toBeDefined();
    expect(assistedEntry.entry.skipped).toBe(false);
    expect(assistedEntry.entry.unparsed).toBe(true);
    expect(assistedEntry.entry.raw).toContain('assist:20 lb');
  });

  test('migrated note session count matches original legacy session count — single session', async () => {
    await saveWorkoutSession(S1);
    const migrated = await migrateWorkoutNote();
    const { sessions } = buildSessionsFromNote(migrated.raw_text);
    expect(sessions.length).toBe(1);
  });

  test('migrated note session count matches original legacy session count — two sessions', async () => {
    const S_A = { ...S1, id: 's_a', date: '2026-05-01' };
    const S_B = {
      id: 's_b', entry_type: 'workout', date: '2026-05-02', saved_at: '2026-05-02T23:00:00.000Z',
      items: [{ exercise_name: 'Squat', result_kind: 'sets', note_text: null, position: 1,
        sets: [{ set_index: 1, rep_count: 5, weight_value: 230, weight_unit: 'lb',
          duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null }] }],
    };
    await saveWorkoutSession(S_A);
    await saveWorkoutSession(S_B);
    const migrated = await migrateWorkoutNote();
    const { sessions } = buildSessionsFromNote(migrated.raw_text);
    expect(sessions.length).toBe(2);
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

// ── export / import ───────────────────────────────────────────────────────────

describe('exportBackup', () => {
  test('returns object with version, exported_at, weight_entries, workout_notes, current_workout_id', async () => {
    const backup = await exportBackup();
    expect(backup).toHaveProperty('version', '2');
    expect(backup).toHaveProperty('exported_at');
    expect(backup.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(backup.weight_entries)).toBe(true);
    expect(Array.isArray(backup.workout_notes)).toBe(true);
    expect('current_workout_id' in backup).toBe(true);
  });

  test('includes saved weight entries in weight_entries', async () => {
    await saveWeightEntry(W1);
    await saveWeightEntry(W2);
    const backup = await exportBackup();
    const ids = backup.weight_entries.map(e => e.id);
    expect(ids).toContain(W1.id);
    expect(ids).toContain(W2.id);
  });

  test('includes saved workout notes in workout_notes', async () => {
    const NOTE = { id: 'wn_export_1', title: 'Push Day', raw_text: 'Squat 225 5,5,5', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: ['Squat'], one_k_exercises: null };
    await saveWorkoutNoteItem(NOTE);
    const backup = await exportBackup();
    expect(backup.workout_notes).toHaveLength(1);
    expect(backup.workout_notes[0].id).toBe('wn_export_1');
    expect(backup.workout_notes[0].title).toBe('Push Day');
  });

  test('includes current_workout_id when set', async () => {
    await saveCurrentWorkoutId('wn_export_1');
    const backup = await exportBackup();
    expect(backup.current_workout_id).toBe('wn_export_1');
  });

  test('workout_notes is empty array and current_workout_id is null when nothing exists', async () => {
    const backup = await exportBackup();
    expect(backup.workout_notes).toEqual([]);
    expect(backup.current_workout_id).toBeNull();
  });
});

const BASE_V2 = { version: '2', exported_at: '2026-05-01T00:00:00.000Z', workout_notes: [], current_workout_id: null };

describe('importBackup — valid restore', () => {
  test('restores weight entries from backup', async () => {
    const backup = { ...BASE_V2, weight_entries: [W1, W2] };
    const result = await importBackup(backup);
    expect(result.ok).toBe(true);
    const entries = await loadWeightEntries();
    const ids = entries.map(e => e.id);
    expect(ids).toContain(W1.id);
    expect(ids).toContain(W2.id);
  });

  test('restores workout notes from backup', async () => {
    const note = { id: 'wn_import_1', title: 'Pull Day', raw_text: 'Deadlift 315 3,3,3', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: ['Deadlift'], one_k_exercises: null };
    const backup = { ...BASE_V2, weight_entries: [], workout_notes: [note] };
    const result = await importBackup(backup);
    expect(result.ok).toBe(true);
    const notes = await loadWorkoutNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].raw_text).toBe('Deadlift 315 3,3,3');
    expect(notes[0].tracked_exercises).toEqual(['Deadlift']);
  });

  test('restores current_workout_id from backup', async () => {
    const note = { id: 'wn_import_1', title: 'A', raw_text: '', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    const backup = { ...BASE_V2, weight_entries: [], workout_notes: [note], current_workout_id: 'wn_import_1' };
    await importBackup(backup);
    const id = await loadCurrentWorkoutId();
    expect(id).toBe('wn_import_1');
  });

  test('null current_workout_id in backup clears existing selection', async () => {
    await saveCurrentWorkoutId('wn_old');
    const backup = { ...BASE_V2, weight_entries: [] };
    await importBackup(backup);
    const id = await loadCurrentWorkoutId();
    expect(id).toBeNull();
  });

  test('empty workout_notes in backup clears existing notes', async () => {
    const NOTE = { id: 'wn_x', title: 'Old', raw_text: '', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(NOTE);
    const backup = { ...BASE_V2, weight_entries: [] };
    await importBackup(backup);
    const notes = await loadWorkoutNotes();
    expect(notes).toEqual([]);
  });

  test('import does not touch legacy workout sessions', async () => {
    await saveWorkoutSession(S1);
    const backup = { ...BASE_V2, weight_entries: [] };
    await importBackup(backup);
    const sessions = await loadWorkoutSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(S1.id);
  });

  test('replace strategy overwrites existing weight entries with backup data', async () => {
    await saveWeightEntry(W1);
    const backup = { ...BASE_V2, weight_entries: [W2] };
    await importBackup(backup, 'replace');
    const entries = await loadWeightEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(W2.id);
  });

  test('round-trip: export then import restores identical weight entries', async () => {
    await saveWeightEntry(W1);
    await saveWeightEntry(W2);
    const backup = await exportBackup();

    AsyncStorage.clear();

    await importBackup(backup);
    const entries = await loadWeightEntries();
    expect(entries.map(e => e.id).sort()).toEqual([W1.id, W2.id].sort());
  });

  test('round-trip: export then import restores workout notes and current selection', async () => {
    const NOTE_A = { id: 'wn_rt_1', title: 'Push', raw_text: 'Bench 185 5,5,5', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: ['Bench'], one_k_exercises: null };
    const NOTE_B = { id: 'wn_rt_2', title: 'Pull', raw_text: 'Row 135 8,8,8', saved_at: '2026-05-02T00:00:00.000Z', updated_at: '2026-05-02T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(NOTE_A);
    await saveWorkoutNoteItem(NOTE_B);
    await saveCurrentWorkoutId('wn_rt_2');
    const backup = await exportBackup();

    AsyncStorage.clear();

    await importBackup(backup);
    const notes = await loadWorkoutNotes();
    const id = await loadCurrentWorkoutId();
    expect(notes.map(n => n.id).sort()).toEqual(['wn_rt_1', 'wn_rt_2'].sort());
    expect(id).toBe('wn_rt_2');
    const push = notes.find(n => n.id === 'wn_rt_1');
    expect(push.tracked_exercises).toEqual(['Bench']);
  });
});

describe('importBackup — malformed input rejection', () => {
  test('rejects null payload without mutating storage', async () => {
    await saveWeightEntry(W1);
    const result = await importBackup(null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid backup/i);
    const entries = await loadWeightEntries();
    expect(entries).toHaveLength(1);
  });

  test('rejects non-object payload', async () => {
    const result = await importBackup('not an object');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid backup/i);
  });

  test('rejects payload with unsupported version', async () => {
    const result = await importBackup({ version: '99', weight_entries: [], workout_notes: [], current_workout_id: null });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/version/i);
  });

  test('rejects payload where weight_entries is not an array', async () => {
    const result = await importBackup({ version: '2', weight_entries: 'bad', workout_notes: [], current_workout_id: null });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/weight_entries/i);
  });

  test('rejects payload with missing version field', async () => {
    const result = await importBackup({ weight_entries: [], workout_notes: [], current_workout_id: null });
    expect(result.ok).toBe(false);
  });

  test('rejects weight entry missing id', async () => {
    const bad = { version: '2', exported_at: '', weight_entries: [{ entry_type: 'weight', date: '2026-05-01', weight_value: 190, logged_at: '2026-05-01T00:00:00.000Z' }], workout_notes: [], current_workout_id: null };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/id/i);
  });

  test('rejects weight entry with wrong entry_type', async () => {
    const bad = { version: '2', exported_at: '', weight_entries: [{ id: 'x', entry_type: 'workout', date: '2026-05-01', weight_value: 190, logged_at: '2026-05-01T00:00:00.000Z' }], workout_notes: [], current_workout_id: null };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/entry_type/i);
  });

  test('rejects weight entry with non-numeric weight_value', async () => {
    const bad = { version: '2', exported_at: '', weight_entries: [{ id: 'x', entry_type: 'weight', date: '2026-05-01', weight_value: '190', logged_at: '2026-05-01T00:00:00.000Z' }], workout_notes: [], current_workout_id: null };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/weight_value/i);
  });

  test('rejects payload where workout_notes is not an array', async () => {
    const bad = { version: '2', exported_at: '', weight_entries: [], workout_notes: 'bad', current_workout_id: null };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/workout_notes/i);
  });

  test('rejects workout note missing id', async () => {
    const bad = { version: '2', exported_at: '', weight_entries: [], workout_notes: [{ title: 'A', raw_text: '' }], current_workout_id: null };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/id/i);
  });

  test('rejects workout note missing title', async () => {
    const bad = { version: '2', exported_at: '', weight_entries: [], workout_notes: [{ id: 'x', raw_text: '' }], current_workout_id: null };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/title/i);
  });

  test('rejects workout note missing raw_text', async () => {
    const bad = { version: '2', exported_at: '', weight_entries: [], workout_notes: [{ id: 'x', title: 'A' }], current_workout_id: null };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/raw_text/i);
  });

  test('rejects current_workout_id that is not a string or null', async () => {
    const bad = { version: '2', exported_at: '', weight_entries: [], workout_notes: [], current_workout_id: 123 };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/current_workout_id/i);
  });

  test('does not mutate existing storage when weight entry validation fails', async () => {
    await saveWeightEntry(W1);
    const NOTE = { id: 'wn_guard', title: 'Guard', raw_text: 'original', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(NOTE);
    const bad = { version: '2', exported_at: '', weight_entries: [{ id: 'x', entry_type: 'weight', date: '2026-05-01', weight_value: 'bad', logged_at: '' }], workout_notes: [], current_workout_id: null };
    await importBackup(bad);
    const entries = await loadWeightEntries();
    const notes = await loadWorkoutNotes();
    expect(entries[0].id).toBe(W1.id);
    expect(notes[0].id).toBe('wn_guard');
  });
});

// ── v1 backup compatibility ───────────────────────────────────────────────────

describe('importBackup — v1 compatibility', () => {
  test('accepts v1 backup and restores weight entries', async () => {
    const backup = { version: '1', exported_at: '2026-05-01T00:00:00.000Z', weight_entries: [W1, W2], workout_note: null };
    const result = await importBackup(backup);
    expect(result.ok).toBe(true);
    const entries = await loadWeightEntries();
    expect(entries.map(e => e.id).sort()).toEqual([W1.id, W2.id].sort());
  });

  test('v1 import does not clear existing workout notes or current selection', async () => {
    const NOTE = { id: 'wn_v1_keep', title: 'Keep Me', raw_text: 'Squat 225 5,5', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(NOTE);
    await saveCurrentWorkoutId('wn_v1_keep');
    const backup = { version: '1', exported_at: '2026-05-01T00:00:00.000Z', weight_entries: [], workout_note: null };
    await importBackup(backup);
    const notes = await loadWorkoutNotes();
    const id = await loadCurrentWorkoutId();
    expect(notes[0].id).toBe('wn_v1_keep');
    expect(id).toBe('wn_v1_keep');
  });

  test('v1 import rejects malformed weight entry', async () => {
    const bad = { version: '1', exported_at: '', weight_entries: [{ id: 'x', entry_type: 'weight', date: '2026-05-01', weight_value: 'bad', logged_at: '' }], workout_note: null };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/weight_value/i);
  });
});

// ── migration contract ────────────────────────────────────────────────────────
// Six contract points verified simultaneously:
// 1. Weighted-only item → parseable session entry with correct sets
// 2. Non-weight-only item → unparsed (skipped:false, unparsed:true), not a skip
// 3. Mixed weighted + extra metadata → parseable entry AND metadata in raw_text
// 4. Exercise absent in one session → skip slot only for that session
// 5. Multi-session → correct count and exercise names across sessions
// 6. LogScreen semantics: every non-skip entry has skipped:false

describe('migration contract — all six properties', () => {
  test('contract 1: weighted-only item produces parseable session entry with sets', async () => {
    await saveWorkoutSession(S1);
    const { raw_text } = await migrateWorkoutNote();
    const { sessions } = buildSessionsFromNote(raw_text);
    expect(sessions).toHaveLength(1);
    const squat = sessions[0].entries.find(e => e.exercise_name === 'Squat');
    expect(squat).toBeDefined();
    expect(squat.entry.skipped).toBe(false);
    expect(squat.entry.unparsed).toBeFalsy();
    expect(squat.entry.sets.length).toBeGreaterThan(0);
    expect(squat.entry.sets[0].weight_value).toBe(225);
  });

  test('contract 2: non-weight-only item is unparsed entry, not a skip', async () => {
    await saveWorkoutSession(S2);
    const { raw_text } = await migrateWorkoutNote();
    const { sessions } = buildSessionsFromNote(raw_text);
    expect(sessions.length).toBeGreaterThan(0);
    const assisted = sessions[0].entries.find(e => e.exercise_name === 'Assisted Pull-up');
    expect(assisted).toBeDefined();
    expect(assisted.entry.skipped).toBe(false);
    expect(assisted.entry.unparsed).toBe(true);
    expect(assisted.entry.raw).toContain('assist:20 lb');
  });

  test('contract 3: mixed item (weighted + set-level note) produces parseable entry and preserves metadata', async () => {
    await saveWorkoutSession(S_MIXED);
    const { raw_text } = await migrateWorkoutNote();
    // raw_text must contain both the parseable row and the extra metadata
    expect(raw_text).toContain('185 5,5');
    expect(raw_text).toContain('[slow]');
    expect(raw_text).toContain('paused reps');
    // The session entry for Bench Press must be parseable with weight sets
    const { sessions } = buildSessionsFromNote(raw_text);
    expect(sessions).toHaveLength(1);
    const bench = sessions[0].entries.find(e => e.exercise_name === 'Bench Press');
    expect(bench).toBeDefined();
    expect(bench.entry.skipped).toBe(false);
    expect(bench.entry.unparsed).toBeFalsy();
    expect(bench.entry.sets.length).toBeGreaterThan(0);
    expect(bench.entry.sets[0].weight_value).toBe(185);
    // Metadata must be in entry.comments so LogScreen can render it alongside the set lines
    expect(Array.isArray(bench.entry.comments)).toBe(true);
    const commentText = bench.entry.comments.join(' ');
    expect(commentText).toContain('[slow]');
    expect(commentText).toContain('paused reps');
  });

  test('contract 4: exercise absent in one session produces a skip slot only for that session', async () => {
    await saveWorkoutSession(S_SKIP_A);
    await saveWorkoutSession(S_SKIP_B);
    const { raw_text } = await migrateWorkoutNote();
    const { sessions } = buildSessionsFromNote(raw_text);
    expect(sessions).toHaveLength(2);
    // RDL was only in session 2 — session 1 must have a skip slot for it
    const rdlSession1 = sessions[0].entries.find(e => e.exercise_name === 'RDL');
    expect(rdlSession1).toBeDefined();
    expect(rdlSession1.entry.skipped).toBe(true);
    // Session 2 must have a real entry for RDL
    const rdlSession2 = sessions[1].entries.find(e => e.exercise_name === 'RDL');
    expect(rdlSession2).toBeDefined();
    expect(rdlSession2.entry.skipped).toBe(false);
    expect(rdlSession2.entry.sets[0].weight_value).toBe(185);
  });

  test('contract 5: multi-session history produces correct count and all exercise names', async () => {
    await saveWorkoutSession(S_SKIP_A);
    await saveWorkoutSession(S_SKIP_B);
    const { raw_text } = await migrateWorkoutNote();
    const { sessions } = buildSessionsFromNote(raw_text);
    expect(sessions).toHaveLength(2);
    const allNames = sessions.flatMap(s => s.entries.map(e => e.exercise_name));
    expect(allNames).toContain('Squat');
    expect(allNames).toContain('RDL');
  });

  test('contract 6: every non-skip entry across sessions has skipped:false', async () => {
    await saveWorkoutSession(S_SKIP_A);
    await saveWorkoutSession(S_SKIP_B);
    await saveWorkoutSession(S2);
    const { raw_text } = await migrateWorkoutNote();
    const { sessions } = buildSessionsFromNote(raw_text);
    for (const session of sessions) {
      for (const e of session.entries) {
        if (!e.entry.skipped) {
          // must be either parsed sets or unparsed raw text — never both empty
          const hasSets = Array.isArray(e.entry.sets) && e.entry.sets.length > 0;
          const isUnparsed = e.entry.unparsed === true && typeof e.entry.raw === 'string';
          expect(hasSets || isUnparsed).toBe(true);
        }
      }
    }
  });
});

// ── multi-note workout storage ────────────────────────────────────────────────

describe('loadWorkoutNotes', () => {
  test('returns empty array when no notes exist', async () => {
    const notes = await loadWorkoutNotes();
    expect(notes).toEqual([]);
  });
});

describe('saveWorkoutNoteItem', () => {
  const NOTE_A = { id: 'wn_2026-05-01_1', title: 'Push Day', raw_text: 'Bench 185 5,5,5', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
  const NOTE_B = { id: 'wn_2026-05-02_1', title: 'Pull Day', raw_text: 'Row 135 8,8,8', saved_at: '2026-05-02T00:00:00.000Z', updated_at: '2026-05-02T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };

  test('saves a new note and retrieves it', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    const notes = await loadWorkoutNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(NOTE_A.id);
    expect(notes[0].title).toBe('Push Day');
    expect(notes[0].raw_text).toBe('Bench 185 5,5,5');
  });

  test('saves multiple notes', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    await saveWorkoutNoteItem(NOTE_B);
    const notes = await loadWorkoutNotes();
    expect(notes).toHaveLength(2);
    const ids = notes.map(n => n.id);
    expect(ids).toContain(NOTE_A.id);
    expect(ids).toContain(NOTE_B.id);
  });

  test('upserts an existing note by id', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    const updated = { ...NOTE_A, raw_text: 'Bench 195 5,5,5', updated_at: '2026-05-01T12:00:00.000Z' };
    await saveWorkoutNoteItem(updated);
    const notes = await loadWorkoutNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].raw_text).toBe('Bench 195 5,5,5');
  });

  test('upsert preserves other fields on update', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    const updated = { ...NOTE_A, title: 'Chest Day' };
    await saveWorkoutNoteItem(updated);
    const notes = await loadWorkoutNotes();
    expect(notes[0].title).toBe('Chest Day');
    expect(notes[0].saved_at).toBe(NOTE_A.saved_at);
  });

  test('raw_text update persists and reloads correctly (single-note save path)', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    const updated = { ...NOTE_A, raw_text: 'Bench 225 5,5,5\nRDL 185 8,8', updated_at: '2026-05-01T12:00:00.000Z' };
    await saveWorkoutNoteItem(updated);
    const notes = await loadWorkoutNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].raw_text).toBe('Bench 225 5,5,5\nRDL 185 8,8');
    expect(notes[0].saved_at).toBe(NOTE_A.saved_at);
  });

  test('clearing raw_text on an existing note persists empty string', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    const cleared = { ...NOTE_A, raw_text: '', updated_at: '2026-05-01T12:00:00.000Z' };
    await saveWorkoutNoteItem(cleared);
    const notes = await loadWorkoutNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].raw_text).toBe('');
  });
});

describe('deleteWorkoutNoteItem', () => {
  const NOTE_A = { id: 'wn_2026-05-01_1', title: 'Push Day', raw_text: '', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
  const NOTE_B = { id: 'wn_2026-05-02_1', title: 'Pull Day', raw_text: '', saved_at: '2026-05-02T00:00:00.000Z', updated_at: '2026-05-02T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };

  test('removes a note by id', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    await saveWorkoutNoteItem(NOTE_B);
    await deleteWorkoutNoteItem(NOTE_A.id);
    const notes = await loadWorkoutNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(NOTE_B.id);
  });

  test('is a no-op for a non-existent id', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    await deleteWorkoutNoteItem('no-such-id');
    const notes = await loadWorkoutNotes();
    expect(notes).toHaveLength(1);
  });
});

describe('current workout id storage', () => {
  test('returns null when no current id is set', async () => {
    const id = await loadCurrentWorkoutId();
    expect(id).toBeNull();
  });

  test('saves and retrieves a current workout id', async () => {
    await saveCurrentWorkoutId('wn_2026-05-01_1');
    const id = await loadCurrentWorkoutId();
    expect(id).toBe('wn_2026-05-01_1');
  });

  test('overwrites previous current id', async () => {
    await saveCurrentWorkoutId('wn_2026-05-01_1');
    await saveCurrentWorkoutId('wn_2026-05-02_1');
    const id = await loadCurrentWorkoutId();
    expect(id).toBe('wn_2026-05-02_1');
  });

  test('clearCurrentWorkoutId removes the stored id', async () => {
    await saveCurrentWorkoutId('wn_2026-05-01_1');
    await clearCurrentWorkoutId();
    const id = await loadCurrentWorkoutId();
    expect(id).toBeNull();
  });

  test('weight entries and workout notes are unaffected by current id operations', async () => {
    await saveWeightEntry(W1);
    const NOTE = { id: 'wn_x', title: 'Test', raw_text: 'Squat 225 5,5', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(NOTE);
    await saveCurrentWorkoutId('wn_x');
    await clearCurrentWorkoutId();
    const entries = await loadWeightEntries();
    const notes = await loadWorkoutNotes();
    expect(entries).toHaveLength(1);
    expect(notes).toHaveLength(1);
  });
});

// ── weight goal storage ───────────────────────────────────────────────────────

describe('weight goal storage', () => {
  test('returns null when no goal has been saved', async () => {
    const goal = await loadWeightGoal();
    expect(goal).toBeNull();
  });

  test('saves and retrieves a weight goal', async () => {
    const saved = await saveWeightGoal({ target_weight: 175, target_date: '2026-09-01' });
    expect(saved.target_weight).toBe(175);
    expect(saved.target_date).toBe('2026-09-01');
    expect(saved.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const goal = await loadWeightGoal();
    expect(goal.target_weight).toBe(175);
    expect(goal.target_date).toBe('2026-09-01');
  });

  test('overwrites previous goal on save', async () => {
    await saveWeightGoal({ target_weight: 175, target_date: '2026-09-01' });
    await saveWeightGoal({ target_weight: 170, target_date: '2026-12-01' });
    const goal = await loadWeightGoal();
    expect(goal.target_weight).toBe(170);
    expect(goal.target_date).toBe('2026-12-01');
  });

  test('clear removes the goal', async () => {
    await saveWeightGoal({ target_weight: 175, target_date: '2026-09-01' });
    await clearWeightGoal();
    const goal = await loadWeightGoal();
    expect(goal).toBeNull();
  });

  test('weight entries are unaffected by goal operations', async () => {
    await saveWeightEntry(W1);
    await saveWeightGoal({ target_weight: 175, target_date: '2026-09-01' });
    await clearWeightGoal();
    const entries = await loadWeightEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(W1.id);
  });
});

// ── computeWeightGoal ─────────────────────────────────────────────────────────

describe('computeWeightGoal', () => {
  const REF = new Date(2026, 4, 19); // 2026-05-19

  test('derives loss direction when target is below current', () => {
    const result = computeWeightGoal({ currentWeight: 200, targetWeight: 175, targetDate: '2026-09-19', referenceDate: REF });
    expect(result.direction).toBe('loss');
  });

  test('derives gain direction when target is above current', () => {
    const result = computeWeightGoal({ currentWeight: 160, targetWeight: 175, targetDate: '2026-09-19', referenceDate: REF });
    expect(result.direction).toBe('gain');
  });

  test('derives maintain direction when delta is under 0.5 lb', () => {
    const result = computeWeightGoal({ currentWeight: 175, targetWeight: 175.3, targetDate: '2026-09-19', referenceDate: REF });
    expect(result.direction).toBe('maintain');
  });

  test('computes required_weekly_pace for a realistic loss goal', () => {
    // 200 → 175 over ~17.4 weeks (122 days from May 19 to Sep 19)
    const result = computeWeightGoal({ currentWeight: 200, targetWeight: 175, targetDate: '2026-09-19', referenceDate: REF });
    expect(result.required_weekly_pace).toBeCloseTo(-25 / (122 / 7), 1);
  });

  test('returns no warnings for a healthy pace (under 1 lb/week)', () => {
    // lose 10 lb over 14 weeks → 0.71 lb/week — healthy range
    const result = computeWeightGoal({ currentWeight: 190, targetWeight: 180, targetDate: '2026-08-18', referenceDate: REF });
    expect(result.warnings).toEqual([]);
  });

  test('returns unhealthy warning for pace between 1 and 2 lb/week', () => {
    // lose 14 lb over 10 weeks → 1.4 lb/week
    const result = computeWeightGoal({ currentWeight: 200, targetWeight: 186, targetDate: '2026-07-28', referenceDate: REF });
    expect(result.warnings).toContain('unhealthy');
    expect(result.warnings).not.toContain('unrealistic');
  });

  test('returns unrealistic warning for pace above 2 lb/week', () => {
    // lose 30 lb over 10 weeks → 3 lb/week
    const result = computeWeightGoal({ currentWeight: 200, targetWeight: 170, targetDate: '2026-07-28', referenceDate: REF });
    expect(result.warnings).toContain('unrealistic');
  });

  test('returns unrealistic warning when target date is today or in the past', () => {
    const result = computeWeightGoal({ currentWeight: 200, targetWeight: 175, targetDate: '2026-05-19', referenceDate: REF });
    expect(result.warnings).toContain('unrealistic');
    expect(result.required_weekly_pace).toBeNull();
  });

  test('returns weeks_remaining proportional to the date range', () => {
    // exactly 7 days out → 1 week
    const result = computeWeightGoal({ currentWeight: 175, targetWeight: 174, targetDate: '2026-05-26', referenceDate: REF });
    expect(result.weeks_remaining).toBeCloseTo(1, 1);
  });

  test('returns unrealistic warning for structurally invalid date like 2026-99-99', () => {
    const result = computeWeightGoal({ currentWeight: 200, targetWeight: 175, targetDate: '2026-99-99', referenceDate: REF });
    expect(result.warnings).toContain('unrealistic');
    expect(result.required_weekly_pace).toBeNull();
  });

  test('returns unrealistic warning for impossible future date that JS would normalize (2026-09-31)', () => {
    // Sep only has 30 days; JS normalizes 2026-09-31 → Oct 1, so isNaN alone misses it
    const result = computeWeightGoal({ currentWeight: 200, targetWeight: 175, targetDate: '2026-09-31', referenceDate: REF });
    expect(result.warnings).toContain('unrealistic');
    expect(result.required_weekly_pace).toBeNull();
  });

  test('returns unrealistic warning for impossible future date in non-leap year (2027-02-29)', () => {
    // 2027 is not a leap year; JS normalizes 2027-02-29 → March 1
    const result = computeWeightGoal({ currentWeight: 200, targetWeight: 175, targetDate: '2027-02-29', referenceDate: REF });
    expect(result.warnings).toContain('unrealistic');
    expect(result.required_weekly_pace).toBeNull();
  });
});

// ── weight goal in backup ─────────────────────────────────────────────────────

describe('exportBackup — weight goal', () => {
  test('includes weight_goal field in export', async () => {
    const backup = await exportBackup();
    expect('weight_goal' in backup).toBe(true);
  });

  test('exports null weight_goal when no goal is set', async () => {
    const backup = await exportBackup();
    expect(backup.weight_goal).toBeNull();
  });

  test('exports saved weight goal in backup', async () => {
    await saveWeightGoal({ target_weight: 175, target_date: '2026-09-01' });
    const backup = await exportBackup();
    expect(backup.weight_goal.target_weight).toBe(175);
    expect(backup.weight_goal.target_date).toBe('2026-09-01');
  });
});

describe('importBackup — weight goal', () => {
  test('restores weight_goal from backup', async () => {
    const backup = { ...BASE_V2, weight_entries: [], weight_goal: { target_weight: 175, target_date: '2026-09-01', saved_at: '2026-05-01T00:00:00.000Z' } };
    await importBackup(backup);
    const goal = await loadWeightGoal();
    expect(goal.target_weight).toBe(175);
    expect(goal.target_date).toBe('2026-09-01');
  });

  test('clears weight_goal when backup has null weight_goal', async () => {
    await saveWeightGoal({ target_weight: 175, target_date: '2026-09-01' });
    const backup = { ...BASE_V2, weight_entries: [], weight_goal: null };
    await importBackup(backup);
    const goal = await loadWeightGoal();
    expect(goal).toBeNull();
  });

  test('leaves weight_goal untouched when backup has no weight_goal key (old v2 backup)', async () => {
    await saveWeightGoal({ target_weight: 175, target_date: '2026-09-01' });
    const backup = { ...BASE_V2, weight_entries: [] }; // no weight_goal key
    await importBackup(backup);
    const goal = await loadWeightGoal();
    expect(goal.target_weight).toBe(175);
  });

  test('round-trip: export then import restores weight goal', async () => {
    await saveWeightGoal({ target_weight: 170, target_date: '2026-12-01' });
    const backup = await exportBackup();
    AsyncStorage.clear();
    await importBackup(backup);
    const goal = await loadWeightGoal();
    expect(goal.target_weight).toBe(170);
    expect(goal.target_date).toBe('2026-12-01');
  });
});

// ── computeCalorieEstimate ────────────────────────────────────────────────────

describe('computeCalorieEstimate', () => {
  test('returns null calories_per_day and null label when pace is null', () => {
    const result = computeCalorieEstimate(null, null);
    expect(result.calories_per_day).toBeNull();
    expect(result.label).toBeNull();
  });

  test('returns deficit label for negative pace (weight loss)', () => {
    // -1 lb/week × 3500 / 7 = 500 cal/day deficit
    const result = computeCalorieEstimate(-1, 'loss');
    expect(result.calories_per_day).toBe(500);
    expect(result.label).toBe('deficit');
  });

  test('returns surplus label for positive pace (weight gain)', () => {
    const result = computeCalorieEstimate(1, 'gain');
    expect(result.calories_per_day).toBe(500);
    expect(result.label).toBe('surplus');
  });

  test('rounds calories to nearest integer', () => {
    // -1.5 lb/week × 3500 / 7 = 750 cal/day
    const result = computeCalorieEstimate(-1.5, 'loss');
    expect(result.calories_per_day).toBe(750);
    expect(result.label).toBe('deficit');
  });

  test('returns maintain label and 0 calories for zero pace', () => {
    const result = computeCalorieEstimate(0, 'maintain');
    expect(result.calories_per_day).toBe(0);
    expect(result.label).toBe('maintain');
  });

  test('calories_per_day is always non-negative', () => {
    expect(computeCalorieEstimate(-2, 'loss').calories_per_day).toBeGreaterThanOrEqual(0);
    expect(computeCalorieEstimate(2, 'gain').calories_per_day).toBeGreaterThanOrEqual(0);
  });

  test('scales linearly with pace magnitude', () => {
    const single = computeCalorieEstimate(-1, 'loss').calories_per_day;
    const double = computeCalorieEstimate(-2, 'loss').calories_per_day;
    expect(double).toBe(single * 2);
  });

  test('returns maintain label for maintain direction even when pace is non-zero', () => {
    // current 180, target 180.4, 7 days out → direction=maintain, pace≈0.4 lb/week
    // estimate must not produce a surplus label
    const goalInfo = computeWeightGoal({
      currentWeight: 180, targetWeight: 180.4, targetDate: '2026-05-26',
      referenceDate: new Date(2026, 4, 19),
    });
    expect(goalInfo.direction).toBe('maintain');
    const estimate = computeCalorieEstimate(goalInfo.required_weekly_pace, goalInfo.direction);
    expect(estimate.label).toBe('maintain');
    expect(estimate.calories_per_day).toBe(0);
  });
});

describe('importBackup — malformed weight_goal rejection', () => {
  test('rejects weight_goal that is a non-null primitive', async () => {
    const bad = { ...BASE_V2, weight_entries: [], weight_goal: 123 };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/weight_goal/i);
  });

  test('rejects weight_goal that is an array', async () => {
    const bad = { ...BASE_V2, weight_entries: [], weight_goal: [] };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/weight_goal/i);
  });

  test('rejects weight_goal missing target_weight', async () => {
    const bad = { ...BASE_V2, weight_entries: [], weight_goal: { target_date: '2026-09-01' } };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/target_weight/i);
  });

  test('rejects weight_goal with non-numeric target_weight', async () => {
    const bad = { ...BASE_V2, weight_entries: [], weight_goal: { target_weight: 'bad', target_date: '2026-09-01' } };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/target_weight/i);
  });

  test('rejects weight_goal missing target_date', async () => {
    const bad = { ...BASE_V2, weight_entries: [], weight_goal: { target_weight: 175 } };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/target_date/i);
  });

  test('does not mutate storage when weight_goal validation fails', async () => {
    await saveWeightGoal({ target_weight: 175, target_date: '2026-09-01' });
    const bad = { ...BASE_V2, weight_entries: [], weight_goal: { target_weight: 'bad', target_date: '2026-09-01' } };
    const result = await importBackup(bad);
    expect(result.ok).toBe(false);
    const goal = await loadWeightGoal();
    expect(goal.target_weight).toBe(175);
  });
});

// ── migrateToNotebook ─────────────────────────────────────────────────────────

describe('migrateToNotebook', () => {
  test('returns empty array when both legacy note and notebook are empty', async () => {
    const result = await migrateToNotebook();
    expect(result).toEqual([]);
  });

  test('returns empty array when no legacy note exists even if called repeatedly', async () => {
    expect(await migrateToNotebook()).toEqual([]);
    expect(await migrateToNotebook()).toEqual([]);
  });

  test('converts legacy note into a notebook entry titled Routine 1', async () => {
    await saveWorkoutNote('-Squat\n225 5,5,5');
    const result = await migrateToNotebook();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Routine 1');
  });

  test('migrated entry has isCurrent: true', async () => {
    await saveWorkoutNote('-Squat\n225 5,5,5');
    const result = await migrateToNotebook();
    expect(result[0].isCurrent).toBe(true);
  });

  test('migrated entry has currentSince: null (start date unknown for legacy data)', async () => {
    await saveWorkoutNote('-Squat\n225 5,5,5');
    const result = await migrateToNotebook();
    expect(result[0].currentSince).toBeNull();
  });

  test('migrated entry preserves raw_text from legacy note', async () => {
    await saveWorkoutNote('-Squat\n225 5,5,5\n-RDL\n185 8,8');
    const result = await migrateToNotebook();
    expect(result[0].raw_text).toBe('-Squat\n225 5,5,5\n-RDL\n185 8,8');
  });

  test('migrated entry preserves tracked_exercises from legacy note', async () => {
    await saveWorkoutNote('-Squat\n225 5,5,5');
    await saveTrackedExercises(['Squat', 'RDL']);
    const result = await migrateToNotebook();
    expect(result[0].tracked_exercises).toEqual(['Squat', 'RDL']);
  });

  test('migrated entry preserves one_k_exercises from legacy note', async () => {
    await saveWorkoutNote('-Squat\n225 5,5,5');
    await saveOneKExercises({ bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' });
    const result = await migrateToNotebook();
    expect(result[0].one_k_exercises).toEqual({ bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' });
  });

  test('migrated entry has a valid id and timestamps', async () => {
    await saveWorkoutNote('some note');
    const result = await migrateToNotebook();
    expect(result[0].id).toMatch(/^wn_\d{4}-\d{2}-\d{2}_\d+$/);
    expect(result[0].saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result[0].updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('migrated entry is loadable via loadWorkoutNotes', async () => {
    await saveWorkoutNote('-Deadlift\n315 3,3,3');
    await migrateToNotebook();
    const notes = await loadWorkoutNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Routine 1');
    expect(notes[0].raw_text).toBe('-Deadlift\n315 3,3,3');
  });

  test('migration sets CURRENT_WORKOUT_ID_KEY for backward compatibility', async () => {
    await saveWorkoutNote('some note');
    const result = await migrateToNotebook();
    const id = await loadCurrentWorkoutId();
    expect(id).toBe(result[0].id);
  });

  test('is idempotent — second call with notebook already populated returns existing entries', async () => {
    await saveWorkoutNote('legacy text');
    const first = await migrateToNotebook();
    const second = await migrateToNotebook();
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].raw_text).toBe(first[0].raw_text);
  });

  test('does not overwrite existing notebook entries', async () => {
    const EXISTING = { id: 'wn_existing', title: 'My Routine', raw_text: 'existing text', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null, isCurrent: true, currentSince: null };
    await saveWorkoutNoteItem(EXISTING);
    await saveWorkoutNote('legacy text that should be ignored');
    const result = await migrateToNotebook();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('wn_existing');
    expect(result[0].raw_text).toBe('existing text');
  });

  test('round-trip: migrated note raw_text survives reload', async () => {
    await saveWorkoutNote('-Bench\n185 5,5,5');
    await migrateToNotebook();
    const notes = await loadWorkoutNotes();
    expect(notes[0].raw_text).toBe('-Bench\n185 5,5,5');
    expect(notes[0].isCurrent).toBe(true);
    expect(notes[0].currentSince).toBeNull();
  });

  // normalization of pre-existing entries missing the new fields
  test('normalizes pre-existing notebook entry missing isCurrent and currentSince', async () => {
    const OLD = { id: 'wn_old', title: 'Old Routine', raw_text: 'old text', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(OLD);
    const result = await migrateToNotebook();
    expect(result).toHaveLength(1);
    expect(result[0].isCurrent).toBe(false);
    expect(result[0].currentSince).toBeNull();
    expect(result[0].raw_text).toBe('old text');
  });

  test('normalization marks the stored current note isCurrent: true', async () => {
    const OLD = { id: 'wn_old', title: 'Old Routine', raw_text: 'text', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(OLD);
    await saveCurrentWorkoutId('wn_old');
    const result = await migrateToNotebook();
    expect(result[0].isCurrent).toBe(true);
    expect(result[0].currentSince).toBeNull();
  });

  test('normalization marks non-current notes isCurrent: false', async () => {
    const NOTE_A = { id: 'wn_a', title: 'A', raw_text: '', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    const NOTE_B = { id: 'wn_b', title: 'B', raw_text: '', saved_at: '2026-05-02T00:00:00.000Z', updated_at: '2026-05-02T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(NOTE_A);
    await saveWorkoutNoteItem(NOTE_B);
    await saveCurrentWorkoutId('wn_b');
    const result = await migrateToNotebook();
    expect(result.find(n => n.id === 'wn_a').isCurrent).toBe(false);
    expect(result.find(n => n.id === 'wn_b').isCurrent).toBe(true);
  });

  test('normalization with no stored current id sets all isCurrent: false', async () => {
    const OLD = { id: 'wn_old', title: 'Old', raw_text: '', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(OLD);
    const result = await migrateToNotebook();
    expect(result[0].isCurrent).toBe(false);
  });

  test('normalization persists the updated shape so loadWorkoutNotes returns the new fields', async () => {
    const OLD = { id: 'wn_old', title: 'Old', raw_text: 'text', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(OLD);
    await migrateToNotebook();
    const notes = await loadWorkoutNotes();
    expect('isCurrent' in notes[0]).toBe(true);
    expect('currentSince' in notes[0]).toBe(true);
  });

  test('normalization preserves existing isCurrent and currentSince when already set', async () => {
    const NOTE = { id: 'wn_a', title: 'A', raw_text: '', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null, isCurrent: true, currentSince: '2026-05-01T00:00:00.000Z' };
    await saveWorkoutNoteItem(NOTE);
    const result = await migrateToNotebook();
    expect(result[0].isCurrent).toBe(true);
    expect(result[0].currentSince).toBe('2026-05-01T00:00:00.000Z');
  });

  test('normalization is idempotent — second call returns same shape without re-writing', async () => {
    const OLD = { id: 'wn_old', title: 'Old', raw_text: 'text', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null };
    await saveWorkoutNoteItem(OLD);
    await saveCurrentWorkoutId('wn_old');
    const first = await migrateToNotebook();
    const second = await migrateToNotebook();
    expect(second[0].isCurrent).toBe(first[0].isCurrent);
    expect(second[0].currentSince).toBe(first[0].currentSince);
  });
});

// ── setCurrentWorkoutNote ─────────────────────────────────────────────────────

describe('setCurrentWorkoutNote', () => {
  const NOTE_A = { id: 'wn_a', title: 'Routine A', raw_text: '', saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null, isCurrent: false, currentSince: null };
  const NOTE_B = { id: 'wn_b', title: 'Routine B', raw_text: '', saved_at: '2026-05-02T00:00:00.000Z', updated_at: '2026-05-02T00:00:00.000Z', tracked_exercises: [], one_k_exercises: null, isCurrent: false, currentSince: null };

  test('marks the target note isCurrent: true', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    await setCurrentWorkoutNote('wn_a');
    const notes = await loadWorkoutNotes();
    expect(notes.find(n => n.id === 'wn_a').isCurrent).toBe(true);
  });

  test('sets currentSince timestamp on the newly-current note', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    await setCurrentWorkoutNote('wn_a');
    const notes = await loadWorkoutNotes();
    expect(notes.find(n => n.id === 'wn_a').currentSince).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('marks all other notes isCurrent: false', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    await saveWorkoutNoteItem(NOTE_B);
    await setCurrentWorkoutNote('wn_a');
    const notes = await loadWorkoutNotes();
    expect(notes.find(n => n.id === 'wn_b').isCurrent).toBe(false);
  });

  test('switching current from A to B marks A false and B true', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    await saveWorkoutNoteItem(NOTE_B);
    await setCurrentWorkoutNote('wn_a');
    await setCurrentWorkoutNote('wn_b');
    const notes = await loadWorkoutNotes();
    expect(notes.find(n => n.id === 'wn_a').isCurrent).toBe(false);
    expect(notes.find(n => n.id === 'wn_b').isCurrent).toBe(true);
  });

  test('switching to B sets a new currentSince on B', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    await saveWorkoutNoteItem(NOTE_B);
    await setCurrentWorkoutNote('wn_b');
    const notes = await loadWorkoutNotes();
    expect(notes.find(n => n.id === 'wn_b').currentSince).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('re-setting the already-current note preserves its currentSince', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    await setCurrentWorkoutNote('wn_a');
    const after_first = await loadWorkoutNotes();
    const firstSince = after_first.find(n => n.id === 'wn_a').currentSince;
    await setCurrentWorkoutNote('wn_a');
    const after_second = await loadWorkoutNotes();
    expect(after_second.find(n => n.id === 'wn_a').currentSince).toBe(firstSince);
  });

  test('updates CURRENT_WORKOUT_ID_KEY for backward compatibility', async () => {
    await saveWorkoutNoteItem(NOTE_A);
    await setCurrentWorkoutNote('wn_a');
    const id = await loadCurrentWorkoutId();
    expect(id).toBe('wn_a');
  });

  test('weight entries are unaffected by setCurrentWorkoutNote', async () => {
    await saveWeightEntry(W1);
    await saveWorkoutNoteItem(NOTE_A);
    await setCurrentWorkoutNote('wn_a');
    const entries = await loadWeightEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(W1.id);
  });
});
