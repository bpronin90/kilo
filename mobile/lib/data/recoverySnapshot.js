// The ONE Recovery strength snapshot (#1315). Every surface that shows Recovery
// numbers (the Analytics Recovery section, the Analytics Overview `Recovery`
// row and Home's Recovery panel) reads this and never re-derives: the return
// comparison, the strength model, the week bands and the movement-group
// breakdown are each computed once per distinct input, then shared.
//
// Pure and read-only. Results live in a content-keyed shared store (see below),
// so simultaneously mounted consumers resolve to the very same frozen object even
// when they hold different-but-equal arrays. The wording the surfaces print (headline caption, empty/unavailable
// messages, full accessibility text) is built
// here too, so two surfaces can never word the same fact differently.

import {
  deriveRecoveryComparison, RECOVERY_COMPARISON_STATES, RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS,
} from './recoveryAnalytics.js';
import { summarizeRecoveryBands } from './derivedAnalytics.js';
import { movementGroupLabel } from './movementGroups.js';
import { deriveRecoveryStrength, displayPercent, STRENGTH_STATUS } from './recoveryStrength.js';
import { deriveRecoveryTotal, deriveLiftStatuses, totalCaption, totalExplainerLines, TOTAL_REASON, TOTAL_EMPTY_COPY } from './recoveryTotal.js';
import { deriveRecoveryWeekBands } from './recoveryReturnBands.js';
import { deriveMovementGroupBreakdown, resolveMovementGroupSource } from './recoveryMovementGroups.js';

export const STRENGTH_EMPTY_COPY = Object.freeze({
  pair_unavailable: 'Baseline best-set data unavailable. Rebuild the baseline in Manage block (Log tab) to score strength.',
  no_readable_weeks: 'No readable week to score yet.',
  no_common_lifts: 'No lift has a strength score in every readable week yet, so there is no average.',
  selected_unreadable: 'This week’s note can’t be read, so it has no score.',
});

export const SNAPSHOT_STATE = Object.freeze({
  SCORE: 'score',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
});

const EMPTY = Object.freeze([]);
const _lifts = (n) => `${n} ${n === 1 ? 'lift' : 'lifts'}`;

// One scale for trend and ladder: at least 100%, extended to the next 10 above
// the largest value so a >100% lift stays fully visible and factual.
export function strengthScaleMax(strength) {
  const values = [
    ...(strength.weeks || []).map(w => w.mean),
    ...(strength.lifts || []).map(l => l.percent),
  ].filter(v => typeof v === 'number' && Number.isFinite(v));
  const top = Math.max(100, ...values);
  return top <= 100 ? 100 : Math.ceil(top / 10) * 10;
}

const _sentence = (l) => (/[.!?]$/.test(l) ? l : `${l}.`);

// #1193: which weeks (other than the selected one) actually trained each
// baseline exercise, so "Not reintroduced" can say whether the exercise is
// absent from the whole block or only from the week being viewed. Only compared
// rows count, plus not-comparable rows that still carry logged work
// (`week_name`) — that work exists, it just cannot be scored.
export function deriveTrainedElsewhere(weekResults, selectedWeek, stale = false) {
  const map = new Map();
  // An unreadable/missing week's work is unknown, so "never trained" cannot be
  // claimed while one exists.
  let unreadable = false;
  for (const w of weekResults) {
    if (!selectedWeek || w.week_id === selectedWeek.week_id) continue;
    if (w.status !== RECOVERY_WEEK_STATUS.OK) { unreadable = true; continue; }
    for (const row of w.exercises || []) {
      const logged = row.state === RECOVERY_COMPARISON_STATES.BASELINE_MET
        || row.state === RECOVERY_COMPARISON_STATES.REBUILDING
        || (row.state === RECOVERY_COMPARISON_STATES.NOT_COMPARABLE && !!row.week_name);
      if (!logged) continue;
      const list = map.get(row.key) || [];
      list.push(w.week_number);
      map.set(row.key, list);
    }
  }
  return { weeks: map, unreadable, stale };
}

// Every status kind a detail row can carry: the visible band ids plus `added`
// (rows with no band). The folded `close` bucket is Rebuilding at presentation.
export const ROW_STATUS_KINDS = Object.freeze(['at_or_above', 'rebuilding', 'early', 'cannot_compare', 'not_trained_yet', 'added']);
export const foldBandId = (bandId) => (bandId === 'close' ? 'rebuilding' : bandId);

// The band of ONE detail row, from the existing return-band derivation run on that
// row (never a second threshold implementation). Added work has no band.
function _rowBandId(row) {
  if (row.state === RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY) return null;
  const { buckets } = deriveRecoveryWeekBands({ status: RECOVERY_WEEK_STATUS.OK, exercises: [row] });
  return foldBandId(Object.keys(buckets).find(id => buckets[id] > 0) || 'cannot_compare');
}

