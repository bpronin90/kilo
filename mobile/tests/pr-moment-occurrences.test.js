import { parseWorkoutNote } from '../lib/parser';
import { deriveTrackedPROccurrences } from '../lib/data/workoutAnalytics';
import { tagNoteSections } from '../screens/analytics/analyticsDerivations';
import { detectPRMoment } from '../lib/prMoment';

function tag(text, noteId = 'n1') {
  const { sections } = parseWorkoutNote(text);
  return sections.map((s, i) => ({ ...s, __noteId: noteId, __noteOrdinal: 0, __sectionOrdinal: i }));
}

describe('deriveTrackedPROccurrences (#577 Contract 3)', () => {
  test('returns per-set entries with note-aware coordinates', () => {
    const sections = tag('-Bench\n135 5,5,5', 'noteA');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    expect(entries.length).toBe(3);
    for (const e of entries) {
      expect(e.noteId).toBe('noteA');
      expect(e.exerciseKey).toBeTruthy();
      expect(e.epley).toBeCloseTo(135 * (1 + 5 / 30));
    }
    expect(entries.map((e) => e.setOrdinal)).toEqual([0, 1, 2]);
  });

  test('warmup-kind occurrences are excluded from the returned entries', () => {
    const sections = tag('Monday\n+Warmup\n-Bench\n95 8\n+Lifting\n-Bench\n135 5');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    // Only the non-warmup 135x5 set should survive.
    expect(entries.length).toBe(1);
    expect(entries[0].weight_value).toBe(135);
  });

  test('skipped sets never produce an entry', () => {
    const sections = tag('-Bench\n135 5,-');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    expect(entries.length).toBe(1);
    expect(entries[0].rep_count).toBe(5);
  });

  test('two notes tagged separately never collide on exerciseKey+noteId', () => {
    const sectionsA = tag('-Bench\n135 5', 'noteA');
    const sectionsB = tag('-Bench\n225 5', 'noteB');
    const entries = deriveTrackedPROccurrences([...sectionsA, ...sectionsB], ['Bench']);
    expect(entries.length).toBe(2);
    const byNote = Object.fromEntries(entries.map((e) => [e.noteId, e.weight_value]));
    expect(byNote.noteA).toBe(135);
    expect(byNote.noteB).toBe(225);
  });

  test('an untracked exercise name produces no entries', () => {
    const sections = tag('-Squat\n225 5');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    expect(entries).toEqual([]);
  });

  test('a non-strength (bodyweight/cardio) exercise name is excluded', () => {
    const sections = tag('-Bike\n5 min 9');
    const entries = deriveTrackedPROccurrences(sections, ['Bike']);
    expect(entries).toEqual([]);
  });

  test('occurrenceOrdinal is stable across multiple occurrences of the same exercise', () => {
    const sections = tag('Monday\n-Bench\n135 5\nWednesday\n-Bench\n145 5');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    expect(entries.length).toBe(2);
    expect(entries[0].occurrenceOrdinal).toBe(0);
    expect(entries[1].occurrenceOrdinal).toBe(1);
  });
});

describe('tagNoteSections', () => {
  test('tags each note\'s sections with its own noteId/noteOrdinal/sectionOrdinal', () => {
    const notes = [
      { id: 'n1', raw_text: '-Bench\n135 5' },
      { id: 'n2', raw_text: 'Monday\n-Squat\n225 5\nWednesday\n-Squat\n235 5' },
    ];
    const tagged = tagNoteSections(notes);
    expect(tagged.filter((s) => s.__noteId === 'n1').every((s) => s.__noteOrdinal === 0)).toBe(true);
    expect(tagged.filter((s) => s.__noteId === 'n2').every((s) => s.__noteOrdinal === 1)).toBe(true);
    const n2Ordinals = tagged.filter((s) => s.__noteId === 'n2').map((s) => s.__sectionOrdinal);
    expect(n2Ordinals).toEqual([...n2Ordinals].sort((a, b) => a - b));
  });

  test('a note with no id falls back to the "current:new" sentinel', () => {
    const tagged = tagNoteSections([{ raw_text: '-Bench\n135 5' }]);
    expect(tagged[0].__noteId).toBe('current:new');
  });

  test('does not mutate deriveParsedSections output shape (additive tags only)', () => {
    const notes = [{ id: 'n1', raw_text: '-Bench\n135 5' }];
    const tagged = tagNoteSections(notes);
    expect(tagged[0]).toHaveProperty('heading');
    expect(tagged[0]).toHaveProperty('exercises');
  });
});

