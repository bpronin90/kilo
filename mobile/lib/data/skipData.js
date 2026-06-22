import { normalizeExerciseKey } from '../parser.js';
import { KILO_EXERCISES } from './exerciseCatalog.js';
import { REPEATED_WEEKDAY_SKIP_SESSION_WINDOW } from './routineStatus.js';

// ── Skip detection and attendance flags ───────────────────────────────────────

const _DAY_LABELS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Returns { weekday: string|null, date: 'YYYY-MM-DD'|null } from a section heading.
function _headingInfo(heading) {
  if (!heading) return { weekday: null, date: null };
  const lower = heading.toLowerCase();
  let weekday = null;
  for (const day of _DAY_LABELS) {
    if (lower.includes(day)) { weekday = day; break; }
  }

  let date = null;
  // Try ISO YYYY-MM-DD
  const isoMatch = /(\d{4}-\d{2}-\d{2})/.exec(heading);
  if (isoMatch) {
    date = isoMatch[1];
  } else {
    // Try MM-DD-YYYY or MM/DD/YYYY
    const commonMatch = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(heading);
    if (commonMatch) {
      const m = commonMatch[1].padStart(2, '0');
      const d = commonMatch[2].padStart(2, '0');
      const y = commonMatch[3];
      date = `${y}-${m}-${d}`;
    }
  }

  if (date && !weekday) {
    const d = new Date(date + 'T12:00:00');
    if (!isNaN(d.getTime())) weekday = _DAY_LABELS[d.getDay()];
  }
  return { weekday, date };
}

function _exerciseIdForName(name) {
  const norm = normalizeExerciseKey(name);
  const found = KILO_EXERCISES.find(e => normalizeExerciseKey(e.name) === norm);
  return found ? found.id : null;
}

// Scan parsed sections for exercise-level and day-level skip markers plus
// derived attendance flags.
//
// exercise_skips: { exercise_name, exercise_id, session_index }[]
//   One entry per skipped session_entry position.
//
// day_skips: { session_index, weekday: string|null, date: 'YYYY-MM-DD'|null }[]
//   Session positions where all exercises present at that index in the same
//   section are skipped. Missing history at an index is not treated as a skip.
//   weekday and date are inferred from the section heading when possible.
//
// attendance_flags:
//   { type: 'consecutive_exercise_skips', exercise_name, exercise_id, consecutive_count }
//     — 2+ consecutive skipped session entries for one exercise
//   { type: 'repeated_weekday_skip', weekday, skip_count }
//     — 2+ fully-skipped sessions on the same weekday within the last
//       REPEATED_WEEKDAY_SKIP_SESSION_WINDOW session cycles for that day slot.
//       Weekday is inferred from section heading (day name or ISO date); no
//       calendar date required — detection is purely session-order based.
export function deriveSkipData(sections) {
  const exercise_skips = [];
  const day_skips = [];
  const attendance_flags = [];

  // weekday → session_index[] of fully-skipped day slots
  const weekdaySkipIndices = {};
  // weekday → max session_entries.length seen across sections for that day slot
  const weekdayMaxDepth = {};
  // Keyed by exercise identity (catalog id, or canonical name for non-catalog exercises).
  // Accumulates session_entries in section order for cross-section consecutive detection.
  const exerciseHistories = new Map();

  for (const section of sections) {
    const eligible = section.exercises.filter(ex =>
      ex.session_entries.length > 0
    );
    if (eligible.length === 0) continue;

    const { weekday, date: headingDate } = _headingInfo(section.heading);
    const maxLen = Math.max(...eligible.map(ex => ex.session_entries.length));

    if (weekday) {
      weekdayMaxDepth[weekday] = Math.max(weekdayMaxDepth[weekday] || 0, maxLen);
    }

    for (const ex of eligible) {
      const exId = _exerciseIdForName(ex.name);
      const histKey = exId ?? normalizeExerciseKey(ex.name);

      if (!exerciseHistories.has(histKey)) {
        exerciseHistories.set(histKey, { exercise_name: ex.name, exercise_id: exId, entries: [] });
      }
      exerciseHistories.get(histKey).entries.push(...ex.session_entries);

      ex.session_entries.forEach((entry, idx) => {
        if (entry.skipped) {
          exercise_skips.push({ exercise_name: ex.name, exercise_id: exId, session_index: idx });
        }
      });
    }

    for (let i = 0; i < maxLen; i++) {
      // All eligible exercises must have an entry at this position.
      // Missing history is not evidence of a skip.
      if (!eligible.every(ex => i < ex.session_entries.length)) continue;
      if (!eligible.every(ex => ex.session_entries[i].skipped)) continue;

      day_skips.push({ session_index: i, weekday, date: headingDate });

      if (weekday) {
        if (!weekdaySkipIndices[weekday]) weekdaySkipIndices[weekday] = [];
        weekdaySkipIndices[weekday].push(i);
      }
    }
  }

  // Cross-section consecutive skip detection: evaluate each exercise's full history.
  for (const { exercise_name, exercise_id, entries } of exerciseHistories.values()) {
    let consecutive = 0;
    let maxConsecutive = 0;
    for (const entry of entries) {
      if (entry.skipped) {
        consecutive++;
        if (consecutive > maxConsecutive) maxConsecutive = consecutive;
      } else {
        consecutive = 0;
      }
    }
    if (maxConsecutive >= 2) {
      attendance_flags.push({
        type: 'consecutive_exercise_skips',
        exercise_name,
        exercise_id,
        consecutive_count: maxConsecutive,
      });
    }
  }

  // Repeated weekday skip: session-depth window (no calendar dates required).
  for (const [weekday, skipIndices] of Object.entries(weekdaySkipIndices)) {
    const maxDepth = weekdayMaxDepth[weekday] || 0;
    const windowStart = Math.max(0, maxDepth - REPEATED_WEEKDAY_SKIP_SESSION_WINDOW);
    const recentSkips = skipIndices.filter(idx => idx >= windowStart);
    if (recentSkips.length >= 2) {
      attendance_flags.push({ type: 'repeated_weekday_skip', weekday, skip_count: recentSkips.length });
    }
  }

  return { exercise_skips, day_skips, attendance_flags };
}