function _routineName(block) {
  return ((block && block.baseline_note_title) || '').trim() || 'Untitled Routine';
}

// The secondary detail the summary does not print: the strict consistent-cohort
// average (#1305, now secondary to the total, #1318) with its numeric percent or
// truthful unavailable reason, plus coverage, exclusions and drops. They live in
// the accessibility label.
function _detailLines(strength) {
  const cohortSize = strength.cohort.length;
  const lines = [];
  const coverage = `${_lifts(cohortSize)} scored every week · ${cohortSize} of ${strength.roster_size} baseline lifts`;
  if (strength.headline != null && cohortSize > 0) {
    lines.push(`Consistent-cohort average (secondary): ${displayPercent(strength.headline)}% across ${coverage}`);
  } else if (strength.status === STRENGTH_STATUS.OK) {
    lines.push(`Consistent-cohort average (secondary): ${STRENGTH_EMPTY_COPY[strength.empty_reason] || STRENGTH_EMPTY_COPY.no_common_lifts}`);
    if (cohortSize > 0) lines.push(coverage);
  }
  if (cohortSize > 0) {
    lines.push(`In the consistent cohort: ${strength.cohort.map(c => c.name).join(', ')}`);
    // The same cohort's average in every readable week through the selection.
    const byWeek = strength.weeks.filter(w => w.mean != null).map(w => `Week ${w.week_number} ${displayPercent(w.mean)}%`);
    if (byWeek.length > 0) lines.push(`Consistent-cohort average by week: ${byWeek.join(' · ')}`);
  }
  if (strength.excluded_weeks.length > 0) {
    lines.push(`Week ${strength.excluded_weeks.join(', ')} couldn’t be read and is left out of the comparison.`);
  }
  if (strength.cohort_dropped.length > 0) {
    lines.push(`Left the average this week (not scored every week): ${strength.cohort_dropped.join(', ')}.`);
  }
  return lines;
}

function _message(comparison, selectedWeek, strength, total) {
  if (comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_UNAVAILABLE
    || comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_UNSUPPORTED) {
    return 'Baseline data for this block isn’t available.';
  }
  if (comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY) return 'No baseline exercises were captured for this block.';
  if (!selectedWeek) return 'Baseline captured. No week logged yet.';
  if (strength.status === STRENGTH_STATUS.PAIR_UNAVAILABLE) return STRENGTH_EMPTY_COPY.pair_unavailable;
  if (selectedWeek.status === RECOVERY_WEEK_STATUS.NOTE_MISSING) return 'This week’s note is no longer available.';
  if (strength.status === STRENGTH_STATUS.OK) {
    return total.reason === TOTAL_REASON.NO_SCOREABLE ? TOTAL_EMPTY_COPY.no_scoreable_lifts : STRENGTH_EMPTY_COPY.no_readable_weeks;
  }
  return 'No strength score for this week.';
}

function _display(block, comparison, selectedWeek, strength, total) {
  const weekLabel = selectedWeek ? `Week ${selectedWeek.week_number}` : null;
  const routine = _routineName(block);
  if (total.percent != null && weekLabel) {
    const percent = displayPercent(total.percent);
    const detail = [...totalExplainerLines(total, selectedWeek.week_number), ..._detailLines(strength)];
    const caption = totalCaption(total);
    const headline = `${percent}% total recovery`;
    const gap = total.selectedReadable ? [] : ['This week’s note can’t be read, so this total adds no score for it.'];
    return {
      state: SNAPSHOT_STATE.SCORE, weekLabel, routine, percent, headline, caption, message: null, detail,
      a11y: [
        `${weekLabel}: ${headline} of ${routine} baseline strength. ${caption.replace(/ · /g, ', ')}.`,
        ...gap, ...detail.map(_sentence),
      ].join(' '),
    };
  }
  const message = _message(comparison, selectedWeek, strength, total);
  const detail = strength.status === STRENGTH_STATUS.OK ? _detailLines(strength) : [];
  return {
    state: strength.status === STRENGTH_STATUS.OK ? SNAPSHOT_STATE.EMPTY : SNAPSHOT_STATE.UNAVAILABLE,
    weekLabel, routine, percent: null, headline: null, caption: null, message, detail,
    a11y: `${weekLabel ? `${weekLabel}: ` : ''}${[message, ...detail.map(_sentence)].join(' ')}`.trim(),
  };
}

