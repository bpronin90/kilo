// Tracked-span watermark — F12b (#893), against the owner-approved
// exercise-identity and storage contract in #892 comment 5425328351.
//
// The claim under test, in one line: progression reflects only the current
// intentional tracked span, while historical capability stays available.

import { parseWorkoutNote, deriveWorkoutAnalytics, deriveProgressionSignals, derivePerDaySignals, epleyPR } from '../lib/parser';
import { loggedSessionUnits } from '../lib/parser/analytics';
import {
  buildTrackedLiftActivation,
  resolveTrackedLiftAnchors,
  reconcileTrackedLiftActivations,
  classifyExerciseSessions,
  deriveWorkoutNoteAnalytics,
} from '../lib/data/workoutAnalytics';
import { deriveNonWeightedTrackedExerciseMetrics } from '../lib/data/nonWeightedMetrics';
import { normalizeExerciseKey } from '../lib/parser';
import { getDefaultTrackedNames } from '../lib/data/exerciseCatalog';

const parse = (text) => parseWorkoutNote(text).sections;
const anchorsFor = (sections, activations) => resolveTrackedLiftAnchors(sections, activations);
const activate = (sections, name, at = '2026-08-26T12:00:00.000Z') =>
  buildTrackedLiftActivation(sections, name, new Date(at));

// ─────────────────────────────────────────────────────────────────────────────
// Identity (matrix 1-6)
// ─────────────────────────────────────────────────────────────────────────────

