export const DELOAD_NOTE_PREFIX = 'Deload · ';
export const AUTOSAVE_DEBOUNCE_MS = 800;

export const _DELOAD_EXERCISE_LINE = /^[^:+\d-][^:]*?:\s+\d+(?:\.\d+)?\s+lbs?\s+\d+x\d+\s*$/i;
export const _DELOAD_CORE_LINE = /^Core:/i;

// Parse any ISO timestamp or YYYY-MM-DD string as local midnight so
// toLocaleDateString() never shifts the date back one day for UTC- timezones.
export function localDate(str) {
  if (!str) return new Date();
  const [y, m, d] = str.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Reshape the compact deload generator output into routine-note style:
// blank line between day blocks, +Lifting subheading per day.
// The deload format line "Name: weight lbs SxR" still parses via _DELOAD_RE.
export function _shapeDeloadText(text) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const isExercise = _DELOAD_EXERCISE_LINE.test(line) || _DELOAD_CORE_LINE.test(line);
    if (!isExercise) {
      if (out.length > 0) out.push('');
      out.push(line);
      out.push('+Lifting');
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}
