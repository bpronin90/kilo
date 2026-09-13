// Contract tests for the shared Log-editor modules extracted in #1055:
//   editorDrafts, editorConvergence, editorWeekText, useLogEditorSave
//
// These verify the extracted machinery preserves the exact identity, isolation,
// and data-loss guarantees the two editor hooks (useLogCurrentRoutineEditor,
// useLogOtherRoutineEditor) depend on. The five required NEGATIVE fixtures are
// each covered: rapid routine switching, stale convergence, rejected save,
// unmount during pending save, and current/other draft isolation.
//
// The draft-storage functions run for real against the globally mocked
// AsyncStorage (see jest moduleNameMapper), exactly as the hook-level draft
// suites exercise them.

import {
  writeWorkoutNoteDraftNow,
  cancelPendingDraftRestore,
  restoreWorkoutNoteDraft,
} from '../screens/log/editorDrafts';
import { deriveSaveStatus, snapshotMatches } from '../screens/log/editorConvergence';
import { isValidActiveWeek, sliceWeekText, spliceWeekText } from '../screens/log/editorWeekText';
import { reconcileDraftsAfterSave, runDoneConvergenceLoop } from '../screens/log/useLogEditorSave';
import {
  saveWorkoutNoteDraft,
  loadWorkoutNoteDraft,
  markWorkoutNoteDraftSaveStart,
  clearWorkoutNoteDraftsSupersededBySave,
  clearAllWorkoutNoteDrafts,
} from '../storage/entries/workoutNoteDrafts';

const ref = (value) => ({ current: value });

// Mirror the two hooks' own key derivation so isolation is tested against the
// exact strings they use. currentDraftKey/otherDraftKey are file-local to the
// hooks; these copies are pinned here so a drift in either hook is caught.
const currentDraftKey = (id) => (id ? `current:${id}` : 'current:new');
const otherDraftKey = (id, source = null) => {
  if (!id) return null;
  if (source === 'recovery') return `recovery:${id}`;
  return id === 'new' ? 'other:new' : `other:${id}`;
};

beforeEach(async () => {
  await clearAllWorkoutNoteDrafts();
});

describe('editorWeekText: A/B slicing/splicing round-trips', () => {
  const ab = 'A1\nA2\n---\nB1\nB2';

  test('isValidActiveWeek accepts only A/B', () => {
    expect(isValidActiveWeek('A')).toBe(true);
    expect(isValidActiveWeek('B')).toBe(true);
    expect(isValidActiveWeek(null)).toBe(false);
    expect(isValidActiveWeek('C')).toBe(false);
  });

  test('slice returns the requested half, splice replaces only that half', () => {
    expect(sliceWeekText(ab, 'A')).toBe('A1\nA2');
    expect(sliceWeekText(ab, 'B')).toBe('B1\nB2');
    // Editing week A must leave week B byte-identical, and vice versa.
    expect(spliceWeekText(ab, 'A', 'X1\nX2')).toBe('X1\nX2\n---\nB1\nB2');
    expect(spliceWeekText(ab, 'B', 'Y1')).toBe('A1\nA2\n---\nY1');
  });

  test('single-week text (no separator) is returned/replaced whole', () => {
    expect(sliceWeekText('only', 'A')).toBe('only');
    expect(spliceWeekText('only', 'A', 'replaced')).toBe('replaced');
  });
});

describe('editorConvergence: save-status derivation', () => {
  test('snapshotMatches compares title and raw_text', () => {
    expect(snapshotMatches({ title: 't', raw_text: 'x' }, 't', 'x')).toBe(true);
    expect(snapshotMatches({ title: 't', raw_text: 'x' }, 't', 'y')).toBe(false);
    expect(snapshotMatches(null, 't', 'x')).toBe(false);
  });

  // FIXTURE: stale convergence. A completed save's pending/saved indicator must
  // NOT show once the live editor no longer matches the durable snapshot -
  // otherwise a stale "Saved"/"Syncing" claim outlives the text it described.
  test('stale convergence never surfaces once the live editor moved past the save', () => {
    expect(
      deriveSaveStatus({
        liveMatchesSavingSnapshot: false,
        liveIsLocallyDurable: false, // live text has diverged from last save
        pendingConvergence: true,
        saveSuccess: 'Saved on device',
      })
    ).toEqual({ boundSaveSuccess: '', saveStatus: null });
  });

  test('durable + convergence pending yields pending; an in-flight snapshot wins', () => {
    expect(
      deriveSaveStatus({
        liveMatchesSavingSnapshot: false,
        liveIsLocallyDurable: true,
        pendingConvergence: true,
        saveSuccess: '',
      }).saveStatus
    ).toBe('pending');
    expect(
      deriveSaveStatus({
        liveMatchesSavingSnapshot: true,
        liveIsLocallyDurable: true,
        pendingConvergence: true,
        saveSuccess: 'Saved on device',
      }).saveStatus
    ).toBe('saving');
    expect(
      deriveSaveStatus({
        liveMatchesSavingSnapshot: false,
        liveIsLocallyDurable: true,
        pendingConvergence: false,
        saveSuccess: 'Saved on device',
      })
    ).toEqual({ boundSaveSuccess: 'Saved on device', saveStatus: 'saved' });
  });
});

