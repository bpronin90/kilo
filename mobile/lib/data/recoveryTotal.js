// Total recovery (#1318): the owner-approved headline for a Recovery block.
//
//   total(W) = (1/M) * sum_i min(100, latest_i(W))
//
// M is every strength-scoreable frozen baseline lift (equal weights), so a lift
// that is not yet back counts as 0 rather than disappearing from the average.
// latest_i(W) is the lift's most recent #1305 score in any readable week <= W
// (carried forward, no decay, never its all-time best), or 0 if it has none.
// Unreadable weeks are gaps: they neither erase earlier scores nor add zeros.
//
// Pure leaf. Called ONLY while the Recovery snapshot is constructed, from the
// raw per-week scores `deriveRecoveryStrength` already produced (`evidence`);
// it never scores a lift itself and no surface calls it.

import { STRENGTH_STATUS, PACE_STATUS, deriveLiftPace, displayPercent } from './recoveryStrength.js';

export const TOTAL_CAP = 100;

export const TOTAL_REASON = Object.freeze({
  UNAVAILABLE: 'unavailable',
  NO_SCOREABLE: 'no_scoreable_lifts',
  NO_READABLE: 'no_readable_weeks',
});

export const TOTAL_EMPTY_COPY = Object.freeze({
  no_scoreable_lifts: 'No baseline lift can be scored for strength yet.',
});

const EMPTY = Object.freeze([]);
const _unavailable = (reason, extra = {}) => Object.freeze({
  percent: null, reason, back: 0, scoreable: 0, avgOfBack: null, week: null, selectedReadable: false,
  perLiftLatest: EMPTY, trend: EMPTY, pace: Object.freeze({ status: PACE_STATUS.NO_CURRENT }), unknown: EMPTY, ...extra,
});

export function deriveRecoveryTotal(strength, { stale = false } = {}) {
  const evidence = strength && strength.status === STRENGTH_STATUS.OK ? strength.evidence : null;
  if (!evidence) return _unavailable(TOTAL_REASON.UNAVAILABLE);
  const { lifts, weeks } = evidence;
  const M = lifts.length;
  if (M === 0) return _unavailable(TOTAL_REASON.NO_SCOREABLE);
  if (weeks.length === 0) return _unavailable(TOTAL_REASON.NO_READABLE, { scoreable: M });

  const latest = new Map();
  const trend = [];
  let sawUnreadable = false;
  let anyReadable = false;
  for (const w of weeks) {
    if (!w.readable) {
      sawUnreadable = true;
      trend.push(Object.freeze({ week_id: w.week_id, week_number: w.week_number, readable: false, percent: null }));
      continue;
    }
    anyReadable = true;
    for (const l of lifts) {
      if (w.scores.has(l.key)) latest.set(l.key, { percent: w.scores.get(l.key), week: w.week_number });
    }
    let sum = 0;
    for (const l of lifts) {
      const e = latest.get(l.key);
      if (e) sum += Math.min(TOTAL_CAP, e.percent);
    }
    trend.push(Object.freeze({ week_id: w.week_id, week_number: w.week_number, readable: true, percent: sum / M }));
  }
  const selected = weeks[weeks.length - 1];
  if (!anyReadable) return _unavailable(TOTAL_REASON.NO_READABLE, { scoreable: M, week: selected.week_number, trend: Object.freeze(trend) });

  let sum = 0;
  let back = 0;
  const perLiftLatest = lifts.map(l => {
    const e = latest.get(l.key) || null;
    if (e) { sum += Math.min(TOTAL_CAP, e.percent); back += 1; }
    return Object.freeze({
      key: l.key, name: l.name, percent: e ? e.percent : 0, week: e ? e.week : null,
      // Unreadable weeks might hold this lift's only score.
      unknown: !e && sawUnreadable,
    });
  });
  const points = trend.filter(t => t.readable).map(t => ({ week_number: t.week_number, percent: t.percent }));
  return Object.freeze({
    percent: sum / M,
    reason: null,
    back,
    scoreable: M,
    avgOfBack: back > 0 ? sum / back : 0,
    week: selected.week_number,
    selectedReadable: selected.readable,
    perLiftLatest: Object.freeze(perLiftLatest),
    trend: Object.freeze(trend),
    pace: stale ? Object.freeze({ status: PACE_STATUS.SUPPRESSED }) : deriveLiftPace(points, selected.week_number),
    unknown: Object.freeze(perLiftLatest.filter(l => l.unknown).map(l => l.name)),
  });
}

const _lifts = (n) => `${n} ${n === 1 ? 'lift' : 'lifts'}`;
const _sentence = (l) => (/[.!?]$/.test(l) ? l : `${l}.`);

// ONE compact caption: `{N} of {M} lifts back · avg {avg}% · Week {n}`.
export function totalCaption(total) {
  return `${total.back} of ${total.scoreable} lifts back · avg ${displayPercent(total.avgOfBack)}% · Week ${total.week}`;
}

// The explainer sentences for the total (the secondary cohort lines are the
// snapshot's `detail`). Cap/denominator, what "back" means, carried-score age and
// the unknown/gap limits all live here and in the accessibility label.
export function totalExplainerLines(total, selectedWeekNumber) {
  const lines = [
    `Total recovery averages every one of your ${_lifts(total.scoreable)} that can be scored against its baseline best set, each capped at ${TOTAL_CAP}%. A lift with no score yet counts as 0%, so a first score raises the total.`,
    `Back means a lift has a score. It can still be below 100%. Each lift uses its latest score, carried forward until it is tested again.`,
  ];
  const carried = total.perLiftLatest.filter(l => l.week != null && l.week !== selectedWeekNumber);
  if (carried.length > 0) {
    lines.push(`Carried scores: ${carried.map(l => `${l.name} (last tested Week ${l.week})`).join(', ')}.`);
  }
  if (total.unknown.length > 0) {
    lines.push(`Could be higher: a week that can’t be read may hold a score for ${total.unknown.join(', ')}.`);
  }
  if (!total.selectedReadable) {
    lines.push('This week’s note can’t be read, so the total carries your earlier readable scores and adds none for this week.');
  }
  return lines.map(_sentence);
}
