// Recovery ordinary-analytics filtering + read-derived hooks for Home/Analytics
// (#699, #868; split from recoveryBlockHooks.js in #1058, behavior unchanged).
//
// These hooks render from the shared store owned by recoveryReadState.js — they
// hold none of its mutable state. `useRecoveryAnalyticsFilter` subscribes to the
// filter snapshot; `useActiveTrainingContext` derives an interpretation over the
// authoritative `useRecoveryBlockState` snapshot; `loadRecoveryExcludedNoteIds`
// is a one-shot storage read for save-time classification.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as Storage from '../../storage/entries';
import {
  buildRecoveryAnalyticsFilter,
  deriveRecoveryExcludedNoteIds,
} from '../../lib/data/recoveryAnalyticsFilter';
import { resolveActiveTrainingContext } from '../../lib/data/activeTrainingContext';
import { SYNC_PHASE, SYNC_STATUS, subscribeSyncState } from '../../storage/syncRecovery';
import {
  addRecoveryListener,
  addSnapshotSubscriber,
  getFilterSnapshot,
  isRecoveryFilterVerified,
  removeRecoveryListener,
  removeSnapshotSubscriber,
  runRecoveryFilterRead,
  useRecoveryBlockState,
} from './recoveryReadState';

// Retry cadence for a failed read, capped. A cold-start failure would otherwise
// wait for an unrelated recovery mutation or a cloud sync to clear, which a
// local-only user may never produce, leaving the screens loading forever.
const RECOVERY_READ_RETRY_MS = [500, 1500, 4000, 10000];

// Read-only subscriber for the ordinary-analytics boundary.
//
// Deliberately NOT `useRecoveryBlockState`: that hook reconciles the recovery
// operation journal before every read, which is correct for a surface that is
// about to mutate recovery records, and wrong for Home/Analytics/save-time
// classification, which only ever ask "which notes are excluded right now".
// Mounting the reconciling hook on those surfaces would replay journaled
// operations from screens that never asked to.
//
// Refreshes on the signals that can change the boundary out from under a
// mounted screen: the private `recoveryListeners` notification (any local
// recovery mutation, including the inclusion toggle and a restored local
// backup), a completed cloud sync (another device's records), mount, and — only
// while the boundary is still unverified — a bounded retry.
export function useRecoveryAnalyticsFilter() {
  const [state, setState] = useState(
    () => ({ snapshot: getFilterSnapshot(), verified: isRecoveryFilterVerified() })
  );
  const retryTimerRef = useRef(null);
  const retryAttemptRef = useRef(0);
  const unmountedRef = useRef(false);

  const syncFromShared = useCallback(() => {
    setState(prev => {
      const snapshot = getFilterSnapshot();
      const verified = isRecoveryFilterVerified();
      return prev.snapshot === snapshot && prev.verified === verified
        ? prev
        : { snapshot, verified };
    });
  }, []);

  const refresh = useCallback(() => {
    return runRecoveryFilterRead()
      .then(() => {
        retryAttemptRef.current = 0;
        syncFromShared();
      })
      .catch(() => {
        // A failed read never publishes "nothing is excluded". If a good
        // snapshot was already read in this process it stays authoritative; if
        // none ever was, the boundary stays unverified and every consumer holds
        // its loading state rather than admitting recovery work.
        syncFromShared();
        if (isRecoveryFilterVerified() || unmountedRef.current) return;
        const attempt = retryAttemptRef.current;
        if (attempt >= RECOVERY_READ_RETRY_MS.length) return;
        retryAttemptRef.current = attempt + 1;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (!unmountedRef.current) refresh();
        }, RECOVERY_READ_RETRY_MS[attempt]);
      });
  }, [syncFromShared]);

  useEffect(() => {
    unmountedRef.current = false;
    refresh();
    addRecoveryListener(refresh);
    // A publish from the authoritative `useRecoveryBlockState` read must move
    // this hook too, or Log and Analytics could render two different snapshots
    // while mounted together.
    addSnapshotSubscriber(syncFromShared);

    let lastSyncStatus = null;
    const handleSyncState = (syncState) => {
      const sync = syncState?.[SYNC_PHASE.SYNC];
      if (sync && sync.status === SYNC_STATUS.COMPLETE && lastSyncStatus !== SYNC_STATUS.COMPLETE) {
        refresh();
      }
      lastSyncStatus = sync ? sync.status : null;
    };
    const unsubscribeSync = subscribeSyncState(handleSyncState);

    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      removeRecoveryListener(refresh);
      removeSnapshotSubscriber(syncFromShared);
      unsubscribeSync();
    };
  }, [refresh, syncFromShared]);

  return useMemo(
    () => buildRecoveryAnalyticsFilter(state.snapshot.blocks, state.snapshot.weeks, { ready: state.verified }),
    [state]
  );
}

// One presentation-level answer to "what am I training now?" (#868), shared by
// Home, Log, and Analytics. Wraps the same authoritative `useRecoveryBlockState`
// snapshot every screen already renders from — this adds no second read and no
// second store — plus the caller's own workout-note `currentId`/`notes`, which
// stay owned by `useWorkoutNotes` exactly as before.
//
// Deliberately takes `currentId`/`notes` as parameters rather than calling
// `useWorkoutNotes()` itself: every screen already holds that state locally at
// its own Recovery-state boundary, and this hook only derives an interpretation
// over it, never a competing read.
export function useActiveTrainingContext({ currentId = null, notes = [] } = {}) {
  const recovery = useRecoveryBlockState() || {};
  return useMemo(
    () => resolveActiveTrainingContext({
      currentId,
      notes,
      recoveryReady: recovery.ready,
      recoveryLoading: recovery.loading,
      // Propagated so a verified-but-unreliable read (the latest refresh
      // failed, or a journaled Recovery operation is still unresolved) can
      // never present as a confirmed `NORMAL`/no-active-block answer (#868
      // review, PR #873) — see activeTrainingContext.js's STALE/PENDING
      // statuses.
      recoveryStale: recovery.stale,
      pendingRecovery: recovery.pendingRecovery,
      activeBlock: recovery.activeBlock,
      weeks: recovery.weeks,
    }),
    [
      currentId, notes, recovery.ready, recovery.loading, recovery.stale,
      recovery.pendingRecovery, recovery.activeBlock, recovery.weeks,
    ]
  );
}

// One-shot read of the ordinary-analytics exclusion set, straight from storage.
//
// For callers that act asynchronously rather than render — save-time exercise
// classification is the one today. They must decide against what is actually
// persisted at the moment they write, not against a snapshot captured by the
// render that scheduled them, so they deliberately do NOT subscribe. Rejects on
// a storage failure; the caller decides what an unknown boundary means for its
// own write.
export async function loadRecoveryExcludedNoteIds(storage = Storage) {
  const [blocks, weeks] = await Promise.all([
    storage.loadRecoveryBlocks(),
    storage.loadRecoveryBlockWeeks(),
  ]);
  return deriveRecoveryExcludedNoteIds(blocks, weeks);
}
