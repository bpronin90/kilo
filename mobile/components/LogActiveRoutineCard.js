import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './UI';
import { Colors } from '../theme/colors';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';

export function LogActiveRoutineCard({
  workoutNoteTitle,
  hasABWeeks,
  effectiveActiveWeek,
  handleToggleWeek,
  enterCurrentEditor,
  handleNoteBodyPress,
  handleSkipWeek,
  handleUnskipWeek,
  canUnskipWeek,
  skipWeekStatus,
  toggleCollapsed,
  isCollapsed,
  dayGroups,
  trackedLifts,
  handleToggleTrack,
  roughNoteId,
  currentId,
  roughFlaggedNames,
  activeEditText,
}) {
  return (
    <View style={styles.mirrorContainer}>
      <Card style={styles.currentRoutineCard}>
        <Pressable
          onPress={toggleCollapsed} // Tapping the header collapses/expands the card body
          style={styles.otherNoteHeader}
        >
          <View style={styles.otherNoteInfo}>
            <Text style={styles.currentNoteTitle}>{workoutNoteTitle || 'Untitled Routine'}</Text>
            <Text style={styles.otherNoteSub}>
              {hasABWeeks ? `Week ${effectiveActiveWeek} · Current routine` : 'Current routine'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {hasABWeeks && (
              <Pressable
                onPress={(e) => { e.stopPropagation(); handleToggleWeek(); }}
                style={styles.inlineSwitchButton}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              >
                <Text style={styles.inlineSwitchButtonText}>
                  Week {effectiveActiveWeek === 'B' ? 'A' : 'B'}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={(e) => { e.stopPropagation(); enterCurrentEditor(); }}
              style={styles.inlineSwitchButton}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <Text style={styles.inlineSwitchButtonText}>Edit</Text>
            </Pressable>
          </View>
        </Pressable>

        <Pressable 
          onPress={handleNoteBodyPress}
          style={[styles.currentNoteContent, isCollapsed ? { display: 'none' } : null]}
        >
          <View style={styles.editHintRow}>
            <Text style={styles.editHint}>Double-tap to edit</Text>
            <View style={styles.skipWeekActions}>
              {handleSkipWeek && (
                <Pressable
                  onPress={(e) => { e.stopPropagation(); handleSkipWeek(); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Skip week"
                  accessibilityRole="button"
                >
                  <Text style={styles.skipWeekText}>Skip week</Text>
                </Pressable>
              )}
              {handleUnskipWeek && (
                <Pressable
                  onPress={(e) => { e.stopPropagation(); handleUnskipWeek(); }}
                  disabled={!canUnskipWeek}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Remove skip"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canUnskipWeek }}
                >
                  {/* Deliberately not "Undo skip": that text collides with the
                      unrelated editor-header "Undo" button substring-matched
                      by tests elsewhere in this screen tree. */}
                  <Text style={[styles.skipWeekText, !canUnskipWeek && styles.skipWeekTextDisabled]}>
                    Remove skip
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
          {skipWeekStatus ? (
            <Text style={styles.skipWeekStatusText}>{skipWeekStatus}</Text>
          ) : null}
          <WorkoutContentRenderer
            dayGroups={dayGroups}
            trackedLifts={trackedLifts}
            onToggleTrack={handleToggleTrack}
            roughNoteId={roughNoteId}
            currentId={currentId}
            roughFlaggedNames={roughFlaggedNames}
            emptyText="Add some exercises to see the formatted view."
            altWeekText={hasABWeeks ? activeEditText.trim() : ""}
          />
        </Pressable>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  mirrorContainer: {
    paddingBottom: 2,
  },
  currentRoutineCard: {
    padding: 0,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: Colors.cardBorder,
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
  currentNoteTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.accent,
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
  editHintRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  editHint: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  skipWeekActions: {
    flexDirection: 'row',
    gap: 12,
  },
  skipWeekText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  skipWeekTextDisabled: {
    opacity: 0.4,
  },
  skipWeekStatusText: {
    fontSize: 11,
    color: Colors.accent,
    marginBottom: 8,
    marginTop: -4,
  },
});
