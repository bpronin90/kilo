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
  const weight = sets[0].weight_value;
  const reps = sets.map(s => s.rep_count).join(', ');
  const weightStr = weight ? `${weight} lb` : 'Bodyweight';
  return `${weightStr} ${reps}`;
}
