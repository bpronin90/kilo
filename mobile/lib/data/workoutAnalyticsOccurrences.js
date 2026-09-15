import { deriveWorkoutAnalytics, normalizeExerciseKey, epleyPR } from '../parser.js';
import { _occurrenceEntries, sliceEntriesFromAnchor } from '../parser/analytics.js';
import { isStrengthExerciseName } from './exerciseCatalog.js';
import { resolveTrackedLiftAnchors } from './workoutAnalyticsActivations.js';

// ── PR-moment canonical occurrence helper (#577 Contract 3) ────────────────
//
// Thin, pure derivation reusing the SAME primitives Analytics itself uses
// for watermark/comparability (deriveWorkoutAnalytics, resolveTrackedLiftAnchors,
// _occurrenceEntries, sliceEntriesFromAnchor) — no reimplemented filtering,
// no second PR definition. `sections` must already be tagged with
// __noteId/__noteOrdinal/__sectionOrdinal on each section object (see
// tagNoteSections in screens/analytics/analyticsDerivations.js) — those tags
// pass through deriveWorkoutAnalytics onto each occurrence unchanged (the
// #577-authorized, strictly-scoped addition there), and this helper re-stamps
// them onto every returned per-set entry so a caller can trace a PR
// candidate back to its exact note/section/occurrence/set, never colliding
// with an identically-headed section in a different note.
//
// Returns a flat array of
//   { exerciseKey, noteId, noteOrdinal, sectionOrdinal, occurrenceOrdinal,
//     setOrdinal, weight_value, rep_count, skipped, kind, epley }
// ordered by (occurrenceOrdinal, setOrdinal) within each exercise, ready for
// lib/prMoment.js's positional frontier comparison. Warmup-kind occurrences
// and non-strength exercise names are excluded entirely — matching
// deriveWorkoutAnalytics'/deriveTrackedPRs' own R3 exclusion — but a
// warmup occurrence's logged-session count still advances the anchor
// ordinal it's cut against, exactly as it does for every other Analytics
// consumer of the watermark (sliceEntriesFromAnchor operates on the
// unfiltered entries list; the warmup filter is applied strictly after the
// anchor cut, never before).
// #577 review (Codex, post-freeze): callers that only need a RESTRICTED
// section population for their own purposes (e.g. one A/B week's own text)
// must still call this with the FULL, unrestricted population to resolve
// and cut the tracked-lift activation anchor/watermark correctly, then
// restrict the RETURNED entries afterward (e.g. by their `sectionOrdinal`)
// — never call this directly with an already-restricted population. Doing
// so would resolve/cut the anchor against a population smaller than the
// one it was recorded against, clamping a legitimate anchor down and/or
// dropping sessions the anchor never meant to exclude. See
// useLogCurrentRoutineEditor.js's computePendingPRCandidate for the actual
// resolve-full-then-restrict pattern.
export function deriveTrackedPROccurrences(sections, trackedNames, activations = null) {
  const uniqueNames = [...new Set(trackedNames || [])];
  if (uniqueNames.length === 0) return [];

  const { exercises } = deriveWorkoutAnalytics(sections || []);
  const anchors = resolveTrackedLiftAnchors(sections || [], activations);
  const byKey = new Map(exercises.map((ex) => [normalizeExerciseKey(ex.name), ex]));

  const results = [];
  for (const name of uniqueNames) {
    if (!isStrengthExerciseName(name)) continue;
    const key = normalizeExerciseKey(name);
    const ex = byKey.get(key);
    if (!ex) continue;

    // Flatten every occurrence's session units (session_entries/rows/sets
    // fallback — exactly _occurrenceEntries' existing logic), re-stamping
    // this helper's own coordinates onto each unit since _occurrenceEntries
    // itself is not authorized to change and does not carry them.
    const entries = ex.occurrences.flatMap((occ, occurrenceOrdinal) =>
      _occurrenceEntries(occ).map((unit) => ({
        ...unit,
        __noteId: occ.__noteId,
        __noteOrdinal: occ.__noteOrdinal,
        __sectionOrdinal: occ.__sectionOrdinal,
        __occurrenceOrdinal: occurrenceOrdinal,
      }))
    );

    const anchor = anchors[key] || 0;
    // Same watermark primitive every other Analytics comparability consumer
    // uses — cuts on the unfiltered (warmup-inclusive) ordinal, exactly
    // matching how the anchor was itself counted at Track-toggle time.
    const sliced = sliceEntriesFromAnchor(entries, anchor);
    const comparable = sliced.filter((u) => u.kind !== 'warmup');

    // setOrdinal must be a running count across the WHOLE occurrence, not
    // reset per session unit — an occurrence can hold several logged rows
    // (session_entries), and resetting to 0 for each one lets a set
    // appended in a LATER row collide with (and sort ahead of) an existing
    // set in an EARLIER row of the same occurrence, which the frontier
    // comparison in lib/prMoment.js then misreads as an ambiguous
    // historical edit rather than a legitimate append. Incremented for
    // every set regardless of skipped status, so ordinal position is
    // stable independent of what gets filtered below.
    const setOrdinalByOccurrence = new Map();
    for (const unit of comparable) {
      const occurrenceOrdinal = unit.__occurrenceOrdinal;
      (unit.sets || []).forEach((set) => {
        const setOrdinal = setOrdinalByOccurrence.get(occurrenceOrdinal) ?? 0;
        setOrdinalByOccurrence.set(occurrenceOrdinal, setOrdinal + 1);
        if (set.skipped) return;
        const epley = epleyPR(set.weight_value, set.rep_count);
        results.push({
          exerciseKey: key,
          noteId: unit.__noteId,
          noteOrdinal: unit.__noteOrdinal,
          sectionOrdinal: unit.__sectionOrdinal,
          occurrenceOrdinal,
          setOrdinal,
          weight_value: set.weight_value,
          rep_count: set.rep_count,
          skipped: false,
          kind: unit.kind,
          epley,
        });
      });
    }
  }

  return results;
}
