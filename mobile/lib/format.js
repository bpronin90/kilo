export function formatDate(isoString) {
  if (!isoString) return '';
  const datePart = String(isoString).slice(0, 10);
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return '';
  return `${month}-${day}-${year}`;
}

export function formatTimestamp(value) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatWorkoutSets(sets) {
  if (!sets || sets.length === 0) return '';
  
  const groups = [];
  let currentGroup = null;

  for (const set of sets) {
    if (!currentGroup || currentGroup.weight !== set.weight_value) {
      currentGroup = { weight: set.weight_value, reps: [] };
      groups.push(currentGroup);
    }
    currentGroup.reps.push(set.rep_count);
  }

  return groups.map(group => {
    const weightStr = group.weight ? `${group.weight} lb` : 'BW';
    return `${weightStr} ${group.reps.join(', ')}`;
  }).join('; ');
}

export function formatDelta(delta) {
  if (delta === null || delta === undefined) return '';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}`;
}

export function getWeightDeltaSeverity(delta) {
  if (delta === null || delta === undefined) return 'normal';
  const abs = Math.abs(delta);
  if (abs > 3.5) return 'outlier';
  if (abs > 2.3) return 'spike';
  if (abs > 1.5) return 'notable';
  return 'normal';
}

// Format a session classification label for display.
export function formatSessionClassification(label) {
  switch (label) {
    case 'initial':      return 'Initial';
    case 'progressing':  return '↑ Progressing';
    case 'stalled':      return '↔ Steady';
    case 'regressing':   return '↓ Regressing';
    case 'inconsistent': return '~ Inconsistent';
    default:             return null;
  }
}

// Return nudge copy for a rep drop-off flag, or null when no nudge applies.
export function formatRepDropOffNudge(flag) {
  if (flag === 'hit_wall') return 'Last time you hit a wall — stay at this weight.';
  return null;
}

// Format the copy for a cross-lift asymmetry note.
// progressingSlot: 'squat'|'bench'|'deadlift'
// laggingSlot: 'squat'|'bench'|'deadlift'
// laggingClass: 'stalled'|'regressing'
export function formatAsymmetryNote(progressingSlot, laggingSlot, laggingClass) {
  const p = progressingSlot;
  const state = laggingClass === 'regressing' ? 'regressing' : 'steady';
  return `${p.charAt(0).toUpperCase() + p.slice(1)} progressing, ${laggingSlot} ${state} — worth reviewing.`;
}

// Format display copy for a persisted attendance flag.
// Returns a string or null when the flag type is unrecognised.
export function formatAttendanceFlag(flag) {
  if (!flag) return null;
  if (flag.type === 'consecutive_exercise_skips') {
    return `${flag.exercise_name} skipped ${flag.consecutive_count} sessions in a row.`;
  }
  if (flag.type === 'repeated_weekday_skip') {
    const day = flag.weekday
      ? flag.weekday.charAt(0).toUpperCase() + flag.weekday.slice(1)
      : 'A weekday';
    return `${day} skipped ${flag.skip_count} times recently.`;
  }
  return null;
}

// Classify a weight delta (today − yesterday) into a pace flag.
// Returns null when the change is within normal range.
// Returns { direction: 'gain'|'loss', level: 'notable'|'spike' } otherwise.
export function classifyWeightPace(delta) {
  if (delta === null || delta === undefined) return null;
  const abs = Math.abs(delta);
  if (abs < 1.5) return null;
  return { direction: delta > 0 ? 'gain' : 'loss', level: abs >= 2.3 ? 'spike' : 'notable' };
}
