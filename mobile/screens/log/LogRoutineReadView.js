// Composition of the Log tab's routine read view (#1606, extracted from
// LogScreen for the 600-line cap). It owns the one Routine actions instance
// (shared by the root header and the card's status lines) and the sticky day
// index store, and builds the current-routine card's props from the state LogScreen
// already holds. Nothing here reads or writes storage or re-parses the note.
import React, { useMemo } from 'react';
import { useLogRoutineActions, RoutinePlateCalculator } from '../../components/log/LogRoutineActionSheet';
import { LogRoutineHeaderActions } from './LogRoutineHeaderActions';
import { deriveLogDays, useLogDayNav } from './LogDayIndex';

export function useLogRoutineReadView({
  currentEditor, currentId, workoutNoteTitle, workoutNoteText, toggleCollapsed, isCollapsed,
  trackedLifts, handleToggleTrack, currentRecoveryWeekNumber, currentIsPausedBaseline,
  visibleProgressionSuggestions, mutedProgressionRows, handleMuteProgression,
  handleUnmuteProgression, handleDismissProgression, readScrollRef,
}) {
  const ce = currentEditor;
  const routineActions = useLogRoutineActions({
    workoutNoteTitle,
    // #954: the full stored body, not the active-week slice, so a shared A/B
    // routine carries both halves byte-for-byte.
    routineRawText: workoutNoteText,
    activeEditText: ce.activeEditText,
    enterCurrentEditor: ce.enterCurrentEditor,
    handleSkipWeek: ce.handleSkipWeek,
    handleUnskipWeek: ce.handleUnskipWeek,
    canUnskipWeek: ce.canUnskipWeek,
    isCollapsed,
    toggleCollapsed,
  });
  // Day offsets belong to one note + A/B slice + parsed text; any change drops them.
  const scopeKey = `${currentId ?? ''}|${ce.hasABWeeks ? ce.effectiveActiveWeek : ''}|${ce.activeEditText ?? ''}`;
  const dayNav = useLogDayNav({ scrollRef: readScrollRef, scopeKey });
  const days = useMemo(() => deriveLogDays(ce.dayGroups || []), [ce.dayGroups]);

  // LogScreen renders the card with these props plus the skip handlers, so the
  // skip/unskip wiring stays visible (and ungated) at the screen boundary.
  const cardProps = {
    workoutNoteTitle, hasABWeeks: ce.hasABWeeks, effectiveActiveWeek: ce.effectiveActiveWeek,
    handleToggleWeek: ce.handleToggleWeek, enterCurrentEditor: ce.enterCurrentEditor, handleNoteBodyPress: ce.handleNoteBodyPress,
    canUnskipWeek: ce.canUnskipWeek, skipWeekStatus: ce.skipWeekStatus, toggleCollapsed, isCollapsed,
    dayGroups: ce.dayGroups, noteError: ce.noteError, trackedLifts, handleToggleTrack, roughNoteId: ce.roughNoteId, currentId,
    roughFlaggedNames: ce.roughFlaggedNames, activeEditText: ce.activeEditText, routineRawText: workoutNoteText,
    onExerciseSourceJump: ce.handleExerciseSourceJump, recoveryWeekNumber: currentRecoveryWeekNumber,
    baselinePaused: currentIsPausedBaseline, progressionSuggestions: visibleProgressionSuggestions, mutedProgressionRows,
    onMuteProgression: handleMuteProgression, onUnmuteProgression: handleUnmuteProgression, onDismissProgression: handleDismissProgression,
    // #1010: the production Apply-to-note path — the card forwards the
    // exact rendered record and surfaces the persisted result.
    onApplyProgression: ce.handleApplyProgressionSuggestion,
    routineActions, dayNav,
  };
  const headerActions = <LogRoutineHeaderActions actions={routineActions} hostsCalculator={false} />;
  // #1650: mounted by LogScreen in both modes; the editor's Plates opens it.
  const plateCalculator = <RoutinePlateCalculator actions={routineActions} />;
  return { cardProps, headerActions, plateCalculator, openPlates: routineActions.openPlates, dayNav, days };
}
