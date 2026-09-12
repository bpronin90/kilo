import React from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
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

export function WeekIndexRow({ block, week, notesById, onNavigate }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { kind, title } = _weekNoteStatus(week, notesById);
  const isAvailable = kind === 'ok';

  const noteTitle = title;
  const stateText = !isAvailable
    ? 'Unavailable'
    : week.completed_at
      ? formatDate(week.completed_at)
      : 'In progress';

  const a11yLabel = [
    block.baseline_note_title || 'Untitled Routine',
    `Recovery Week ${week.week_number}`,
    noteTitle || 'Unavailable',
  ].join(', ');

  const rowContent = (
    <>
      <View style={styles.weekIndexRowHeader}>
        <Text style={[styles.weekIndexWeekLabel, !isAvailable && styles.weekIndexMuted]}>
          {`Week ${week.week_number}`}
        </Text>
        {isAvailable && (
          <MaterialIcons name="chevron-right" size={16} color={colors.accent} accessible={false} />
        )}
      </View>
      {noteTitle != null && (
        <Text style={styles.weekIndexNoteTitle} numberOfLines={1}>{noteTitle}</Text>
      )}
      <Text style={styles.weekIndexStateText}>{stateText}</Text>
    </>
  );

  if (isAvailable) {
    return (
      <Pressable
        onPress={() => onNavigate?.('Log', { kind: 'note', noteId: week.note_id })}
        style={styles.weekIndexRow}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
      >
        {rowContent}
      </Pressable>
    );
  }

  return (
    <View style={styles.weekIndexRow} accessible accessibilityLabel={a11yLabel}>
      {rowContent}
    </View>
  );
}
