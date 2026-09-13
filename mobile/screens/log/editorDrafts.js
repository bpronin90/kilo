import { useEffect } from 'react';
import { AppState } from 'react-native';
import {
  saveWorkoutNoteDraft,
  loadWorkoutNoteDraft,
} from '../../storage/entries/workoutNoteDrafts';
import { loadWorkoutNoteCreationAttempt } from '../../storage/entries/workoutNoteCreationAttempts';

// Shared cheap-draft machinery (#880, extracted #1055) for the two Log editor
// hooks. Every function here is pure/parameterized: identity (the draft key)
// and storage behavior arrive as explicit inputs, and all editor state is held
// in refs OWNED BY THE CALLING HOOK and passed in. This module keeps NO
// module-level mutable editor state, so the current-routine and other-routine
// editors never share a draft, signature, or restore token.

// Cheap-draft debounce, deliberately much shorter than AUTOSAVE_DEBOUNCE_MS:
// this write only persists {title, text} to a scratch key with no
// parse/derive/cloud work, so it is safe to run far more often than the real
// autosave. It exists for the gap the real autosave cannot cover — a brand-new
// note, which the real autosave never touches until the first explicit save
// gives it an id.
export const DRAFT_DEBOUNCE_MS = 400;

// Persist the live editor snapshot to its draft key, de-duplicated by a
// signature so ordinary same-revision typing keeps replacing one active draft
// instead of retaining every debounce-window snapshot. `signatureRef` is the
// caller's last-write signature ref; `onPreserveConsumed` clears the caller's
// one-shot preserve flag once a preserving write lands.
export function writeWorkoutNoteDraftNow({
  key,
  title,
  raw_text,
  baseUpdatedAt,
  preserveExisting,
  signatureRef,
  onPreserveConsumed,
}) {
  if (!key) return;
  const draft = { title, raw_text, baseUpdatedAt };
  const signature = JSON.stringify([key, baseUpdatedAt, title, raw_text, preserveExisting]);
  if (signatureRef.current === signature) return;
  signatureRef.current = signature;
  saveWorkoutNoteDraft(key, draft, { preserveExisting }).then(() => {
    if (preserveExisting) onPreserveConsumed?.();
  }).catch(() => {
    if (signatureRef.current === signature) {
      signatureRef.current = null;
    }
  });
}

// A pending async restore must yield to any real editor interaction. This keeps
// restoration passive: it can never rewrite a focused value and move the caret
// after the user has started editing. Preserve is armed once for that cancelled
// restore, not on every later keystroke.
export function cancelPendingDraftRestore({ pendingRef, tokenRef, preserveExistingRef }) {
  if (!pendingRef.current) return;
  pendingRef.current = false;
  tokenRef.current += 1;
  preserveExistingRef.current = true;
}

// Restore a cheap local draft into the live editor, but only when it is still
// safe to trust: the draft must match the canonical `updated_at` this editor
// opened on (loadWorkoutNoteDraft enforces the revision), the restore token
// must still be current, `isStillCurrent()` must confirm the editor context has
// not moved on, and the live values must still equal the ones the caller opened
// with (nothing typed since). #880 reversal: a stale-revision draft is never
// auto-applied AND never deleted here — it stays recoverable.
export async function restoreWorkoutNoteDraft({
  key,
  canonicalUpdatedAt,
  restoreToken,
  tokenRef,
  pendingRef,
  isStillCurrent,
  expectedTitle,
  expectedText,
  readLiveTitle,
  readLiveText,
  applyTitle,
  applyText,
}) {
  try {
    if (!key) return;
    const draft = await loadWorkoutNoteDraft(key, { baseUpdatedAt: canonicalUpdatedAt }).catch(() => null);
    if (!draft) return;
    if (tokenRef.current !== restoreToken) return;
    if (!isStillCurrent()) return;
    if (readLiveTitle() !== expectedTitle || readLiveText() !== expectedText) return;
    const draftText = draft.raw_text || '';
    const draftTitle = draft.title || '';
    if (draftText === readLiveText() && draftTitle === readLiveTitle()) return;
    applyTitle(draftTitle);
    applyText(draftText);
  } finally {
    if (tokenRef.current === restoreToken) pendingRef.current = false;
  }
}

// Durable creation-attempt token restore-on-mount (#997). Minted before a
// new-note create and cleared only on full success; this restores a token left
// behind by an interrupted create so a retry after an app restart completes the
// original note. Never overwrites a token this session already minted (the
// restore is asynchronous and a save can start before it lands).
export function useRestoreCreationAttemptToken(attemptKey, tokenRef) {
  useEffect(() => {
    let cancelled = false;
    loadWorkoutNoteCreationAttempt(attemptKey)
      .then((token) => {
        if (!cancelled && token && !tokenRef.current) {
          tokenRef.current = token;
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Shared cheap-draft persistence lifecycle for both editors (#880): a debounced
// draft write while the editor is open (including a brand-new note, the gap the
// real autosave cannot cover), plus an immediate flush on backgrounding instead
// of waiting out the debounce. `debounceDeps` is the effect's dependency array;
// `enabled` gates whether the debounce arms; `isFlushEligible` is read at
// background time so a stale closure never flushes the wrong state.
export function useEditorDraftPersistence({
  enabled,
  debounceDeps,
  timerRef,
  writeDraftNow,
  isFlushEligible,
}) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      writeDraftNow();
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, debounceDeps);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'background' && state !== 'inactive') return;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (isFlushEligible()) writeDraftNow();
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Clears the new-note id override once the canonical currentId catches up to it,
// so a post-create render stops treating the note as still-new.
export function useDraftNoteIdOverrideReset(draftNoteIdOverrideRef, currentId) {
  useEffect(() => {
    if (draftNoteIdOverrideRef.current && currentId === draftNoteIdOverrideRef.current) {
      draftNoteIdOverrideRef.current = null;
    }
  }, [currentId, draftNoteIdOverrideRef]);
}