describe('identity', () => {
  test('a non-alias key is canonical already: activating stores it unchanged', () => {
    const sections = parse('Monday\n-Face Pull\n30 12\n35 12');
    const record = activate(sections, 'Face Pull');
    expect(normalizeExerciseKey('Face Pull')).toBe('face pull');
    expect(record.anchor).toBe(2);
  });

  test('aliases resolve to one identity: an anchor minted under one applies to the other', () => {
    const sections = parse('Monday\n-iso row\n90 10\n100 10');
    const record = activate(sections, 'Hammer Strength Iso Row');
    const anchors = anchorsFor(sections, { [normalizeExerciseKey('iso row')]: record });
    expect(record.anchor).toBe(2);
    expect(anchors['hammer strength iso row']).toBe(2);
  });

  test('two legacy keys collapsing onto one canonical key keep the LATEST activation', () => {
    const sections = parse('Monday\n-iso row\n90 10\n100 10\n110 10');
    const older = { anchor: 1, at: '2026-01-01T00:00:00.000Z', witness: { headings: ['Monday'], sessions: 'x' } };
    const newer = { anchor: 3, at: '2026-08-01T00:00:00.000Z', witness: { headings: ['Monday'], sessions: 'y' } };
    // Latest wins because it yields the NARROWER span: a merge must never widen
    // a trend back across a span the user did not choose.
    const anchors = anchorsFor(sections, { 'iso row': older, 'hammer strength iso row': newer });
    expect(anchors['hammer strength iso row']).toBe(3);
  });

  test('near-duplicate names stay distinct — no watermark inheritance', () => {
    const sections = parse('Monday\n-RDL\n225 8\n235 8\n-Single-Leg RDL\n50 10\n55 10');
    const record = activate(sections, 'RDL');
    const anchors = anchorsFor(sections, { rdl: record });
    expect(anchors['rdl']).toBe(2);
    expect(anchors['single-leg rdl']).toBeUndefined();
  });

  test('one movement on two days is one identity with one ordered session list', () => {
    const sections = parse('Monday\n-Hammer Curl\n30 12\nWednesday\n-Hammer Curl\n35 12');
    const record = activate(sections, 'Hammer Curl');
    expect(record.anchor).toBe(2);
    expect(record.witness.headings).toEqual(['Monday', 'Wednesday']);
  });

  test('casing and surrounding whitespace collapse to one identity', () => {
    expect(normalizeExerciseKey('  squat ')).toBe(normalizeExerciseKey('SQUAT'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Witness (matrix 7-15) — verified at the SAVE boundary, which is the one place
// retirement is a write.
// ─────────────────────────────────────────────────────────────────────────────

describe('witness verification at the save boundary', () => {
  test('a substitute with a DIFFERENT opening history is retired, not adopted', () => {
    const before = parse('Monday\n-Alpha Row\n90 10\n95 10\n100 10');
    const record = activate(before, 'Alpha Row');
    expect(record.anchor).toBe(3);

    // One save: Alpha renamed away, Beta renamed onto the freed key.
    const after = parse('Monday\n-Alpha Row\n50 5\n55 5\n60 5\n65 5\n70 5');
    const { next, changed } = reconcileTrackedLiftActivations(after, { 'alpha row': record });
    expect(changed).toBe(true);
    expect(next['alpha row']).toBeUndefined();
  });

  test('across two saves the key is simply gone: retired on absence, witness never consulted', () => {
    const before = parse('Monday\n-Alpha Row\n90 10\n95 10');
    const record = activate(before, 'Alpha Row');
    const after = parse('Monday\n-Beta Row\n90 10\n95 10');
    const { next, changed } = reconcileTrackedLiftActivations(after, { 'alpha row': record });
    expect(changed).toBe(true);
    expect(next['alpha row']).toBeUndefined();
    // and the movement that took no key inherits nothing
    expect(next['beta row']).toBeUndefined();
  });

  test('a substitute with FEWER sessions than the anchor is caught by the witness, not the clamp', () => {
    const before = parse('Monday\n-Alpha Row\n90 10\n95 10\n100 10\n105 10');
    const record = activate(before, 'Alpha Row');
    expect(record.anchor).toBe(4);

    const after = parse('Monday\n-Alpha Row\n50 5\n55 5');
    const { next } = reconcileTrackedLiftActivations(after, { 'alpha row': record });
    expect(next['alpha row']).toBeUndefined();

    // The clamp alone would have kept the record and merely narrowed it to 2.
    // Assert that is NOT what happened: content, not length, is what caught it.
    const clampOnly = { ...record, witness: { ...record.witness, sessions: activate(after, 'Alpha Row').witness.sessions } };
    const { next: kept } = reconcileTrackedLiftActivations(after, { 'alpha row': clampOnly });
    expect(kept['alpha row'].anchor).toBe(2);
  });

  test('an identical FIRST session that diverges at the second is still distinguished', () => {
    const before = parse('Monday\n-Alpha Row\n90 10\n95 10');
    const record = activate(before, 'Alpha Row');
    const after = parse('Monday\n-Alpha Row\n90 10\n120 3\n130 3');
    const { next } = reconcileTrackedLiftActivations(after, { 'alpha row': record });
    expect(next['alpha row']).toBeUndefined();
  });

  test('THE ACCEPTED RESIDUAL: an equal-witness substitution DOES inherit the boundary', () => {
    // Documented behavior, not a pass. Two reps-only accessories that both
    // opened 3x10 under the same heading serialize identically, and within the
    // note grammar nothing can tell "renamed" from "substituted" once the
    // original is gone.
    const before = parse('Monday\n-Band Pull-Apart\n10,10,10\n12,12,12');
    const record = activate(before, 'Band Pull-Apart');
    const after = parse('Monday\n-Band Pull-Apart\n10,10,10\n12,12,12\n15,15,15');
    const { next } = reconcileTrackedLiftActivations(after, { 'band pull-apart': record });
    expect(next['band pull-apart']).toBeDefined();

    // ...and the §5 bounds hold. The boundary lands inside the substitute's OWN
    // history, so the trend only ever compares the substitute to itself.
    const anchors = anchorsFor(after, next);
    const units = loggedSessionUnits(deriveWorkoutAnalytics(after).exercises[0].occurrences);
    expect(anchors['band pull-apart']).toBeLessThanOrEqual(units.length);

    // Capability is unaffected, and the next untrack clears the record entirely.
    const { next: afterUntrack } = reconcileTrackedLiftActivations(after, {});
    expect(afterUntrack['band pull-apart']).toBeUndefined();
  });

  test('the same content under DIFFERENT headings is distinguished by witness.headings', () => {
    const before = parse('Monday\n-Band Pull-Apart\n10,10,10');
    const record = activate(before, 'Band Pull-Apart');
    const after = parse('Friday\n-Band Pull-Apart\n10,10,10\n12,12,12');
    const { next } = reconcileTrackedLiftActivations(after, { 'band pull-apart': record });
    expect(next['band pull-apart']).toBeUndefined();
  });

  test('anchor 0 carries no witness and is identity-neutral', () => {
    const sections = parse('Monday\n-Brand New Lift 3x10');
    const record = activate(sections, 'Brand New Lift');
    expect(record.anchor).toBe(0);
    expect(record.witness).toBeNull();
    // It survives any content, because it excludes nothing and so can inherit
    // nothing wrong.
    const after = parse('Monday\n-Brand New Lift\n50 10\n60 10');
    const { next } = reconcileTrackedLiftActivations(after, { 'brand new lift': record });
    expect(next['brand new lift'].anchor).toBe(0);
    expect(anchorsFor(after, next)['brand new lift']).toBeUndefined();
  });

  test('editing an old logged session retires the record but never the Track flag', () => {
    const before = parse('Monday\n-Bench\n225 5\n235 5\n245 5');
    const record = activate(before, 'Bench');
    const edited = parse('Monday\n-Bench\n230 5\n235 5\n245 5');
    const { next } = reconcileTrackedLiftActivations(edited, { bench: record });
    expect(next['bench']).toBeUndefined();
    // Retirement returns only the record map; nothing here can clear a flag.
    // The degradation is back to shipped full-history behavior:
    // Full history restored: the last two of the three sessions are compared,
    // exactly as before any watermark existed.
    const sig = deriveProgressionSignals(edited, ['Bench'], anchorsFor(edited, next)).exercises[0];
    expect(sig.progression_status).toBe('improved');
    expect(sig.prior_pr).toBeCloseTo(epleyPR(235, 5));
  });

  test('remove-and-re-add of an identical movement in one save keeps the span (documented benign edge)', () => {
    const before = parse('Monday\n-Bench\n225 5\n235 5');
    const record = activate(before, 'Bench');
    const after = parse('Tuesday\n-Curl\n30 10\nMonday\n-Bench\n225 5\n235 5');
    const { next } = reconcileTrackedLiftActivations(after, { bench: record });
    expect(next['bench']).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Watermark semantics (matrix 16-22)
// ─────────────────────────────────────────────────────────────────────────────

describe('watermark semantics', () => {
  const HISTORY = 'Monday\n-Bench\n225 5\n235 5\n245 5';

  test('first Track anchors at the current count; the trend restarts, capability does not', () => {
    const sections = parse(HISTORY);
    const record = activate(sections, 'Bench');
    expect(record.anchor).toBe(3);

    const anchors = anchorsFor(sections, { bench: record });
    const sig = deriveProgressionSignals(sections, ['Bench'], anchors).exercises[0];

    expect(sig.progression_status).toBe('first_session');
    expect(sig.overload_trend).toBe('first_session');
    expect(sig.prior_pr).toBeNull();
    // Capability is untouched and still historical.
    expect(sig.kilo_max).toBeCloseTo(epleyPR(245, 5));
    expect(sig.latest_pr).toBeCloseTo(epleyPR(245, 5));
    expect(sig.latest_top_weight).toBe(245);
  });

  test('with no record at all, behavior is exactly as shipped', () => {
    const sections = parse(HISTORY);
    const withNone = deriveProgressionSignals(sections, ['Bench'], {}).exercises[0];
    const shipped = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(withNone).toEqual(shipped);
    expect(shipped.progression_status).toBe('improved');
  });

  test('entries logged while untracked never enter the retracked span', () => {
    // Tracked, then untracked (record deleted with the flag), then three
    // sessions logged during the gap, then retracked.
    const gapText = HISTORY + '\n255 5\n185 5\n195 5';
    const atRetrack = parse(gapText);
    const record = activate(atRetrack, 'Bench');
    expect(record.anchor).toBe(6);

    // The first newly tracked session is a DROP from the gap's last entry. If
    // the gap leaked in, this would read `improved` (195 -> 200).
    const afterOneNew = parse(gapText + '\n200 5');
    const anchors = anchorsFor(afterOneNew, { bench: record });
    const sig = deriveProgressionSignals(afterOneNew, ['Bench'], anchors).exercises[0];
    expect(sig.progression_status).toBe('first_session');
    expect(sig.prior_pr).toBeNull();

    // A second newly tracked session compares against the first, not the gap.
    const afterTwoNew = parse(gapText + '\n200 5\n210 5');
    const sig2 = deriveProgressionSignals(afterTwoNew, ['Bench'], anchorsFor(afterTwoNew, { bench: record })).exercises[0];
    expect(sig2.progression_status).toBe('improved');
    expect(sig2.prior_pr).toBeCloseTo(epleyPR(200, 5));
    // Capability still reaches back over the gap to the all-time best.
    expect(sig2.kilo_max).toBeCloseTo(epleyPR(255, 5));
  });

  test('untracking removes the record with the flag, so nothing survives to be resumed', () => {
    const sections = parse(HISTORY);
    const record = activate(sections, 'Bench');
    const afterUntrack = {};
    expect(anchorsFor(sections, afterUntrack)).toEqual({});
    expect(record.anchor).toBe(3);
  });

  test('legacy boolean-only state keeps full history; no anchor is invented', () => {
    const sections = parse(HISTORY);
    // A tracked flag with no record is exactly the legacy state.
    expect(anchorsFor(sections, {})).toEqual({});
    const sig = deriveProgressionSignals(sections, ['Bench'], anchorsFor(sections, {})).exercises[0];
    expect(sig.progression_status).toBe('improved');
  });

  test("a catalog default the user never toggled keeps full history", () => {
    // Catalog `po: true` names are tracked without an explicit activation, so
    // they are not activations at all and get no record — the same standing as
    // legacy boolean-only state. docs/calculations-reference.md makes this claim
    // to users, so it is pinned here rather than left implicit.
    const sections = parse('Tuesday\n-Squat\n315 5\n325 5\n335 5');
    expect(getDefaultTrackedNames().map(n => normalizeExerciseKey(n))).toContain('squat');
    const anchors = anchorsFor(sections, {});
    expect(anchors['squat']).toBeUndefined();
    const sig = deriveProgressionSignals(sections, ['Squat'], anchors).exercises[0];
    expect(sig.progression_status).toBe('improved');
    expect(sig.prior_pr).toBeCloseTo(epleyPR(325, 5));
  });

  test('a reps-only exercise lands on the same boundary from the same anchor', () => {
    const text = 'Monday\n-Band Pull-Apart\n10,10,10\n12,12,12';
    const atTrack = parse(text);
    const record = activate(atTrack, 'Band Pull-Apart');
    expect(record.anchor).toBe(2);

    const after = parse(text + '\n8,8,8');
    const activations = { 'band pull-apart': record };
    const nw = deriveNonWeightedTrackedExerciseMetrics(after, ['Band Pull-Apart'], activations);
    const metrics = nw['band pull-apart'];
    // One newly tracked session: no comparison yet, but AVG/BEST still read.
    expect(metrics.reps_arrow).toBe('dash');
    expect(metrics.avg_reps).toBe(8);
    expect(metrics.best_set_reps).toBe(8);

    // Without the watermark this same data reads as a decline.
    const legacy = deriveNonWeightedTrackedExerciseMetrics(after, ['Band Pull-Apart'], null);
    expect(legacy['band pull-apart'].reps_arrow).toBe('down');

    // A second newly tracked session compares within the span.
    const after2 = parse(text + '\n8,8,8\n11,11,11');
    const nw2 = deriveNonWeightedTrackedExerciseMetrics(after2, ['Band Pull-Apart'], activations);
    expect(nw2['band pull-apart'].reps_arrow).toBe('up');
  });

  test('a time-based hold follows the same rule', () => {
    const text = 'Monday\n-Plank 3x30s\n60\n75';
    const atTrack = parse(text);
    const record = activate(atTrack, 'Plank');
    expect(record.anchor).toBe(2);
    const after = parse(text + '\n45');
    const metrics = deriveNonWeightedTrackedExerciseMetrics(after, ['Plank'], { plank: record })['plank'];
    expect(metrics.exercise_class).toBe('time_based');
    expect(metrics.hold_arrow).toBe('dash');
    expect(metrics.best_hold).toBe(45);
  });

  test('the classification obeys the same boundary as the trend', () => {
    const atTrack = parse(HISTORY);
    const record = activate(atTrack, 'Bench');
    const after = parse(HISTORY + '\n200 5');
    const anchors = anchorsFor(after, { bench: record });
    expect(classifyExerciseSessions(after, ['Bench'], anchors)['bench']).toBe('initial');
    // Shipped behavior over the same text calls it a regression, because it can
    // see the untracked history.
    expect(classifyExerciseSessions(after, ['Bench'])['bench']).toBe('regressing');
  });

  test('per-day trends count ordinals across the whole history, not per day', () => {
    const text = 'Monday\n-Bench\n225 5\n235 5\nWednesday\n-Bench\n135 12\n145 12';
    const atTrack = parse(text);
    const record = activate(atTrack, 'Bench');
    expect(record.anchor).toBe(4);

    const after = parse('Monday\n-Bench\n225 5\n235 5\n245 5\nWednesday\n-Bench\n135 12\n145 12');
    const anchors = anchorsFor(after, { bench: record });
    const perDay = derivePerDaySignals(after, ['Bench'], anchors);
    // Monday's newly tracked session is its only one inside the span, so there
    // is nothing to compare it to. If the ordinal had restarted per day, the
    // anchor of 4 would have emptied Monday entirely and Wednesday too.
    expect(perDay['bench']['Monday'].overload_trend).toBeNull();
    expect(perDay['bench']['Monday'].latest_top_weight).toBe(245);
  });

  test('Home and Analytics derive one boundary from one activation map', () => {
    const atTrack = parse(HISTORY);
    const record = activate(atTrack, 'Bench');
    const after = parse(HISTORY + '\n200 5');
    const activations = { bench: record };

    const home = deriveWorkoutNoteAnalytics(after, ['Bench'], 1.07, activations);
    const analytics = deriveWorkoutNoteAnalytics(after, ['Bench'], 1.07, activations);
    expect(home.anchors).toEqual(analytics.anchors);
    expect(home.anchors['bench']).toBe(3);
    expect(home.classifications).toEqual(analytics.classifications);
    expect(home.signals[0].progression_status).toBe(analytics.signals[0].progression_status);
    expect(home.signals[0].progression_status).toBe('first_session');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retirement safety (matrix 23-26)
// ─────────────────────────────────────────────────────────────────────────────

describe('retirement safety', () => {
  test('the stale-anchor clamp repairs downward, and the repair is what gets persisted', () => {
    const before = parse('Monday\n-Bench\n225 5\n235 5\n245 5\n255 5');
    const record = activate(before, 'Bench');
    expect(record.anchor).toBe(4);

    // A past session column is deleted from the END: the opening history the
    // witness pinned is untouched, so this is a clamp, not a substitution.
    const after = parse('Monday\n-Bench\n225 5\n235 5');
    const { next, changed } = reconcileTrackedLiftActivations(after, { bench: record });
    expect(changed).toBe(true);
    expect(next['bench'].anchor).toBe(2);

    // Re-running over the same population is now a no-op — without the persisted
    // repair the movement would re-clamp on every render and read
    // `First session` forever.
    const { changed: again } = reconcileTrackedLiftActivations(after, next);
    expect(again).toBe(false);
  });

  test('render paths never retire: a witness mismatch degrades this render only', () => {
    const before = parse('Monday\n-Bench\n225 5\n235 5\n245 5');
    const record = activate(before, 'Bench');
    // A narrower render population (Analytics excludes deloads; both surfaces
    // exclude opted-out recovery weeks) must not be read as an identity change.
    const narrow = parse('Monday\n-Bench\n245 5');
    const anchors = anchorsFor(narrow, { bench: record });
    expect(anchors['bench']).toBe(1);
    // Nothing was written; the record is returned untouched by the read path.
    expect(record.anchor).toBe(3);
  });

  test('a movement present ONLY in a note the ordinary population excludes is not retired', () => {
    // The save boundary is required to reconcile over the UNFILTERED notebook.
    // Here that is the union of both notes; the ordinary population is only the
    // first. Reconciling over the union keeps the record.
    const ordinaryOnly = parse('Monday\n-Squat\n315 5');
    const unfiltered = parse('Monday\n-Squat\n315 5\nRecovery Week\n-Bench\n135 10\n145 10');

    const record = activate(unfiltered, 'Bench');
    const { next: overUnfiltered } = reconcileTrackedLiftActivations(unfiltered, { bench: record });
    expect(overUnfiltered['bench']).toBeDefined();

    // The same reconcile over the recovery-FILTERED population would have
    // wrongly retired it — which is exactly why the caller must not pass that.
    const { next: overFiltered } = reconcileTrackedLiftActivations(ordinaryOnly, { bench: record });
    expect(overFiltered['bench']).toBeUndefined();
  });

  test('an unchanged reconcile reports no change, so no write is made', () => {
    const sections = parse('Monday\n-Bench\n225 5\n235 5');
    const record = activate(sections, 'Bench');
    const { changed } = reconcileTrackedLiftActivations(sections, { bench: record });
    expect(changed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regressions the watermark must not cause
// ─────────────────────────────────────────────────────────────────────────────

describe('regressions', () => {
  test('a warmup occurrence still contributes no trend but does advance the ordinal', () => {
    const text = 'Monday\n+WARMUP\n-Bench\n95 10\n+LIFTING\n-Bench\n225 5\n235 5';
    const sections = parse(text);
    const record = activate(sections, 'Bench');
    // Three logged sessions exist in the normative list, warmup included.
    expect(record.anchor).toBe(3);
    const after = parse(text + '\n245 5');
    const anchors = anchorsFor(after, { bench: record });
    const sig = deriveProgressionSignals(after, ['Bench'], anchors).exercises[0];
    expect(sig.progression_status).toBe('first_session');
    // The warmup set never becomes a comparison partner.
    expect(sig.latest_top_weight).toBe(245);
  });

  test('an absent exercise still returns the absent shape, not a watermarked one', () => {
    const sections = parse('Monday\n-Squat\n315 5');
    const sig = deriveProgressionSignals(sections, ['Bench'], { bench: 2 }).exercises[0];
    expect(sig.progression_status).toBeNull();
    expect(sig.latest_pr).toBeNull();
  });
});
