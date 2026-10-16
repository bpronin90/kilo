import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { normalizeExerciseKey } from '../../lib/parser';
import {
  buildTrackedLiftActivation,
  reconcileTrackedLiftActivations,
} from '../../lib/data/workoutAnalytics';
import { safeNotify } from './shared';
import { finishNormalizationApplyIntent, maybeSyncCloud, setNormalizationApplyGate } from './storageMode';
import { markStartupPhase } from '../../storage/entries/startupTiming';
import { withLocalWriteLock } from '../../storage/sync/localWriteLock';
import { isNormalizationApplyIntentMaybePending } from '../../storage/entries/workoutNotes';
import {
  getTrackedLiftWriteGeneration,
  setTrackedLiftWriteListener,
  loadTrackedLiftsStrict,
  loadTrackedLiftActivationsStrict,
} from '../../storage/entries/settings';
import { withExclusiveRecoveryAccess } from '../../storage/entries/recoveryOperationJournal';

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

// Each queued change runs as ONE section of the shared local-write lock (#1393),
// which a sync pass's local read and write-back also take: adoption of external
// writes, derivation from module state, and both storage writes (#1395 round 5).
// A pass then sees the pair wholly before or after the change, and no writer
// holding the lock can land maps between the derivation and the write. Only
// local storage happens inside it, and nothing inside takes the notebook lock;
// the sync request is made after release and never awaited, so the queue never
// waits on the network and no holder waits on the other's queue (no deadlock).
// Inside that section only. `lifts === null` writes the records alone.
async function writeTrackedLiftStorage(lifts, activations) {
  ownWriteInFlight = true;
  try {
    if (lifts !== null) await Storage.saveTrackedLifts(lifts);
    await Storage.saveTrackedLiftActivations(activations);
  } finally {
    ownWriteInFlight = false;
  }
}

// ── adopting writes made outside this queue (#1395) ──────────────────────────
//
// Invariant: a queued write derives only from module state that matches durable
// storage, apart from this queue's own optimistic (possibly failed) writes. Every
// Track-map write bumps a storage write generation (settings.js). The hook claims
// a bump as its own, synchronously, when it lands during its own write and is the
// very next one; any other bump (an apply commit/rollback/replay from any entry
// point, a note writer's lock-level settle, a sync pull, a backup restore) leaves
// `adoptedGeneration` behind. Each queued write then re-reads storage before it
// derives, and, while any consumer is mounted, an adoption-only queued step
// re-reads and broadcasts so it shows the external change without waiting for a
// toggle (an unmounted one reads storage when it mounts; #818's single cold-start
// read is kept). Both run in the queue, so #1393's refresh() gating still holds.
let adoptedGeneration = getTrackedLiftWriteGeneration();
let ownWriteInFlight = false;
let adoptionQueued = false;
let rollingForwardInQueue = false;
setTrackedLiftWriteListener((generation) => {
  if (ownWriteInFlight && generation === adoptedGeneration + 1) {
    adoptedGeneration = generation;
    return;
  }
  if (adoptionQueued || rollingForwardInQueue || trackedLiftsListeners.length === 0) return;
  adoptionQueued = true;
  enqueueTrackedLiftWrite(ADOPT_ONLY).catch(() => {});
});

// Inside the queue AND the local-write lock only, so a sync write-back is never
// seen half-way. Strict reads: an unreadable map is unknown, never empty, so the
// queued change is rejected instead of deriving from a guess. True if adopted.
async function adoptExternalTrackedLiftWrites() {
  const generation = getTrackedLiftWriteGeneration();
  if (generation === adoptedGeneration) return false;
  const lifts = await loadTrackedLiftsStrict();
  const activations = await loadTrackedLiftActivationsStrict();
  currentTrackedLifts = lifts;
  currentActivations = activations;
  adoptedGeneration = generation;
  return true;
}

// What refresh() needs in order to tell a storage read that may be older than the
// module state from one that is not. A queued write sets module state optimistically
// and only later (behind the queue and the shared lock) makes it durable, so
// storage can trail the module for the whole time a write is pending.
//   * `pendingTrackedLiftWrites` counts writes from ENQUEUE (synchronously) to
//     settle, so one still waiting on the queue or the lock counts too;
//   * `trackedLiftsGeneration` is bumped when a write starts and when it settles,
//     so a read that began and ended around a whole write is also caught.
let pendingTrackedLiftWrites = 0;
let trackedLiftsGeneration = 0;

