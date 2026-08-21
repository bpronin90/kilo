// The active routine card (#711 information hierarchy, restyled #843): the
// header carries identity only — title and status badges — and every action
// lives in the one control row directly under it. The header stays a press
// target for collapse/expand; it hosts no controls of its own, so a header
// can never win a width fight with its own title.
//
// #843 owner-authorized exception to the Log tab's style lock, scoped to this
// file plus LogRecoverySection.js, RecoveryBlockEndModal.js, and
// LogPreviousRoutines.js.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
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
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // An explicit accessibilityLabel on an accessible ancestor replaces the label VoiceOver
  // would otherwise derive from its Text descendants (#738 review) — so the routine title
  // and every visible status badge must be spelled out here too, or focusing it announces
  // only "Collapse/Expand current routine".
  const collapseLabel = [
    `${isCollapsed ? 'Expand' : 'Collapse'} ${workoutNoteTitle || 'Untitled Routine'}`,
    'Current',
    recoveryWeekNumber != null ? `Recovery Week ${recoveryWeekNumber}` : null,
  ].filter(Boolean).join(', ');
  const isB = effectiveActiveWeek === 'B';
  return (
    <View style={styles.mirrorContainer}>
      <Card style={styles.currentRoutineCard}>
        {/* Standard card border, with a single 4px accent top rail replacing
            the former 4px all-round border (#843) — the active note is still
            identifiable at a glance, without a filled rectangle everywhere
            else on screen using the ordinary 1px border. */}
        <View style={styles.accentRail} />
        <Pressable
          onPress={toggleCollapsed} // Tapping the header collapses/expands the card body
          style={styles.otherNoteHeader}
          accessibilityRole="button"
          accessibilityLabel={collapseLabel}
          accessibilityState={{ expanded: !isCollapsed }}
        >
          <View style={styles.otherNoteInfo}>
            <View style={styles.badgeRow}>
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>CURRENT</Text>
              </View>
              {recoveryWeekNumber != null && (
                <View
                  style={styles.recoveryBadge}
                  accessible
                  accessibilityLabel={`Recovery Week ${recoveryWeekNumber}`}
                >
                  <Text style={styles.recoveryBadgeText}>RECOVERY WEEK {recoveryWeekNumber}</Text>
                </View>
              )}
            </View>
            <Text
              style={styles.currentNoteTitle}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {workoutNoteTitle || 'Untitled Routine'}
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={handleNoteBodyPress}
          style={[styles.currentNoteContent, isCollapsed ? { display: 'none' } : null]}
        >
          {/* The card's one control row (#843): a consistently shaped 38px
              row of Edit, the A/B segment, and Skip week/Remove skip. */}
          <View style={styles.controlRow}>
            <Pressable
              onPress={(e) => { e.stopPropagation(); enterCurrentEditor(); }}
              style={styles.controlButton}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel="Edit routine"
            >
              <MaterialIcons name="edit" size={14} color={colors.accent} accessible={false} />
              <Text style={styles.controlButtonText}>Edit</Text>
            </Pressable>
            {hasABWeeks && (
              <Pressable
                onPress={(e) => { e.stopPropagation(); handleToggleWeek(); }}
                style={styles.controlButton}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel={`Switch to Week ${isB ? 'A' : 'B'}`}
                accessibilityState={{ selected: isB }}
              >
                <Text style={styles.controlButtonText}>
                  Week {isB ? 'A' : 'B'}
                </Text>
              </Pressable>
            )}
            {/* One skip control, never two (#711). The state decides which
                single control exists. */}
            {canUnskipWeek ? (
              handleUnskipWeek && (
                <Pressable
                  onPress={(e) => { e.stopPropagation(); handleUnskipWeek(); }}
                  style={styles.controlButton}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  accessibilityLabel="Remove skip"
                  accessibilityRole="button"
                >
                  <MaterialIcons name="play-arrow" size={14} color={colors.textMuted} accessible={false} />
                  {/* Deliberately not "Undo skip": that text collides with the
                      unrelated editor-header "Undo" button substring-matched
                      by tests elsewhere in this screen tree. */}
                  <Text style={styles.controlButtonTextMuted}>Remove skip</Text>
                </Pressable>
              )
            ) : (
              handleSkipWeek && (
                <Pressable
                  onPress={(e) => { e.stopPropagation(); handleSkipWeek(); }}
                  style={styles.controlButton}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  accessibilityLabel="Skip week"
                  accessibilityRole="button"
                >
                  <MaterialIcons name="pause" size={14} color={colors.textMuted} accessible={false} />
                  <Text style={styles.controlButtonTextMuted}>Skip week</Text>
                </Pressable>
              )
            )}
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
  currentRoutineCard: {
    padding: 0,
    overflow: 'hidden',
  },
  // A single 4px accent rail across the top edge (#843), replacing the former
  // 4px all-round border. The card keeps its ordinary 1px `cardBorder` from
  // `Card`'s own base style.
  accentRail: {
    height: 4,
    backgroundColor: colors.accent,
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
    minWidth: 96,
    gap: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  // The one filled `CURRENT` badge (#843), the loudest status mark on the
  // card besides the title itself.
  currentBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: colors.onAccent,
  },
  // A quieter outlined badge, only when applicable (#843) — subordinate to
  // `CURRENT`, never the loudest mark on the card.
  recoveryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  recoveryBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: colors.textMuted,
  },
  // `colors.text`, not `colors.accent` (#843) — the accent ink is now carried
  // by the `CURRENT` badge and the top rail, not the title itself.
  currentNoteTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  // The card's one control row (#843): Edit, the A/B pill, and Skip
  // week/Remove skip, each a consistently shaped 38px control.
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    flexShrink: 1,
  },
  controlButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  controlButtonTextMuted: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  skipWeekStatusText: {
    fontSize: 11,
    color: colors.accent,
    marginBottom: 8,
    marginTop: -4,
  },
});
