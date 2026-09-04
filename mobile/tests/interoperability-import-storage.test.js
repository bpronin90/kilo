import { saveFreshImportedWorkoutNotes } from '../storage/entries/workoutNotes';
import { serializeImportedWorkoutNotes } from '../lib/interoperability/workoutText';
import { parseWorkoutNote } from '../lib/parser';

describe('fresh imported workout writes', () => {
  test('creates fresh non-current notes on every import without deduplication', async () => {
    const written = [];
    let id = 0;
    const options = { writeNote: async note => written.push(note), idFactory: () => `fresh-${++id}`, now: () => '2026-09-04T00:00:00.000Z' };
    const drafts = [{ title: 'A', raw_text: '-@import-exercise "Bench"' }];
    const first = await saveFreshImportedWorkoutNotes(drafts, options);
    const second = await saveFreshImportedWorkoutNotes(drafts, options);
    expect(written.map(note => note.id)).toEqual(['fresh-1', 'fresh-2']);
    expect(written.every(note => note.isCurrent === false)).toBe(true);
    expect(first.warning).toMatch(/Repeat imports/);
    expect(second.ok).toBe(true);
  });

  test('stops at first throw and distinguishes confirmed from unconfirmed', async () => {
    let call = 0;
    const result = await saveFreshImportedWorkoutNotes(
      [{ raw_text: 'one' }, { raw_text: 'two' }, { raw_text: 'three' }],
      { idFactory: () => `id-${call + 1}`, writeNote: async () => { call++; if (call === 2) throw new Error('cloud timeout'); } },
    );
    expect(call).toBe(2);
    expect(result.confirmed).toEqual([{ index: 0, id: 'id-1', status: 'confirmed' }]);
    expect(result.unconfirmed).toMatchObject({ index: 1, id: 'id-2', status: 'unconfirmed', message: 'cloud timeout' });
    expect(result.remaining).toBe(1);
    expect(result.warning).toMatch(/Inspect routines before retrying/);
  });

  test('validates the whole batch before any write', async () => {
    const writeNote = jest.fn();
    await expect(saveFreshImportedWorkoutNotes([{ raw_text: 'valid' }, { raw_text: '' }], { writeNote })).rejects.toThrow(/note 2/);
    expect(writeNote).not.toHaveBeenCalled();
  });

  test('round trips intermediate records through save, reload, and parse', async () => {
    const persisted = [];
    const drafts = serializeImportedWorkoutNotes([{ title: 'Lift', metadata: { vendor: 'fixture' }, sections: [{ exercises: [{ name: 'Bench @2', rows: [{ kind: 'performed', sets: [{ rep_count: 5, weight_value: 80, weight_unit: 'lb' }] }] }] }] }])
      .map(({ title, rawText }) => ({ title, raw_text: rawText }));
    await saveFreshImportedWorkoutNotes(drafts, { writeNote: async note => persisted.push(JSON.parse(JSON.stringify(note))), idFactory: () => 'fresh' });
    const parsed = parseWorkoutNote(persisted[0].raw_text);
    expect(parsed.sections[0].exercises[0]).toMatchObject({ name: 'Bench @2', session_entries: [{ import_record: { kind: 'performed', sets: [{ rep_count: 5, weight_value: 80, weight_unit: 'lb' }] } }] });
  });
});
