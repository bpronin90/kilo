import { parseWorkoutNote } from '../lib/parser';
import { captureDeloadWorkingContext, buildDeloadReentryRecord, deriveDeloadReentry } from '../lib/parser/deloadHistory';

const parse = text => parseWorkoutNote(text).sections;
const BEFORE = parse('Monday\n-Bench Press: 3x8-10\n135 10,10,10');
const AFTER = parse('Monday\n-Bench Press: 3x8-10\n135 10,10,10\n135 8,8,8');
const newRecord = () => buildDeloadReentryRecord({ id: 'dl', completed_at: '2026-09-01T12:00:00Z' }, captureDeloadWorkingContext(BEFORE, 'source'), BEFORE);
const freeze = object => { Object.values(object).forEach(value => { if (value && typeof value === 'object') freeze(value); }); return Object.freeze(object); };

describe('deload context builders and legacy compatibility (#959)', () => {
  test('captured working weight uses the generator rule, canonical lb, and excludes warmup and bodyweight', () => {
    const sections = parse('Monday\n-Deadlift\n100kg 5,5 240 1\n-Pull-ups\n12,12\n+Warmup\n-Deadlift\n45 10,10');
    const captured = captureDeloadWorkingContext(sections, 'source');
    expect(captured.exercises.deadlift).toMatchObject({ working_weight_lb: 220, logged_session_count: 1 });
    expect(Object.keys(captured.exercises)).toEqual(['deadlift']);
  });

  test('new record construction does not mutate a note, captured context, prior record or parsed sections', () => {
    const captured = freeze(captureDeloadWorkingContext(BEFORE, 'source'));
    const record = freeze({ id: 'new', raw_text: 'deload', completed_at: '2026-09-01T12:00:00Z' });
    const original = JSON.stringify({ captured, record, sections: BEFORE });
    const output = buildDeloadReentryRecord(record, captured, freeze(BEFORE));
    expect(output).not.toBe(record);
    expect(output.pre_deload_context.exercises['bench press'].working_weight_lb).toBe(135);
    expect(JSON.stringify({ captured, record, sections: BEFORE })).toBe(original);
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });

  test('work logged during the deload is inside the completion boundary, with the original load retained', () => {
    const completedSections = parse('Monday\n-Bench Press\n135 10,10,10\n115 8,8,8');
    const completed = buildDeloadReentryRecord({ id: 'dl', completed_at: '2026-09-01T12:00:00Z' }, captureDeloadWorkingContext(BEFORE, 'source'), completedSections);
    expect(deriveDeloadReentry(completedSections, [completed], 'source')).toEqual({});
    const returned = parse('Monday\n-Bench Press\n135 10,10,10\n115 8,8,8\n135 8,8,8');
    expect(deriveDeloadReentry(returned, [completed], 'source')['bench press']).toMatchObject({ pre_deload_working_weight_lb: 135, logged_session_ordinal: 2 });
  });

  test.each([
    ['legacy', record => { delete record.pre_deload_context; }],
    ['unknown version', record => { record.pre_deload_context.version = 2; }],
    ['wrong routine', record => { record.pre_deload_context.source_note_id = 'another'; }],
    ['missing completion', record => { delete record.completed_at; }],
    ['invalid completion', record => { record.completed_at = 'invalid'; }],
    ['deleted history', record => { record.deleted_at = '2026-09-02'; }],
    ['unverified boundary', record => { delete record.pre_deload_context.exercises['bench press'].boundary_witness; }],
    ['invalid count', record => { record.pre_deload_context.exercises['bench press'].logged_session_count = -1; }],
    ['invalid weight', record => { record.pre_deload_context.exercises['bench press'].working_weight_lb = '135'; }],
  ])('%s records never manufacture re-entry evidence or rewrite history', (_, mutate) => {
    const record = newRecord(); mutate(record); const before = JSON.stringify(record);
    expect(deriveDeloadReentry(AFTER, [record], 'source')).toEqual({});
    expect(JSON.stringify(record)).toBe(before);
  });

  test('newer legacy history supersedes an older context record instead of reviving it', () => {
    const legacy = { id: 'later', completed_at: '2026-09-02T00:00:00Z', session_count: 1 };
    expect(deriveDeloadReentry(AFTER, [legacy, newRecord()], 'source')).toEqual({});
  });

  test('editing the boundary session invalidates the positional evidence', () => {
    const edited = parse('Monday\n-Bench Press\n140 10,10,10\n135 8,8,8');
    expect(deriveDeloadReentry(edited, [newRecord()], 'source')).toEqual({});
  });

  test('no source id, no history and no returned session each mean no re-entry', () => {
    expect(deriveDeloadReentry(AFTER, [newRecord()], null)).toEqual({});
    expect(deriveDeloadReentry(AFTER, [], 'source')).toEqual({});
    expect(deriveDeloadReentry(BEFORE, [newRecord()], 'source')).toEqual({});
  });
});