function _build(block, weeks, notes, comparison, selectedWeek, { stale }) {
  const weekResults = comparison.weeks || EMPTY;
  const strength = deriveRecoveryStrength({
    block, weeks, notes, selectedWeekId: selectedWeek ? selectedWeek.week_id : null, stale,
  });
  const strengthOk = strength.status === STRENGTH_STATUS.OK;
  // #1318: total recovery is derived HERE, once per distinct input, and read by
  // every surface (never re-derived).
  const total = deriveRecoveryTotal(strength, { stale });
  const display = _display(block, comparison, selectedWeek, strength, total);
  // Per-row bands and the summary counts, derived here once so no row or summary
  // component derives anything while rendering (or re-renders).
  const detailRows = selectedWeek && selectedWeek.status === RECOVERY_WEEK_STATUS.OK
    ? [...(selectedWeek.exercises || []), ...(selectedWeek.added || [])] : EMPTY;
  const bandById = {};
  const kindCounts = Object.fromEntries(ROW_STATUS_KINDS.map(k => [k, 0]));
  for (const row of detailRows) {
    const id = _rowBandId(row);
    bandById[row.key] = id;
    kindCounts[id || 'added'] += 1;
  }
  const bands = deriveRecoveryWeekBands(selectedWeek);
  return {
    blockId: block.id,
    weekId: selectedWeek ? selectedWeek.week_id : null,
    stale: !!stale,
    comparison,
    weekResults,
    selectedWeek,
    strength,
    total,
    liftStatus: deriveLiftStatuses(strength),
    scaleMax: strengthOk ? strengthScaleMax(strength) : 100,
    bands,
    counts: summarizeRecoveryBands(bands),
    detailRows,
    bandById: Object.freeze(bandById),
    detailSummary: Object.freeze({ counts: Object.freeze(kindCounts), total: detailRows.length }),
    trainedElsewhere: deriveTrainedElsewhere(comparison.weeks || EMPTY, selectedWeek, stale),
    display,
    // Status flags the surfaces branch on without re-reading the strength model.
    legacy: strength.status === STRENGTH_STATUS.PAIR_UNAVAILABLE,
    emptyCohort: strengthOk && strength.headline == null && strength.empty_reason === 'no_common_lifts',
  };
}

// #1378: the compact line a Recovery Blocks row prints, worded from the
// snapshot's own display (never a second percentage or another week). An
// unreadable latest week keeps the carried total but says it adds nothing, and a
// stale snapshot says it is last saved data.
export function compactRecoverySummary(snapshot) {
  if (!snapshot) return null;
  const { display, total } = snapshot;
  const scored = display.state === SNAPSHOT_STATE.SCORE;
  const text = scored
    ? [display.headline, display.weekLabel].filter(Boolean).join(' · ')
    : `${display.weekLabel ? `${display.weekLabel}: ` : ''}${display.message}`;
  const qualifiers = [];
  if (scored && !total.selectedReadable) qualifiers.push(`${display.weekLabel} note can’t be read; total is from earlier weeks`);
  if (snapshot.stale) qualifiers.push('From last saved data');
  return Object.freeze({
    text, qualifiers: Object.freeze(qualifiers),
    a11y: [text.replace(/ · /g, ', '), ...qualifiers].map(_sentence).join(' '),
  });
}

// Movement groups depend on the notes-read error, which Home does not carry. They
// are layered on the cached core so a differing `notesError` never re-derives
// the comparison or strength.
function _withGroups(core, block, notes, selectedWeek, notesError) {
  const baselineRows = block.baseline && Array.isArray(block.baseline.exercises) ? block.baseline.exercises : [];
  const source = resolveMovementGroupSource({ block, notes, notesError });
  // Numeric breakdown (needs a strength model) for the read-only Analytics panel.
  const movementGroups = core.strength.status === STRENGTH_STATUS.OK ? {
    source,
    breakdown: deriveMovementGroupBreakdown({
      strength: core.strength,
      baselineRows: (block.baseline && block.baseline.exercises) || [],
      addedRows: (selectedWeek && selectedWeek.added) || [],
      overrides: source.overrides,
    }),
  } : null;
  // Log's group editor: every baseline lift plus any added in ANY week, in
  // routine order, with its group and source; independent of the strength model.
  const addedRows = [];
  const seen = new Set(baselineRows.map(r => r && r.key));
  for (const w of core.weekResults) {
    for (const row of w.added || []) {
      if (row && row.key && !seen.has(row.key)) { seen.add(row.key); addedRows.push(row); }
    }
  }
  const order = new Map([...baselineRows, ...addedRows].map((r, i) => [r && r.key, i]));
  const editorBreakdown = deriveMovementGroupBreakdown({ baselineRows, addedRows, overrides: source.overrides });
  const groupEditor = {
    source,
    exercises: editorBreakdown.groups.flatMap(g => g.exercises)
      .sort((a, b) => order.get(a.key) - order.get(b.key))
      .map(ex => ({ ...ex, groupLabel: movementGroupLabel(ex.group) })),
  };
  return Object.freeze({ ...core, movementGroups, groupEditor });
}

