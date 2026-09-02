// The active routine card (#711 information hierarchy): the header carries
// identity only — title, `Week X · Current routine`, recovery badge — and every
// action lives in the one action strip directly under it. The header stays a
// press target for collapse/expand; it hosts no controls of its own, so a
// header can never win a width fight with its own title.
//
// This is the Current routine card, which the Log tab's style lock
// (`screens/LogScreen.js` lines 1-46) holds tighter than the rest of the tab:
// #843 and #847 explicitly do NOT authorize touching it. The one exception is
// #918, scoped to text `color` values only — `currentNoteTitle` and
// `skipWeekStatusText` take `colors.accentText`, and `inlineSwitchButtonText`,
// which sits on a `chipBackground` fill, takes `colors.chipAccentText`. The
// card's 4px `accent` border and every other value here remain locked.
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
  // #881: exercise source-jump wiring — passed straight through to
  // WorkoutContentRenderer, which no-ops the gesture whenever any of these
  // is missing. `currentId` (already a prop above, for the flagged-name
  // comparison) doubles as the source note id.
  onExerciseSourceJump,
  recoveryWeekNumber = null,
  // #870: true while an active Recovery block has paused this stored
  // routine as the baseline it is standing in for. This card is the ONLY
  // place the baseline itself is presented while paused — the note text
  // content is unchanged and stays readable/editable, but the identity
  // label switches from "Current routine" to "Baseline routine · paused" so
  // it never reads as the thing actually being trained right now (Recovery
  // already owns that role).
  baselinePaused = false,
}) {
  const styles = useThemedStyles(createStyles);
  const identityLabel = baselinePaused ? 'Baseline routine · paused' : 'Current routine';
  // An explicit accessibilityLabel on an accessible ancestor replaces the label VoiceOver
  // would otherwise derive from its Text descendants (#738 review) — so the routine title,
  // week, and recovery-week badge that are visibly inside this header must be spelled out
  // here too, or focusing it announces only "Collapse/Expand current routine".
  const collapseLabel = [
    `${isCollapsed ? 'Expand' : 'Collapse'} ${workoutNoteTitle || 'Untitled Routine'}`,
    hasABWeeks ? `Week ${effectiveActiveWeek} · ${identityLabel}` : identityLabel,
    recoveryWeekNumber != null ? `Recovery Week ${recoveryWeekNumber}` : null,
  ].filter(Boolean).join(', ');
  return (
    <View style={styles.mirrorContainer}>
      <Card style={styles.currentRoutineCard}>
        <Pressable
          onPress={toggleCollapsed} // Tapping the header collapses/expands the card body
          style={styles.otherNoteHeader}
          accessibilityRole="button"
          accessibilityLabel={collapseLabel}
          accessibilityState={{ expanded: !isCollapsed }}
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
              {hasABWeeks ? `Week ${effectiveActiveWeek} · ${identityLabel}` : identityLabel}
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
        </Pressable>

        <Pressable
          onPress={handleNoteBodyPress}
          style={[styles.currentNoteContent, isCollapsed ? { display: 'none' } : null]}
        >
          {/* The card's one action strip. `Double-tap to edit` used to live on
              the left of this row; the explicit `Edit` control supersedes it as
              the advertised path. handleNoteBodyPress stays wired on the body
              above, so the double-tap gesture still works for users who know
              it — it is simply no longer the only way in. */}
          <View style={styles.actionStrip}>
            <View style={styles.actionStripPrimary}>
              <Pressable
                onPress={(e) => { e.stopPropagation(); enterCurrentEditor(); }}
                style={styles.inlineSwitchButton}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel="Edit routine"
              >
                <Text style={styles.inlineSwitchButtonText}>Edit</Text>
              </Pressable>
              {hasABWeeks && (
                <Pressable
                  onPress={(e) => { e.stopPropagation(); handleToggleWeek(); }}
                  style={styles.inlineSwitchButton}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to Week ${effectiveActiveWeek === 'B' ? 'A' : 'B'}`}
                  accessibilityState={{ selected: effectiveActiveWeek === 'B' }}
                >
                  <Text style={styles.inlineSwitchButtonText}>
                    Week {effectiveActiveWeek === 'B' ? 'A' : 'B'}
                  </Text>
                </Pressable>
              )}
            </View>
            {/* One skip control, never two (#711). Previously both rendered and
                `canUnskipWeek` only dimmed `Remove skip` to opacity 0.4 over
                already-muted text — two contradictory-looking controls, with the
                disabled state carried by opacity alone (ui-design-rules §13
                contrast). The state now decides which single control exists. */}
            <View style={styles.skipWeekActions}>
              {canUnskipWeek ? (
                handleUnskipWeek && (
                  <Pressable
                    onPress={(e) => { e.stopPropagation(); handleUnskipWeek(); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.skipWeekButton}
                    accessibilityLabel="Remove skip"
                    accessibilityRole="button"
                  >
                    {/* Deliberately not "Undo skip": that text collides with the
                        unrelated editor-header "Undo" button substring-matched
                        by tests elsewhere in this screen tree. */}
                    <Text style={styles.skipWeekText}>Remove skip</Text>
                  </Pressable>
                )
              ) : (
                handleSkipWeek && (
                  <Pressable
                    onPress={(e) => { e.stopPropagation(); handleSkipWeek(); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.skipWeekButton}
                    accessibilityLabel="Skip week"
                    accessibilityRole="button"
                  >
                    <Text style={styles.skipWeekText}>Skip week</Text>
                  </Pressable>
                )
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
            sourceNoteId={currentId}
            sourceWeekIndex={hasABWeeks && effectiveActiveWeek === 'B' ? 1 : 0}
            sourceSliceText={activeEditText}
            onExercisePress={onExerciseSourceJump}
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
    // A hard floor, not 0 (#710 review). The header no longer has an action
    // row to lose width to (#711), but flex:1 still gives this column a zero
    // flex-basis, so the floor is what keeps the title from being handed 0dp
    // by anything placed beside it. 96 clears the widest word in a routine
    // title like "Return (ease the back) rehab" at both title font sizes, so
    // it never degrades to per-letter wrapping.
    minWidth: 96,
  },
  currentNoteTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.accentText,
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
    color: colors.chipAccentText,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  // The card's single action strip (#711), grown out of the former
  // `editHintRow`: same row, same position, same 8px separation from the
  // content below. `flexWrap` + `gap` are the containment props the header
  // action row used to carry — the strip is now the only row that has to hold
  // more than one control, so the wrap behavior belongs here.
  actionStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  actionStripPrimary: {
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: 12,
  },
  skipWeekActions: {
    flexDirection: 'row',
    gap: 12,
  },
  // 44dp floor and a text size matching the pills beside it (#823): this was
  // previously a bare Pressable sized only by its 11px text, noticeably
  // smaller and easier to mis-tap than Edit/Week A-B in the same row.
  skipWeekButton: {
    minHeight: 44,
    justifyContent: 'center',
    flexShrink: 1,
  },
  skipWeekText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  skipWeekStatusText: {
    fontSize: 11,
    color: colors.accentText,
    marginBottom: 8,
    marginTop: -4,
  },
});
