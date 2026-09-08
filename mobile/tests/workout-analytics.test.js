import { parseWorkoutNote } from '../lib/parser';
import { deriveWorkoutNoteAnalytics, buildTrackedLiftActivation } from '../lib/data/workoutAnalytics';
import { deriveProgressionSuggestions } from '../lib/data/progressionSuggestions';
import { captureDeloadWorkingContext, buildDeloadReentryRecord } from '../lib/parser/deloadHistory';

const sections = text => parseWorkoutNote(text).sections;
const bench = rows => sections(`Monday\n-Bench Press: 3x8-10\n${rows}`);
const BEFORE = bench('135 10,10,10\n135 10,10,10');
const RETURN = bench('135 10,10,10\n135 10,10,10\n135 8,8,8');
const record = () => buildDeloadReentryRecord({ id: 'dl1', completed_at: '2026-09-01T12:00:00Z', raw_text: 'deload text' }, captureDeloadWorkingContext(BEFORE, 'routine1'), BEFORE);
const options = history => ({ sourceNoteId: 'routine1', deloadHistory: history });

describe('progression evidence at the workout analytics boundary (#959)', () => {
  test.each([
    ['weighted ceiling', '-Bench Press: 3x8-10\n135 10,10,10\n135 10,10,10', 'Bench Press', true],
    ['climbing reps', '-Bench Press: 3x8-10\n135 8,8,8\n135 10,9,8', 'Bench Press', false],
    ['missing history', '-Bench Press: 3x8-10\n135 10,10,10', 'Bench Press', false],
    ['skipped week', '-Squat: 3x5-5\n225 5,5,5\n-\n225 5,5,5', 'Squat', true],
    ['bodyweight ceiling', '-Pull-ups: 3x8-12\n12,12,12\n12,12,12', 'Pull-ups', true],
    ['kg provenance', '-Deadlift: 3x5-5\n100kg 5,5,5\n220 5,5,5', 'Deadlift', true],
    ['regressing', '-Squat: 3x5-5\n225 5,5,5\n215 5,5,5\n205 5,5,5', 'Squat', false],
  ])('%s uses the existing rule and real parser', (_, text, name, suggested) => {
    const parsed = sections(text);
    expect(parsed.flatMap(s => s.exercises)).toHaveLength(1);
    const result = deriveWorkoutNoteAnalytics(parsed, [name]);
    expect(result.progressionSuggestions).toEqual(deriveProgressionSuggestions(parsed, [name], { anchors: {} }));
    expect(result.progressionSuggestions[0].suggested).toBe(suggested);
    expect(result.reentry).toEqual({});
  });

  test('bodyweight latest_top_weight remains a rep count, never a proposed load', () => {
    const result = deriveWorkoutNoteAnalytics(sections('-Pull-ups: 3x8-12\n12,12,12\n12,12,12'), ['Pull-ups']);
    expect(result.signals[0]).toMatchObject({ is_bodyweight: true, latest_top_weight: 12 });
    expect(result.progressionSuggestions[0].evidence.is_bodyweight).toBe(true);
    expect(result.progressionSuggestions[0].explanation).not.toContain('lb');
    expect(result.progressionSuggestions[0].heuristic.suggested_weight).toBeNull();
  });

  test('tracked-span activation still suppresses a comparison crossing the activation boundary', () => {
    const activations = { 'bench press': buildTrackedLiftActivation(BEFORE, 'Bench Press') };
    const result = deriveWorkoutNoteAnalytics(RETURN, ['Bench Press'], undefined, activations);
    expect(result.signals[0].progression_status).toBe('first_session');
    expect(result.progressionSuggestions[0].suggested).toBe(false);
  });

  test('active Recovery suppresses both double progression and re-entry for covered exercises', () => {
    const recoveryBlocks = [{ id: 'active', completed_at: null, deleted_at: null, baseline: { exercises: [{ key: 'bench press' }] } }];
    const result = deriveWorkoutNoteAnalytics(RETURN, ['Bench Press'], undefined, null, { ...options([record()]), recoveryBlocks });
    expect(result.reentry).toEqual({});
    expect(result.progressionSuggestions[0]).toMatchObject({ suggested: false, reason: 'recovery_active' });
  });

  test('missing sections keep an empty evidence result', () => {
    expect(deriveWorkoutNoteAnalytics(null, ['Bench Press'])).toMatchObject({ progressionSuggestions: [], reentry: {} });
  });
});

describe('post-deload re-entry is additive context (#959)', () => {
  test('first working session back has an explicit explanation instead of a suggestion to increase load', () => {
    const result = deriveWorkoutNoteAnalytics(RETURN, ['Bench Press'], undefined, null, options([record()]));
    expect(result.reentry['bench press']).toMatchObject({ status: 're_entry', pre_deload_working_weight_lb: 135, current_working_weight_lb: 135 });
    expect(result.progressionSuggestions[0]).toMatchObject({ kind: 're_entry', suggested: false, heuristic: null });
    expect(result.progressionSuggestions[0].explanation).toBe('First working session back at your pre-deload working weight (135 lb). This is re-entry context, not a progression trend.');
    // Existing classifications and capability math remain identical. A future
    // UI can show the additive context without rewriting historical signals.
    const legacy = deriveWorkoutNoteAnalytics(RETURN, ['Bench Press']);
    expect(result.signals).toEqual(legacy.signals);
    expect(result.classifications).toEqual(legacy.classifications);
    expect(result.perDaySignals).toEqual(legacy.perDaySignals);
  });

  test('a lighter first session reports both observed loads without claiming a return at baseline', () => {
    const result = deriveWorkoutNoteAnalytics(bench('135 10,10,10\n135 10,10,10\n125 8,8,8'), ['Bench Press'], undefined, null, options([record()]));
    expect(result.progressionSuggestions[0].explanation).toBe('First working session after deload: 125 lb; your recorded pre-deload working weight was 135 lb. This is re-entry context, not a progression trend.');
  });

  test('the second working session resumes the existing progression rule', () => {
    const after = bench('135 10,10,10\n135 10,10,10\n135 10,10,10\n135 10,10,10');
    const result = deriveWorkoutNoteAnalytics(after, ['Bench Press'], undefined, null, options([record()]));
    expect(result.reentry).toEqual({});
    expect(result.progressionSuggestions[0].suggested).toBe(true);
  });

  test('skips, unparsed rows and warmups do not consume the first working return', () => {
    const after = bench('135 10,10,10\n135 10,10,10\n-\nunknown\n135 8,8,8\n+Warmup\n-Bench Press\n45 10,10,10');
    const result = deriveWorkoutNoteAnalytics(after, ['Bench Press'], undefined, null, options([record()]));
    expect(result.reentry['bench press'].current_working_weight_lb).toBe(135);
    expect(result.signals[0].latest_top_weight).toBe(135);
  });

  test('a new Track activation after the return excludes even re-entry context', () => {
    const activations = { 'bench press': buildTrackedLiftActivation(RETURN, 'Bench Press') };
    const result = deriveWorkoutNoteAnalytics(RETURN, ['Bench Press'], undefined, activations, options([record()]));
    expect(result.reentry).toEqual({});
    expect(result.progressionSuggestions[0].suggested).toBe(false);
  });
});
