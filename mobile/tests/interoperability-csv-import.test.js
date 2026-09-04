import { parseCsvDocument } from '../lib/interoperability/csv';

const options = { aliases: { name: ['Exercise Name'], reps: ['Repetitions'] }, required: ['name'] };

describe('bounded CSV import parser', () => {
  test('handles BOM, CRLF/LF, quoting, embedded newlines, blank records, and trailing cells', () => {
    const csv = '\uFEFF Exercise Name ,Repetitions,extra\r\n"Bench, Press","5\n5",\r\n\r\nSquat,8,tail\n';
    const parsed = parseCsvDocument(new TextEncoder().encode(csv), options);
    expect(parsed.columns).toEqual({ name: 0, reps: 1 });
    expect(parsed.rows).toEqual([['Bench, Press', '5\n5', ''], ['Squat', '8', 'tail']]);
    expect(parsed.unusedColumns).toEqual(['extra']);
  });

  test('uses exact aliases with ASCII trim and no fuzzy matching', () => {
    expect(() => parseCsvDocument('exercise_name\nBench', options)).toThrow(/missing required header/);
    expect(parseCsvDocument('EXERCISE NAME\nBench', options).rows[0][0]).toBe('Bench');
  });

  test('rejects one source header claimed by two canonical aliases', () => {
    expect(() => parseCsvDocument('name\nBench', { aliases: { exercise: ['name'], title: ['name'] } })).toThrow(/ambiguously/);
  });

  test.each([
    ['duplicate headers', 'name, NAME\na,b', /duplicate/],
    ['width mismatch', 'name,reps\nBench', /expected 2/],
    ['unterminated quote', 'name\n"Bench', /unterminated/],
    ['quote in plain field', 'name\nBe"nch', /malformed quote/],
    ['after quote', 'name\n"Bench"x', /after a closing quote/],
    ['NUL', 'name\nBen\0ch', /NUL/],
    ['extra BOM', 'name\n\uFEFFBench', /BOM only/],
  ])('rejects %s before producing rows', (_label, csv, error) => {
    expect(() => parseCsvDocument(csv, { aliases: { name: [] }, required: ['name'] })).toThrow(error);
  });

  test('rejects invalid UTF-8 and byte/row bounds', () => {
    expect(() => parseCsvDocument(Uint8Array.from([0xc3, 0x28]))).toThrow(/valid UTF-8/);
    expect(() => parseCsvDocument('name\nBench', { maxBytes: 4 })).toThrow(/exceeds/);
    expect(() => parseCsvDocument('name\na\nb', { maxRows: 1 })).toThrow(/data rows/);
  });
});