// #577 gap fix: adversarial/stale activation fixtures, matching
// resolveTrackedLiftAnchors' own (unverified, clamp-only) read-side
// behavior exactly — deriveTrackedPROccurrences must never diverge from it.
describe('deriveTrackedPROccurrences — activation/watermark edge cases', () => {
  test('an anchor larger than the logged-session count clamps to that count rather than excluding everything', () => {
    const sections = tag('-Bench\n135 5\n145 5\n155 5'); // 3 logged sessions
    const activations = { bench: { anchor: 100, at: '2024-01-01T00:00:00.000Z' } };
    const clamped = deriveTrackedPROccurrences(sections, ['Bench'], activations);
    // Clamp to 3 means "drop the first 3" -> nothing left, not an error and
    // not "drop nothing" — matches resolveTrackedLiftAnchors' own
    // Math.min(raw, loggedSessionUnits(...).length) clamp.
    expect(clamped).toEqual([]);
  });

  test('a non-positive or non-integer anchor is treated as no watermark (full history)', () => {
    const sections = tag('-Bench\n135 5\n145 5');
    for (const anchor of [0, -5, 1.5, 'not-a-number', null]) {
      const activations = { bench: { anchor, at: '2024-01-01T00:00:00.000Z' } };
      const entries = deriveTrackedPROccurrences(sections, ['Bench'], activations);
      expect(entries.length).toBe(2);
    }
  });

  test('a malformed activations map (not an object, or a record missing required fields) never throws — treated as no watermark', () => {
    const sections = tag('-Bench\n135 5');
    expect(() => deriveTrackedPROccurrences(sections, ['Bench'], null)).not.toThrow();
    expect(() => deriveTrackedPROccurrences(sections, ['Bench'], undefined)).not.toThrow();
    expect(() => deriveTrackedPROccurrences(sections, ['Bench'], 'garbage')).not.toThrow();
    expect(() => deriveTrackedPROccurrences(sections, ['Bench'], { bench: 'garbage' })).not.toThrow();
    expect(deriveTrackedPROccurrences(sections, ['Bench'], { bench: 'garbage' }).length).toBe(1);
  });

  test('an activation record for an exercise absent from this population contributes no anchor and no error', () => {
    const sections = tag('-Bench\n135 5');
    const activations = { squat: { anchor: 5, at: '2024-01-01T00:00:00.000Z' } };
    const entries = deriveTrackedPROccurrences(sections, ['Bench'], activations);
    expect(entries.length).toBe(1);
  });

  test('an anchor of exactly the logged-session count excludes all prior history, matching the resolver boundary exactly', () => {
    const sections = tag('-Bench\n135 5\n145 5\n155 5'); // 3 sessions
    const activations = { bench: { anchor: 3, at: '2024-01-01T00:00:00.000Z' } };
    expect(deriveTrackedPROccurrences(sections, ['Bench'], activations)).toEqual([]);
  });

  test('an anchor of count-minus-one keeps exactly the most recent session', () => {
    const sections = tag('-Bench\n135 5\n145 5\n155 5');
    const activations = { bench: { anchor: 2, at: '2024-01-01T00:00:00.000Z' } };
    const entries = deriveTrackedPROccurrences(sections, ['Bench'], activations);
    expect(entries.length).toBe(1);
    expect(entries[0].weight_value).toBe(155);
  });

  test('a duplicate activation record for the same canonical key (case/whitespace variants) resolves via the newest `at`, matching _dedupeByCanonicalKey', () => {
    const sections = tag('-Bench\n135 5\n145 5\n155 5');
    const activations = {
      Bench: { anchor: 1, at: '2024-01-01T00:00:00.000Z' },
      bench: { anchor: 2, at: '2024-06-01T00:00:00.000Z' }, // newer — wins
    };
    const entries = deriveTrackedPROccurrences(sections, ['Bench'], activations);
    expect(entries.length).toBe(1);
    expect(entries[0].weight_value).toBe(155);
  });
});

// #577 gap fix: boundary-unready suppression at the caller level (the
// contract's "if the boundary is not ready at Done, suppress for that
// Done" requirement) is implemented as a blanket try/catch in
// useLogCurrentRoutineEditor.js's computePendingPRCandidate around the
// whole aggregate-build/detection pipeline — any failure there, including a
// recovery-boundary read failure, yields no candidate rather than a
// possibly-wrong one. That behavior is exercised at the hook level in
// pr-moment-editor.test.js; this file only covers the pure derivation
// layer, which has no "readiness" concept of its own (deriveParsedSections
// itself has none either — readiness is a hook-level/render concept).

// #577 review (Codex, post-freeze) — finding 2: setOrdinal must be a
// running count across a WHOLE occurrence, not reset per logged row
// (session unit), or an appended row's set can collide with an earlier
// row's set at the same ordinal and get misread as a historical edit.
describe('deriveTrackedPROccurrences — set ordinal stability across multiple rows in one occurrence (#577 review)', () => {
  test('two logged rows in the same occurrence get non-colliding, source-ordered setOrdinals', () => {
    // One occurrence (single section, single exercise), two separate
    // logged rows: "135 5,5" (2 sets) then "200 5" (1 set) appended after.
    const sections = tag('-Bench\n135 5,5\n200 5');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    expect(entries.length).toBe(3);
    // Exactly the reviewer's example: must NOT be [0, 1, 0].
    expect(entries.map((e) => e.setOrdinal)).toEqual([0, 1, 2]);
    expect(entries.map((e) => e.weight_value)).toEqual([135, 135, 200]);
  });

  test('the exact reviewer scenario: appending 200 5 after 135 5,5 is a legitimate PR, not a suppressed historical edit', () => {
    const before = deriveTrackedPROccurrences(tag('-Bench\n135 5,5'), ['Bench']);
    const after = deriveTrackedPROccurrences(tag('-Bench\n135 5,5\n200 5'), ['Bench']);
    const result = detectPRMoment(before, after, 'n1');
    expect(result).not.toBeNull();
    expect(result.weight_value).toBe(200);
  });
});

