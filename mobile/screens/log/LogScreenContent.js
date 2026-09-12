import React from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, Text, View } from 'react-native';
import { ScreenShell } from '../../components/ScreenShell';
import { ErrorBanner, Card, Button } from '../../components/UI';
import { LogEmptyState } from '../../components/LogEmptyState';
import { LogDeloadSection } from '../../components/LogDeloadSection';
import { LogRecoverySection } from '../../components/LogRecoverySection';
import { LogPreviousRoutines } from '../../components/LogPreviousRoutines';
import { RoutineAdoptionPrompt } from '../../components/LogScreenEditorCard';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { createStyles } from './logScreenStyles';
import { LogSkeleton } from './LogScreenStates';
import { Alert } from '../../lib/platformAlert';
import { compareRecoveryBlocksNewestCompletedFirst } from '../../storage/entries/recoveryStorage';

// Presentation for the Log tab's read view (the first, non-editing ScreenShell):
// the Routine / Deload / Recovery tab body, routine cards, recovery entry points,
// and the previous-routines list. All state and every handler live in LogScreen;
// this component only receives them and lays them out. The current-routine card
// is built in LogScreen (it carries the source-scanned skip/unskip wiring) and
// handed in as `activeRoutineCard`.
export function LogScreenContent(props) {
  const {
    readScrollRef, currentEditor, otherEditor, deloadEditor, isEditing,
    isEmpty, notesError, refreshNotes, isNotesFirstLoad, notes, handleCreateRoutineEntry,
    deloadTabEnabled, recoveryTabVisible, handleTabViewChange, effectiveTabView, recoveryInlineEditActive, deloadNote,
    deloadLoading, completeDeload, clearDeloadNote, workoutNoteText, activeSaveError, deloadNotes,
    deloadHistory, deleteDeloadNote, deleteDeload, currentId, deloadCardCollapsed, setDeloadCardCollapsed,
    adoptableRoutine, hasContent, activeRoutineCard, recoveryBlocks, recoveryWeeks, handleCompleteCurrentWeek,
    handleUndoCompleteWeek, openAddWeekModal, openEndBlockModal, handleUnlinkRecoveryWeek, recoveryActionBusy, pendingRecovery,
    recoveryPendingError, handleRetryRecovery, recoveryReady, recoveryLoading, recoveryRefreshing, recoveryStale,
    recoveryStateError, recoveryMutationsAllowed, showRecoveryStartInManagement, openStartRecoveryBlock, showRecoveryReopenInManagement, openReopenRecoveryBlockConfirm,
    newestCompletedRecoveryBlock, otherNotes, guardedHandleDeleteRoutine, recoveryWeekNumberByNoteId,
  } = props;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const headerRight = !otherEditor.editingNoteId && hasContent && currentEditor.mode === 'edit' && (
    <Pressable
      onPress={currentEditor.handleDoneCurrent}
      style={styles.modeToggle}
      accessibilityRole="button"
      accessibilityLabel="Done"
    >
      <Text style={styles.modeToggleText} accessible={false}>
        Done
      </Text>
    </Pressable>
  );
  return (
      <ScreenShell
        ref={readScrollRef}
        onScroll={currentEditor.handleReadScroll}
        style={isEditing ? { display: 'none' } : { flex: 1 }}
        title="Workout Notes"
        subtitle={isEmpty ? "Track your active training routine." : "Your active training routine. Update it as you go."}
        headerRight={headerRight}
        keyboardShouldPersistTaps="handled"
      >
        {notesError ? (
          <ErrorBanner message="Could not load workout notes." onRetry={refreshNotes} />
        ) : null}
        {isNotesFirstLoad ? (
          <LogSkeleton />
        ) : notesError && notes.length === 0 ? null : isEmpty ? (
          <LogEmptyState onCreateRoutine={handleCreateRoutineEntry} />
        ) : (
          <>
            {(deloadTabEnabled || recoveryTabVisible) && (
              <View style={styles.tabToggle}>
                {/* Recovery is first when present (#823) — see
                    `recoveryTabVisible` above for exactly when that is, so it
                    is never a permanent, empty tab. */}
                {recoveryTabVisible && (
                  <Pressable
                    onPress={() => handleTabViewChange('recovery')}
                    style={[styles.tabToggleItem, effectiveTabView === 'recovery' && styles.tabToggleItemActive]}
                  >
                    <Text style={[styles.tabToggleText, effectiveTabView === 'recovery' && styles.tabToggleTextActive]}>Recovery</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => handleTabViewChange('routine')}
                  disabled={recoveryInlineEditActive}
                  accessibilityState={{ disabled: recoveryInlineEditActive }}
                  style={[styles.tabToggleItem, effectiveTabView === 'routine' && styles.tabToggleItemActive]}
                >
                  <Text style={[styles.tabToggleText, effectiveTabView === 'routine' && styles.tabToggleTextActive]}>Routine</Text>
                </Pressable>
                {deloadTabEnabled && (
                  <Pressable
                    onPress={() => handleTabViewChange('deload')}
                    disabled={recoveryInlineEditActive}
                    accessibilityState={{ disabled: recoveryInlineEditActive }}
                    style={[styles.tabToggleItem, effectiveTabView === 'deload' && styles.tabToggleItemActive]}
                  >
                    <Text style={[styles.tabToggleText, effectiveTabView === 'deload' && styles.tabToggleTextActive]}>Deload</Text>
                  </Pressable>
                )}
              </View>
            )}

            {effectiveTabView === 'deload' && (
              <LogDeloadSection
                deloadNote={deloadNote}
                deloadLoading={deloadLoading}
                deloadDayGroups={deloadEditor.deloadDayGroups}
                enterDeloadEditor={deloadEditor.enterDeloadEditor}
                handleDeloadBodyPress={deloadEditor.handleDeloadBodyPress}
                deloadMode={deloadEditor.deloadMode}
                completeDeload={completeDeload}
                clearDeloadNote={clearDeloadNote}
                handleGenerateDeload={deloadEditor.handleGenerateDeload}
                isGenerating={deloadEditor.isGenerating}
                workoutNoteText={workoutNoteText}
                saveError={activeSaveError}
                deloadNotes={deloadNotes}
                deloadHistory={deloadHistory}
                deleteDeloadNote={deleteDeloadNote}
                deleteDeload={deleteDeload}
                viewingNoteId={otherEditor.viewingNoteId}
                handleViewOtherNote={otherEditor.handleViewOtherNote}
                viewingNote={otherEditor.viewingNote}
                viewingNoteDayGroups={otherEditor.viewingNoteDayGroups}
                handleOpenOtherNote={otherEditor.handleOpenOtherNote}
                logSessionCount={currentEditor.logSessionCount}
                deloadCollapsed={deloadCardCollapsed}
                onToggleDeloadCollapsed={() => setDeloadCardCollapsed(c => !c)}
              />
            )}

            {/* The post-save adoption prompt, when the routine was saved from
                the guided sheet and there is no open editor to host it. Same
                state and same handlers as the editor's copy. */}
            {effectiveTabView === 'routine' && !isEditing && otherEditor.adoptionPrompt && (
              <RoutineAdoptionPrompt
                prompt={otherEditor.adoptionPrompt}
                error={otherEditor.adoptionError}
                busy={otherEditor.adoptionBusy}
                hasCurrentRoutine={!!currentId}
                onAdopt={otherEditor.handleAdoptPromptedRoutine}
                onDismiss={otherEditor.handleDismissAdoptionPrompt}
              />
            )}

            {/* S1 — a routine exists but none is current. Without this card,
                `Not now` (and any save while `currentId` is null) recreates the
                F1 dead end: the routine is filed under a collapsed "More
                Routines" before the user has more than one, with no
                instruction anywhere. One instruction, one action. */}
            {effectiveTabView === 'routine' && adoptableRoutine && (
              <Card style={styles.firstUseCard}>
                <Text style={styles.firstUseTitle}>Start logging this routine</Text>
                <Text style={styles.firstUseBody}>
                  "{adoptableRoutine.title || 'Untitled Routine'}" is saved but is not your current routine yet, so nothing you log will land in it.
                </Text>
                {otherEditor.adoptionError ? (
                  <Text style={styles.firstUseError}>{otherEditor.adoptionError}</Text>
                ) : null}
                <Button
                  onPress={() => otherEditor.handleSwitchCurrent(adoptableRoutine.id)}
                  title="Use this routine"
                  style={styles.firstUseAction}
                  accessibilityLabel={`Use ${adoptableRoutine.title || 'Untitled Routine'} as your current routine`}
                />
              </Card>
            )}

            {effectiveTabView === 'routine' && currentEditor.mode === 'read' && hasContent && activeRoutineCard}

            {effectiveTabView === 'recovery' && (
              <LogRecoverySection
                blocks={recoveryBlocks}
                weeks={recoveryWeeks}
                notes={notes}
                onViewNote={otherEditor.handleViewRecoveryNote}
                viewingNoteId={otherEditor.recoveryViewingNoteId}
                viewingNote={otherEditor.recoveryViewingNote}
                viewingNoteDayGroups={otherEditor.recoveryViewingNoteDayGroups}
                viewingHasABWeeks={otherEditor.recoveryViewingHasABWeeks}
                viewingEffectiveWeek={otherEditor.recoveryViewingEffectiveWeek}
                viewingActiveText={otherEditor.recoveryViewingActiveText}
                onExerciseSourceJump={otherEditor.handleRecoveryExerciseSourceJump}
                onToggleViewingWeek={otherEditor.handleToggleRecoveryViewingWeek}
                onEditNote={otherEditor.handleEditRecoveryViewedNote}
                // Inline recovery-note editor wiring (#841): a note is being
                // edited inline in THIS block only when editingNoteId names it
                // AND that session was opened from the recovery surface —
                // otherwise editingNoteId belongs to the shared full-screen
                // editor (or to nothing) and this block stays in read mode.
                editingNoteId={otherEditor.editingSource === 'recovery' ? otherEditor.editingNoteId : null}
                editingTitle={otherEditor.editingTitle}
                onChangeEditingTitle={otherEditor.setEditingTitle}
                editingText={otherEditor.editingText}
                onChangeEditingText={otherEditor.setEditingText}
                editingHasABWeeks={otherEditor.editingHasABWeeks}
                editingEffectiveWeek={otherEditor.editingEffectiveWeek}
                onToggleEditingWeek={otherEditor.handleToggleEditingWeek}
                editingIsSaving={otherEditor.noteIsSaving}
                editingSaveError={otherEditor.saveError}
                editingSaveSuccess={otherEditor.saveSuccess}
                editingSaveStatus={otherEditor.saveStatus}
                onEditorInteraction={otherEditor.cancelPendingDraftRestore}
                onSaveEdit={otherEditor.handleDoneOther}
                onCancelEdit={otherEditor.handleCancelRecoveryEdit}
                pendingSourceJump={otherEditor.pendingSourceJump}
                onSourceJumpApplied={otherEditor.clearPendingSourceJump}
                onCompleteWeek={handleCompleteCurrentWeek}
                onUndoCompleteWeek={handleUndoCompleteWeek}
                onOpenAddWeek={openAddWeekModal}
                onOpenEndBlockModal={openEndBlockModal}
                onUnlinkWeek={handleUnlinkRecoveryWeek}
                busy={recoveryActionBusy}
                pendingRecovery={pendingRecovery}
                pendingRecoveryError={recoveryPendingError}
                onRetryRecovery={handleRetryRecovery}
                stateReady={recoveryReady}
                stateLoading={recoveryLoading}
                stateRefreshing={recoveryRefreshing}
                stateStale={recoveryStale}
                stateError={recoveryStateError}
                mutationsAllowed={recoveryMutationsAllowed}
              />
            )}

            {/* Persistent, low-emphasis entry point (#823): previously
                `Start recovery block` only existed inside the collapsed
                "More Routines" disclosure below, so seeing it at all required
                opening the exact panel that disclosure has since lost its
                bordered chrome to. It is never nested in a menu now — always
                visible under the current routine card, subordinate to Edit,
                and gone the instant a block becomes active (folded into
                `showRecoveryStartInManagement` unchanged). */}
            {effectiveTabView === 'routine' && showRecoveryStartInManagement && (
              <Pressable
                onPress={openStartRecoveryBlock}
                style={styles.recoveryStartRow}
                accessibilityRole="button"
                accessibilityLabel="Start recovery block"
              >
                <Text style={styles.recoveryStartRowText}>Start recovery block</Text>
                <MaterialIcons name="chevron-right" size={18} color={colors.accent} accessible={false} />
              </Pressable>
            )}

            {/* Secondary, lower-emphasis entry point immediately below Start
                (#839): computes its own visibility independently of Start's
                and renders alongside it whenever both qualify — neither
                replaces or gates the other. Non-destructive styling
                (`textMuted`, not `accent`) keeps Start visually primary. */}
            {effectiveTabView === 'routine' && showRecoveryReopenInManagement && (
              <Pressable
                onPress={openReopenRecoveryBlockConfirm}
                style={styles.recoveryReopenRow}
                accessibilityRole="button"
                accessibilityLabel={`Reopen recovery block: ${newestCompletedRecoveryBlock.baseline_note_title || 'Untitled Routine'}`}
              >
                <Text style={styles.recoveryReopenRowText} numberOfLines={1}>
                  {`Reopen recovery block: ${newestCompletedRecoveryBlock.baseline_note_title || 'Untitled Routine'}`}
                </Text>
                <MaterialIcons name="chevron-right" size={18} color={colors.textMuted} accessible={false} />
              </Pressable>
            )}

            {effectiveTabView === 'routine' && (
              <LogPreviousRoutines
                otherNotes={otherNotes}
                handleViewOtherNote={otherEditor.handleViewOtherNote}
                viewingNoteId={otherEditor.viewingNoteId}
                viewingNote={otherEditor.viewingNote}
                viewingNoteDayGroups={otherEditor.viewingNoteDayGroups}
                viewingHasABWeeks={otherEditor.viewingHasABWeeks}
                viewingEffectiveWeek={otherEditor.viewingEffectiveWeek}
                viewingActiveText={otherEditor.viewingActiveText}
                onExerciseSourceJump={otherEditor.handleRoutineExerciseSourceJump}
                handleToggleViewingWeek={otherEditor.handleToggleViewingWeek}
                handleSwitchCurrent={otherEditor.handleSwitchCurrent}
                handleEditViewedNote={otherEditor.handleEditViewedNote}
                handleDeleteRoutine={guardedHandleDeleteRoutine}
                handleCreateRoutine={handleCreateRoutineEntry}
                recoveryWeekNumberByNoteId={recoveryWeekNumberByNoteId}
              />
            )}
          </>
        )}
      </ScreenShell>
  );
}


// Recovery-block mutation flow for the Log tab (#1054 split): the eligibility
// derivations, the persistent Start / Reopen entry-point predicates, and every
// journaled recovery action (start, add week, complete, reopen, unlink, retry,
// undo) with its refresh/rollback glue. Pure — it holds no state of its own and
// is rebuilt each render from LogScreen's owned state, so it never changes what
// mounts or resets.
export function buildLogRecovery(deps) {
  const {
    activeRecoveryBlock, recoveryBlocks, recoveryWeeks, recoveryReady, recoveryStale,
    recoveryActionBusy, pendingRecovery, recoveryMutationsAllowed, startRecoveryBlock, recoveryLifecycle, refreshRecoveryState,
    refreshNotes, runRecoveryAction, notes, add, remove, setTabView,
    setRecoveryModal, setAddWeekModalOpen, setEndBlockModalOpen, otherEditor, eligibleBaselineNotes,
  } = deps;

  const recoveryBlockingMessage = activeRecoveryBlock
    ? `A recovery block baselined from "${activeRecoveryBlock.baseline_note_title || 'Untitled Routine'}" is already active. Complete or delete it before starting another.`
    : null;

  // The one recovery entry point (#711), opened from LogRecoverySection with no
  // subject: `presetNote: null` makes RecoveryBlockStartModal render its own
  // baseline and Week 1 pickers over the same eligible collections it already
  // receives, and both paths reach the unchanged handleConfirmRecoveryBlock.
  // Deliberately NOT the old per-card opener, which returns early without a
  // note — the preset-note modal contract itself is untouched and still
  // supported, it simply has no per-card caller left on this screen.
  const openStartRecoveryBlock = () => setRecoveryModal({ mode: 'routine', note: null });
  const closeRecoveryModal = () => setRecoveryModal(null);

  // The relocated `Start recovery block` entry point (#724, then #823) now
  // renders as a persistent row directly under the current routine card,
  // never inside a menu or disclosure. The contract requires it ABSENT — not
  // merely disabled — whenever a block cannot be started right now, so every
  // gate folds into one visibility predicate: no active block, a verified and
  // non-stale read, at least one eligible baseline (eligibleBaselineNotes is
  // already empty until the read is verified), and no pending/in-flight
  // recovery action or mutation lock. startRecoveryBlock rechecks the
  // authoritative precondition at confirm regardless.
  const showRecoveryStartInManagement =
    !activeRecoveryBlock
    && recoveryReady
    && !recoveryStale
    && !recoveryActionBusy
    && (pendingRecovery?.length || 0) === 0
    && recoveryMutationsAllowed
    && eligibleBaselineNotes.length > 0;

  // The `Reopen recovery block: {baseline title}` secondary entry point
  // (#839). Uses the EXACT SAME comparator storage's own "newest completed"
  // resolution does — including its `id` tie-break for equal `completed_at`
  // values (#839 review) — so what this row NAMES is exactly what
  // `reopenBlock` will act on, and every device resolves the same winner
  // rather than each seeing a different "newest" depending on local array
  // order; `reopenRecoveryBlockCore` re-verifies this against persisted state
  // at confirm time regardless (#711-style gate). Independent of
  // `showRecoveryStartInManagement`: both compute their own visibility and
  // render together whenever both qualify, per #839's contract that neither
  // replaces or gates the other.
  const newestCompletedRecoveryBlock = recoveryBlocks
    .filter(b => !!b.completed_at)
    .sort(compareRecoveryBlocksNewestCompletedFirst)[0] || null;

  const showRecoveryReopenInManagement =
    !activeRecoveryBlock
    && recoveryReady
    && !recoveryStale
    && !recoveryActionBusy
    && (pendingRecovery?.length || 0) === 0
    && recoveryMutationsAllowed
    && !!newestCompletedRecoveryBlock;

  const handleConfirmRecoveryBlock = async ({ baselineNoteId, weekChoice, weekNoteId, newNoteTitle, reason }) => {
    if (!startRecoveryBlock) {
      return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    }
    const baselineNote = notes.find(n => n.id === baselineNoteId);
    if (!baselineNote) {
      return { ok: false, error: 'Select a baseline routine first.' };
    }
    // The confirm-time authoritative precondition, the new-note creation (on
    // the "New note" Week 1 path), and the block/week write are now ALL
    // sequenced inside `startRecoveryBlock` itself, behind exactly one gate
    // check — this screen no longer creates the note or re-checks anything
    // on its own. That is what makes "no persisted write can precede the
    // authoritative decision" structural rather than merely ordered: there is
    // no code path here that reaches storage without going through the one
    // gated call below (#711 review finding 2).
    const result = await startRecoveryBlock({
      baselineNoteId: baselineNote.id,
      baselineNoteTitle: baselineNote.title || null,
      baselineNoteText: baselineNote.raw_text || '',
      weekNoteId: weekChoice === 'new' ? null : weekNoteId,
      // Optional free text (#872), passed straight through — this screen makes
      // no decision about it and never substitutes one of its own.
      reason,
      createWeekNote: weekChoice === 'new' ? () => add(newNoteTitle, '') : undefined,
      // New-note path only: if the note this call created is left orphaned by
      // a later block/week failure, `startRecoveryBlock` rolls it back
      // through this — "no partial changes" covers the note it created too.
      removeWeekNote: (noteId) => remove(noteId),
    });
    if (result?.ok) {
      refreshRecoveryState?.();
      // Land on the tab that now holds the block just created (#823) — Recovery
      // used to just appear inline in the Routine tab the user was already on,
      // but it is a separate tab now, so starting a block has to navigate there
      // for the new week to actually be visible.
      setTabView('recovery');
    }
    return result;
  };

  // Week 2+ lifecycle (#696). Each wrapper delegates the actual mutation to
  // hooks/entries/recoveryBlockHooks.js (which already enforces sequential
  // completion and the latest-week-only unlink restriction) and only adds the
  // Log-screen-local refresh/rollback glue.
  const openAddWeekModal = () => setAddWeekModalOpen(true);
  const closeAddWeekModal = () => setAddWeekModalOpen(false);

  // Two distinct operations, deliberately.
  //
  // Attaching an EXISTING note touches one collection, so it stays a plain
  // single-domain action. Creating a new note AND attaching it touches two, so it
  // is a durable journaled operation (addRecoveryWeekWithNewNoteCore): the note id
  // and the week ordinal are minted once inside the journal lock and recorded on
  // the intent before anything is written. This screen no longer creates the note
  // itself, and there is no best-effort rollback delete left to fail — a failed
  // attempt leaves a journaled intent that replay finishes instead of an untracked
  // orphan note.
  const handleConfirmAddWeek = ({ weekChoice, weekNoteId, newNoteTitle }) => runRecoveryAction('add', async () => {
    if (!activeRecoveryBlock) {
      return { ok: false, error: 'No active recovery block to add a week to.' };
    }
    if (weekChoice === 'new') {
      if (!recoveryLifecycle.addWeekWithNewNote) {
        return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
      }
      const result = await recoveryLifecycle.addWeekWithNewNote({
        blockId: activeRecoveryBlock.id,
        title: newNoteTitle,
      });
      if (result?.ok) {
        refreshRecoveryState?.();
        refreshNotes?.();
      }
      return result;
    }
    if (!recoveryLifecycle.addWeek) {
      return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    }
    if (!weekNoteId) {
      return { ok: false, error: 'Select or create a note for this recovery week.' };
    }
    const result = await recoveryLifecycle.addWeek({
      blockId: activeRecoveryBlock.id,
      noteId: weekNoteId,
    });
    if (result?.ok) refreshRecoveryState?.();
    return result;
  });

  const handleCompleteCurrentWeek = (params) => runRecoveryAction('week', async () => {
    if (!recoveryLifecycle.completeCurrentWeek) return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    const result = await recoveryLifecycle.completeCurrentWeek(params);
    if (result?.ok) refreshRecoveryState?.();
    return result;
  });

  const handleCompleteRecoveryBlock = (params) => runRecoveryAction('block', async () => {
    if (!recoveryLifecycle.completeBlock) return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    const result = await recoveryLifecycle.completeBlock(params);
    if (result?.ok) refreshRecoveryState?.();
    return result;
  });

  // `RecoveryBlockEndModal`'s own inclusion write (#843): ordered strictly
  // before `handleCompleteRecoveryBlock` by the modal itself, but not
  // serialized behind the SAME `runRecoveryAction` key — the modal's own
  // `submitting` state is what keeps it from double-firing, and this write
  // changes no week/note/baseline, exactly like the per-block toggle
  // `LogRecoverySection` already owns.
  const handleSetRecoveryInclusionFromEndModal = async (params) => {
    if (!recoveryLifecycle.setIncludeInNormalAnalytics) {
      return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    }
    const result = await recoveryLifecycle.setIncludeInNormalAnalytics(params);
    if (result?.ok) refreshRecoveryState?.();
    return result;
  };

  const openEndBlockModal = () => setEndBlockModalOpen(true);
  const closeEndBlockModal = () => setEndBlockModalOpen(false);

  // Reopen the newest completed recovery block (#839). Reactivates only the
  // block — every week's completion state is untouched — so on success the
  // ordinary active Recovery tab/card returns exactly as it would for any
  // other active block, including its existing Add week / Undo completion
  // affordances.
  const handleReopenRecoveryBlock = (block) => runRecoveryAction('reopen', async () => {
    if (!recoveryLifecycle.reopenBlock) return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    const result = await recoveryLifecycle.reopenBlock({ blockId: block.id });
    if (result?.ok) {
      refreshRecoveryState?.();
      setTabView('recovery');
    }
    return result;
  });

  const openReopenRecoveryBlockConfirm = () => {
    if (!newestCompletedRecoveryBlock) return;
    const baselineTitle = newestCompletedRecoveryBlock.baseline_note_title || 'Untitled Routine';
    Alert.alert(
      'Reopen this recovery block?',
      `This reactivates ${baselineTitle} as your active recovery block. Every week's status stays exactly as it is — you can add a new week or undo the latest week's completion once it's reopened. You can only reopen your most recently completed block, and only while no other block is active.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reopen block',
          onPress: async () => {
            const result = await handleReopenRecoveryBlock(newestCompletedRecoveryBlock);
            if (!result.ok) {
              Alert.alert('Could not reopen this recovery block', result.error || 'Could not reopen this recovery block.');
            }
          },
        },
      ]
    );
  };

  const handleUnlinkRecoveryWeek = (params) => runRecoveryAction(params.weekId, async () => {
    if (!recoveryLifecycle.unlinkWeek) return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    const result = await recoveryLifecycle.unlinkWeek(params);
    if (result?.ok) refreshRecoveryState?.();
    return result;
  });

  // The `Retry recovery` affordance. It runs the same idempotent reconciler as
  // app start, remount, and the cloud sync boundary — never a separate repair
  // path — and then refreshes both the workout-note and recovery views so a
  // successful reconciliation clears the warning.
  const handleRetryRecovery = () => runRecoveryAction('retry-recovery', async () => {
    if (!recoveryLifecycle.retryRecovery) {
      return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    }
    const result = await recoveryLifecycle.retryRecovery();
    await Promise.resolve(refreshRecoveryState?.());
    refreshNotes?.();
    return result;
  });

  const handleUndoCompleteWeek = (params) => runRecoveryAction('undo-week', async () => {
    if (!recoveryLifecycle.uncompleteCurrentWeek) return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    const result = await recoveryLifecycle.uncompleteCurrentWeek(params);
    if (result?.ok) refreshRecoveryState?.();
    return result;
  });


  return {
    recoveryBlockingMessage, openStartRecoveryBlock, closeRecoveryModal, showRecoveryStartInManagement, newestCompletedRecoveryBlock, showRecoveryReopenInManagement,
    handleConfirmRecoveryBlock, openAddWeekModal, closeAddWeekModal, handleConfirmAddWeek, handleCompleteCurrentWeek, handleCompleteRecoveryBlock,
    handleSetRecoveryInclusionFromEndModal, openEndBlockModal, closeEndBlockModal, handleReopenRecoveryBlock, openReopenRecoveryBlockConfirm, handleUnlinkRecoveryWeek,
    handleRetryRecovery, handleUndoCompleteWeek,
  };
}


// Editor header actions beside the compact rest timer: the A/B week toggle,
// Merge weeks, and Done (RestTimerBanner stays in LogScreen).
export function EditorHeaderActions({ otherEditor, deloadEditor, currentEditor }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <>
      {otherEditor.editingNoteId && otherEditor.editingHasABWeeks && (
        <Pressable
          onPress={otherEditor.handleToggleEditingWeek}
          style={[styles.modeToggle, styles.modeToggleOutline]}
          accessibilityRole="button"
          accessibilityLabel={`Switch to Week ${otherEditor.editingEffectiveWeek === 'B' ? 'A' : 'B'}`}
          accessibilityState={{ selected: otherEditor.editingEffectiveWeek === 'B' }}
        >
          <Text style={[styles.modeToggleText, { color: colors.chipAccentText }]} accessible={false}>
            Week {otherEditor.editingEffectiveWeek === 'B' ? 'A' : 'B'}
          </Text>
        </Pressable>
      )}
      {otherEditor.editingNoteId && otherEditor.editingHasABWeeks && (
        <Pressable
          onPress={otherEditor.handleMergeEditingWeeks}
          style={[styles.modeToggle, styles.modeToggleOutline]}
          accessibilityRole="button"
          accessibilityLabel="Merge Week A and Week B into one routine"
        >
          <Text style={[styles.modeToggleText, { color: colors.textMuted, fontWeight: '500' }]} accessible={false}>Merge weeks</Text>
        </Pressable>
      )}
      <Pressable
        onPress={deloadEditor.deloadMode === 'edit' ? deloadEditor.handleDoneDeload : otherEditor.editingNoteId ? otherEditor.handleDoneOther : currentEditor.handleDoneCurrent}
        style={styles.modeToggle}
        accessibilityLabel="Done"
        accessibilityRole="button"
      >
        <Text style={styles.modeToggleText} accessible={false}>Done</Text>
      </Pressable>
    </>
  );
}
