import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Button, SectionTitle } from './UI';
import { Colors } from '../theme/colors';
import { localDate } from '../lib/LogScreenHelpers';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';

export function LogPreviousRoutines({
  otherNotes,
  handleViewOtherNote,
  viewingNoteId,
  viewingNote,
  viewingNoteDayGroups,
  handleSwitchCurrent,
  handleEditViewedNote,
  handleDeleteRoutine,
  handleCreateRoutine,
}) {
  // Double-tap the viewed routine body to open it in the editor (matches main).
  const viewingNoteLastTapRef = useRef(0);
  const handleViewedNoteBodyPress = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - viewingNoteLastTapRef.current < DOUBLE_TAP_DELAY) {
      handleEditViewedNote();
      viewingNoteLastTapRef.current = 0;
    } else {
      viewingNoteLastTapRef.current = now;
    }
  };

  return (
    <View style={styles.previousRoutines}>
      {otherNotes.length > 0 && (
        <>
          <SectionTitle>More Routines</SectionTitle>
          {otherNotes.map(other => (
            <Card
              key={other.id}
              style={styles.otherNoteCard}
            >
              <Pressable
                onPress={() => handleViewOtherNote(other)}
                style={styles.otherNoteHeader}
              >
                <View style={styles.otherNoteInfo}>
                  <Text style={styles.otherNoteTitle}>{other.title || 'Untitled Routine'}</Text>
                  {other.updated_at && (
                    <Text style={styles.otherNoteSub}>{localDate(other.updated_at).toLocaleDateString()}</Text>
                  )}
                </View>
                <Pressable
                  onPress={(e) => { e.stopPropagation(); handleSwitchCurrent(other.id); }}
                  style={styles.inlineSwitchButton}
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                >
                  <Text style={styles.inlineSwitchButtonText}>Set as current routine</Text>
                </Pressable>
              </Pressable>
              {viewingNoteId === other.id && viewingNote && (
                <>
                  <Pressable onPress={handleViewedNoteBodyPress} style={styles.currentNoteContent}>
                    <Text style={styles.editHint}>Double-tap to edit</Text>
                    <WorkoutContentRenderer
                      dayGroups={viewingNoteDayGroups}
                      emptyText="No exercises to display."
                    />
                  </Pressable>
                  <View style={styles.inlineActions}>
                    <Button
                      onPress={handleEditViewedNote}
                      title="Edit routine"
                      style={styles.switchButton}
                      textStyle={styles.switchButtonText}
                    />
                    <Button
                      onPress={() => viewingNote && handleDeleteRoutine(viewingNoteId, viewingNote.title || 'Untitled Routine', false)}
                      title="Delete routine"
                      style={styles.deleteButton}
                      textStyle={styles.deleteButtonText}
                    />
                  </View>
                </>
              )}
            </Card>
          ))}
        </>
      )}
      <Button
        onPress={handleCreateRoutine}
        title="+ New routine"
        style={styles.createButton}
        textStyle={styles.createButtonText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  previousRoutines: {
    marginTop: 4,
    gap: 12,
  },
  otherNoteCard: {
    padding: 0,
    overflow: 'hidden',
  },
  otherNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
    gap: 12,
  },
  otherNoteInfo: {
    flex: 1,
  },
  otherNoteTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  otherNoteSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  inlineSwitchButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.chipBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  inlineSwitchButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  editHint: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 8,
  },
  inlineActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  switchButtonText: {
    color: Colors.accent,
  },
  deleteButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.error,
  },
  deleteButtonText: {
    color: Colors.error,
  },
  createButton: {
    marginTop: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.accent,
    borderStyle: 'dashed',
  },
  createButtonText: {
    color: Colors.accent,
  },
});