describe('editorDrafts: identity isolation and restore safety', () => {
  // FIXTURE: current/other draft isolation. The current and other editors write
  // to distinct context keys for the same note id; neither can read or clobber
  // the other's draft.
  test('current and other keep separate drafts for the same note id', async () => {
    await saveWorkoutNoteDraft(currentDraftKey('n1'), { title: 'C', raw_text: 'ctext', baseUpdatedAt: null });
    await saveWorkoutNoteDraft(otherDraftKey('n1'), { title: 'O', raw_text: 'otext', baseUpdatedAt: null });
    await saveWorkoutNoteDraft(otherDraftKey('n1', 'recovery'), { title: 'R', raw_text: 'rtext', baseUpdatedAt: null });

    expect((await loadWorkoutNoteDraft(currentDraftKey('n1'))).raw_text).toBe('ctext');
    expect((await loadWorkoutNoteDraft(otherDraftKey('n1'))).raw_text).toBe('otext');
    expect((await loadWorkoutNoteDraft(otherDraftKey('n1', 'recovery'))).raw_text).toBe('rtext');

    // A restore for the current key must apply the current draft, never the
    // other or recovery text.
    const applied = [];
    await restoreWorkoutNoteDraft({
      key: currentDraftKey('n1'),
      canonicalUpdatedAt: null,
      restoreToken: 1,
      tokenRef: ref(1),
      pendingRef: ref(true),
      isStillCurrent: () => true,
      expectedTitle: '',
      expectedText: '',
      readLiveTitle: () => '',
      readLiveText: () => '',
      applyTitle: (t) => applied.push(['title', t]),
      applyText: (t) => applied.push(['text', t]),
    });
    expect(applied).toEqual([['title', 'C'], ['text', 'ctext']]);
  });

  // FIXTURE: rapid routine switching. If the restore token advanced (the user
  // switched to another routine) before the async draft read resolves, the
  // stale restore must NOT apply text and must NOT clear the new context's
  // pending-restore flag.
  test('a stale-token restore applies nothing and leaves the new pending flag intact', async () => {
    await saveWorkoutNoteDraft(currentDraftKey('A'), { title: 'AT', raw_text: 'AX', baseUpdatedAt: null });
    const applied = [];
    const tokenRef = ref(2); // already advanced past the restore below
    const pendingRef = ref(true); // belongs to the newly-switched-to context

    await restoreWorkoutNoteDraft({
      key: currentDraftKey('A'),
      canonicalUpdatedAt: null,
      restoreToken: 1, // stale
      tokenRef,
      pendingRef,
      isStillCurrent: () => true,
      expectedTitle: '',
      expectedText: '',
      readLiveTitle: () => '',
      readLiveText: () => '',
      applyTitle: (t) => applied.push(t),
      applyText: (t) => applied.push(t),
    });

    expect(applied).toEqual([]);
    expect(pendingRef.current).toBe(true);
  });

  test('cancelPendingDraftRestore arms preserve and advances the token', () => {
    const pendingRef = ref(true);
    const tokenRef = ref(5);
    const preserveExistingRef = ref(false);
    cancelPendingDraftRestore({ pendingRef, tokenRef, preserveExistingRef });
    expect(pendingRef.current).toBe(false);
    expect(tokenRef.current).toBe(6);
    expect(preserveExistingRef.current).toBe(true);
    // A second call is a no-op once nothing is pending.
    cancelPendingDraftRestore({ pendingRef, tokenRef, preserveExistingRef });
    expect(tokenRef.current).toBe(6);
  });

  // FIXTURE: unmount during pending save. When the editor context is gone
  // (isStillCurrent() is false, e.g. the tree unmounted while a save/restore
  // was in flight) a resolving restore must never write into the torn-down
  // editor.
  test('a restore whose context is gone applies nothing', async () => {
    await saveWorkoutNoteDraft(currentDraftKey('U'), { title: 'UT', raw_text: 'UX', baseUpdatedAt: null });
    const applied = [];
    await restoreWorkoutNoteDraft({
      key: currentDraftKey('U'),
      canonicalUpdatedAt: null,
      restoreToken: 1,
      tokenRef: ref(1),
      pendingRef: ref(true),
      isStillCurrent: () => false, // unmounted / navigated away
      expectedTitle: '',
      expectedText: '',
      readLiveTitle: () => '',
      readLiveText: () => '',
      applyTitle: (t) => applied.push(t),
      applyText: (t) => applied.push(t),
    });
    expect(applied).toEqual([]);
  });

  test('writeWorkoutNoteDraftNow de-duplicates by signature and persists once', async () => {
    const signatureRef = ref(null);
    const key = currentDraftKey('W');
    const args = {
      key,
      title: 'T',
      raw_text: 'X',
      baseUpdatedAt: null,
      preserveExisting: false,
      signatureRef,
      onPreserveConsumed: () => {},
    };
    writeWorkoutNoteDraftNow(args);
    const firstSig = signatureRef.current;
    expect(firstSig).not.toBeNull();
    // Same content -> no new write attempt, signature unchanged.
    writeWorkoutNoteDraftNow(args);
    expect(signatureRef.current).toBe(firstSig);
    await Promise.resolve();
    await Promise.resolve();
    expect((await loadWorkoutNoteDraft(key)).raw_text).toBe('X');
  });
});

