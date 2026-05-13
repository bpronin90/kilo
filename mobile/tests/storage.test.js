import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadWeightEntries,
  saveWeightEntry,
  deleteWeightEntry,
  updateWeightEntry,
  loadWorkoutSessions,
  saveWorkoutSession,
  deleteWorkoutSession,
} from '../storage/entries';

const W1 = { id: 'w_2026-05-01_1', entry_type: 'weight', date: '2026-05-01', weight_value: 192.0, weight_unit: 'lb', logged_at: '2026-05-01T08:00:00.000Z', saved_at: '2026-05-01T08:00:00.000Z' };
const W2 = { id: 'w_2026-05-02_2', entry_type: 'weight', date: '2026-05-02', weight_value: 191.5, weight_unit: 'lb', logged_at: '2026-05-02T08:00:00.000Z', saved_at: '2026-05-02T08:00:00.000Z' };

const S1 = {
  id: 's_2026-05-01_1', entry_type: 'workout', date: '2026-05-01', saved_at: '2026-05-01T23:00:00.000Z',
  items: [{ exercise_name: 'Squat', result_kind: 'sets', note_text: null, position: 1, sets: [{ set_index: 1, rep_count: 5, weight_value: 225, weight_unit: 'lb', duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null }] }],
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

  test('updates weight_value for an existing entry', async () => {
    await saveWeightEntry(W1);
    const ok = await updateWeightEntry(W1.id, 190.0);
    expect(ok).toBe(true);
    const entries = await loadWeightEntries();
    expect(entries[0].weight_value).toBe(190.0);
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
