import {
  applySelectedChanges,
  buildNormalizationPreview,
  diffTargetNames,
  splitNormalizationReply,
} from '../lib/interoperability/routineNormalizationImport';
import { applyWorkoutNoteTextBatchIfUnchanged, compareAndSetWorkoutNoteText as saveWorkoutNoteTextIfUnchanged } from '../storage/entries/workoutNotes';
import * as Storage from '../storage/entries';
import { canPickTextFile, pickTextFile } from '../lib/platformFilePicker';

jest.mock('../lib/reminderScheduler', () => ({ reconcileWorkoutReminder: () => Promise.resolve() }));

const AUTH = { id: 'auth', title: 'Upper', raw_text: 'Monday\n-Bench Press 3x5\n- 135 5,5,5' };
const T1 = { id: 't1', title: 'Upper', raw_text: 'Monday\n-bench press 3x5\n- 135 5,5,5 *\n-- elbows in\n---\nTuesday\n-Squat*\n- 185 -\n' };
const T2 = { id: 't2', title: 'Upper', raw_text: 'Friday\n-BB Bench 3x5\n- 140 5,5,5' };
const SNAP = { authority: AUTH, targets: [T1, T2] };
const NOTES = [AUTH, T1, T2];

const T1_OUT = 'Monday\n-Bench Press 3x5\n- 135 5,5,5 *\n-- elbows in\n---\nTuesday\n-Squat*\n- 185 -';
const T2_OUT = 'Friday\n-Bench Press 3x5\n- 140 5,5,5';
const reply = (...parts) => parts.join('\n\n');

describe('splitNormalizationReply', () => {
  test('ignores explanations and Markdown fences and accepts decorated labels', () => {
    const sections = splitNormalizationReply(`Sure! Here you go.\n\n**Target routine 2: Upper**\n\`\`\`\n${T2_OUT}\n\`\`\`\n### Target routine 1\n${T1_OUT}\n`);
    expect(sections.map(s => s.number)).toEqual([2, 1]);
    expect(sections[0].lines.join('\n')).toBe(T2_OUT);
  });
});

test('a fence-like line inside a routine is kept and validated', () => {
  const fenced = { ...T2, raw_text: 'Friday\n-BB Bench 3x5\n```\n- 140 5,5,5' };
  const out = '```\nTarget routine 1\n```\nFriday\n-Bench Press 3x5\n```\n- 140 5,5,5\n```';
  const preview = buildNormalizationPreview(out, { authority: AUTH, targets: [fenced] }, [AUTH, fenced]);
  expect(preview.entries[0].changes).toHaveLength(1);
});

describe('buildNormalizationPreview', () => {
  test('matches by reference label regardless of order and duplicate titles', () => {
    const preview = buildNormalizationPreview(reply('Target routine 2: Upper', T2_OUT, 'Target routine 1: Upper', T1_OUT), SNAP, NOTES);
    expect(preview.entries.map(e => [e.id, e.changes.map(c => `${c.oldName}>${c.newName}`)])).toEqual([
      ['t1', ['bench press>Bench Press']],
      ['t2', ['BB Bench>Bench Press']],
    ]);
    expect(preview.mappings).toEqual([
      expect.objectContaining({ oldName: 'bench press', newName: 'Bench Press', noteCount: 1 }),
      expect.objectContaining({ oldName: 'BB Bench', newName: 'Bench Press', noteCount: 1 }),
    ]);
  });

  test('valid names apply byte-identically outside headers, preserving CRLF and trailing newline', () => {
    const crlf = { ...T2, raw_text: 'Friday\r\n-BB Bench 3x5\r\n- 140 5,5,5\r\n' };
    const preview = buildNormalizationPreview(reply('Target routine 1', T1_OUT, 'Target routine 2', T2_OUT), { authority: AUTH, targets: [T1, crlf] }, [AUTH, T1, crlf]);
    const keys = new Set(preview.mappings.map(m => m.key));
    expect(applySelectedChanges(preview.entries[0], keys)).toBe(T1.raw_text.replace('-bench press', '-Bench Press'));
    expect(applySelectedChanges(preview.entries[1], keys)).toBe('Friday\r\n-Bench Press 3x5\r\n- 140 5,5,5\r\n');
  });

  test('deselected mappings are not applied', () => {
    const preview = buildNormalizationPreview(reply('Target routine 1', T1_OUT, 'Target routine 2', T2_OUT), SNAP, NOTES);
    const only = new Set([preview.mappings[1].key]);
    expect(applySelectedChanges(preview.entries[0], only)).toBeNull();
    expect(applySelectedChanges(preview.entries[1], only)).toBe(T2_OUT);
  });

  test('missing, duplicate, and unknown labels are reported per target; valid targets still proceed', () => {
    const missing = buildNormalizationPreview(reply('Target routine 2', T2_OUT, 'Target routine 7', T2_OUT), SNAP, NOTES);
    expect(missing.entries[0].problems[0]).toMatch(/No result labelled/);
    expect(missing.entries[1].changes).toHaveLength(1);
    expect(missing.unknown).toEqual([7]);
    const dup = buildNormalizationPreview(reply('Target routine 1', T1_OUT, 'Target routine 1', T1_OUT, 'Target routine 2', T2_OUT), SNAP, NOTES);
    expect(dup.entries[0].problems[0]).toMatch(/appears 2 times/);
  });

  test('an oversized reply is rejected before splitting', () => {
    const preview = buildNormalizationPreview(`Target routine 1\n${'x'.repeat(1024 * 1024)}`, SNAP, NOTES);
    expect(preview.tooLarge).toBe(true);
    expect(preview.entries).toEqual([]);
  });

  test('malformed output with no labels yields no applicable changes', () => {
    const preview = buildNormalizationPreview('I could not do this.', SNAP, NOTES);
    expect(preview.entries.every(e => e.problems)).toBe(true);
  });

  test('stale authority blocks the batch; stale target blocks only that target', () => {
    expect(buildNormalizationPreview(reply('Target routine 1', T1_OUT), SNAP, [{ ...AUTH, raw_text: 'x' }, T1, T2]).authorityStale).toBe(true);
    const preview = buildNormalizationPreview(reply('Target routine 1', T1_OUT, 'Target routine 2', T2_OUT), SNAP, [AUTH, { ...T1, raw_text: 'edited' }, T2]);
    expect(preview.entries[0].problems[0]).toMatch(/edited after/);
    expect(preview.entries[1].changes).toHaveLength(1);
  });
});