// #577 review (Codex, post-freeze) — finding 1: the tracked-lift
// activation anchor must be resolved against the FULL (both A/B halves)
// population, never a week-restricted slice, or a legitimate anchor gets
// clamped down to the smaller active-only session count and
// sliceEntriesFromAnchor then drops everything, including a real PR.
describe('deriveTrackedPROccurrences — activation anchor resolved against the full population, not a restricted slice (#577 review)', () => {
  test('an anchor recorded while the OTHER (inactive) half held logged sessions is not clamped down by resolving against only the active half', () => {
    // Full note: week A has 1 Bench session, week B has 3 — 4 total. An
    // anchor of 2 (recorded when the exercise had 2 total logged sessions)
    // must resolve to 2 against the FULL 4-session population, not be
    // clamped to 1 by looking only at week A's own session count.
    const weekA = '-Bench\n135 5';
    const weekB = '-Bench\n100 5\n110 5\n120 5';
    const fullText = `${weekA}\n---\n${weekB}`;
    const fullSections = tag(fullText);
    const activations = { bench: { anchor: 2, at: '2024-01-01T00:00:00.000Z' } };

    // Resolving against the FULL population correctly keeps the last 2 of
    // the 4 logged sessions (both from week B) — this is the "resolve
    // against the full Analytics population" step the fix performs.
    const fullEntries = deriveTrackedPROccurrences(fullSections, ['Bench'], activations);
    expect(fullEntries.map((e) => e.weight_value)).toEqual([110, 120]);

    // Resolving against ONLY week A's session (the pre-fix bug) would
    // clamp the anchor to 1 and, on a 1-entry list, drop everything —
    // demonstrating the exact failure mode the fix avoids.
    const weekAOnlySections = tag(weekA);
    const weekAOnlyEntries = deriveTrackedPROccurrences(weekAOnlySections, ['Bench'], activations);
    expect(weekAOnlyEntries).toEqual([]); // the bug this fix works around, confirmed still true of the raw primitive
  });

  test('end-to-end reproduction: a genuine appended PR in the ACTIVE week (B) survives when the anchor is resolved+cut against the full population, and is silently lost by the old active-only-restricted approach', () => {
    // Week A (inactive) has 2 sessions; week B (active) has 3, soon 4 after
    // an appended PR. anchor=3 was recorded when the exercise had 3 total
    // logged sessions.
    const weekA = '-Bench\n90 5\n135 5';
    const weekBBefore = '-Bench\n100 5\n110 5\n120 5';
    const weekBAfter = '-Bench\n100 5\n110 5\n120 5\n999 5';
    const activations = { bench: { anchor: 3, at: '2024-01-01T00:00:00.000Z' } };

    // FIX (matches useLogCurrentRoutineEditor.js's computePendingPRCandidate):
    // resolve+cut against the FULL population, restrict to active week (B)
    // afterward via sectionOrdinal.
    const fullBefore = tag(`${weekA}\n---\n${weekBBefore}`);
    const fullAfter = tag(`${weekA}\n---\n${weekBAfter}`);
    const { weekBStartIndex } = parseWorkoutNote(`${weekA}\n---\n${weekBBefore}`);
    const restrictToB = (entries) => entries.filter((e) => e.sectionOrdinal >= weekBStartIndex);

    const fixedBefore = restrictToB(deriveTrackedPROccurrences(fullBefore, ['Bench'], activations));
    const fixedAfter = restrictToB(deriveTrackedPROccurrences(fullAfter, ['Bench'], activations));
    expect(fixedBefore.map((e) => e.weight_value)).toEqual([110, 120]); // 90 and 100 fall before the anchor cut
    expect(fixedAfter.map((e) => e.weight_value)).toEqual([110, 120, 999]);

    const fixedResult = detectPRMoment(fixedBefore, fixedAfter, 'n1');
    expect(fixedResult).not.toBeNull();
    expect(fixedResult.weight_value).toBe(999);

    // OLD (buggy) approach: resolve+cut directly against the ACTIVE-ONLY
    // (week B alone) sliced population — the anchor is applied to a list
    // that no longer contains week A's sessions, over-cutting by exactly
    // week A's count and silently losing the legitimate PR.
    const activeOnlyBefore = tag(weekBBefore);
    const activeOnlyAfter = tag(weekBAfter);
    const buggyBefore = deriveTrackedPROccurrences(activeOnlyBefore, ['Bench'], activations);
    const buggyAfter = deriveTrackedPROccurrences(activeOnlyAfter, ['Bench'], activations);
    expect(buggyBefore).toEqual([]); // over-cut: the whole active-only list is consumed
    const buggyResult = detectPRMoment(buggyBefore, buggyAfter, 'n1');
    expect(buggyResult).toBeNull(); // the exact suppression bug the fix resolves
  });
});
