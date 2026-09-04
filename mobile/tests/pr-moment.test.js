import { setFingerprint, detectPRMoment } from '../lib/prMoment';

// Minimal entry builder matching deriveTrackedPROccurrences' output shape.
function entry({ exerciseKey = 'bench', noteId = 'n1', occurrenceOrdinal = 0, setOrdinal = 0, weight_value, rep_count, skipped = false, kind = 'general' }) {
  const epley = skipped || !weight_value || !rep_count ? null : weight_value * (1 + rep_count / 30);
  return { exerciseKey, noteId, noteOrdinal: 0, sectionOrdinal: 0, occurrenceOrdinal, setOrdinal, weight_value, rep_count, skipped, kind, epley };
}

describe('setFingerprint', () => {
  test('two sets with identical comparable fields have the same fingerprint', () => {
    const a = { weight_value: 135, rep_count: 5, skipped: false, kind: 'general' };
    const b = { weight_value: 135, rep_count: 5, skipped: false, kind: 'general' };
    expect(setFingerprint(a)).toBe(setFingerprint(b));
  });

  test('an annotation-only difference does not change the fingerprint', () => {
    const a = { weight_value: 135, rep_count: 5, skipped: false, kind: 'general', annotation: { mark: null } };
    const b = { weight_value: 135, rep_count: 5, skipped: false, kind: 'general', annotation: { mark: 'PR' } };
    expect(setFingerprint(a)).toBe(setFingerprint(b));
  });

  test('a weight change changes the fingerprint', () => {
    const a = { weight_value: 135, rep_count: 5, skipped: false, kind: 'general' };
    const b = { weight_value: 140, rep_count: 5, skipped: false, kind: 'general' };
    expect(setFingerprint(a)).not.toBe(setFingerprint(b));
  });
});