// Keep the shared write queue alive after a failed write: the caller still sees
// the rejection, but the next toggle/save/reconcile runs instead of inheriting it.
// Every path that sets module state optimistically (toggle, save, reconcile) goes
// through here, so it is counted as pending before it can touch that state.
//
// An unfinished normalization apply (#1395) is rolled forward first (it takes
// notebook -> local-write itself, so it runs before this step's lock section),
// so no write can land over its record or derive from the mixed state. Then,
// in one local-write section, external writes are adopted and `work` derives
// and writes; it resolves `{ value, wrote }`. Broadcast and the sync request
// follow the release. `locked: false` is the apply, whose storage call takes
// both locks itself; it adopts in its own section afterwards.
function enqueueTrackedLiftWrite(work, { locked = true } = {}) {
  pendingTrackedLiftWrites += 1;
  const run = trackedLiftsPromise.then(async () => {
    trackedLiftsGeneration += 1;
    adoptionQueued = false;
    try {
      // Bumps made while this step rolls forward queue nothing more: this step
      // adopts them next, and a roll-forward failing every time cannot loop.
      rollingForwardInQueue = true;
      try {
        if (isNormalizationApplyIntentMaybePending()) await finishNormalizationApplyIntent();
      } finally {
        rollingForwardInQueue = false;
      }
      if (!locked) return await work();
      let adopted = false;
      let out;
      try {
        out = await withLocalWriteLock(async () => {
          adopted = await adoptExternalTrackedLiftWrites();
          return work();
        });
      } finally {
        if (adopted || out?.wrote) notifyTrackedLifts();
      }
      if (out.wrote) requestTrackedLiftSync();
      return out.value;
    } finally {
      trackedLiftsGeneration += 1;
      pendingTrackedLiftWrites -= 1;
    }
  });
  trackedLiftsPromise = run.catch(() => {});
  return run;
}

// A read may replace module state only if no write was pending when it started
// or when it finished, and none ran in between. Otherwise module state is newer;
// the pending write's own broadcast reads storage again once it is durable.
function beginTrackedLiftRead() {
  const pendingAtStart = pendingTrackedLiftWrites;
  const generation = trackedLiftsGeneration;
  return () => pendingAtStart === 0
    && pendingTrackedLiftWrites === 0
    && generation === trackedLiftsGeneration;
}

let currentTrackedLifts = {};
// Tracked-span activation records (#893). Held beside the flags rather than
// inside them: they are written and cleared by the same toggle, so keeping one
// write queue over both is what makes "untrack deletes flag and record together"
// an invariant rather than a convention.
let currentActivations = {};
// Seed the write queue with the initial load so toggle/save always derive from
// real storage, not the empty module-scope default. An apply interrupted by a
// crash is finished first, so the seed never loads its mixed state; a read that
// overlapped that roll-forward is discarded by the generation bump.
let trackedLiftsPromise = Promise.resolve()
  .then(() => finishNormalizationApplyIntent())
  .then((replayed) => { if (replayed) trackedLiftsGeneration += 1; return replayed; }, () => null)
  .then((replayed) => {
    const generation = getTrackedLiftWriteGeneration();
    return Promise.all([
      Storage.loadTrackedLifts(),
      Storage.loadTrackedLiftActivations(),
    ]).then(([lifts, activations]) => {
      currentTrackedLifts = lifts;
      currentActivations = activations;
      adoptedGeneration = generation;
      if (replayed) notifyTrackedLifts();
    });
  })
  .catch(() => {});

// Sync passes finish an unfinished apply through this queue (#1395).
const ADOPT_ONLY = async () => ({ value: undefined, wrote: false });
setNormalizationApplyGate(() => (isNormalizationApplyIntentMaybePending()
  ? enqueueTrackedLiftWrite(ADOPT_ONLY)
  : Promise.resolve()));

// The normalization apply (#1395): notes and their Track transition commit in
// one storage operation, run as ONE queued tracked-lift write so toggles land
// wholly before or after it and never derive from pre-apply module state. The
// recovery-access guard around it is the one every sync pass holds, so no pass
// reads half of the transition; it is taken before the queue (no queued write
// ever waits on a pass). The caller requests the cloud pass once this resolves,
// in the same tick as its note broadcast, so both share one coalesced pass.
//
// Its storage writes (commit, rollback, roll-forward) are external to this hook,
// so they are adopted like any other. A failed re-read must not turn a committed
// apply into a reported failure: it falls back to the committed maps, and the
// stale generation makes the next queued write retry the read.
export function runNormalizationApplyWithTracking(apply) {
  return withExclusiveRecoveryAccess(() => enqueueTrackedLiftWrite(async () => {
    const result = await apply();
    try {
      if (await withLocalWriteLock(adoptExternalTrackedLiftWrites)) notifyTrackedLifts();
    } catch {
      if (result?.tracking) {
        currentTrackedLifts = result.tracking.lifts;
        currentActivations = Storage.normalizeTrackedLiftActivations(result.tracking.activations);
        notifyTrackedLifts();
      }
    }
    return result;
  }, { locked: false }));
}

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
  // Every write broadcasts to this, so a read can overlap a pending write (queued,
  // waiting for the lock, or running). Such a read may be older than module state
  // (#1393): adopting it would roll the module back and the next toggle would
  // derive from it, losing the user's latest intent. It shows the module state
  // instead; see beginTrackedLiftRead.
  const refresh = useCallback(() => {
    const isFresh = beginTrackedLiftRead();
    Promise.all([Storage.loadTrackedLifts(), Storage.loadTrackedLiftActivations()])
      .then(([loadedLifts, loadedRecords]) => {
        const fresh = isFresh();
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
      return { value: nextTrackedLifts, wrote: true };
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
      return { value: nextLifts, wrote: true };
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
    if (!changed) return { value: currentTrackedLifts, wrote: false };
    currentActivations = next;
    await writeTrackedLiftStorage(null, next);
    return { value: currentTrackedLifts, wrote: true };
  });
}
