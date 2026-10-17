import React, { useMemo } from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { formatDate } from '../../lib/format';
import { parseWorkoutNote } from '../../lib/parser/workoutNote';
import { createStyles } from './analyticsRecoveryStyles';

function _weekNoteStatus(week, notesById) {
  const note = notesById.get(week.note_id);
  if (!note) return { kind: 'missing', title: null };
  const { ok } = parseWorkoutNote(note.raw_text || '');
  if (!ok) return { kind: 'unreadable', title: note.title || 'Untitled Routine' };
  return { kind: 'ok', title: note.title || 'Untitled Routine' };
}

// History week row (#1307, #1442): ONE compact focus target — "Week N · state".
// The routine title is already on the block row above, so it is not repeated
// here, and there is no per-week note link (that path lived in Log).
export function WeekIndexRow({ block, week, notesById, selected = false, onFocusWeek }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const { kind } = _weekNoteStatus(week, notesById);
  const blockTitle = block.baseline_note_title || 'Untitled Routine';

  const stateText = kind !== 'ok'
    ? 'Note unavailable'
    : week.completed_at
      ? formatDate(week.completed_at)
      : 'In progress';

  return (
    <Pressable
      testID={`recovery-history-week-${block.id}-${week.week_number}`}
      onPress={() => onFocusWeek?.(block.id, week.week_id || week.id)}
      style={[styles.weekIndexRow, selected && styles.historyRowSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Show evidence for ${blockTitle}, Recovery Week ${week.week_number}, ${stateText}`}
    >
      <Text style={styles.weekIndexWeekLabel}>{`Week ${week.week_number}`}</Text>
      <Text style={styles.weekIndexStateText}>{stateText}</Text>
    </Pressable>
  );
}

export { deriveTrainedElsewhere } from '../../lib/data/recoverySnapshot';
