// The active routine card (#711 information hierarchy): the collapse target
// carries identity only — title, `Week X · Current routine`, recovery badge. Its
// one sibling is the 44dp Routine actions trigger (#1244); Week A/B lives in
// the strip under it. Skip week and Remove skip live together in the Routine
// actions menu; Skip week is always offered (through saves and after a skip, a
// press mid-save answers with a status line). The title column keeps a width floor.
//
// This is the Current routine card, which the Log tab's style lock
// (`screens/LogScreen.js` lines 1-46) holds tighter than the rest of the tab:
// #843 and #847 explicitly do NOT authorize touching it. The one exception is
// #918, scoped to text `color` values only — `currentNoteTitle` and
// `skipWeekStatusText` take `colors.accentText`, and `inlineSwitchButtonText`,
// which sits on a `chipBackground` fill, takes `colors.chipAccentText`. The
// card's 4px `accent` border and every other value here remain locked.
//
// #1021 (trigger in header + compact sheet, #1244) owner-authorized exception, scoped to the action strip only: the
// four individual action pills this card used to show inline (Edit, Share,
// Copy, Share as Image) are consolidated into one 44dp three-dot menu
// (`menuButton` / `actionMenu`), so the header's only ALWAYS-visible pill is
// the compact Week A/B switch. Copy and Share stay distinct actions inside
// that menu — neither is merged into the other. Nothing else about the card
// (border, title, content, skip-week row) changes.
//
// #1109 owner-authorized exception: full KUA surface migration. The card
// `createStyles` factory now takes `(kua, colors)` and applies KUA tokens
// throughout: 2px primary border replaces the legacy 4px accent border;
// card/header backgrounds use surfaceCard/surfaceCardHeader; title adopts
// headline-md type in primary color; status uses on-surface-variant; badges
// and chips use primaryContainer/primaryOnContainer; action menu uses
// surfaceCard bg / surfaceBorder dividers; skip and status lines use
// on-surface-variant. No behavioral, data, or navigation change.
//
// #1606 (redesign v3 "Log", owner-approved): the card becomes the Log tab's
// single active panel — title (the collapse target), the identity line and a
// Week A / Week B segmented control, the sticky day index, and the routine in
// WorkoutContentRenderer's opt-in Log presentation. Plates and Routine actions
// move to the Log root header (screens/log/LogRoutineHeaderActions.js); LogScreen
// passes that one `routineActions` owner in, so the card renders no sheet of its
// own. A caller that passes none (an isolated mount) gets the same controls
// in the card header from its own instance, so the card stays self-contained.
import React, { useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { useKuaTypography } from '../theme/typography';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';
import { WorkoutKuaProvider } from './ui/workout';
import { ProgressionSuggestionCard, MutedProgressionRow } from './ProgressionSuggestionCard';
import { TYPOGRAPHY } from '../theme/typography';
import { GEOMETRY } from '../theme/spacing';
import { useLogRoutineActions } from './log/LogRoutineActionSheet';
import { LogRoutineHeaderActions } from '../screens/log/LogRoutineHeaderActions';
import { LogDayIndex, deriveLogDays } from '../screens/log/LogDayIndex';

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
  // #954 Share Routine. `routineRawText` is the FULL stored routine body —
  // both A/B halves and the `---` separator — which is what byte preservation
  // requires. `activeEditText` is only ever the active week's slice for an A/B
  // routine (useLogCurrentRoutineEditor.js), so it is a last-resort fallback
  // for a caller that supplies no body, not the intended source.
  routineRawText,
  onShareRoutine,
  // #960: explainable progression-suggestion cards for the current routine.
  // `progressionSuggestions` is already filtered by LogScreen (feature on,
  // renderable, not muted, not dismissed) — each entry is
  // `{ record, key, instanceId }`. This card only lays them out below the
  // routine content and forwards the three allowed actions.
  progressionSuggestions = [],
  mutedProgressionRows = [],
  onMuteProgression,
  onUnmuteProgression,
  onDismissProgression,
  // #1010: the production "Apply to note" path. `onApplyProgression(record)` is
  // `currentEditor.handleApplyProgressionSuggestion` threaded straight through
  // from LogScreen — it inserts the suggested target as new note content and
  // persists it, and resolves to `{ applied, reason }` (or throws). This card
  // owns only the wiring and the visible/accessible result line; it never
  // reconstructs a suggestion, and it hands each card the exact `record` that
  // card rendered.
  onApplyProgression,
  // #1606: the Log header's `useLogRoutineActions` owner, and the sticky day
  // index store (screens/log/LogDayIndex.js). Both optional.
  routineActions = null,
  dayNav = null,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(kua, colors), [kua, colors]);
  const typography = useKuaTypography();
  const ownActions = useLogRoutineActions({
    workoutNoteTitle, routineRawText, activeEditText, onShareRoutine, enterCurrentEditor,
    handleSkipWeek, handleUnskipWeek, canUnskipWeek, isCollapsed, toggleCollapsed,
  });
  const actions = routineActions || ownActions;
  const days = useMemo(() => deriveLogDays(dayGroups), [dayGroups]);
  // A single result line for the most recent explicit Apply attempt. Only an
  // `applied: true` result is allowed to read as success; every no-op, failure,
  // or thrown error explains that nothing was added. Every press reaches the
  // helper — no card-level in-flight guard — so a second press while the first
  // save is still running gets the helper's own `save-in-flight` result and its
  // retry-later line, rather than a silent no-op.
  const [applyStatus, setApplyStatus] = useState(null);
  const handleApplyProgression = async (record) => {
    if (typeof onApplyProgression !== 'function') return;
    let message;
    try {
      const result = await onApplyProgression(record);
      if (result && result.applied === true) {
        message = 'Applied. The suggested target was added to your note.';
      } else if (result && result.reason === 'save-in-flight') {
        message = 'Wait for the current save to finish, then try Apply again. Nothing was added.';
      } else if (result && result.reason === 'save-failed') {
        message = 'Couldn’t save the change, so the target was not added to your note.';
      } else {
        message = 'This suggestion no longer applies, so nothing was added to your note.';
      }
    } catch {
      message = 'Couldn’t apply the suggestion. Nothing was added to your note.';
    }
    setApplyStatus(message);
    AccessibilityInfo.announceForAccessibility?.(message);
  };
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
  const weekOptions = hasABWeeks ? ['A', 'B'] : [];
  return (
    <View style={styles.mirrorContainer} onLayout={dayNav?.onCardLayout}>
      <Card style={styles.currentRoutineCard}>
        <View style={styles.headerBlock}>
          {/* #1244: the collapse target and the (isolated-mount) actions are
              siblings, so the collapse press hosts no nested control. */}
          <View style={styles.headerRow}>
            <Pressable
              onPress={() => { actions.setMenuOpen(false); toggleCollapsed && toggleCollapsed(); }} // Tapping the title collapses/expands the card body
              style={styles.otherNoteHeader}
              accessibilityRole="button"
              accessibilityLabel={collapseLabel}
              accessibilityState={{ expanded: !isCollapsed }}
            >
              <Text style={[typography['headline-md'], styles.currentNoteTitle]} numberOfLines={2} ellipsizeMode="tail">
                {workoutNoteTitle || 'Untitled Routine'}
              </Text>
            </Pressable>
            {routineActions ? null : <LogRoutineHeaderActions actions={actions} />}
          </View>
          <View style={styles.metaRow}>
            <Text style={[typography['label-md'], styles.otherNoteSub]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              {identityLabel}
            </Text>
            {hasABWeeks && (
              <View style={styles.weekSeg} accessibilityRole="radiogroup" accessibilityLabel="Routine week">
                {weekOptions.map((wk) => {
                  const on = effectiveActiveWeek === wk;
                  return (
                    <Pressable
                      key={wk}
                      onPress={(e) => { e?.stopPropagation?.(); if (!on) handleToggleWeek(); }}
                      style={styles.weekTarget}
                      accessibilityRole="radio"
                      accessibilityLabel={`Week ${wk}`}
                      accessibilityState={{ checked: on, selected: on }}
                    >
                      <View style={[styles.weekOption, on ? styles.weekOptionOn : null]}>
                        <Text style={[typography['label-md'], styles.weekText, on ? styles.weekTextOn : null]}>{`Week ${wk}`}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
          {recoveryWeekNumber != null && (
            <View style={styles.recoveryBadge} accessible accessibilityLabel={`Recovery Week ${recoveryWeekNumber}`}>
              <Text style={styles.recoveryBadgeText}>Recovery Week {recoveryWeekNumber}</Text>
            </View>
          )}
        </View>

        {!isCollapsed && <LogDayIndex days={days} nav={dayNav} />}

        <Pressable
          onPress={handleNoteBodyPress}
          onLayout={dayNav?.onBodyLayout}
          style={[styles.currentNoteContent, isCollapsed ? { display: 'none' } : null]}
        >
          {skipWeekStatus ? (
            <Text style={styles.skipWeekStatusText}>{skipWeekStatus}</Text>
          ) : null}
          {actions.copyStatus ? (
            <Text
              style={styles.skipWeekStatusText}
              accessibilityLiveRegion="polite"
              testID="log-copy-routine-status"
            >
              {actions.copyStatus.message}
            </Text>
          ) : null}
          <WorkoutKuaProvider kua={kua}>
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
              presentation="log"
              onDayLayout={dayNav?.onDayLayout}
            />
          </WorkoutKuaProvider>

          {(progressionSuggestions.length > 0 || mutedProgressionRows.length > 0 || applyStatus) && (
            <View style={styles.progressionSuggestions} testID="log-progression-suggestions">
              {progressionSuggestions.map(({ record, key, instanceId }) => (
                <ProgressionSuggestionCard
                  key={instanceId}
                  suggestion={record}
                  surface="log"
                  onApply={
                    typeof onApplyProgression === 'function'
                      ? () => handleApplyProgression(record)
                      : undefined
                  }
                  onMute={() => onMuteProgression && onMuteProgression(key)}
                  onDismiss={() => onDismissProgression && onDismissProgression(instanceId)}
                />
              ))}
              {mutedProgressionRows.map(row => (
                <MutedProgressionRow
                  key={row.key}
                  name={row.name}
                  onUnmute={() => onUnmuteProgression && onUnmuteProgression(row.key)}
                />
              ))}
              {applyStatus ? (
                <Text
                  style={styles.progressionApplyStatus}
                  accessibilityLiveRegion="polite"
                  testID="log-progression-apply-status"
                >
                  {applyStatus}
                </Text>
              ) : null}
            </View>
          )}
        </Pressable>
      </Card>
    </View>
  );
}

// #1109: signature takes (kua, colors) — kua is the active KUA palette and
// colors is the legacy palette. KUA tokens are used throughout; colors is kept
// for properties that have no direct KUA equivalent (error, shadowColor).
const createStyles = (kua, colors) => StyleSheet.create({
  mirrorContainer: {
    paddingBottom: 2,
  },
  // #960: a plain vertical stack under the routine content.
  progressionSuggestions: {
    marginTop: 16,
    gap: 12,
  },
  // #1010/#1109: status line below the content area.
  progressionApplyStatus: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.accentText,
  },
  // #1109: the primary routine card now uses the KUA activeCard border level —
  // 2px primary border replacing the legacy 4px accent border. The card stays
  // visually distinct as the active routine; primary color provides identity
  // without the heavier accent stroke.
  currentRoutineCard: {
    padding: 0,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: kua ? kua.primary : colors.accent,
    backgroundColor: kua ? kua.surfaceCard : undefined,
  },
  // #1606: header block = title row (collapse target) + identity/week row.
  headerBlock: {
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 16,
    paddingRight: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.surfaceCardHeader : undefined,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  otherNoteHeader: {
    flex: 1,
    // A hard floor (#710 review): keeps the title from being handed 0dp by
    // anything placed beside it.
    minWidth: 96,
    minHeight: 44,
    justifyContent: 'center',
  },
  currentNoteTitle: {
    fontSize: 20,
    lineHeight: 26,
    color: kua ? kua.primaryOnContainer : colors.accentText,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 4,
  },
  otherNoteSub: {
    textTransform: 'uppercase',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Week A / Week B segmented control: 44dp targets around 34dp segments.
  weekSeg: {
    flexDirection: 'row',
    borderRadius: GEOMETRY['radius-lg'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
    paddingHorizontal: 3,
  },
  weekTarget: {
    minHeight: 44,
    justifyContent: 'center',
  },
  weekOption: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: GEOMETRY['radius-md'],
    justifyContent: 'center',
  },
  weekOptionOn: {
    backgroundColor: kua ? kua.primary : colors.accent,
  },
  weekText: {
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  weekTextOn: {
    fontWeight: '600',
    color: kua ? kua.onPrimary : colors.background,
  },
  // Purely presentational metadata layered on top of the ordinary note
  // header — the badge never affects title, text, selection, or rendering.
  recoveryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
    borderWidth: kua ? 1 : 0,
    borderColor: kua ? kua.primaryContainerBorder : undefined,
  },
  recoveryBadgeText: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: kua ? '500' : '800',
    textTransform: 'uppercase',
    color: kua ? kua.primaryOnContainer : colors.chipText,
  },
  currentNoteContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
  },
  skipWeekStatusText: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.accentText,
    marginTop: 8,
  },
});
