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
