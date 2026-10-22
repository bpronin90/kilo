// Training breakdown session windows (#1597, replacing #1589's calendar ranges).
// Workout notes carry no per-session dates (a note is a growing routine notebook;
// `saved_at`/`updated_at` date the whole note), so 30D/90D could never be honoured.
// Windows are positional instead, over per-exercise session streams:
//
// - Stream identity is the breakdown's original-name key,
//   String(name).trim().toLowerCase(), across every eligible note/section.
// - Order is the existing positional session model: notes in their array order,
//   then sections/exercises in parsed order, then each occurrence's
//   `_occurrenceEntries` order. Nothing is sorted by timestamp, heading or ID.
// - A slot is one eligible logged session unit (a multi-set row is one session),
//   never one set or one note. Last N keeps the newest N units per stream; All
//   bypasses windowing entirely.
//
// The selection runs over the ALREADY recovery-filtered population
// `deriveParsedSections` returns and keeps normalNotes[i] <-> noteSectionsList[i]
// paired, so each retained unit's overrides resolve against its own note.

export const TRAINING_BREAKDOWN_WINDOWS = Object.freeze(['last4', 'last12', 'All']);
const WINDOW_SESSIONS = { last4: 4, last12: 12 };

export const streamKey = (name) => String(name).trim().toLowerCase();

// Validates the window and the population. Returns { all: true } for All, the
// window size for a bounded window, or null when a bounded window cannot be
// honoured (no usable note/section pairing) — never a broadened population.
export function resolveWindow(parsedSections, windowId) {
  if (!TRAINING_BREAKDOWN_WINDOWS.includes(windowId)) throw new Error(`Unknown training breakdown window: ${windowId}`);
  if (windowId === 'All') return { all: true };
  const notes = parsedSections?.normalNotes;
  const lists = parsedSections?.noteSectionsList;
  if (!Array.isArray(notes) || !Array.isArray(lists) || notes.length !== lists.length) return null;
  // A missing pair entry is an unusable population, not an empty one.
  if (!notes.every((n) => n && typeof n === 'object') || !lists.every(Array.isArray)) return null;
  return { all: false, size: WINDOW_SESSIONS[windowId] };
}

// Given each stream's total eligible unit count, returns keep(key, ordinal):
// true when the ordinal-th (0-based, oldest first) unit of that stream is among
// its newest `size` units. Fewer than `size` units keeps the whole stream.
export function windowKeeper(streamTotals, size) {
  return (key, ordinal) => ordinal >= (streamTotals.get(key) || 0) - size;
}
