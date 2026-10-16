import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { normalizeExerciseKey } from '../../lib/parser';
import {
  buildTrackedLiftActivation,
  reconcileTrackedLiftActivations,
} from '../../lib/data/workoutAnalytics';
import { safeNotify } from './shared';
import { maybeSyncCloud } from './storageMode';
import { markStartupPhase } from '../../storage/entries/startupTiming';
import { withLocalWriteLock } from '../../storage/sync/localWriteLock';

let trackedLiftsListeners = [];
const notifyTrackedLifts = () => safeNotify(trackedLiftsListeners);

// Ask for a cloud pass once a flag/record change is DURABLE (#1393). Called only
// after every storage write of the change has resolved, so a write failure never
// starts a pass over an incomplete pair. Fire-and-forget on purpose: the write
// queue must not wait on the network, or a burst of toggles would serialize on
// round trips instead of coalescing. maybeSyncCloud() supplies the rest — no-op
// outside cloud mode, one shared pending pass plus one trailing pass for writes
// that land while a pass runs, and failed/retryable phase reporting.
function requestTrackedLiftSync() {
  Promise.resolve()
    .then(maybeSyncCloud)
    .catch(() => {});
}

// Every storage write of a queued change runs inside the shared local-write lock
// (#1393), which a sync pass's local read and write-back also take. A pass then
// sees the pair wholly before or wholly after this write, and cannot write a
// stale ack back over it. Only local storage happens inside the lock: the sync
// request is made after it is released and never awaited, so the queue never
// waits on the network and no holder waits on the other's queue (no deadlock).
// `lifts === null` writes the activation records alone (the note-save reconcile).
function writeTrackedLiftStorage(lifts, activations) {
  return withLocalWriteLock(async () => {
    if (lifts !== null) await Storage.saveTrackedLifts(lifts);
    await Storage.saveTrackedLiftActivations(activations);
  });
}

// Bumped when a queued write starts and again when it settles, so refresh() can
// tell a storage read that overlapped a write from one that did not.
let trackedLiftsGeneration = 0;

// Keep the shared write queue alive after a failed write: the caller still sees
// the rejection, but the next toggle/save/reconcile runs instead of inheriting it.
function enqueueTrackedLiftWrite(work) {
  const run = trackedLiftsPromise.then(async () => {
    trackedLiftsGeneration += 1;
    try {
      return await work();
    } finally {
      trackedLiftsGeneration += 1;
    }
  });
  trackedLiftsPromise = run.catch(() => {});
  return run;
}

let currentTrackedLifts = {};
// Tracked-span activation records (#893). Held beside the flags rather than
// inside them: they are written and cleared by the same toggle, so keeping one
// write queue over both is what makes "untrack deletes flag and record together"
// an invariant rather than a convention.
let currentActivations = {};
// Seed the write queue with the initial load so toggle/save always derive from
// real storage, not the empty module-scope default.
let trackedLiftsPromise = Promise.all([
  Storage.loadTrackedLifts(),
  Storage.loadTrackedLiftActivations(),
])
  .then(([lifts, activations]) => {
    currentTrackedLifts = lifts;
    currentActivations = activations;
  })
  .catch(() => {});

// Collapse a stored flag map onto canonical keys (#892 contract revision 3, §4).
// A no-op for every name outside the 8-entry alias table, so a legacy non-alias
// key loads and rewrites byte-identically; two legacy keys that resolve to one
// canonical key union into one identity, and tracked wins. Only exact canonical
// equality merges — no fuzzy matching, no edit distance, no heading affinity.
function canonicalizeTrackedLifts(map) {
  const out = {};
  for (const [key, value] of Object.entries(map || {})) {
    const canonical = normalizeExerciseKey(key) || key;
    out[canonical] = out[canonical] || !!value;
  }
  return out;
}

