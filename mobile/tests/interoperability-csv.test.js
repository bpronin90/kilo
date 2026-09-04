// CSV dialect writer + spreadsheet-safety escaping (issue #578 Issue A).

import { writeCsvRow, writeCsvDocument, CSV_ROW_TERMINATOR } from '../lib/interoperability/csv';

// Minimal RFC-4180-aware single-row splitter, good enough for asserting on
// our own writer's output in tests (not a general parser — that belongs to
// Issue B). Handles a quoted field containing a delimiter/quote/CR/LF.
function splitCsvRow(row) {
  const cells = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (inQuotes) {
      if (c === '"' && row[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cells.push(field); field = '';
    } else {
      field += c;
    }
  }
  cells.push(field);
  return cells;
}

describe('CSV dialect writer', () => {
  const columns = ['a', 'b', 'spreadsheet_escaped_fields'];
  const freeText = new Set(['a', 'b']);

  test('plain fields are written unquoted', () => {
    const row = writeCsvRow(columns, { a: 'hello', b: 'world' }, freeText);
    expect(row).toBe('hello,world,[]');
  });

  test('a comma triggers RFC 4180 quoting', () => {
    const row = writeCsvRow(columns, { a: 'a,b', b: 'x' }, freeText);
    expect(row).toBe('"a,b",x,[]');
  });

  test('a double quote is escaped by doubling and the field is quoted', () => {
    const row = writeCsvRow(columns, { a: 'say "hi"', b: 'x' }, freeText);
    expect(row).toBe('"say ""hi""",x,[]');
  });

  test('an embedded newline is preserved literally inside a quoted field', () => {
    const row = writeCsvRow(columns, { a: 'line1\nline2', b: 'x' }, freeText);
    expect(row).toBe('"line1\nline2",x,[]');
  });

  test('a full document uses CRLF between rows including after the header', () => {
    const doc = writeCsvDocument(columns, [{ a: '1', b: '2' }], freeText);
    expect(doc).toBe(`a,b,spreadsheet_escaped_fields${CSV_ROW_TERMINATOR}1,2,[]${CSV_ROW_TERMINATOR}`);
  });

  describe('spreadsheet formula-trigger neutralization', () => {
    test.each(['=SUM(A1)', '+1', '-1', '@cmd', '\t1', '\r1'])(
      'a value starting with %p gets exactly one leading apostrophe and is listed as escaped',
      (value) => {
        const row = writeCsvRow(columns, { a: value, b: 'x' }, freeText);
        const [a, , fields] = splitCsvRow(row);
        expect(a.startsWith("'")).toBe(true);
        expect(JSON.parse(fields)).toContain('a');
      }
    );

    test('a value already starting with an apostrophe is left untouched and never listed', () => {
      const row = writeCsvRow(columns, { a: "'=SUM(A1)", b: 'x' }, freeText);
      const [a, , fields] = splitCsvRow(row);
      // Only one apostrophe survives — Kilo added none, since the trigger set
      // does not include a leading apostrophe itself.
      expect(a).toBe("'=SUM(A1)");
      expect(JSON.parse(fields)).toEqual([]);
    });

    test('an ordinary value with no trigger character is never escaped', () => {
      const row = writeCsvRow(columns, { a: 'Bench Press', b: 'x' }, freeText);
      expect(row).toBe('Bench Press,x,[]');
    });

    test('a non-free-text column is never escaped even with a trigger-shaped value', () => {
      const numericColumns = ['n', 'spreadsheet_escaped_fields'];
      const row = writeCsvRow(numericColumns, { n: '-5' }, new Set());
      expect(row).toBe('-5,[]');
    });

    test('multiple escaped fields in one row are all listed', () => {
      const row = writeCsvRow(columns, { a: '=1', b: '-2' }, freeText);
      const [, , fields] = splitCsvRow(row);
      expect(JSON.parse(fields).sort()).toEqual(['a', 'b']);
    });
  });
});
