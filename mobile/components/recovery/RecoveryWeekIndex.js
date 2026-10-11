import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { formatDate } from '../../lib/format';
import { parseWorkoutNote } from '../../lib/parser/workoutNote';
import { RECOVERY_COMPARISON_STATES, RECOVERY_WEEK_STATUS } from '../../lib/data/recoveryAnalytics';
import { createStyles } from './analyticsRecoveryStyles';

function _weekNoteStatus(week, notesById) {
  const note = notesById.get(week.note_id);
  if (!note) return { kind: 'missing', title: null };
  const { ok } = parseWorkoutNote(note.raw_text || '');
  if (!ok) return { kind: 'unreadable', title: note.title || 'Untitled Routine' };
  return { kind: 'ok', title: note.title || 'Untitled Routine' };
}

// History week row (#1307): TWO sibling targets, never nested. The row focuses
// this block + week in Analytics evidence; a separately labelled "View note in
// Log" link navigates to the note and exists only when the note is readable.
export function WeekIndexRow({ block, week, notesById, selected = false, onFocusWeek, onNavigate }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const { kind, title } = _weekNoteStatus(week, notesById);
  const isAvailable = kind === 'ok';
  const blockTitle = block.baseline_note_title || 'Untitled Routine';

  const stateText = !isAvailable
    ? 'Note unavailable'
    : week.completed_at
      ? formatDate(week.completed_at)
      : 'In progress';

  return (
    <View style={[styles.weekIndexRow, selected && styles.historyRowSelected]}>
      <Pressable
        testID={`recovery-history-week-${block.id}-${week.week_number}`}
        onPress={() => onFocusWeek?.(block.id, week.week_id || week.id)}
        style={styles.weekIndexFocus}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`Show evidence for ${blockTitle}, Recovery Week ${week.week_number}, ${stateText}`}
      >
        <Text style={styles.weekIndexWeekLabel}>{`Week ${week.week_number}`}</Text>
        {title != null && <Text style={styles.weekIndexNoteTitle} numberOfLines={1}>{title}</Text>}
        <Text style={styles.weekIndexStateText}>{stateText}</Text>
      </Pressable>
      {isAvailable ? (
        <Pressable
          testID={`recovery-history-week-log-${block.id}-${week.week_number}`}
          onPress={() => onNavigate?.('Log', { kind: 'note', noteId: week.note_id })}
          style={styles.weekIndexLogLink}
          accessibilityRole="button"
          accessibilityLabel={`View note in Log: ${blockTitle}, Recovery Week ${week.week_number}, ${title}`}
        >
          <Text style={styles.weekIndexLogLinkText}>View note in Log</Text>
          <MaterialIcons name="chevron-right" size={16} color={kua ? kua.primary : colors.accent} accessible={false} />
        </Pressable>
      ) : null}
    </View>
  );
}

export { deriveTrainedElsewhere } from '../../lib/data/recoverySnapshot';
