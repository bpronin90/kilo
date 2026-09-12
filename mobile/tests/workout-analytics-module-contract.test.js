// Export-parity + identity contract for the #1053 split of
// lib/data/workoutAnalytics.js into pure derivation modules.
//
// The split is behavior-only: the barrel must keep EXACTLY the named exports and
// constants the pre-split file exposed, at the same value, and — for the two
// parser watermark primitives it re-exports — at the same object identity. This
// fixture enumerates that whole surface (public + the private `_`-prefixed
// test/consumer exports) so a future move that drops or renames one fails here
// rather than silently in a distant importer.

import * as wa from '../lib/data/workoutAnalytics';
import * as parserAnalytics from '../lib/parser/analytics';
import { parseWorkoutNote } from '../lib/parser';

const parse = (text) => parseWorkoutNote(text).sections;

// The complete named surface of the pre-split module. `kind` records how each
// export must present after the split.
const EXPECTED = {
  // ── activations (#893) ──
  TRACKED_LIFT_WITNESS_SESSIONS: { kind: 'const', value: 10 },
  buildTrackedLiftActivation: { kind: 'function' },
  resolveTrackedLiftAnchors: { kind: 'function' },
  reconcileTrackedLiftActivations: { kind: 'function' },
  // ── parser watermark primitives, re-exported at identity ──
  _occurrenceEntries: { kind: 'reexport', from: '_occurrenceEntries' },
  classifyExerciseSessions: { kind: 'reexport', from: 'classifyExerciseSessions' },
  // ── rep drop-off + session check-in ──
  computeRepDropOff: { kind: 'function' },
  deriveRepDropOffFlags: { kind: 'function' },
  SESSION_CHECKIN_REP_DROP_THRESHOLD: { kind: 'const', value: 2 },
  SESSION_CHECKIN_MIN_COLLAPSED_SETS: { kind: 'const', value: 2 },
  SESSION_CHECKIN_MIN_PRIOR_ENTRIES: { kind: 'const', value: 2 },
  SESSION_CHECKIN_SKIP_FLOOR: { kind: 'const', value: 2 },
  SESSION_CHECKIN_SKIP_MARGIN: { kind: 'const', value: 1 },
  SESSION_CHECKIN_MIN_SKIP_COLUMNS: { kind: 'const', value: 2 },
  deriveSessionCheckIn: { kind: 'function' },
  // ── signals / note analytics / weekly summary / check-in history ──
  deriveSignals: { kind: 'function' },
  deriveWorkoutNoteAnalytics: { kind: 'function' },
  deriveOverloadCounts: { kind: 'function' },
  computeWeeklySummary: { kind: 'function' },
  deriveCheckInHistory: { kind: 'function' },
  // ── PR-moment canonical occurrences (#577) ──
  deriveTrackedPROccurrences: { kind: 'function' },
};

describe('workoutAnalytics barrel export parity (#1053)', () => {
  test('every pre-split named export is still present', () => {
    for (const name of Object.keys(EXPECTED)) {
      expect(wa[name]).toBeDefined();
    }
  });

  test('the barrel exposes no more and no fewer names than the contract', () => {
    const actual = Object.keys(wa)
      .filter((k) => k !== 'default' && k !== '__esModule')
      .sort();
    expect(actual).toEqual(Object.keys(EXPECTED).sort());
  });

  test('functions are functions', () => {
    for (const [name, spec] of Object.entries(EXPECTED)) {
      if (spec.kind === 'function') expect(typeof wa[name]).toBe('function');
    }
  });

  test('constants keep their exact values', () => {
    for (const [name, spec] of Object.entries(EXPECTED)) {
      if (spec.kind === 'const') expect(wa[name]).toBe(spec.value);
    }
  });

  test('re-exported parser primitives keep the same object identity', () => {
    for (const [name, spec] of Object.entries(EXPECTED)) {
      if (spec.kind === 'reexport') {
        expect(wa[name]).toBe(parserAnalytics[spec.from]);
        expect(typeof wa[name]).toBe('function');
      }
    }
  });
});

describe('workoutAnalytics barrel wires to the real implementations (#1053)', () => {
  test('buildTrackedLiftActivation anchors at the logged-session count', () => {
    const sections = parse('Monday\n-Face Pull\n30 12\n35 12');
    const record = wa.buildTrackedLiftActivation(sections, 'Face Pull', new Date('2026-08-26T12:00:00.000Z'));
    expect(record.anchor).toBe(2);
    expect(record.at).toBe('2026-08-26T12:00:00.000Z');
  });

  test('computeRepDropOff flags a heaviest-weight rep collapse', () => {
    expect(
      wa.computeRepDropOff([
        { weight_value: 100, rep_count: 8 },
        { weight_value: 100, rep_count: 5 },
      ])
    ).toBe('hit_wall');
    expect(
      wa.computeRepDropOff([
        { weight_value: 100, rep_count: 8 },
        { weight_value: 100, rep_count: 8 },
      ])
    ).toBeNull();
  });

  test('deriveSessionCheckIn returns the neutral shape with no tracked names', () => {
    expect(wa.deriveSessionCheckIn(parse('Monday\n-Bench\n135 5'), [])).toEqual({
      sessionIndex: null,
      isRough: false,
      detectors: [],
      flagged: [],
      metrics: { exercises_skipped: 0, volume_decline_pct: null },
    });
  });

  test('deriveTrackedPROccurrences reuses the shared occurrence primitives', () => {
    const sections = parse('-Bench\n135 5,5,5').map((s, i) => ({
      ...s, __noteId: 'n1', __noteOrdinal: 0, __sectionOrdinal: i,
    }));
    const entries = wa.deriveTrackedPROccurrences(sections, ['Bench']);
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.setOrdinal)).toEqual([0, 1, 2]);
  });

  test('deriveWorkoutNoteAnalytics returns the canonical result shape', () => {
    const result = wa.deriveWorkoutNoteAnalytics(parse('Monday\n-Bench\n135 5,5,5'), ['Bench']);
    expect(result).toHaveProperty('weeksIn');
    expect(result).toHaveProperty('classifications');
    expect(result).toHaveProperty('signals');
    expect(result.nameDisplayMap).toBeInstanceOf(Map);
  });
});
