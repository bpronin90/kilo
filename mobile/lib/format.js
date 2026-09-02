import { formatLiftWeightValue } from './units';
import { WEIGHT_PACE_NOTABLE_THRESHOLD, WEIGHT_PACE_SPIKE_THRESHOLD, classifyWeightPace } from './data/weightGoal';

// Canonical weight-pace classification lives in the data layer; re-exported here
// so existing format consumers keep a single import site. See
// mobile/lib/data/weightGoal.js for the elapsed-day rules.
export { classifyWeightPace };

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

export function formatWorkoutSets(sets, unit = 'lb') {
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
    const weightStr = group.weight ? `${formatLiftWeightValue(group.weight, unit)} ${unit}` : 'BW';
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
  if (abs >= WEIGHT_PACE_SPIKE_THRESHOLD) return 'spike';
  if (abs >= WEIGHT_PACE_NOTABLE_THRESHOLD) return 'notable';
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

// Human-readable elapsed span for a pace flag, so a badge or label states the
// period in words instead of leaving it to color alone.
// elapsedDays is the whole calendar-day gap between the two compared weigh-in
// dates; null or 1 reads as consecutive days.
export function formatPaceElapsed(elapsedDays) {
  if (elapsedDays == null || elapsedDays <= 1) return 'day-over-day';
  return `over ${elapsedDays} days`;
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