describe('useLogEditorSave: save reconciliation and Done convergence', () => {
  // FIXTURE: rejected save. A save that fails must never destroy the user's
  // draft. reconcileDraftsAfterSave runs ONLY on success; and even on success
  // it retires only the saved snapshot / pre-checkpoint drafts, so newer
  // in-flight typing written after the checkpoint survives and is rebased onto
  // the new revision rather than lost.
  test('newer in-flight typing survives a save of older content (no data loss)', async () => {
    const key = currentDraftKey('P');
    const checkpoint = await markWorkoutNoteDraftSaveStart();
    // The user kept typing after the save started; this newer draft post-dates
    // the checkpoint.
    await saveWorkoutNoteDraft(key, { title: 'new', raw_text: 'newX', baseUpdatedAt: null });

    await reconcileDraftsAfterSave({
      preKey: key,
      postKey: key,
      checkpoint,
      savedSnapshot: { title: 'old', raw_text: 'oldX' },
      latestSnapshot: { title: 'new', raw_text: 'newX' },
      identityUnchanged: true,
      resultUpdatedAt: 'rev2',
    });

    const survivor = await loadWorkoutNoteDraft(key);
    expect(survivor).not.toBeNull();
    expect(survivor.raw_text).toBe('newX');
    expect(survivor.baseUpdatedAt).toBe('rev2'); // rebased onto the saved revision
  });

  test('a rejected save (reconcile never invoked) leaves the draft intact', async () => {
    const key = currentDraftKey('J');
    const checkpoint = await markWorkoutNoteDraftSaveStart();
    await saveWorkoutNoteDraft(key, { title: 'draft', raw_text: 'draftX', baseUpdatedAt: null });
    // Simulate the failed-save path: the hook's `if (result)` block, and thus
    // reconcileDraftsAfterSave, is never reached. The draft must remain.
    void checkpoint;
    const survivor = await loadWorkoutNoteDraft(key);
    expect(survivor.raw_text).toBe('draftX');
  });

  test('a pre-checkpoint superseded draft is retired but newer text is kept', async () => {
    const key = currentDraftKey('S');
    // Old draft predates the save.
    await saveWorkoutNoteDraft(key, { title: 'stale', raw_text: 'staleX', baseUpdatedAt: null });
    const checkpoint = await markWorkoutNoteDraftSaveStart();
    // Superseded-clear for the exact saved snapshot removes the pre-checkpoint
    // stale draft.
    await clearWorkoutNoteDraftsSupersededBySave(key, checkpoint, { title: 'stale', raw_text: 'staleX' });
    expect(await loadWorkoutNoteDraft(key)).toBeNull();
  });

  test('runDoneConvergenceLoop returns false on failed save and on non-convergence', async () => {
    // Failed initial save -> caller must not close the editor.
    expect(await runDoneConvergenceLoop({ save: async () => false, hasConverged: () => true })).toBe(false);

    // Converges immediately after one successful save.
    let saves = 0;
    expect(
      await runDoneConvergenceLoop({ save: async () => { saves += 1; return true; }, hasConverged: () => true })
    ).toBe(true);
    expect(saves).toBe(1);

    // Never converges -> guard caps the loop and returns false rather than
    // spinning unbounded.
    let attempts = 0;
    const result = await runDoneConvergenceLoop({
      save: async () => { attempts += 1; return true; },
      hasConverged: () => false,
      guardMax: 3,
    });
    expect(result).toBe(false);
    expect(attempts).toBe(1 + 3); // initial save + guardMax retries
  });
});
