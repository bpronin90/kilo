// The ONE Recovery strength snapshot (#1315). Every surface that shows Recovery
// numbers (the Analytics Recovery section, the Analytics Overview `Recovery`
// row and Home's Recovery panel) reads this and never re-derives: the return
// comparison, the strength model, the week bands and the movement-group
// breakdown are each computed once per distinct input, then shared.
//
// Pure and read-only. Results live in a content-keyed shared store (see below),
// so simultaneously mounted consumers resolve to the very same frozen object even
// when they hold different-but-equal arrays. The wording the surfaces print (headline caption, empty/unavailable
// messages, full accessibility text, the "About these numbers" lines) is built
// here too, so two surfaces can never word the same fact differently.

import { deriveRecoveryComparison, RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS } from './recoveryAnalytics.js';
import { deriveRecoveryStrength, displayPercent, STRENGTH_STATUS } from './recoveryStrength.js';
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

function _routineName(block) {
  return ((block && block.baseline_note_title) || '').trim() || 'Untitled Routine';
}

// The sentences the summary no longer prints. They live in the accessibility
// label and the "About these numbers" explainer.
function _detailLines(strength) {
  const cohortSize = strength.cohort.length;
  const lines = [];
  if (cohortSize > 0) {
    lines.push(`Average of ${_lifts(cohortSize)} scored every week · ${cohortSize} of ${strength.roster_size} baseline lifts`);
    lines.push(`In the average: ${strength.cohort.map(c => c.name).join(', ')}`);
  }
  if (strength.excluded_weeks.length > 0) {
    lines.push(`Week ${strength.excluded_weeks.join(', ')} couldn’t be read and is left out of the comparison.`);
  }
  if (strength.cohort_dropped.length > 0) {
    lines.push(`Left the average this week (not scored every week): ${strength.cohort_dropped.join(', ')}.`);
  }
  return lines;
}

function _message(comparison, selectedWeek, strength) {
  if (comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_UNAVAILABLE
    || comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_UNSUPPORTED) {
    return 'Baseline data for this block isn’t available.';
  }
  if (comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY) return 'No baseline exercises were captured for this block.';
  if (!selectedWeek) return 'Baseline captured. No week logged yet.';
  if (strength.status === STRENGTH_STATUS.PAIR_UNAVAILABLE) return STRENGTH_EMPTY_COPY.pair_unavailable;
  if (selectedWeek.status === RECOVERY_WEEK_STATUS.NOTE_MISSING) return 'This week’s note is no longer available.';
  if (strength.status === STRENGTH_STATUS.OK) return STRENGTH_EMPTY_COPY[strength.empty_reason] || STRENGTH_EMPTY_COPY.no_common_lifts;
  return 'No strength score for this week.';
}

function _display(block, comparison, selectedWeek, strength) {
  const weekLabel = selectedWeek ? `Week ${selectedWeek.week_number}` : null;
  const routine = _routineName(block);
  if (strength.status === STRENGTH_STATUS.OK && strength.headline != null && weekLabel) {
    const percent = displayPercent(strength.headline);
    const detail = _detailLines(strength);
    const caption = `${_lifts(strength.cohort.length)} · ${weekLabel}`;
    return {
      state: SNAPSHOT_STATE.SCORE, weekLabel, routine, percent, caption, message: null, detail,
      a11y: [`${weekLabel}: ${percent}% of ${routine} baseline strength.`, ...detail.map(_sentence)].join(' '),
    };
  }
  const message = _message(comparison, selectedWeek, strength);
  const detail = strength.status === STRENGTH_STATUS.OK ? _detailLines(strength) : [];
  return {
    state: strength.status === STRENGTH_STATUS.OK ? SNAPSHOT_STATE.EMPTY : SNAPSHOT_STATE.UNAVAILABLE,
    weekLabel, routine, percent: null, caption: null, message, detail,
    a11y: `${weekLabel ? `${weekLabel}: ` : ''}${[message, ...detail.map(_sentence)].join(' ')}`.trim(),
  };
}

function _build(block, weeks, notes, comparison, selectedWeek, { stale, notesError }) {
  const weekResults = comparison.weeks || EMPTY;
  const strength = deriveRecoveryStrength({
    block, weeks, notes, selectedWeekId: selectedWeek ? selectedWeek.week_id : null, stale,
  });
  const strengthOk = strength.status === STRENGTH_STATUS.OK;
  let movementGroups = null;
  if (strengthOk) {
    const source = resolveMovementGroupSource({ block, notes, notesError });
    movementGroups = {
      source,
      breakdown: deriveMovementGroupBreakdown({
        strength,
        baselineRows: (block.baseline && block.baseline.exercises) || [],
        addedRows: (selectedWeek && selectedWeek.added) || [],
        overrides: source.overrides,
      }),
    };
  }
  const display = _display(block, comparison, selectedWeek, strength);
  return Object.freeze({
    blockId: block.id,
    weekId: selectedWeek ? selectedWeek.week_id : null,
    stale: !!stale,
    comparison,
    weekResults,
    selectedWeek,
    strength,
    scaleMax: strengthOk ? strengthScaleMax(strength) : 100,
    bands: deriveRecoveryWeekBands(selectedWeek),
    movementGroups,
    display,
    // Status flags the surfaces branch on without re-reading the strength model.
    legacy: strength.status === STRENGTH_STATUS.PAIR_UNAVAILABLE,
    emptyCohort: strengthOk && strength.headline == null && strength.empty_reason === 'no_common_lifts',
  });
}

// Content-keyed shared store. The key is a fingerprint of exactly the records the
// derivations read (the block, its weeks, the notes those weeks and the baseline
// point at), NOT array identity, so consumers that re-render with new-but-equal
// arrays still resolve to the one derived snapshot. Entries are bounded (LRU).
const _store = new Map();
const MAX_ENTRIES = 64;

function _hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${str.length}:${h}`;
}

export function recoveryInputFingerprint(block, weeks, notes) {
  const liveWeeks = (weeks || []).filter(w => w && w.block_id === block.id);
  const ids = new Set([block.baseline_note_id, ...liveWeeks.map(w => w.note_id)]);
  const noteParts = (notes || []).filter(n => n && ids.has(n.id)).map(n => [
    n.id, n.title, n.deleted_at || '', n.updated_at || '',
    typeof n.raw_text === 'string' ? _hash(n.raw_text) : '',
    n.exercise_movement_groups ? JSON.stringify(n.exercise_movement_groups) : '',
  ]);
  return JSON.stringify([block, liveWeeks, noteParts]);
}

let _derivations = 0;
// Test seam: how many full derivations the store has run.
export const _snapshotDerivationCount = () => _derivations;
export function _resetRecoverySnapshotStore() { _store.clear(); _derivations = 0; }

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
  const key = `s|${selected ? selected.week_id : ''}|${stale ? 1 : 0}|${notesError ? 1 : 0}|${base}`;
  let snapshot = _store.get(key);
  if (snapshot) { _store.delete(key); _store.set(key, snapshot); return snapshot; }
  _derivations += 1;
  snapshot = _build(block, weeks, notes, comparison, selected, { stale, notesError });
  _store.set(key, snapshot);
  while (_store.size > MAX_ENTRIES) _store.delete(_store.keys().next().value);
  return snapshot;
}