describe('diffTargetNames rejects structural edits disguised as renames', () => {
  const cases = {
    weight: T1_OUT.replace('135', '145'),
    reps: T1_OUT.replace('5,5,5 *', '5,5,4 *'),
    mark: T1_OUT.replace('5,5,5 *', '5,5,5'),
    headerMark: T1_OUT.replace('-Squat*', '-Back Squat'),
    comment: T1_OUT.replace('elbows in', 'elbows out'),
    weekday: T1_OUT.replace('Tuesday', 'Wednesday'),
    weekBoundary: T1_OUT.replace('---\n', ''),
    skipped: T1_OUT.replace('185 -', '185 5'),
    declaration: T1_OUT.replace('Bench Press 3x5', 'Bench Press 4x5'),
    reorder: 'Monday\n-Squat*\n- 185 -\n-- elbows in\n---\nTuesday\n-Bench Press 3x5\n- 135 5,5,5 *',
    headerToRow: T1_OUT.replace('-Squat*', '- Squat*'),
  };
  test.each(Object.entries(cases))('%s', (_name, returned) => {
    expect(diffTargetNames(T1.raw_text, returned.split('\n')).problems.length).toBeGreaterThan(0);
  });

  test('a spaced prescription folded into the name cannot change', () => {
    expect(diffTargetNames('Monday\n-Bench 3 x 5', ['Monday', '-Bench 4 x 5']).problems).toHaveLength(1);
    expect(diffTargetNames('Monday\n-Bench 3 x 5', ['Monday', '-Bench 3x 5']).problems).toHaveLength(1);
    expect(diffTargetNames('Monday\n-Bench3x5', ['Monday', '-Bench3-5']).problems).toHaveLength(1);
    expect(diffTargetNames('Monday\n-Bench 3x5', ['Monday', '-Bench3x5']).problems).toHaveLength(1);
    expect(diffTargetNames('Monday\n-bench3x5', ['Monday', '-Bench Press3x5']).changes).toHaveLength(1);
    expect(diffTargetNames('Monday\n-bench 3 x 5', ['Monday', '-Bench Press 3 x 5']).changes).toHaveLength(1);
  });

  test('casing and punctuation-only renames are allowed name changes', () => {
    const out = diffTargetNames('Monday\n-db row 3x8', ['Monday', '-DB Row, one-arm 3x8']);
    expect(out.changes).toEqual([expect.objectContaining({ oldName: 'db row', newName: 'DB Row, one-arm' })]);
  });
});

