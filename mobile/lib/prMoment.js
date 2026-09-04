// Pure PR-moment detection (#577 Contract 3). Given the SAME
// deriveTrackedPROccurrences() output computed twice — once over a "before"
// aggregate population and once over an "after" one that differs only in the
// current note's own contribution — finds newly appended sets that establish
// a strict Epley PR for a tracked strength exercise, using an append-only
// positional frontier per exercise key. Never a content-based diff, never
// the `*mark` annotation, never a mere aggregate-maximum delta (an edited
// HISTORICAL set surfacing as a new maximum must not celebrate).
//
// No React, no storage, no notification imports here — this module is pure
// data in/out so it is unit-testable without any of that.

// The canonical comparable value of a set, EXCLUDING its position and its
// annotation/mark/comments — an edit that only touches those is never a
// historical rewrite and never itself a candidate.
export function setFingerprint(set) {
  return JSON.stringify([
    set.weight_value ?? null,
    set.rep_count ?? null,
    set.duration_seconds ?? null,
    !!set.skipped,
    set.kind ?? null,
    !!set.converted_from_kg,
    set.kg_value ?? null,
  ]);
}

// Groups a flat occurrence-set list (deriveTrackedPROccurrences' output
// shape: { exerciseKey, noteId, sectionOrdinal, occurrenceOrdinal,
// setOrdinal, weight_value, rep_count, skipped, kind, epley, ... }) by
// exerciseKey, then by occurrenceOrdinal, each holding its sets ordered by
// setOrdinal. Only entries belonging to `noteId` are considered — the
// frontier/fingerprint comparison only ever runs against the CURRENT note's
// own contribution; other notes' entries are relevant only to the separate
// "does this candidate actually beat the aggregate" check (see
// bestPriorEpley below), never to frontier/historical-edit detection.
function groupByExerciseThenOccurrence(entries, noteId) {
  const byKey = new Map();
  for (const e of entries) {
    if (e.noteId !== noteId) continue;
    if (!byKey.has(e.exerciseKey)) byKey.set(e.exerciseKey, new Map());
    const byOcc = byKey.get(e.exerciseKey);
    if (!byOcc.has(e.occurrenceOrdinal)) byOcc.set(e.occurrenceOrdinal, []);
    byOcc.get(e.occurrenceOrdinal).push(e);
  }
  const result = new Map();
  for (const [key, byOcc] of byKey) {
    const occOrdinals = [...byOcc.keys()].sort((a, b) => a - b);
    result.set(key, occOrdinals.map((oi) => ({
      occurrenceOrdinal: oi,
      sets: byOcc.get(oi).slice().sort((a, b) => a.setOrdinal - b.setOrdinal),
    })));
  }
  return result;
}

// The best (highest) Epley value across ALL entries for an exercise key,
// across every note in the population — this is the true "prior best" a
// candidate must strictly exceed, matching what Analytics itself would show
// (a prior best logged in a different note, or in a since-re-included
// Recovery note, still counts).
function bestEpley(entries, exerciseKey) {
  let best = null;
  for (const e of entries) {
    if (e.exerciseKey !== exerciseKey) continue;
    if (e.epley === null || e.epley === undefined) continue;
    if (best === null || e.epley > best) best = e.epley;
  }
  return best;
}

