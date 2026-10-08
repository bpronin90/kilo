// The active routine card (#711 information hierarchy): the collapse target
// carries identity only — title, `Week X · Current routine`, recovery badge. Its
// one sibling is the 44dp Routine actions trigger (#1244); Week A/B and Skip
// week live in the strip under it. The title column keeps a width floor.
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
import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';
import { WorkoutKuaProvider } from './ui/workout';
import {
  shareRoutine,
  copyRoutineToClipboard,
  ROUTINE_COPY_SUCCESS_MESSAGE,
  ROUTINE_COPY_FAILURE_MESSAGE,
} from '../lib/interoperability/routineShare';
import { RoutineShareModal } from './RoutineShareCard';
import { MODAL_SUPPORTED_ORIENTATIONS } from './adaptiveLayout';
import { ProgressionSuggestionCard, MutedProgressionRow } from './ProgressionSuggestionCard';
import { TYPOGRAPHY } from '../theme/typography';
import { GEOMETRY } from '../theme/spacing';

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
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(kua, colors), [kua, colors]);
  const [imageShare, setImageShare] = useState(null);
  // #1021: the consolidated three-dot menu's open state. Closes itself after
  // any item is chosen, and on header collapse (the menu has nothing to
  // attach to once the body it lives in is hidden).
  const [menuOpen, setMenuOpen] = useState(false);
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
        message = 'Applied — the suggested target was added to your note.';
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
  const handleShareRoutine = () => {
    const payload = { title: workoutNoteTitle, rawText: routineRawText ?? activeEditText };
    if (onShareRoutine) onShareRoutine(payload);
    else shareRoutine(payload);
  };
  // A single transient status line for the most recent copy attempt, matching
  // the card's existing `skipWeekStatus` treatment. Stored as a fresh object per
  // attempt (not a bare string) so a second copy while the same message is still
  // showing is a real state change — the auto-expire effect below re-runs and
  // restarts its 4s window rather than letting the first timer clear the line
  // early. The payload is the FULL stored routine body (`routineRawText`), never
  // the viewed-week slice — copy must carry both A/B halves and the `---`.
  const [copyStatus, setCopyStatus] = useState(null);
  // Auto-expire the confirmation like the card's other transient lines
  // (`skipWeekStatus` clears itself after 4s in useLogCurrentRoutineEditor.js).
  // The cleanup makes a fast unmount or a second copy cancel the pending clear.
  useEffect(() => {
    if (!copyStatus) return undefined;
    const timer = setTimeout(() => setCopyStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const handleCopyRoutine = () => {
    const payload = { title: workoutNoteTitle, rawText: routineRawText ?? activeEditText };
    return copyRoutineToClipboard(payload).then(({ ok, showConfirmation }) => {
      if (!ok) {
        setCopyStatus({ message: ROUTINE_COPY_FAILURE_MESSAGE });
        AccessibilityInfo.announceForAccessibility?.(ROUTINE_COPY_FAILURE_MESSAGE);
        return;
      }
      // Android 13+ shows its own system clipboard popup; suppress the in-app
      // line there so the confirmation is not doubled.
      if (showConfirmation) {
        setCopyStatus({ message: ROUTINE_COPY_SUCCESS_MESSAGE });
        AccessibilityInfo.announceForAccessibility?.(ROUTINE_COPY_SUCCESS_MESSAGE);
      } else {
        setCopyStatus(null);
      }
    });
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
  return (
    <View style={styles.mirrorContainer}>
      {imageShare && <RoutineShareModal {...imageShare} onClose={() => setImageShare(null)} />}
      {/* #1244: a compact sheet over a dismissable scrim, so opening it never
          shifts card content and the card's overflow clip cannot cut it off. */}
      <Modal
        visible={menuOpen}
        transparent
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={styles.menuScrim}>
          {/* Sibling scrim behind the sheet, not its parent, so TalkBack keeps
              each item focusable (RestTimerBanner pattern); back dismisses. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setMenuOpen(false)}
            accessible={false}
            importantForAccessibility="no"
          />
          <View style={styles.actionMenu} accessibilityRole="menu" testID="log-current-routine-menu">
            {[
              { label: 'Edit', a11y: 'Edit routine', run: enterCurrentEditor },
              // #956: Copy and Share stay distinct actions, not merged.
              { label: 'Copy', a11y: `Copy routine ${workoutNoteTitle || 'Untitled Routine'}`, run: handleCopyRoutine },
              { label: 'Share', a11y: 'Share routine', run: handleShareRoutine },
              {
                label: 'Share as Image',
                a11y: 'Share routine as image',
                run: () => setImageShare({ title: workoutNoteTitle, rawText: routineRawText ?? activeEditText }),
              },
              // "Remove skip", not "Undo skip": that text collides with the editor's "Undo".
              canUnskipWeek && handleUnskipWeek
                ? { label: 'Remove skip', a11y: 'Remove skip', run: handleUnskipWeek }
                : null,
            ].filter(Boolean).map(item => (
              <Pressable
                key={item.label}
                onPress={(e) => { e?.stopPropagation?.(); setMenuOpen(false); return item.run(); }}
                style={styles.actionMenuItem}
                accessibilityRole="menuitem"
                accessibilityLabel={item.a11y}
              >
                <Text style={styles.actionMenuItemText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
      <Card style={styles.currentRoutineCard}>
        {/* #1244: the header row pairs the collapse target with the Routine
            actions trigger as siblings, so the collapse press hosts no nested control. */}
        <View style={styles.headerRow}>
        <Pressable
          onPress={() => { setMenuOpen(false); toggleCollapsed(); }} // Tapping the header collapses/expands the card body
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
            onPress={() => setMenuOpen(o => !o)}
            style={styles.menuButton}
            accessibilityRole="button"
            accessibilityLabel="Routine actions"
            accessibilityHint="Opens Edit, Copy, Share, and Share as Image"
            accessibilityState={{ expanded: menuOpen }}
          >
            <MaterialIcons name="more-horiz" size={20} color={kua ? kua.onSurfaceVariant : colors.chipAccentText} accessible={false} />
          </Pressable>
        </View>

        <Pressable
          onPress={handleNoteBodyPress}
          style={[styles.currentNoteContent, isCollapsed ? { display: 'none' } : null]}
        >
          {/* The card's action strip: Week A/B and Skip week only. #1244 moved
              the Routine actions trigger to the header and Remove skip into the
              menu, so a skipped single-week routine renders no strip at all. */}
          {(hasABWeeks || (!canUnskipWeek && handleSkipWeek)) && (
          <View style={styles.actionStrip}>
            <View style={styles.actionStripPrimary}>
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
            {/* One skip control, never two (#711): Skip week here, or Remove
                skip in the Routine actions menu (#1244). */}
            {!canUnskipWeek && handleSkipWeek && (
              <View style={styles.skipWeekActions}>
                <Pressable
                  onPress={(e) => { e.stopPropagation(); handleSkipWeek(); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.skipWeekButton}
                  accessibilityLabel="Skip week"
                  accessibilityRole="button"
                >
                  <Text style={styles.skipWeekText}>Skip week</Text>
                </Pressable>
              </View>
            )}
          </View>
          )}
          {skipWeekStatus ? (
            <Text style={styles.skipWeekStatusText}>{skipWeekStatus}</Text>
          ) : null}
          {copyStatus ? (
            <Text
              style={styles.skipWeekStatusText}
              accessibilityLiveRegion="polite"
              testID="log-copy-routine-status"
            >
              {copyStatus.message}
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
  otherNoteHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 24,
    gap: 12,
    backgroundColor: kua ? kua.surfaceCardHeader : undefined,
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
  // #1109: headline-md type and primary color per KUA surfaces.md.
  currentNoteTitle: {
    fontSize: TYPOGRAPHY['headline-md'].fontSize,
    fontWeight: '600',
    color: kua ? kua.primary : colors.accentText,
  },
  // #1109: body-sm, on-surface-variant per KUA surfaces.md.
  otherNoteSub: {
    ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 2,
  },
  // Purely presentational metadata layered on top of the ordinary note
  // header — the badge never affects title, text, selection, or rendering.
  recoveryBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
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
  inlineSwitchButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
    borderWidth: 1,
    borderColor: kua ? kua.primaryContainerBorder : colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
    // Lets the pill shrink (text wraps) instead of overflowing the card (#710).
    flexShrink: 1,
  },
  inlineSwitchButtonText: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    fontWeight: kua ? '500' : '700',
    color: kua ? kua.primaryOnContainer : colors.chipAccentText,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  // The card's single action strip (#711); flexWrap + gap contain its controls.
  actionStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
    zIndex: 10,
  },
  actionStripPrimary: {
    zIndex: 10,
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: 12,
  },
  skipWeekActions: {
    flexDirection: 'row',
    gap: 12,
  },
  // #1021: icon-only 44dp trigger, no pill chrome.
  menuButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // #1244: header row = collapse target + Routine actions trigger.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: 12,
    backgroundColor: kua ? kua.surfaceCardHeader : undefined,
  },
  menuScrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  // #1244: compact bottom sheet — one 44dp row per action.
  actionMenu: {
    paddingVertical: 8,
    paddingBottom: 24,
    borderTopLeftRadius: GEOMETRY['radius-2xl'],
    borderTopRightRadius: GEOMETRY['radius-2xl'],
    backgroundColor: kua ? kua.surfaceCard : colors.card,
  },
  actionMenuItem: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  actionMenuItemText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurface : colors.chipAccentText,
  },
  // 44dp floor, sized like the pills beside it (#823).
  skipWeekButton: {
    minHeight: 44,
    justifyContent: 'center',
    flexShrink: 1,
  },
  skipWeekText: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  skipWeekStatusText: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.accentText,
    marginBottom: 8,
    marginTop: -4,
  },
});