describe('descriptor comment moved out of a corrected header (#1201)', () => {
  const ORIG = 'Monday\n-Bench Press (paused) 3x5\n- 135 5,5,5\n- 140 5,5,5\n-Row 3x8\n- 100 8,8,8\n---\nTuesday\n-Squat (low bar) 3x5\n- 185 5,5,5\n-- felt heavy\n';
  const GOOD = 'Monday\n-Bench Press 3x5\n- 135 5,5,5\n- 140 5,5,5\n-- paused\n-Row 3x8\n- 100 8,8,8\n---\nTuesday\n-Squat 3x5\n- 185 5,5,5\n-- low bar\n-- felt heavy';
  const note = { id: 'd1', title: 'Upper', raw_text: ORIG };
  const MAIN = { id: 'auth', title: 'Main', raw_text: 'Monday\n-Bench Press 3x5\n-Bench\n-Squat 3x5' };
  const lines = text => text.split('\n');

  test('header rename plus one following comment is accepted, for multiple exercises', () => {
    const out = diffTargetNames(ORIG, lines(GOOD));
    expect(out.problems).toBeUndefined();
    expect(out.changes.map(c => `${c.oldName}>${c.newName}:${c.insert ? c.insert.line : ''}`)).toEqual([
      'Bench Press (paused)>Bench Press:-- paused',
      'Squat (low bar)>Squat:-- low bar',
    ]);
  });

  test('preview and apply splice the comment into the original text', () => {
    const preview = buildNormalizationPreview(`Target routine 1\n${GOOD}`, { authority: MAIN, targets: [note] }, [MAIN, note]);
    const keys = new Set(preview.mappings.map(m => m.key));
    expect(applySelectedChanges(preview.entries[0], keys)).toBe(`${GOOD}\n`);
    const onlyBench = new Set([preview.mappings[0].key]);
    expect(applySelectedChanges(preview.entries[0], onlyBench)).toBe(ORIG.replace('(paused) ', '').replace('140 5,5,5\n', '140 5,5,5\n-- paused\n'));
  });

  test('CRLF originals keep CRLF on the inserted line', () => {
    const crlf = { ...note, raw_text: 'Monday\r\n-Bench (x) 3x5\r\n- 135 5,5,5\r\n' };
    const preview = buildNormalizationPreview('Target routine 1\nMonday\n-Bench 3x5\n- 135 5,5,5\n-- x', { authority: MAIN, targets: [crlf] }, [MAIN, crlf]);
    expect(applySelectedChanges(preview.entries[0], new Set(preview.mappings.map(m => m.key)))).toBe('Monday\r\n-Bench 3x5\r\n- 135 5,5,5\r\n-- x\r\n');
  });

  const bad = {
    reorder: GOOD.replace('-Row 3x8\n- 100 8,8,8\n', '').replace('-Bench Press 3x5', '-Row 3x8\n- 100 8,8,8\n-Bench Press 3x5'),
    exerciseRemoved: GOOD.replace('-Row 3x8\n- 100 8,8,8\n', ''),
    exerciseAdded: GOOD.replace('---', '-Curl 3x8\n- 30 8,8,8\n---'),
    setRemoved: GOOD.replace('- 140 5,5,5\n', ''),
    setAdded: GOOD.replace('- 100 8,8,8', '- 100 8,8,8\n- 100 8,8,8'),
    weight: GOOD.replace('135', '145'),
    reps: GOOD.replace('100 8,8,8', '100 8,8,7'),
    unrelatedComment: GOOD.replace('---\nTuesday', '-- new note\n---\nTuesday'),
    misplacedComment: GOOD.replace('- 135 5,5,5\n- 140 5,5,5\n-- paused', '- 135 5,5,5\n-- paused\n- 140 5,5,5'),
    beforeHeader: GOOD.replace('-Bench Press 3x5', '-- paused\n-Bench Press 3x5').replace('\n-- paused\n-Row', '\n-Row'),
    duplicateComment: GOOD.replace('-- paused', '-- paused\n-- paused'),
    multipleComments: GOOD.replace('-- paused', '-- paused\n-- more'),
    uncorrectedHeader: ORIG.replace('- 185 5,5,5', '- 185 5,5,5\n-- extra'),
    dividerInserted: GOOD.replace('-- paused', '---'),
    emptyComment: GOOD.replace('-- paused', '-- '),
    extraLine: `${GOOD}\n- 1 1`,
  };
  test.each(Object.entries(bad))('rejects %s', (_name, returned) => {
    expect(diffTargetNames(ORIG, lines(returned)).problems.length).toBeGreaterThan(0);
  });

  test('a parser-excluded "| descriptor" suffix can move into the comment', () => {
    const orig = 'Monday\n-Bench | paused 3x5\n- 135 5,5,5';
    const out = diffTargetNames(orig, ['Monday', '-Bench Press 3x5', '- 135 5,5,5', '-- paused']);
    expect(out.problems).toBeUndefined();
    expect(out.changes).toEqual([expect.objectContaining({ oldName: 'Bench', newName: 'Bench Press', insert: expect.objectContaining({ line: '-- paused' }) })]);
    // Dropping that descriptor without preserving it is data loss, so it is rejected.
    expect(diffTargetNames(orig, ['Monday', '-Bench Press 3x5', '- 135 5,5,5']).problems).toHaveLength(1);
    // Digits inside the shed descriptor are preserved under the same rule.
    const digits = diffTargetNames('Monday\n-Bench | 2 sec pause 3x5\n- 135 5,5,5', ['Monday', '-Bench Press 3x5', '- 135 5,5,5', '-- 2 sec pause']);
    expect(digits.problems).toBeUndefined();
    expect(digits.changes[0].insert.line).toBe('-- 2 sec pause');
    expect(diffTargetNames('Monday\n-Bench | 2 sec pause 3x5\n- 135 5,5,5', ['Monday', '-Bench Press 3x5', '- 135 5,5,5']).problems).toHaveLength(1);
    expect(diffTargetNames('Monday\n-Bench | 2 sec pause 3x5\n- 135 5,5,5', ['Monday', '-Bench Press 4x5', '- 135 5,5,5', '-- 2 sec pause']).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-Bench | 2 sec pause 3x5\n- 135 5,5,5', ['Monday', '-Bench Press 3x5', '- 135 5,5,5', '-- 3 sec pause']).problems.length).toBeGreaterThan(0);
  });

  test('an invented or unrelated comment is rejected', () => {
    const alias = 'Monday\n-BB Bench 3x5\n- 135 5,5,5';
    expect(diffTargetNames(alias, ['Monday', '-Bench Press 3x5', '- 135 5,5,5', '-- increase weight']).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames(alias, ['Monday', '-Bench Press 3x5', '- 135 5,5,5', '-- BB Bench']).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames(ORIG, lines(GOOD.replace('-- paused', '-- increase weight'))).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames(ORIG, lines(GOOD.replace('-- low bar', '-- low bar heavy'))).problems.length).toBeGreaterThan(0);
  });

  test('dropping a descriptor without its comment is rejected; an unchanged target stays valid (#1383)', () => {
    expect(diffTargetNames(ORIG, lines(GOOD.replace(/\n-- (paused|low bar)/g, ''))).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames(ORIG, lines(ORIG.trimEnd())).changes).toEqual([]);
  });
});

describe('owner regression fixture: one intended header correction (#1210)', () => {
  const AUTHORITY = { id: 'auth', title: 'Summer 2026 Routine', raw_text: 'MONDAY — Push\n+LIFTING (~30 min)\n-DB Bench Press 3x6-8\n100 8,8,7\n-Lateral Raise 2x12\n25 12,12' };
  const TARGET = { id: 'rehab', title: 'Rehab 3', raw_text: 'MONDAY — Push\n+LIFTING\n-DB Bench press 3x6-8\n85 8,8 90 8\n-Lateral Raise 2x12\n20 12,12\n-Squat 3x8\n95 10, 165 8,8,8\n-- keep it slow\n---\nTUESDAY — Pull\n-Dead bugs 2x10\n' };
  const snap = { authority: AUTHORITY, targets: [TARGET] };
  const notes = [AUTHORITY, TARGET];
  const FIXED = TARGET.raw_text.replace('DB Bench press', 'DB Bench Press');
  const GOOD = FIXED.trimEnd();
  const preview = out => buildNormalizationPreview(`Target routine 1: Rehab 3\n${out}`, snap, notes);

  test('exactly one mapping is proposed and everything else stays byte-identical', () => {
    const p = preview(GOOD);
    expect(p.mappings).toEqual([expect.objectContaining({ oldName: 'DB Bench press', newName: 'DB Bench Press' })]);
    expect(applySelectedChanges(p.entries[0], new Set(p.mappings.map(m => m.key)))).toBe(FIXED);
  });

  test('an unchanged reply proposes no change and writes nothing', () => {
    const p = preview(TARGET.raw_text);
    expect(p.entries[0].changes).toEqual([]);
    expect(p.mappings).toEqual([]);
    expect(applySelectedChanges(p.entries[0], new Set())).toBeNull();
  });

  test('an incorrect rename of an ambiguous header is listed and stays unapplied when deselected', () => {
    const p = preview(GOOD.replace('-Squat 3x8', '-Single-Leg Press 3x8'));
    expect(p.mappings.map(m => `${m.oldName}>${m.newName}`)).toEqual(['DB Bench press>DB Bench Press', 'Squat>Single-Leg Press']);
    expect(applySelectedChanges(p.entries[0], new Set([p.mappings[0].key]))).toBe(FIXED);
  });

  test('a rename that also edits a prescription, set, comment, or boundary is rejected', () => {
    for (const bad of [GOOD.replace('3x6-8', '3x8'), GOOD.replace('85 8,8', '95 8,8'), GOOD.replace('keep it slow', 'go fast'), GOOD.replace('---\n', ''), GOOD.replace('+LIFTING', '+LIFT')]) {
      expect(preview(bad).entries[0].problems.length).toBeGreaterThan(0);
    }
  });
});

describe('saveWorkoutNoteTextIfUnchanged', () => {
  beforeEach(async () => { await Storage.replaceWorkoutNotesRaw([]); });

  test('writes only while the note still holds the prompt snapshot', async () => {
    await Storage.saveWorkoutNoteItem({ ...T2, recovery_block_id: 'blk' });
    expect(await saveWorkoutNoteTextIfUnchanged('t2', T2.raw_text, T2_OUT)).toBe('saved');
    const saved = (await Storage.loadWorkoutNotes()).find(n => n.id === 't2');
    expect(saved.raw_text).toBe(T2_OUT);
    expect(saved.recovery_block_id).toBe('blk');
    // Retry after an interrupted write/enqueue: already-landed text is rewritten, not rejected.
    expect(await saveWorkoutNoteTextIfUnchanged('t2', T2.raw_text, T2_OUT)).toBe('saved');
  });

  test('never overwrites newer text or resurrects a missing note', async () => {
    await Storage.saveWorkoutNoteItem({ ...T2, raw_text: 'newer' });
    expect(await saveWorkoutNoteTextIfUnchanged('t2', T2.raw_text, T2_OUT)).toBe('stale');
    expect((await Storage.loadWorkoutNotes()).find(n => n.id === 't2').raw_text).toBe('newer');
    expect(await saveWorkoutNoteTextIfUnchanged('gone', 'a', 'b')).toBe('missing');
  });
});

describe('platformFilePicker (native)', () => {
  const fileReading = body => jest.fn().mockImplementation(function File(asset) { this.asset = asset; this.text = async () => body; });

  test('android and ios offer file picking', () => {
    expect(canPickTextFile({ platform: 'android' })).toBe(true);
    expect(canPickTextFile({ platform: 'ios' })).toBe(true);
  });

  test('reads the cached copy locally and returns null on cancel', async () => {
    const documentPicker = { getDocumentAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/r.txt', size: 10 }] }) };
    const File = fileReading('Target routine 1');
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('fetch must not be used'); });
    await expect(pickTextFile({ platform: 'android', documentPicker, File })).resolves.toBe('Target routine 1');
    expect(documentPicker.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ copyToCacheDirectory: true }));
    expect(File).toHaveBeenCalledWith('file:///cache/r.txt');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    documentPicker.getDocumentAsync.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickTextFile({ platform: 'ios', documentPicker, File })).resolves.toBeNull();
  });

  test('rejects oversized files', async () => {
    const documentPicker = { getDocumentAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x', size: 5 * 1024 * 1024 }] }) };
    await expect(pickTextFile({ platform: 'android', documentPicker, File: fileReading('') })).rejects.toThrow(/too large/);
  });
});