describe('detectPRMoment — append-only frontier', () => {
  test('no baseline history for this exercise: appended work with no prior comparator never celebrates', () => {
    const before = [];
    const after = [entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 })];
    expect(detectPRMoment(before, after, 'n1')).toBeNull();
  });

  test('appending a new set to the unchanged latest occurrence that beats prior best celebrates', () => {
    const before = [entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 })];
    const after = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
      entry({ occurrenceOrdinal: 0, setOrdinal: 1, weight_value: 145, rep_count: 5 }),
    ];
    const result = detectPRMoment(before, after, 'n1');
    expect(result).not.toBeNull();
    expect(result.exerciseKey).toBe('bench');
    expect(result.weight_value).toBe(145);
  });

  test('appending a genuine new occurrence after an unchanged earlier one celebrates', () => {
    const before = [entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 })];
    const after = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
      entry({ occurrenceOrdinal: 1, setOrdinal: 0, weight_value: 145, rep_count: 5 }),
    ];
    const result = detectPRMoment(before, after, 'n1');
    expect(result.weight_value).toBe(145);
  });

  test('raising an OLD (non-latest) set is a historical edit — never celebrates, even though the aggregate maximum rises', () => {
    const before = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 100, rep_count: 5 }),
      entry({ occurrenceOrdinal: 1, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
    ];
    const after = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 500, rep_count: 5 }), // historical edit
      entry({ occurrenceOrdinal: 1, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
    ];
    expect(detectPRMoment(before, after, 'n1')).toBeNull();
  });

  test('inserting a historical row before the frontier is ambiguous and suppresses the exercise', () => {
    const before = [entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 100, rep_count: 5 })];
    const after = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 999, rep_count: 5 }), // inserted/different content at the same coordinate
      entry({ occurrenceOrdinal: 1, setOrdinal: 0, weight_value: 200, rep_count: 5 }), // even a real new PR after it
    ];
    expect(detectPRMoment(before, after, 'n1')).toBeNull();
  });

  test('reordering/deleting an old occurrence is ambiguous and suppresses the exercise', () => {
    const before = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 100, rep_count: 5 }),
      entry({ occurrenceOrdinal: 1, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
    ];
    // occurrence 0 vanished entirely from "after"
    const after = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
    ];
    expect(detectPRMoment(before, after, 'n1')).toBeNull();
  });

  test('a tie (equal, not strictly greater) does not celebrate', () => {
    const before = [entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 })];
    const after = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
      entry({ occurrenceOrdinal: 0, setOrdinal: 1, weight_value: 135, rep_count: 5 }), // identical epley
    ];
    expect(detectPRMoment(before, after, 'n1')).toBeNull();
  });

  test('a candidate that only matches a prior best logged in ANOTHER note never celebrates (aggregate maximum, not per-note)', () => {
    const before = [
      entry({ exerciseKey: 'bench', noteId: 'n1', occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
      entry({ exerciseKey: 'bench', noteId: 'n2', occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 200, rep_count: 5 }),
    ];
    const after = [
      entry({ exerciseKey: 'bench', noteId: 'n1', occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
      entry({ exerciseKey: 'bench', noteId: 'n1', occurrenceOrdinal: 0, setOrdinal: 1, weight_value: 180, rep_count: 5 }), // beats n1's own history but not n2's
      entry({ exerciseKey: 'bench', noteId: 'n2', occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 200, rep_count: 5 }),
    ];
    expect(detectPRMoment(before, after, 'n1')).toBeNull();
    // But truly beating the cross-note best does celebrate.
    const afterBeats = [
      ...after.filter((e) => e.noteId === 'n2'),
      entry({ exerciseKey: 'bench', noteId: 'n1', occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
      entry({ exerciseKey: 'bench', noteId: 'n1', occurrenceOrdinal: 0, setOrdinal: 1, weight_value: 250, rep_count: 5 }),
    ];
    const result = detectPRMoment(before, afterBeats, 'n1');
    expect(result).not.toBeNull();
    expect(result.weight_value).toBe(250);
  });

  test('duplicate identical fingerprints at different ordinals never create false ambiguity', () => {
    const before = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 100, rep_count: 5 }),
      entry({ occurrenceOrdinal: 0, setOrdinal: 1, weight_value: 100, rep_count: 5 }), // identical to the one above
    ];
    const after = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 100, rep_count: 5 }),
      entry({ occurrenceOrdinal: 0, setOrdinal: 1, weight_value: 100, rep_count: 5 }),
      entry({ occurrenceOrdinal: 0, setOrdinal: 2, weight_value: 200, rep_count: 5 }), // genuinely appended
    ];
    const result = detectPRMoment(before, after, 'n1');
    expect(result.weight_value).toBe(200);
  });

  test('an already-consumed exercise key is never re-celebrated', () => {
    const before = [entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 })];
    const after = [
      entry({ occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
      entry({ occurrenceOrdinal: 0, setOrdinal: 1, weight_value: 200, rep_count: 5 }),
    ];
    expect(detectPRMoment(before, after, 'n1', new Set(['bench']))).toBeNull();
  });

  test('multiple qualifying exercise keys pick the highest epley, deterministically tie-broken by exerciseKey', () => {
    const before = [
      entry({ exerciseKey: 'bench', occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
      entry({ exerciseKey: 'squat', occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 185, rep_count: 5 }),
    ];
    const after = [
      entry({ exerciseKey: 'bench', occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 135, rep_count: 5 }),
      entry({ exerciseKey: 'bench', occurrenceOrdinal: 0, setOrdinal: 1, weight_value: 400, rep_count: 5 }), // bigger epley
      entry({ exerciseKey: 'squat', occurrenceOrdinal: 0, setOrdinal: 0, weight_value: 185, rep_count: 5 }),
      entry({ exerciseKey: 'squat', occurrenceOrdinal: 0, setOrdinal: 1, weight_value: 200, rep_count: 5 }),
    ];
    const result = detectPRMoment(before, after, 'n1');
    expect(result.exerciseKey).toBe('bench');
  });
});
