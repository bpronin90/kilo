import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveWorkoutNoteDraft,
  loadWorkoutNoteDraft,
  clearWorkoutNoteDraft,
  clearAllWorkoutNoteDrafts,
} from '../storage/entries/workoutNoteDrafts';

// ── cheap local drafts (#880) ────────────────────────────────────────────────
//
// This module is the local safety net for text that has not yet reached the
// expensive save pipeline (parse/derive/cloud write). It must be: cheap
// (verified indirectly — it never touches parse/derive, only JSON.stringify),
// keyed so unrelated contexts never collide, tolerant of legacy/corrupt state,
// and cleanly removable so a successful save, discard, or deletion leaves no
// stale draft behind.

describe('workout note drafts', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('round-trips a draft under its context key', async () => {
    await saveWorkoutNoteDraft('current:new', { title: 'My Routine', raw_text: 'Day 1\nSquat 5x5', baseUpdatedAt: null });
    const draft = await loadWorkoutNoteDraft('current:new');
    expect(draft.title).toBe('My Routine');
    expect(draft.raw_text).toBe('Day 1\nSquat 5x5');
    expect(draft.baseUpdatedAt).toBeNull();
    expect(typeof draft.savedAt).toBe('string');
  });

  test('missing draft resolves to null, not an error', async () => {
    await expect(loadWorkoutNoteDraft('current:does-not-exist')).resolves.toBeNull();
  });

  test('drafts under different context keys never collide', async () => {
    await saveWorkoutNoteDraft('current:abc', { title: 'A', raw_text: 'text-a', baseUpdatedAt: '2024-01-01T00:00:00.000Z' });
    await saveWorkoutNoteDraft('other:xyz', { title: 'B', raw_text: 'text-b', baseUpdatedAt: null });
    await saveWorkoutNoteDraft('current:new', { title: 'C', raw_text: 'text-c', baseUpdatedAt: null });

    const [a, b, c] = await Promise.all([
      loadWorkoutNoteDraft('current:abc'),
      loadWorkoutNoteDraft('other:xyz'),
      loadWorkoutNoteDraft('current:new'),
    ]);
    expect(a.raw_text).toBe('text-a');
    expect(b.raw_text).toBe('text-b');
    expect(c.raw_text).toBe('text-c');
  });

  test('clearing one draft never deletes an unrelated draft (#880 acceptance)', async () => {
    await saveWorkoutNoteDraft('current:abc', { title: 'A', raw_text: 'text-a' });
    await saveWorkoutNoteDraft('other:xyz', { title: 'B', raw_text: 'text-b' });

    await clearWorkoutNoteDraft('current:abc');

    expect(await loadWorkoutNoteDraft('current:abc')).toBeNull();
    const stillThere = await loadWorkoutNoteDraft('other:xyz');
    expect(stillThere.raw_text).toBe('text-b');
  });

  test('clearing a context key that was never written is a safe no-op', async () => {
    await saveWorkoutNoteDraft('current:abc', { title: 'A', raw_text: 'text-a' });
    await expect(clearWorkoutNoteDraft('current:never-written')).resolves.toBeUndefined();
    expect(await loadWorkoutNoteDraft('current:abc')).not.toBeNull();
  });

  test('rewriting the same context key overwrites rather than appending', async () => {
    await saveWorkoutNoteDraft('current:new', { title: 'v1', raw_text: 'first' });
    await saveWorkoutNoteDraft('current:new', { title: 'v2', raw_text: 'second' });
    const draft = await loadWorkoutNoteDraft('current:new');
    expect(draft.title).toBe('v2');
    expect(draft.raw_text).toBe('second');
  });

  test('a corrupt draft table is treated as empty rather than throwing', async () => {
    await AsyncStorage.setItem('kilo_workout_note_drafts_v1', 'not json{{{');
    await expect(loadWorkoutNoteDraft('current:new')).resolves.toBeNull();
    // And writing afterward still works — the corrupt table is replaced, not
    // preserved.
    await saveWorkoutNoteDraft('current:new', { title: 'ok', raw_text: 'ok' });
    const draft = await loadWorkoutNoteDraft('current:new');
    expect(draft.raw_text).toBe('ok');
  });

  test('clearAllWorkoutNoteDrafts wipes every context (account transition safety net)', async () => {
    await saveWorkoutNoteDraft('current:abc', { title: 'A', raw_text: 'text-a' });
    await saveWorkoutNoteDraft('other:xyz', { title: 'B', raw_text: 'text-b' });
    await clearAllWorkoutNoteDrafts();
    expect(await loadWorkoutNoteDraft('current:abc')).toBeNull();
    expect(await loadWorkoutNoteDraft('other:xyz')).toBeNull();
  });

  test('a device with no draft table (legacy install) reads as no draft, never an error', async () => {
    // Nothing written at all — the module's key has never existed on this
    // device. Restoring must be a plain no-op, not a thrown error that could
    // block opening the editor.
    await expect(loadWorkoutNoteDraft('current:legacy-note')).resolves.toBeNull();
  });

  test('baseUpdatedAt is carried through unchanged, including null for a brand-new note', async () => {
    await saveWorkoutNoteDraft('current:new', { title: '', raw_text: 'x', baseUpdatedAt: null });
    const draftNew = await loadWorkoutNoteDraft('current:new');
    expect(draftNew.baseUpdatedAt).toBeNull();

    const ts = '2026-08-20T10:00:00.000Z';
    await saveWorkoutNoteDraft('current:existing-1', { title: '', raw_text: 'y', baseUpdatedAt: ts });
    const draftExisting = await loadWorkoutNoteDraft('current:existing-1');
    expect(draftExisting.baseUpdatedAt).toBe(ts);
  });
});
