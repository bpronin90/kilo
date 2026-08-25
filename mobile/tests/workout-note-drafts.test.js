import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveWorkoutNoteDraft,
  loadWorkoutNoteDraft,
  loadWorkoutNoteDrafts,
  clearWorkoutNoteDraft,
  clearWorkoutNoteDraftIfMatches,
  clearWorkoutNoteDraftsSupersededBySave,
  markWorkoutNoteDraftSaveStart,
  clearAllWorkoutNoteDrafts,
} from '../storage/entries/workoutNoteDrafts';
import {
  setLocalDataOwner,
  OWNER_UNCLAIMED,
  OWNER_UNKNOWN,
} from '../storage/entries/localDataOwner';

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

  test('a new canonical revision retains the conflicting draft while later typing gets its own active slot', async () => {
    await saveWorkoutNoteDraft('other:note-1', {
      title: 'Interrupted',
      raw_text: 'stale work',
      baseUpdatedAt: 'revision-a',
    });
    await saveWorkoutNoteDraft('other:note-1', {
      title: 'Canonical edit',
      raw_text: 'new work',
      baseUpdatedAt: 'revision-b',
    });

    const drafts = await loadWorkoutNoteDrafts('other:note-1');
    expect(drafts.map((draft) => draft.raw_text)).toEqual(
      expect.arrayContaining(['stale work', 'new work']),
    );
    expect(await loadWorkoutNoteDraft('other:note-1', { baseUpdatedAt: 'revision-a' }))
      .toMatchObject({ raw_text: 'stale work' });
    expect(await loadWorkoutNoteDraft('other:note-1', { baseUpdatedAt: 'revision-b' }))
      .toMatchObject({ raw_text: 'new work' });
  });

  test('Recovery and ordinary-other contexts for the same note never restore one another', async () => {
    await saveWorkoutNoteDraft('other:note-1', { title: 'Routine', raw_text: 'ordinary' });
    await saveWorkoutNoteDraft('recovery:note-1', { title: 'Recovery', raw_text: 'recovery' });
    expect((await loadWorkoutNoteDraft('other:note-1')).raw_text).toBe('ordinary');
    expect((await loadWorkoutNoteDraft('recovery:note-1')).raw_text).toBe('recovery');
  });

  test('a source-jump or focus-cancelled restore can preserve a same-revision draft before typing', async () => {
    await saveWorkoutNoteDraft('current:note-1', {
      title: 'Interrupted', raw_text: 'draft text', baseUpdatedAt: 'revision-a',
    });
    await saveWorkoutNoteDraft(
      'current:note-1',
      { title: 'Canonical', raw_text: 'typed after jump', baseUpdatedAt: 'revision-a' },
      { preserveExisting: true },
    );
    const drafts = await loadWorkoutNoteDrafts('current:note-1');
    expect(drafts.map((draft) => draft.raw_text)).toEqual(
      expect.arrayContaining(['draft text', 'typed after jump']),
    );
  });

  test('successful-save cleanup retires pre-save conflicts but preserves later in-flight typing', async () => {
    await saveWorkoutNoteDraft('current:note-1', {
      title: 'Old conflict',
      raw_text: 'interrupted',
      baseUpdatedAt: 'revision-a',
    });
    const checkpoint = await markWorkoutNoteDraftSaveStart();
    await saveWorkoutNoteDraft('current:note-1', {
      title: 'Live',
      raw_text: 'typed after save began',
      baseUpdatedAt: 'revision-b',
    });

    await clearWorkoutNoteDraftsSupersededBySave(
      'current:note-1',
      checkpoint,
      { title: 'Canonical', raw_text: 'snapshot being saved' },
    );

    const drafts = await loadWorkoutNoteDrafts('current:note-1');
    expect(drafts).toHaveLength(1);
    expect(drafts[0].raw_text).toBe('typed after save began');
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

  // ── PR #882 review regressions ────────────────────────────────────────────

  describe('clearWorkoutNoteDraftIfMatches (finding 2: save-in-flight race)', () => {
    test('clears the draft when it exactly matches the saved snapshot', async () => {
      await saveWorkoutNoteDraft('current:note-1', { title: 'T', raw_text: 'saved text' });
      await clearWorkoutNoteDraftIfMatches('current:note-1', { title: 'T', raw_text: 'saved text' });
      expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();
    });

    test('keeps a draft that is NEWER than the snapshot just saved (user kept typing during the write)', async () => {
      // A save started with 'saved text', but by the time it resolves the
      // cheap draft timer has already persisted newer keystrokes.
      await saveWorkoutNoteDraft('current:note-1', { title: 'T', raw_text: 'saved text PLUS more typed during the save' });
      await clearWorkoutNoteDraftIfMatches('current:note-1', { title: 'T', raw_text: 'saved text' });
      const draft = await loadWorkoutNoteDraft('current:note-1');
      expect(draft).not.toBeNull();
      expect(draft.raw_text).toBe('saved text PLUS more typed during the save');
    });

    test('keeps a draft whose title differs from the saved snapshot even if the text matches', async () => {
      await saveWorkoutNoteDraft('current:note-1', { title: 'Renamed mid-save', raw_text: 'saved text' });
      await clearWorkoutNoteDraftIfMatches('current:note-1', { title: 'T', raw_text: 'saved text' });
      expect(await loadWorkoutNoteDraft('current:note-1')).not.toBeNull();
    });

    test('is a safe no-op when there is no draft for the key', async () => {
      await expect(clearWorkoutNoteDraftIfMatches('current:never-written', { title: '', raw_text: '' })).resolves.toBeUndefined();
    });
  });

  describe('atomic mutation of the shared draft table (finding 3)', () => {
    test('two concurrent saves to different context keys both persist (no lost update)', async () => {
      await Promise.all([
        saveWorkoutNoteDraft('current:a', { title: 'A', raw_text: 'text-a' }),
        saveWorkoutNoteDraft('other:b', { title: 'B', raw_text: 'text-b' }),
      ]);
      expect((await loadWorkoutNoteDraft('current:a')).raw_text).toBe('text-a');
      expect((await loadWorkoutNoteDraft('other:b')).raw_text).toBe('text-b');
    });

    // Regresses the exact scenario the review flagged: useWorkoutNotes.remove
    // launches clears for `current:<id>` and `other:<id>` concurrently. With
    // a plain (non-atomic) read-then-write, both calls can read the same
    // pre-clear map and the later whole-map write resurrects whichever key
    // the earlier call had just deleted.
    test('two concurrent clears for different keys never resurrect one another (useWorkoutNotes.remove pattern)', async () => {
      await saveWorkoutNoteDraft('current:note-1', { title: 'A', raw_text: 'text-a' });
      await saveWorkoutNoteDraft('other:note-1', { title: 'B', raw_text: 'text-b' });

      await Promise.all([
        clearWorkoutNoteDraft('current:note-1'),
        clearWorkoutNoteDraft('other:note-1'),
      ]);

      expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();
      expect(await loadWorkoutNoteDraft('other:note-1')).toBeNull();
    });

    test('a concurrent save and an unrelated concurrent clear never lose the save', async () => {
      await saveWorkoutNoteDraft('other:note-2', { title: 'existing', raw_text: 'existing-text' });

      await Promise.all([
        saveWorkoutNoteDraft('current:note-3', { title: 'new', raw_text: 'new-text' }),
        clearWorkoutNoteDraft('other:note-2'),
      ]);

      expect((await loadWorkoutNoteDraft('current:note-3')).raw_text).toBe('new-text');
      expect(await loadWorkoutNoteDraft('other:note-2')).toBeNull();
    });

    test('a burst of concurrent writes to many distinct keys all survive (no interleaved lost update)', async () => {
      const keys = Array.from({ length: 12 }, (_, i) => `current:burst-${i}`);
      await Promise.all(keys.map((k, i) => saveWorkoutNoteDraft(k, { title: `t${i}`, raw_text: `text-${i}` })));
      const results = await Promise.all(keys.map((k) => loadWorkoutNoteDraft(k)));
      results.forEach((draft, i) => {
        expect(draft).not.toBeNull();
        expect(draft.raw_text).toBe(`text-${i}`);
      });
    });
  });

  describe('owner stamp (#880 revised body: cross-account restoration must be structurally impossible)', () => {
    test('a draft written under one owner is invisible to a different current owner', async () => {
      await setLocalDataOwner('user-a');
      await saveWorkoutNoteDraft('current:note-1', { title: 'A', raw_text: 'text-a' });

      await setLocalDataOwner('user-b');
      expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();
    });

    test('a draft is visible again once the SAME owner is current again', async () => {
      await setLocalDataOwner('user-a');
      await saveWorkoutNoteDraft('current:note-1', { title: 'A', raw_text: 'text-a' });

      await setLocalDataOwner('user-b');
      expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();

      await setLocalDataOwner('user-a');
      const draft = await loadWorkoutNoteDraft('current:note-1');
      expect(draft).not.toBeNull();
      expect(draft.raw_text).toBe('text-a');
    });

    test('one owner writing or clearing a shared context cannot destroy another owner\'s retained draft', async () => {
      await setLocalDataOwner('user-a');
      await saveWorkoutNoteDraft('current:note-1', { title: 'A', raw_text: 'text-a' });
      await setLocalDataOwner('user-b');
      await saveWorkoutNoteDraft('current:note-1', { title: 'B', raw_text: 'text-b' });
      await clearWorkoutNoteDraft('current:note-1');
      expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();

      await setLocalDataOwner('user-a');
      expect(await loadWorkoutNoteDraft('current:note-1')).toMatchObject({ raw_text: 'text-a' });
    });

    test('unclaimed and unknown owners are distinct — a draft from one is invisible under the other', async () => {
      await setLocalDataOwner(OWNER_UNCLAIMED);
      await saveWorkoutNoteDraft('current:note-1', { title: 'A', raw_text: 'unclaimed-text' });

      await setLocalDataOwner(OWNER_UNKNOWN);
      expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();
    });

    test('unknown never matches a real userId, even one literally named "unknown" is not special-cased away', async () => {
      await setLocalDataOwner(OWNER_UNKNOWN);
      await saveWorkoutNoteDraft('current:note-1', { title: 'A', raw_text: 'unknown-owner-text' });

      // A real account signs in — must never see the 'unknown'-owned draft.
      await setLocalDataOwner('real-user-id');
      expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();
    });

    test('every draft is stamped with the owner active at write time', async () => {
      await setLocalDataOwner('user-a');
      await saveWorkoutNoteDraft('current:note-1', { title: 'A', raw_text: 'text-a' });
      const draft = await loadWorkoutNoteDraft('current:note-1');
      expect(draft.owner).toBe('user-a');
    });

    test('clearing (successful save / discard / deletion) still works across owners by exact key, unaffected by the stamp', async () => {
      await setLocalDataOwner('user-a');
      await saveWorkoutNoteDraft('current:note-1', { title: 'A', raw_text: 'text-a' });
      await clearWorkoutNoteDraft('current:note-1');
      expect(await loadWorkoutNoteDraft('current:note-1')).toBeNull();
    });
  });
});
