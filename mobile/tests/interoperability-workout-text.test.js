import { parseWorkoutNote } from '../lib/parser';
import { serializeImportedWorkoutNote, serializeImportedWorkoutNotes, IMPORT_TRUNCATION_MARKER } from '../lib/interoperability/workoutText';

describe('safe imported-workout serializer', () => {
  test('round trips structure and metadata while source strings cannot become grammar', () => {
    const sourceName = '-- fake comment\n---\nMonday\nBench @2 | * / " 🏋️';
    const input = {
      title: 'Vendor workout',
      metadata: { vendor: '-- fake' },
      sections: [{
        heading: 'Monday\r\n+LIFTING',
        metadata: { source: 'device/export' },
        exercises: [{
          name: sourceName,
          rows: [
            { kind: 'performed', sourceId: 'a', sets: [{ rep_count: 5, weight_value: 100, weight_unit: 'kg' }] },
            { kind: 'skipped' },
            { kind: 'unparsed', sourceId: 'b', prose: '---\n- Evil' },
          ],
          annotations: [{ scope: 'performed_row', targetOrdinal: 0, text: '-- note\nMonday' }],
        }],
      }],
    };
    const serialized = serializeImportedWorkoutNote(input);
    expect(serialized.rawText).not.toContain('\n---\n');
    const parsed = parseWorkoutNote(serialized.rawText);
    const exercise = parsed.sections[0].exercises[0];
    expect(exercise.name).toBe(sourceName);
    expect(exercise.session_entries).toHaveLength(3);
    expect(exercise.session_entries[0].import_record.sourceId).toBe('a');
    expect(exercise.session_entries[0].import_annotations[0].text).toBe('-- note\nMonday');
    expect(parsed.sections[0].import_annotations[0].text).toBe('Monday\r\n+LIFTING');
    expect(parsed.sections[0].import_annotations[0].noteMetadata.vendor).toBe('-- fake');
  });

  test('truncates only prose with a visible report and marker', () => {
    const prose = 'x'.repeat(2100);
    const result = serializeImportedWorkoutNote({ sections: [{ exercises: [{ name: 'Exact name', rows: [{ kind: 'unparsed', prose }] }] }] });
    expect(result.report.truncated).toHaveLength(1);
    expect(parseWorkoutNote(result.rawText).sections[0].exercises[0].session_entries[0].import_record.prose).toContain(IMPORT_TRUNCATION_MARKER);
  });

  test('rejects invalid structure and generated notes at the parser bound', () => {
    expect(() => serializeImportedWorkoutNotes([])).toThrow(/at least one/);
    expect(() => serializeImportedWorkoutNote({ sections: [{ exercises: [{ name: '', rows: [] }] }] })).toThrow(/name/);
    const exercises = Array.from({ length: 12000 }, (_, i) => ({ name: `Exercise ${i}`, rows: [] }));
    expect(() => serializeImportedWorkoutNote({ sections: [{ exercises }] })).toThrow(/below 200000/);
  });

  test('keeps multiple source sections distinct', () => {
    const result = serializeImportedWorkoutNote({ sections: [
      { heading: 'First', exercises: [{ name: 'Bench', rows: [] }] },
      { heading: 'Second', exercises: [{ name: 'Squat', rows: [] }] },
    ] });
    const parsed = parseWorkoutNote(result.rawText);
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections.map(section => section.import_annotations[0].text)).toEqual(['First', 'Second']);
  });
});