export function useTrackedLifts() {
  const [trackedLifts, setTrackedLifts] = useState(currentTrackedLifts);
  const [activations, setActivations] = useState(currentActivations);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The mirror of the eager-clear bug in the other read hooks (#737 review):
  // this one never cleared `error` at all, so once a read failed the flag stayed
  // set for the life of the hook and a consumer's banner could never come down,
  // even after a retry succeeded. Clearing it on success — and only on success —
  // fixes that without reintroducing the mid-retry verified-empty window.
  //
  // Every write broadcasts to this, so during a rapid burst a read can overlap a
  // later toggle's write. Such a read is stale (#1393): adopting it would roll
  // the module state back and the next toggle would derive from it, losing the
  // burst's final intent. It shows the newer module state instead; that write's
  // own broadcast reads storage again once it is durable.
  const refresh = useCallback(() => {
    const generation = trackedLiftsGeneration;
    Promise.all([Storage.loadTrackedLifts(), Storage.loadTrackedLiftActivations()])
      .then(([loadedLifts, loadedRecords]) => {
        const fresh = generation === trackedLiftsGeneration;
        const lifts = fresh ? loadedLifts : currentTrackedLifts;
        const records = fresh ? loadedRecords : currentActivations;
        currentTrackedLifts = lifts;
        currentActivations = records;
        setTrackedLifts(lifts);
        setActivations(records);
        setError(null);
        markStartupPhase('trackedLifts:reload:done');
      })
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    trackedLiftsListeners.push(refresh);
    return () => {
      trackedLiftsListeners = trackedLiftsListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  // Bulk flag write. It carries the pairing invariant too (#893): a key this
  // drops loses its record in the same write, so no record can outlive the flag
  // it belongs to and be inherited by a later retrack.
  const save = useCallback(async (nextTrackedLifts) => {
    return enqueueTrackedLiftWrite(async () => {
      const nextActivations = Storage.pruneTrackedLiftActivations(nextTrackedLifts, currentActivations);
      currentTrackedLifts = nextTrackedLifts;
      currentActivations = nextActivations;
      setTrackedLifts(nextTrackedLifts);
      setActivations(nextActivations);
      await writeTrackedLiftStorage(nextTrackedLifts, nextActivations);
      notifyTrackedLifts();
      requestTrackedLiftSync();
      return nextTrackedLifts;
    });
  }, []);

  // `sections` is the parsed routine population the user was looking at when
  // they tapped. Supplying it is what makes the activation an anchored one; a
  // caller that omits it (a test, or a surface with no parse in hand) still gets
  // the shipped boolean behavior, with no record and therefore full history.
  const toggle = useCallback(async (name, sections = null) => {
    return enqueueTrackedLiftWrite(async () => {
      const key = normalizeExerciseKey(name) || name;
      const nextLifts = canonicalizeTrackedLifts(currentTrackedLifts);
      const nextActivations = { ...currentActivations };

      if (nextLifts[key]) {
        // true -> false. The record dies with the flag; nothing is kept for a
        // later retrack to inherit, which is what makes a retrack a genuinely
        // fresh span rather than a resumed one.
        delete nextLifts[key];
        delete nextActivations[key];
      } else {
        nextLifts[key] = true;
        if (sections) nextActivations[key] = buildTrackedLiftActivation(sections, name);
        else delete nextActivations[key];
      }

      currentTrackedLifts = nextLifts;
      currentActivations = nextActivations;
      setTrackedLifts(nextLifts);
      setActivations(nextActivations);
      await writeTrackedLiftStorage(nextLifts, nextActivations);
      notifyTrackedLifts();
      requestTrackedLiftSync();
      return nextLifts;
    });
  }, []);

  return { trackedLifts, activations, loading, error, save, toggle, refresh, reconcileActivations: reconcileTrackedLiftActivationsAtSave };
}

// The note-save boundary's retirement and stale-anchor repair (#892 contract
// revision 3, §6). A module function rather than a hook value so the editor can
// call it without subscribing, while still sharing the one write queue above —
// a toggle and a save can land in either order and neither can lose the other's
// write.
//
// `sections` MUST be the UNFILTERED note population. A movement that appears
// only inside a recovery-excluded week is present, not absent, and retiring it
// for sitting outside the ordinary-analytics boundary would be a silent, wrong
// loss of the user's tracked span. The caller is also required to skip this
// entirely when it cannot establish that boundary at all: an unknown population
// is not evidence of absence.
//
// Retirement never touches `tracked_lifts`. The exercise stays tracked; it just
// falls back to legacy full-history progression.
export async function reconcileTrackedLiftActivationsAtSave(sections) {
  return enqueueTrackedLiftWrite(async () => {
    const { next, changed } = reconcileTrackedLiftActivations(sections, currentActivations);
    // No change, no write — and no redundant cloud pass.
    if (!changed) return currentTrackedLifts;
    currentActivations = next;
    await writeTrackedLiftStorage(null, next);
    notifyTrackedLifts();
    requestTrackedLiftSync();
    return currentTrackedLifts;
  });
}
