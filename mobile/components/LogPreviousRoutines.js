// Non-current routine cards (#711 information hierarchy): every action on these
// cards is occasional, so the card header carries identity only — title, date,
// recovery badge — and a collapsed More Routines list therefore shows zero
// buttons. Tapping a card expands it, and the expanded body is where Week A/B,
// Set as current routine, Edit routine, and Delete routine live.
import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Button, SectionTitle } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
import { localDate } from '../lib/LogScreenHelpers';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';

export function LogPreviousRoutines({
  otherNotes,
  handleViewOtherNote,
  viewingNoteId,
  viewingNote,
  viewingNoteDayGroups,
  viewingHasABWeeks,
  viewingEffectiveWeek,
  handleToggleViewingWeek,
  handleSwitchCurrent,
  handleEditViewedNote,
  handleDeleteRoutine,
  handleCreateRoutine,
  recoveryWeekNumberByNoteId = {},
}) {
  const styles = useThemedStyles(createStyles);
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
                  <Text
                    style={styles.otherNoteTitle}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {other.title || 'Untitled Routine'}
                  </Text>
                  {other.updated_at && (
                    <Text style={styles.otherNoteSub}>
                      {viewingNoteId === other.id && viewingHasABWeeks
                        ? `Week ${viewingEffectiveWeek} · ${localDate(other.updated_at).toLocaleDateString()}`
                        : localDate(other.updated_at).toLocaleDateString()}
                    </Text>
                  )}
                  {recoveryWeekNumberByNoteId[other.id] != null && (
                    <View
                      style={styles.recoveryBadge}
                      accessible
                      accessibilityLabel={`Recovery Week ${recoveryWeekNumberByNoteId[other.id]}`}
                    >
                      <Text style={styles.recoveryBadgeText}>
                        Recovery Week {recoveryWeekNumberByNoteId[other.id]}
                      </Text>
                    </View>
                  )}
                </View>
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
                    {/* The viewed card's Week A/B switch (#711). It keeps the
                        pill form — it changes which week you are READING, not a
                        routine-lifecycle action like the buttons below — and
                        keeps the exact role/label/selected state it had in the
                        header it moved out of. */}
                    {viewingHasABWeeks && (
                      <View style={styles.viewActions}>
                        <Pressable
                          onPress={handleToggleViewingWeek}
                          style={styles.inlineSwitchButton}
                          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Switch to Week ${viewingEffectiveWeek === 'B' ? 'A' : 'B'}`}
                          accessibilityState={{ selected: viewingEffectiveWeek === 'B' }}
                        >
                          <Text style={styles.inlineSwitchButtonText}>
                            Week {viewingEffectiveWeek === 'B' ? 'A' : 'B'}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                    <Button
                      onPress={handleEditViewedNote}
                      title="Edit routine"
                      style={styles.switchButton}
                      textStyle={styles.switchButtonText}
                    />
                    <Button
                      onPress={() => handleSwitchCurrent(other.id)}
                      title="Set as current routine"
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

const createStyles = (colors) => StyleSheet.create({
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
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 24,
    gap: 12,
  },
  otherNoteInfo: {
    flex: 1,
    // See LogActiveRoutineCard.js's otherNoteInfo comment: a hard floor, not 0
    // (#710 review), retained now that the header holds identity only (#711).
    minWidth: 96,
  },
  otherNoteTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  otherNoteSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  // Purely presentational metadata layered on top of the ordinary note
  // header — the badge never affects title, text, selection, or rendering.
  recoveryBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.chipBackground,
  },
  recoveryBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: colors.chipText,
  },
  inlineSwitchButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
    // See LogActiveRoutineCard.js's inlineSwitchButton comment (#710 review).
    flexShrink: 1,
  },
  inlineSwitchButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  editHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 8,
  },
  inlineActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  // Holds the Week A/B pill at its natural width inside the otherwise
  // full-width button stack (a column container would stretch it edge to edge).
  viewActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  switchButtonText: {
    color: colors.accent,
  },
  deleteButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.error,
  },
  deleteButtonText: {
    color: colors.error,
  },
  createButton: {
    marginTop: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
    borderStyle: 'dashed',
  },
  createButtonText: {
    color: colors.accent,
  },
});
