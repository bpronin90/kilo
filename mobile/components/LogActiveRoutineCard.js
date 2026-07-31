import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
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
  noteError,
  trackedLifts,
  handleToggleTrack,
  roughNoteId,
  currentId,
  roughFlaggedNames,
  activeEditText,
  recoveryWeekNumber = null,
  isEligibleForRecoveryBaseline = false,
  onStartRecoveryBlock,
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.mirrorContainer}>
      <Card style={styles.currentRoutineCard}>
        <Pressable
          onPress={toggleCollapsed} // Tapping the header collapses/expands the card body
          style={styles.otherNoteHeader}
        >
          <View style={styles.otherNoteInfo}>
            <Text
              style={styles.currentNoteTitle}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {workoutNoteTitle || 'Untitled Routine'}
            </Text>
            <Text style={styles.otherNoteSub}>
              {hasABWeeks ? `Week ${effectiveActiveWeek} · Current routine` : 'Current routine'}
            </Text>
            {recoveryWeekNumber != null && (
              <View
                style={styles.recoveryBadge}
                accessible
                accessibilityLabel={`Recovery Week ${recoveryWeekNumber}`}
              >
                <Text style={styles.recoveryBadgeText}>Recovery Week {recoveryWeekNumber}</Text>
              </View>
            )}
          </View>
          <View style={styles.currentHeaderActions}>
            {isEligibleForRecoveryBaseline && onStartRecoveryBlock && (
              <Pressable
                onPress={(e) => { e.stopPropagation(); onStartRecoveryBlock(); }}
                style={styles.inlineSwitchButton}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel="Start recovery block from this routine"
              >
                <Text style={styles.inlineSwitchButtonText}>Start recovery block</Text>
              </Pressable>
            )}
            {hasABWeeks && (
              <Pressable
                onPress={(e) => { e.stopPropagation(); handleToggleWeek(); }}
                style={styles.inlineSwitchButton}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <Text style={styles.inlineSwitchButtonText}>
                  Week {effectiveActiveWeek === 'B' ? 'A' : 'B'}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={(e) => { e.stopPropagation(); enterCurrentEditor(); }}
              style={styles.inlineSwitchButton}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
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
            noteError={noteError}
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

const createStyles = (colors) => StyleSheet.create({
  mirrorContainer: {
    paddingBottom: 2,
  },
  // The one card that deviates from the shared 1px cardBorder: the current
  // routine keeps a 4px accent border on all sides in both modes so the active
  // note stays identifiable at a glance (#689). Ordinary cards are never
  // special-cased this way.
  currentRoutineCard: {
    padding: 0,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: colors.accent,
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
    // A hard floor, not 0: flex:1 gives this a zero flex-basis, so with an
    // unbounded sibling action row the shrink algorithm hands the title 0dp
    // before ever touching the action row's width (#710 review). Freezing
    // the title at this floor forces the remaining deficit onto the action
    // row instead. 96 clears the widest word in a routine title like
    // "Return (ease the back) rehab" at both title font sizes, so it never
    // degrades to per-letter wrapping.
    minWidth: 96,
  },
  currentHeaderActions: {
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 12,
  },
  currentNoteTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.accent,
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
    // Lets a single pill shrink (its Text wraps) rather than overflow past
    // the card's clipped right edge once the action row is squeezed below
    // the pill's natural width (#710 review).
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
  editHintRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  editHint: {
    fontSize: 11,
    color: colors.textMuted,
  },
  skipWeekActions: {
    flexDirection: 'row',
    gap: 12,
  },
  skipWeekText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  skipWeekTextDisabled: {
    opacity: 0.4,
  },
  skipWeekStatusText: {
    fontSize: 11,
    color: colors.accent,
    marginBottom: 8,
    marginTop: -4,
  },
});