// Append-only frontier for one exercise key's occurrences (already ordered
// by occurrenceOrdinal): compares `beforeOccs` (baseline) to `afterOccs`
// (current), and returns { candidates, ambiguous }. `candidates` are set
// entries genuinely new since baseline — either appended sets in baseline's
// LAST occurrence, or entirely new occurrences appended after it.
// `ambiguous` is true when any earlier (non-last) baseline occurrence
// doesn't match current fingerprint-for-fingerprint (a historical edit,
// reorder, or deletion) — in which case candidates for this exercise key are
// suppressed entirely, regardless of whether the aggregate maximum rose.
function frontierForExercise(beforeOccs, afterOccs) {
  if (beforeOccs.length === 0) {
    // No prior occurrence at all for this exercise in the current note this
    // session — every current occurrence is technically "new," but with no
    // baseline to diff against we cannot distinguish append-only from a
    // rewrite of pre-existing (pre-session) content. Conservative default:
    // never treat pre-existing content as a candidate just because the
    // editing session started empty for this exercise; only sets APPENDED
    // during this session (i.e. every set here, since there's no baseline)
    // are legitimately new work.
    const candidates = afterOccs.flatMap((occ) => occ.sets);
    return { candidates, ambiguous: false };
  }

  const lastBaselineOrdinal = beforeOccs[beforeOccs.length - 1].occurrenceOrdinal;
  const beforeByOrdinal = new Map(beforeOccs.map((o) => [o.occurrenceOrdinal, o]));
  const afterByOrdinal = new Map(afterOccs.map((o) => [o.occurrenceOrdinal, o]));

  // 1) Every baseline occurrence except the last must match current
  //    exactly, fingerprint-for-fingerprint, same count, same ordinal.
  for (const before of beforeOccs) {
    if (before.occurrenceOrdinal === lastBaselineOrdinal) continue;
    const after = afterByOrdinal.get(before.occurrenceOrdinal);
    if (!after || after.sets.length !== before.sets.length) {
      return { candidates: [], ambiguous: true };
    }
    for (let i = 0; i < before.sets.length; i++) {
      if (setFingerprint(before.sets[i]) !== setFingerprint(after.sets[i])) {
        return { candidates: [], ambiguous: true };
      }
    }
  }

  // 2) Baseline's LAST occurrence: sets before its baseline count must
  //    match exactly too; sets appended beyond that count are candidates.
  const beforeLast = beforeByOrdinal.get(lastBaselineOrdinal);
  const afterLast = afterByOrdinal.get(lastBaselineOrdinal);
  const candidates = [];
  if (!afterLast) {
    // The baseline's last occurrence vanished entirely — a deletion, which
    // is itself a historical edit.
    return { candidates: [], ambiguous: true };
  }
  for (let i = 0; i < beforeLast.sets.length; i++) {
    if (i >= afterLast.sets.length || setFingerprint(beforeLast.sets[i]) !== setFingerprint(afterLast.sets[i])) {
      return { candidates: [], ambiguous: true };
    }
  }
  for (let i = beforeLast.sets.length; i < afterLast.sets.length; i++) {
    candidates.push(afterLast.sets[i]);
  }

  // 3) Occurrences appended strictly after baseline's last ordinal are
  //    entirely candidates (already validated: nothing earlier was
  //    ambiguous, so a genuinely new occurrence is legitimate new work).
  for (const after of afterOccs) {
    if (after.occurrenceOrdinal > lastBaselineOrdinal) {
      candidates.push(...after.sets);
    }
  }

  return { candidates, ambiguous: false };
}

// Top-level entry point. `beforeEntries`/`afterEntries` are
// deriveTrackedPROccurrences' flat output for the before/after aggregate
// populations; `noteId` identifies the current note whose frontier is being
// evaluated (every other note's entries are identical in both passes and
// only feed bestEpley). `consumedKeys` (optional Set) excludes exercise keys
// already celebrated for this editor baseline, so a repeated Done cannot
// re-celebrate the same candidate.
//
// Returns null (nothing to celebrate) or
// { exerciseKey, epley, weight_value, rep_count, occurrenceOrdinal, setOrdinal }
// for the single best qualifying candidate, deterministically tie-broken by
// epley descending then exerciseKey ascending.
export function detectPRMoment(beforeEntries, afterEntries, noteId, consumedKeys = null) {
  const beforeByExercise = groupByExerciseThenOccurrence(beforeEntries, noteId);
  const afterByExercise = groupByExerciseThenOccurrence(afterEntries, noteId);

  const winners = [];
  for (const [exerciseKey, afterOccs] of afterByExercise) {
    if (consumedKeys && consumedKeys.has(exerciseKey)) continue;
    const beforeOccs = beforeByExercise.get(exerciseKey) || [];
    const { candidates, ambiguous } = frontierForExercise(beforeOccs, afterOccs);
    if (ambiguous || candidates.length === 0) continue;

    // Only positive performed strength sets — skipped/unparsed/null-epley
    // candidates never celebrate (deriveTrackedPROccurrences already
    // excludes warmup occurrences and non-strength exercises entirely).
    const eligible = candidates.filter((c) => !c.skipped && c.epley !== null && c.epley !== undefined);
    if (eligible.length === 0) continue;

    const priorBest = bestEpley(beforeEntries.length ? beforeEntries : afterEntries, exerciseKey);
    // First-ever comparable occurrence: nothing to beat, so nothing to
    // celebrate (a baseline of zero history is not a PR, it's a first log).
    const trueBaseline = bestEpley(beforeEntries, exerciseKey);
    if (trueBaseline === null) continue;

    const best = eligible.reduce((a, b) => (b.epley > a.epley ? b : a));
    if (best.epley <= trueBaseline) continue; // ties do not celebrate
    if (priorBest !== null && best.epley <= priorBest) continue; // matched/beaten elsewhere in the aggregate

    winners.push({
      exerciseKey,
      epley: best.epley,
      weight_value: best.weight_value,
      rep_count: best.rep_count,
      occurrenceOrdinal: best.occurrenceOrdinal,
      setOrdinal: best.setOrdinal,
    });
  }

  if (winners.length === 0) return null;
  winners.sort((a, b) => (b.epley - a.epley) || a.exerciseKey.localeCompare(b.exerciseKey));
  return winners[0];
}
