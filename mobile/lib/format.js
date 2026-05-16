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
