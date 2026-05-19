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
