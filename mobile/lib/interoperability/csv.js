import { Buffer } from 'buffer';

// Shared CSV dialect: writer + spreadsheet-safety escaping.
//
// Issue #578 (comment 5530857840, "CSV dialect" and "Reversible spreadsheet
// safety" sections; the apostrophe rule itself is normalized per the followup
// review at comment 5530890672 finding 1 — see `escapeSpreadsheetTrigger`
// below for the exact single, self-consistent rule this module implements).
//
// This module is the WRITER half of the shared dialect only. The read/parse
// half belongs to the shared import foundation (issue #578 Issue B) and is
// intentionally not implemented here — Issue A (Kilo CSV export) never reads
// a CSV back in.
//
// Dialect: UTF-8, no BOM, comma-delimited, RFC 4180 quoting, CRLF between
// records, embedded CR/LF preserved verbatim inside a quoted field.

const DELIMITER = ',';
const ROW_TERMINATOR = '\r\n';

// A field needs RFC 4180 quoting if it contains the delimiter, a double quote,
// or any line-ending character. An embedded double quote is escaped by
// doubling it.
function quoteIfNeeded(value) {
  const needsQuoting = /[",\r\n]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

// The documented Excel/Sheets/LibreOffice formula-trigger set: a cell whose
// first character is one of these is interpreted as a formula rather than
// literal text by default.
const TRIGGER_RE = /^[=+\-@\t\r]/;

// The exact, single rule (resolving the contradiction the review at comment
// 5530890672 finding 1 flagged in the prior draft): a value is escaped if and
// ONLY IF its first character matches TRIGGER_RE. A value that already begins
// with an apostrophe is NEVER re-escaped and NEVER listed as escaped — a
// leading apostrophe already renders as literal text in every major
// spreadsheet application, so there is nothing more for Kilo to neutralize,
// and listing it would falsely claim Kilo added a character it did not add.
//
// Returns { value, escaped }: `value` is the (possibly apostrophe-prefixed)
// string to write; `escaped` is true only when Kilo added the apostrophe.
function escapeSpreadsheetTrigger(rawValue) {
  const str = rawValue == null ? '' : String(rawValue);
  if (str.length === 0) return { value: str, escaped: false };
  if (!TRIGGER_RE.test(str)) return { value: str, escaped: false };
  return { value: `'${str}`, escaped: true };
}

// Columns whose values are free text a user or an imported source authored,
// and therefore the only columns ever subject to spreadsheet-trigger
// escaping. A numeric/boolean-typed column (weight_value_lb, rep_count,
// set_ordinal, is_skipped, ...) is never escaped: a spreadsheet only
// interprets `=`/`+`/`@`/a non-numeric-leading `-` as a formula trigger, and a
// column Kilo always writes as a plain number or `true`/`false` can never
// produce that shape.
export function isEscapableTextColumn(column, freeTextColumns) {
  return freeTextColumns.has(column);
}

// Builds one CSV data row (not yet including a trailing terminator) from an
// ordered `columns` list and a `record` object keyed by column name.
// `freeTextColumns` names which columns may receive spreadsheet-trigger
// escaping; every other column is written as-is (after stringification).
//
// Returns the row string. The caller supplies `record.spreadsheet_escaped_fields`
// as `undefined`/absent — this function computes and fills it, so a caller
// must reserve a `spreadsheet_escaped_fields` column in `columns` for it to
// appear.
export function writeCsvRow(columns, record, freeTextColumns) {
  const escapedColumns = [];
  const cells = columns.map((column) => {
    if (column === 'spreadsheet_escaped_fields') return null; // filled below
    const raw = record[column];
    if (!isEscapableTextColumn(column, freeTextColumns)) {
      return raw == null ? '' : String(raw);
    }
    const { value, escaped } = escapeSpreadsheetTrigger(raw);
    if (escaped) escapedColumns.push(column);
    return value;
  });

  const fieldsIndex = columns.indexOf('spreadsheet_escaped_fields');
  if (fieldsIndex !== -1) {
    cells[fieldsIndex] = JSON.stringify(escapedColumns);
  }

  return cells.map(quoteIfNeeded).join(DELIMITER);
}

// Assembles a full CSV document (header + data rows), CRLF-terminated,
// including the trailing terminator after the final row (RFC 4180 permits
// either; a trailing terminator is the more broadly compatible choice).
export function writeCsvDocument(columns, rows, freeTextColumns) {
  const headerRow = columns.map(quoteIfNeeded).join(DELIMITER);
  const dataRows = rows.map((record) => writeCsvRow(columns, record, freeTextColumns));
  return [headerRow, ...dataRows].map((row) => row + ROW_TERMINATOR).join('');
}

export const CSV_ROW_TERMINATOR = ROW_TERMINATOR;

export const CSV_MAX_BYTES = 10 * 1024 * 1024;
export const CSV_MAX_ROWS = 100000;

function decodeCsvInput(input, maxBytes) {
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > maxBytes) throw new Error(`CSV exceeds ${maxBytes} bytes.`);
    if (input.includes('\0')) throw new Error('CSV contains a NUL character.');
    return input;
  }
  if (!(input instanceof Uint8Array)) throw new TypeError('CSV input must be a string or Uint8Array.');
  if (input.byteLength > maxBytes) throw new Error(`CSV exceeds ${maxBytes} bytes.`);
  const bytes = Buffer.from(input);
  const decoded = bytes.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(bytes)) throw new Error('CSV is not valid UTF-8.');
  if (decoded.includes('\0')) throw new Error('CSV contains a NUL character.');
  return decoded;
}

