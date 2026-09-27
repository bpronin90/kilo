import {
  applySelectedChanges,
  buildNormalizationPreview,
  diffTargetNames,
  splitNormalizationReply,
} from '../lib/interoperability/routineNormalizationImport';
import { saveWorkoutNoteTextIfUnchanged } from '../hooks/entries/workoutNoteHooks';
import * as Storage from '../storage/entries';

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

  test('casing and punctuation-only renames are allowed name changes', () => {
    const out = diffTargetNames('Monday\n-db row 3x8', ['Monday', '-DB Row, one-arm 3x8']);
    expect(out.changes).toEqual([expect.objectContaining({ oldName: 'db row', newName: 'DB Row, one-arm' })]);
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
