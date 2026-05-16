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
  clearWorkoutNote,
  migrateWorkoutNote,
} from '../storage/entries';

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