// Content-keyed shared store. The key is a fingerprint of exactly the records the
// derivations read (the block, its weeks, the notes those weeks and the baseline
// point at), NOT array identity, so consumers that re-render with new-but-equal
// arrays still resolve to the one derived snapshot. Entries are bounded (LRU).
const _store = new Map();
const MAX_ENTRIES = 64;

export function recoveryInputFingerprint(block, weeks, notes) {
  const liveWeeks = (weeks || []).filter(w => w && w.block_id === block.id);
  const ids = new Set([block.baseline_note_id, ...liveWeeks.map(w => w.note_id)]);
  const noteParts = (notes || []).filter(n => n && ids.has(n.id)).map(n => [
    // Exactly the note fields the derivations read, with the FULL workout text:
    // a lossy digest could alias two distinct texts and return stale numbers.
    n.id, n.title, n.deleted_at || '', n.updated_at || '',
    typeof n.raw_text === 'string' ? n.raw_text : null,
    n.exercise_movement_groups ? JSON.stringify(n.exercise_movement_groups) : '',
  ]);
  return JSON.stringify([block, liveWeeks, noteParts]);
}

let _derivations = 0;
// Test seam: how many full derivations the store has run.
export const _snapshotDerivationCount = () => _derivations;
export function _resetRecoverySnapshotStore() { _store.clear(); _summaries.clear(); _derivations = 0; }

// #1378: Recovery Blocks rows need only the latest-week compact summary, for
// every completed block at once. They get their own bounded store of those small
// summaries so a long history neither evicts the full snapshots other surfaces
// share nor re-derives (or builds movement groups) on every row render. A miss
// derives through the same `_build` as the full snapshot, so wording and numbers
// cannot diverge.
const _summaries = new Map();
const MAX_SUMMARIES = 256;

export function getRecoveryRowSummary({ block, weeks = EMPTY, notes = EMPTY, stale = false } = {}) {
  if (!block) return null;
  const base = recoveryInputFingerprint(block, weeks, notes);
  const key = `${stale ? 1 : 0}|${base}`;
  let summary = _summaries.get(key);
  if (summary) { _summaries.delete(key); _summaries.set(key, summary); return summary; }
  const comparison = _store.get(`c|${base}`) || deriveRecoveryComparison({ block, weeks, notes });
  const results = comparison.weeks || EMPTY;
  const latest = results.length > 0 ? results[results.length - 1] : null;
  const core = _store.get(`s|${latest ? latest.week_id : ''}|${stale ? 1 : 0}|${base}`);
  if (!core) _derivations += 1;
  summary = compactRecoverySummary(core || _build(block, weeks, notes, comparison, latest, { stale }));
  _summaries.set(key, summary);
  while (_summaries.size > MAX_SUMMARIES) _summaries.delete(_summaries.keys().next().value);
  return summary;
}

// `selectedWeekId` null (or unknown) resolves to the latest week; the resolved
// id, not the request, is part of the key, so "latest" and an explicit latest id
// share one derivation.
export function getRecoverySnapshot({ block, weeks = EMPTY, notes = EMPTY, selectedWeekId = null, stale = false, notesError = null } = {}) {
  if (!block) return null;
  const base = recoveryInputFingerprint(block, weeks, notes);
  const cmpKey = `c|${base}`;
  let comparison = _store.get(cmpKey);
  if (!comparison) {
    comparison = deriveRecoveryComparison({ block, weeks, notes });
    _store.set(cmpKey, comparison);
  }
  const results = comparison.weeks || EMPTY;
  const latest = results.length > 0 ? results[results.length - 1] : null;
  const selected = (selectedWeekId && results.find(w => w.week_id === selectedWeekId)) || latest;
  const key = `s|${selected ? selected.week_id : ''}|${stale ? 1 : 0}|${base}`;
  let core = _store.get(key);
  if (core) { _store.delete(key); _store.set(key, core); } else {
    _derivations += 1;
    core = _build(block, weeks, notes, comparison, selected, { stale });
    _store.set(key, core);
  }
  const gKey = `g|${notesError ? 1 : 0}|${key}`;
  let snapshot = _store.get(gKey);
  if (!snapshot) {
    snapshot = _withGroups(core, block, notes, selected, notesError);
    _store.set(gKey, snapshot);
  }
  while (_store.size > MAX_ENTRIES) _store.delete(_store.keys().next().value);
  return snapshot;
}
