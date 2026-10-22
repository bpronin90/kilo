// Training breakdown date ranges (#1589). Pure selection over the ALREADY
// recovery-filtered population `deriveParsedSections` returns: it never rebuilds a
// notebook filter, and it keeps normalNotes[i] <-> noteSectionsList[i] paired so
// note-scoped overrides resolve against their own note.
//
// Dates come only from `note.date`. Date-only values (YYYY-MM-DD) are device-local
// calendar dates; nothing is parsed through UTC. 30D/90D are today through
// today-(N-1) local calendar days, inclusive; future dates are excluded. All
// applies no date filter, so notes with a missing or unparseable date appear only
// in All.

export const TRAINING_BREAKDOWN_RANGES = Object.freeze(['30D', '90D', 'All']);
const RANGE_DAYS = { '30D': 30, '90D': 90 };

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Local calendar-day ordinal (days since a fixed epoch) for comparison without
// elapsed-hour arithmetic. Uses Date.UTC only as a pure Y/M/D -> day counter.
const dayOrdinal = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 86400000);

export function noteLocalDayOrdinal(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const match = DATE_ONLY_RE.exec(text);
  if (match) {
    const y = Number(match[1]); const m = Number(match[2]); const d = Number(match[3]);
    const probe = new Date(y, m - 1, d);
    if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
    return dayOrdinal(y, m, d);
  }
  return null;
}

const localDayOf = (date) => dayOrdinal(date.getFullYear(), date.getMonth() + 1, date.getDate());

// Returns { notes, sectionsList } for the range, or null when a bounded range
// cannot be honoured (no usable pairing / invalid now). All returns the inputs
// as given so legacy fallback behaviour is preserved by the caller.
export function selectRangePopulation(parsedSections, range, now) {
  if (!TRAINING_BREAKDOWN_RANGES.includes(range)) throw new Error(`Unknown training breakdown range: ${range}`);
  if (range === 'All') return { all: true };
  const notes = parsedSections?.normalNotes;
  const lists = parsedSections?.noteSectionsList;
  if (!Array.isArray(notes) || !Array.isArray(lists) || notes.length !== lists.length) return null;
  // Every pair must be usable: a note object with its own section array. A missing
  // entry is an unusable population, not an empty one.
  if (!notes.every((n) => n && typeof n === 'object') || !lists.every(Array.isArray)) return null;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const today = localDayOf(now);
  const earliest = today - (RANGE_DAYS[range] - 1);
  const selNotes = [];
  const selLists = [];
  notes.forEach((note, i) => {
    const day = noteLocalDayOrdinal(note?.date);
    if (day === null || day > today || day < earliest) return;
    selNotes.push(note);
    selLists.push(lists[i]);
  });
  return { all: false, notes: selNotes, sectionsList: selLists };
}