function parseCsvRows(text, maxRows) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  function finishField() { row.push(field); field = ''; closedQuote = false; }
  function finishRow() {
    finishField();
    rows.push(row);
    row = [];
    if (rows.length > maxRows + 1) throw new Error(`CSV exceeds ${maxRows} data rows.`);
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += ch;
      continue;
    }
    if (closedQuote && ch !== ',' && ch !== '\r' && ch !== '\n') {
      throw new Error('CSV contains characters after a closing quote.');
    }
    if (ch === '"') {
      if (field.length !== 0 || closedQuote) throw new Error('CSV contains a malformed quote.');
      quoted = true;
    } else if (ch === ',') finishField();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      finishRow();
    } else field += ch;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (row.length || field.length || closedQuote || (text.length > 0 && text[text.length - 1] === ',')) finishRow();
  return rows;
}

function normalizeHeader(value) {
  return value.replace(/^\uFEFF/, '').replace(/^[\t ]+|[\t ]+$/g, '').toLocaleLowerCase('en-US');
}

// Parses and validates the entire document before returning any rows. Aliases
// maps canonical names to exact, case-insensitive source spellings.
export function parseCsvDocument(input, { aliases = {}, required = [], maxBytes = CSV_MAX_BYTES, maxRows = CSV_MAX_ROWS } = {}) {
  let text = decodeCsvInput(input, maxBytes);
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  if (text.includes('\uFEFF')) throw new Error('CSV may contain a BOM only at the beginning.');
  const parsedRows = parseCsvRows(text, maxRows);
  const allRows = parsedRows.length ? [parsedRows[0], ...parsedRows.slice(1).filter(row => !(row.length === 1 && row[0] === ''))] : [];
  if (allRows.length === 0) throw new Error('CSV has no header row.');
  const header = allRows[0];
  const normalized = header.map(normalizeHeader);
  if (new Set(normalized).size !== normalized.length) throw new Error('CSV has duplicate normalized headers.');
  for (let i = 1; i < allRows.length; i++) {
    if (allRows[i].length !== header.length) throw new Error(`CSV row ${i + 1} has ${allRows[i].length} cells; expected ${header.length}.`);
  }

  const claimed = new Map();
  const indexOwners = new Map();
  for (const [canonical, names] of Object.entries(aliases)) {
    const candidates = [canonical, ...(Array.isArray(names) ? names : [names])].map(normalizeHeader);
    const indexes = normalized.flatMap((name, index) => candidates.includes(name) ? [index] : []);
    if (indexes.length > 1) throw new Error(`CSV resolves multiple headers to "${canonical}".`);
    if (indexes.length === 1) {
      const owner = indexOwners.get(indexes[0]);
      if (owner) throw new Error(`CSV header "${header[indexes[0]]}" ambiguously resolves to "${owner}" and "${canonical}".`);
      claimed.set(canonical, indexes[0]);
      indexOwners.set(indexes[0], canonical);
    }
  }
  for (const name of required) if (!claimed.has(name)) throw new Error(`CSV is missing required header "${name}".`);
  const usedIndexes = new Set(claimed.values());
  return {
    header,
    rows: allRows.slice(1),
    columns: Object.fromEntries(claimed),
    unusedColumns: header.filter((_, index) => !usedIndexes.has(index)),
  };
}