describe('owner descriptor examples apply through the batch write (#1383)', () => {
  const AUTHORITY = { id: 'a1383', title: 'Lower', raw_text: 'MONDAY — Lower\n-Single-Leg RDL\n-DB Bench Press 3x6-8\n-Lat Pulldown\n-Deadlift' };
  const ORIG = [
    'MONDAY — Lower', '+WARMUP', '-Plank', '+LIFTING',
    '-Single-Leg RDL 2x8 each leg, light', '25 8,8', '-- existing note', '- 30 8 *PR',
    '-DB Bench Press 3x6-8, step up', '85 8,8,8', '90 -', '-- felt good',
    '-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)',
    '-Deadlift — trial sets, slow and controlled', '135 5,5', '-',
    '---', 'MONDAY — Lower', '-Single-Leg RDL 2x8 each leg', '- 20 8,8', '',
  ].join('\n');
  const RESULT = [
    'MONDAY — Lower', '+WARMUP', '-Plank', '+LIFTING',
    '-Single-Leg RDL 2x8', '25 8,8', '-- existing note', '- 30 8 *PR', '-- each leg, light',
    '-DB Bench Press 3x6-8', '85 8,8,8', '90 -', '-- step up', '-- felt good',
    '-Lat Pulldown 2x10-12', '-- pack shoulder down on eccentric',
    '-Deadlift', '135 5,5', '-', '-- trial sets, slow and controlled',
    '---', 'MONDAY — Lower', '-Single-Leg RDL 2x8', '- 20 8,8', '-- each leg', '',
  ].join('\n');
  const TARGET = { id: 'b1383', title: 'Lower', raw_text: ORIG };
  const TWIN = { id: 'c1383', title: 'Lower', raw_text: 'MONDAY — Lower\n-DB Bench Press 3x6-8, step up\n85 8,8,8' };
  const snap = { authority: AUTHORITY, targets: [TARGET, TWIN] };
  const notes = [AUTHORITY, TARGET, TWIN];
  const TWIN_OUT = 'MONDAY — Lower\n-DB Bench Press 3x6-8\n85 8,8,8\n-- step up';
  const replyFor = (out, twin = TWIN.raw_text) => `Target routine 2: Lower\n${twin}\n\nTarget routine 1: Lower\n${out}`;
  const keysOf = p => new Set(p.mappings.map(m => m.key));

  beforeEach(async () => { await Storage.replaceWorkoutNotesRaw([]); });

  test('all four examples (bare, dashed, skip rows; no-set; repeats) reach the store byte-exactly', async () => {
    const p = buildNormalizationPreview(replyFor(RESULT.trimEnd(), TWIN_OUT), snap, notes);
    expect(p.entries.map(e => e.problems)).toEqual([undefined, undefined]);
    expect(p.mappings.map(m => `${m.oldName}>${m.newName}`)).toEqual([
      'Single-Leg RDL 2x8 each leg, light>Single-Leg RDL',
      'DB Bench Press 3x6-8, step up>DB Bench Press',
      'Lat Pulldown 2x10-12 (pack shoulder down on eccentric)>Lat Pulldown',
      'Deadlift — trial sets, slow and controlled>Deadlift',
      'Single-Leg RDL 2x8 each leg>Single-Leg RDL',
    ]);
    const items = p.entries.map(entry => ({ id: entry.id, expected_raw_text: entry.snapshot, next_raw_text: applySelectedChanges(entry, keysOf(p)) }));
    expect(items).toEqual([
      { id: 'b1383', expected_raw_text: ORIG, next_raw_text: RESULT },
      { id: 'c1383', expected_raw_text: TWIN.raw_text, next_raw_text: TWIN_OUT },
    ]);
    for (const note of notes) await Storage.saveWorkoutNoteItem(note);
    const request = { authority: { id: AUTHORITY.id, expected_raw_text: AUTHORITY.raw_text, accepted_raw_texts: [] }, items };
    const result = await applyWorkoutNoteTextBatchIfUnchanged(request);
    expect(result.saved.map(r => r.id)).toEqual(['b1383', 'c1383']);
    const stored = await Storage.loadWorkoutNotes();
    expect(stored.find(n => n.id === 'b1383').raw_text).toBe(RESULT);
    expect(stored.find(n => n.id === 'c1383').raw_text).toBe(TWIN_OUT);
    // Retrying the same request lands the same text once: no duplicate comment.
    await applyWorkoutNoteTextBatchIfUnchanged(request);
    expect((await Storage.loadWorkoutNotes()).find(n => n.id === 'b1383').raw_text).toBe(RESULT);
  });

  test('a repeated header edits only its own occurrence when one mapping is deselected', () => {
    const p = buildNormalizationPreview(replyFor(RESULT.trimEnd()), snap, notes);
    const only = new Set([...keysOf(p)].filter(k => !k.endsWith('each leg\u0000Single-Leg RDL')));
    const next = applySelectedChanges(p.entries[0], only);
    expect(next).toBe(RESULT.replace('-Single-Leg RDL 2x8\n- 20 8,8\n-- each leg\n', '-Single-Leg RDL 2x8 each leg\n- 20 8,8\n'));
    expect(applySelectedChanges(p.entries[1], keysOf(p))).toBeNull();
  });

  test('CRLF text keeps CRLF everywhere, including inserted comments', () => {
    const crlf = { ...TARGET, raw_text: ORIG.replace(/\n/g, '\r\n') };
    const p = buildNormalizationPreview(`Target routine 1\n${RESULT.trimEnd()}`, { authority: AUTHORITY, targets: [crlf] }, [AUTHORITY, crlf]);
    expect(applySelectedChanges(p.entries[0], keysOf(p))).toBe(RESULT.replace(/\n/g, '\r\n'));
  });

  const bad = {
    descriptorMissing: RESULT.replace('-- step up\n', ''),
    paraphrased: RESULT.replace('-- trial sets, slow and controlled', '-- trial sets, go slow'),
    partialDrop: RESULT.replace('-- each leg, light', '-- each leg'),
    recased: RESULT.replace('-- step up', '-- Step Up'),
    internalPunctuation: RESULT.replace('-- each leg, light', '-- each leg light'),
    invented: RESULT.replace('-- pack shoulder down on eccentric', '-- pack shoulder down on eccentric, slow'),
    prescriptionNumber: RESULT.replace('-DB Bench Press 3x6-8', '-DB Bench Press 3x8-10'),
    prescriptionSpacing: RESULT.replace('-DB Bench Press 3x6-8', '-DB Bench Press 3 x 6-8'),
    rangeEndpointMoved: RESULT.replace('-DB Bench Press 3x6-8', '-DB Bench Press 3x6').replace('-- step up', '-- 8, step up'),
    rangeEndpointSpaced: RESULT.replace('-Lat Pulldown 2x10-12\n-- pack', '-Lat Pulldown 2x10\n-- -12 pack'),
    prescriptionMoved: RESULT.replace('-Lat Pulldown 2x10-12\n-- pack shoulder down on eccentric', '-Lat Pulldown\n-- 2x10-12 pack shoulder down on eccentric'),
    notAuthorityName: RESULT.replace('-Deadlift\n', '-Conventional Deadlift\n'),
    afterExistingComment: RESULT.replace('90 -\n-- step up\n-- felt good', '90 -\n-- felt good\n-- step up'),
    beforeLastSet: RESULT.replace("- 30 8 *PR\n-- each leg, light", '-- each leg, light\n- 30 8 *PR'),
    crossesBoundary: RESULT.replace('-\n-- trial sets, slow and controlled\n---', '-\n---\n-- trial sets, slow and controlled'),
    setChanged: RESULT.replace('85 8,8,8', '85 8,8,7'),
    skipFilled: RESULT.replace('90 -', '90 8'),
    markDropped: RESULT.replace(' *PR', ''),
    sectionChanged: RESULT.replace('+WARMUP', '+WARM UP'),
    weekBoundaryDropped: RESULT.replace('---\n', ''),
  };
  test.each(Object.entries(bad))('rejects %s and writes nothing', async (_name, out) => {
    for (const note of notes) await Storage.saveWorkoutNoteItem(note);
    const p = buildNormalizationPreview(replyFor(out.trimEnd()), snap, notes);
    expect(p.entries[0].problems.length).toBeGreaterThan(0);
    expect(p.entries[0].changes).toBeUndefined();
    expect((await Storage.loadWorkoutNotes()).find(n => n.id === 'b1383').raw_text).toBe(ORIG);
  });

  test('a load or rep-range endpoint can never leave the header', () => {
    const auth = new Set(['Bench Press']);
    expect(diffTargetNames('Monday\n-bench @135 3x5, paused', ['Monday', '-Bench Press @1', '-- 35 3x5, paused'], auth).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-bench 3x5-8 paused', ['Monday', '-Bench Press 3x5', '-- -8 paused'], auth).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-bench 3x5/8 paused', ['Monday', '-Bench Press 3x5', '-- /8 paused'], auth).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-bench 3x5-8 paused', ['Monday', '-Bench Press 3x5-8', '-- paused'], auth).changes).toHaveLength(1);
  });

  test('a timed declaration keeps its unit and meaning', () => {
    const auth = new Set(['Plank', 'Bike']);
    expect(diffTargetNames('Monday\n-plank 3x30 sec, slow', ['Monday', '-Plank 3x30', '-- sec, slow'], auth).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-plank 3x30sec slow', ['Monday', '-Plank 3x30', '-- sec slow'], auth).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-plank 30-45 s, slow', ['Monday', '-Plank 30-45', '-- s, slow'], auth).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-bike 5 min easy', ['Monday', '-Bike 5', '-- min easy'], auth).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-plank 3x30s, slow', ['Monday', '-Plank 3x30', '-- s, slow'], auth).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-plank 3x30s, slow', ['Monday', '-Plank 3x30s', '-- slow'], auth).changes).toHaveLength(1);
    expect(diffTargetNames('Monday\n-bike 5 min easy', ['Monday', '-Bike', '-- 5 min easy'], auth).problems.length).toBeGreaterThan(0);
    // The parser keeps a spaced duration in the name, so this stays unapplied.
    expect(diffTargetNames('Monday\n-bike 5 min easy', ['Monday', '-Bike 5 min', '-- easy'], auth).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-bike, 5 min easy', ['Monday', '-Bike', '-- 5 min easy'], auth).changes).toHaveLength(1);
  });

  test.each([':', ';', ',', ' |', ' (', ' [', ' {', ' <', ' "', ' —', ' –', ' -', ' /', ' ~', ' #', ' !', " '", ' ‘', ' .'])('an alias rename cannot drop a "%s"-separated cue', sep => {
    const close = { ' (': ')', ' [': ']', ' {': '}', ' <': '>', ' "': '"', " '": "'", ' ‘': '’' }[sep] || '';
    const orig = `Monday\n-Dumbbell Bench Press${sep} paused${close} 3x5\n85 5,5,5`;
    const auth = new Set(['DB Bench Press']);
    expect(diffTargetNames(orig, ['Monday', '-DB Bench Press 3x5', '85 5,5,5'], auth).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames(orig, ['Monday', '-DB Bench Press 3x5', '85 5,5,5', '-- paused'], auth).changes).toHaveLength(1);
  });

  test("in-word name punctuation stays part of an alias name", () => {
    const auth = new Set(['Farmer Carry', 'Single Leg Press']);
    expect(diffTargetNames("Monday\n-Farmer's Walk 3x40", ['Monday', '-Farmer Carry 3x40'], auth).changes).toHaveLength(1);
    expect(diffTargetNames('Monday\n-Single-Leg Leg Press 3x8', ['Monday', '-Single Leg Press 3x8'], auth).changes).toHaveLength(1);
    // Spaced "&" and "+" join name words by owner decision; an unspaced slash stays in-word.
    const joined = new Set(['C&J', 'Push/Pull Row']);
    expect(diffTargetNames("Monday\n-Dumbbell Bench Press 'paused' 3x5", ['Monday', '-DB Bench Press 3x5'], new Set(['DB Bench Press'])).problems.length).toBeGreaterThan(0);
    expect(diffTargetNames('Monday\n-Clean & Jerk 3x2', ['Monday', '-C&J 3x2'], joined).changes).toHaveLength(1);
    expect(diffTargetNames('Monday\n-push/pull row 3x5', ['Monday', '-Push/Pull Row 3x5'], joined).changes).toHaveLength(1);
  });

  test('an uncertain movement left unchanged proposes nothing for it', () => {
    const p = buildNormalizationPreview(replyFor(RESULT.trimEnd(), TWIN.raw_text), snap, notes);
    expect(p.entries[1].changes).toEqual([]);
    expect(applySelectedChanges(p.entries[1], keysOf(p))).toBeNull();
  });

  test('a stale or deleted target and a changed authority produce no write', async () => {
    for (const note of notes) await Storage.saveWorkoutNoteItem(note);
    const p = buildNormalizationPreview(replyFor(RESULT.trimEnd(), TWIN_OUT), snap, notes);
    const items = p.entries.map(entry => ({ id: entry.id, expected_raw_text: entry.snapshot, next_raw_text: applySelectedChanges(entry, keysOf(p)) }));
    const authority = { id: AUTHORITY.id, expected_raw_text: AUTHORITY.raw_text, accepted_raw_texts: [] };
    await Storage.saveWorkoutNoteItem({ ...TWIN, raw_text: 'edited' });
    const result = await applyWorkoutNoteTextBatchIfUnchanged({ authority, items });
    expect(result.skipped).toEqual([expect.objectContaining({ id: 'c1383', status: 'stale' })]);
    expect((await Storage.loadWorkoutNotes()).find(n => n.id === 'c1383').raw_text).toBe('edited');
    await Storage.saveWorkoutNoteItem({ ...AUTHORITY, raw_text: `${AUTHORITY.raw_text}\n-Row` });
    await Storage.saveWorkoutNoteItem(TARGET);
    expect((await applyWorkoutNoteTextBatchIfUnchanged({ authority, items })).authority).toBe('stale');
    expect((await Storage.loadWorkoutNotes()).find(n => n.id === 'b1383').raw_text).toBe(ORIG);
    expect(buildNormalizationPreview(replyFor(RESULT.trimEnd()), snap, [AUTHORITY, TWIN]).entries[0].problems[0]).toMatch(/no longer exists/);
  });
});
