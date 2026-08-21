// Recovery Block lifecycle UI (#696): the active block's baseline, current
// week, lifecycle actions, and active-block inclusion control. Completed-block
// history lives in Analytics (#729). Week 1 attach/start lives in
// RecoveryBlockStartModal (#695); this component only ever advances or
// completes a block that already exists.
//
// All lifecycle mutation (complete week, add week, complete block, unlink
// week) is delegated to the handlers passed in from LogScreen, which bind to
// hooks/entries/recoveryBlockHooks.js — this file never imports storage
// directly and never decides eligibility itself beyond what those handlers
// already enforce.

import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Alert } from '../lib/platformAlert';
import { Card, SectionTitle } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { findActiveBlock, orderedLiveWeeks } from '../lib/data/recoveryBlocks';
import {
  RECOVERY_STALE_MESSAGE,
  RECOVERY_UNVERIFIED_MESSAGE,
  useRecoveryBlockLifecycle,
} from '../hooks/entries/recoveryBlockHooks';
import { RecoveryInclusionToggle } from './RecoveryInclusionToggle';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';
export { RECOVERY_INCLUSION_LABEL } from './RecoveryInclusionToggle';

// A week whose `note_id` is null, or names a note that is not in the notebook,
// has no readable content (#775). `Untitled Routine` is reserved for notes that
// EXIST and were left untitled — using it here claimed a note was present and
// made a dead row look like an ordinary one.
const RECOVERY_NOTE_UNAVAILABLE = 'Note unavailable';

function _noteTitle(note) {
  return note?.title || 'Untitled Routine';
}

export function LogRecoverySection({
  blocks = [],
  weeks = [],
  notes = [],
  onViewNote,
  // The shared note viewer state (#775). Reading a recovery week's note used to
  // hand the request off to More Routines — a different section, sometimes on a
  // different view, that had to be revealed for the note to appear at all. The
  // note now renders inline in the week row the user tapped, off the same
  // `viewingNoteId`/`viewingNote`/`viewingNoteDayGroups` state LogDeloadSection
  // already consumes, so the tap has an effect exactly where it was made.
  //
  // `viewingNoteDayGroups` is the SELECTED half of an A/B note, not the whole
  // note, so the A/B state and its toggle come through too (#775 review): an
  // A/B routine is eligible as a recovery week, and reading one here without
  // the switch would leave its other week unreachable from this card.
  viewingNoteId = null,
  viewingNote = null,
  viewingNoteDayGroups = [],
  viewingHasABWeeks = false,
  viewingEffectiveWeek = null,
  onToggleViewingWeek,
  // Opens the shared note editor on the currently-viewed note (#823) —
  // `otherEditor.handleEditViewedNote`, which takes no argument and reads
  // off the same shared viewing state this card renders from, so the editor
  // opens on whichever A/B week the user was actually looking at rather than
  // the note's persisted default. So a recovery week's note is no longer the
  // one note viewer in this tab with no way back into editing.
  onEditNote,
  // Inline recovery-note editor (#841): both the explicit `Edit` action and
  // double-tapping the expanded note body open the SAME inline editor here,
  // never the shared full-screen Routine editor. `editingNoteId` is null
  // unless the currently open editor session was opened FROM this block (see
  // LogScreen's `editingSource === 'recovery'` gate) — a full-screen or
  // Routine-tab edit of some other note never makes any row here look like
  // it is mid-edit. Seeded (title/text/A-B week) by `onEditNote` exactly as
  // before; these props only render what is already seeded.
  editingNoteId = null,
  editingTitle = '',
  onChangeEditingTitle,
  editingText = '',
  onChangeEditingText,
  editingHasABWeeks = false,
  editingEffectiveWeek = null,
  onToggleEditingWeek,
  editingIsSaving = false,
  editingSaveError = '',
  onSaveEdit,
  onCancelEdit,
  onCompleteWeek,
  // Reopens the most recently completed week (#836), restoring it to
  // in-progress without touching its note. LogScreen only offers this when
  // `canAddWeek` holds — i.e. the current week is completed AND it is the
  // latest live week, so no later week exists to make the undo ambiguous.
  onUndoCompleteWeek,
  onOpenAddWeek,
  onCompleteBlock,
  onUnlinkWeek,
  // The single in-flight lifecycle-action key, owned by LogScreen (not local
  // state here): null | 'week' | 'block' | 'add' | a week id being unlinked.
  // LogScreen serializes every recovery mutation — including the Add Week
  // modal's own confirm — behind this one key, so a stale concurrent action
  // (e.g. Add week racing Complete recovery block) is rejected rather than
  // silently writing under a block/week that changed underneath it. Every
  // button below disables on ANY non-null value, not just its own key, so two
  // conflicting actions can never both be enabled at once.
  busy = null,
  // Journaled recovery operations that are not yet verified (#696), and the
  // shared reconciler behind `Retry recovery`. While anything is pending, the
  // requested transition is NOT presented as complete and every conflicting
  // action for the affected records is disabled — but ordinary read access to
  // the rest of the recovery and workout data is retained.
  pendingRecovery = [],
  pendingRecoveryError = null,
  onRetryRecovery,
  // Authoritative Recovery read state (#716). Defaults describe a verified,
  // current snapshot so a caller that does not yet supply them is unchanged.
  //
  // `stateReady` is what separates "verified empty" from "unknown". While it is
  // false, `blocks`/`weeks` are placeholders, so this component must never fall
  // through to its "nothing to show" return — it renders the initial-loading or
  // error/retry state instead.
  stateReady = true,
  stateLoading = false,
  stateRefreshing = false,
  stateStale = false,
  stateError = null,
  mutationsAllowed = true,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [actionError, setActionError] = useState(null);
  // The inclusion preference (#699) is the one recovery mutation this component
  // owns directly rather than receiving as a handler from LogScreen. It changes
  // no week, no note, and no baseline — only a single field on one block — so
  // there is no cross-record state for LogScreen to serialize, and it carries
  // its own in-flight key. It is still disabled by `actionsLocked` below, so it
  // can never race a journaled lifecycle operation over the same block.
  const { setIncludeInNormalAnalytics } = useRecoveryBlockLifecycle();
  const [inclusionBusyBlockId, setInclusionBusyBlockId] = useState(null);
  const [inclusionError, setInclusionError] = useState(null);
  // The `Manage recovery block` disclosure (#789), collapsed by default. It is
  // presentation state only: nothing inside it changes handler, gating, or
  // confirm copy, and the trigger itself is NEVER disabled — a locked user must
  // still be able to open it and see WHY each control inside is unavailable
  // (#780 corrected blocked-mutation contract).
  //
  // Stored as the block id it was opened FOR, not as a boolean. This component
  // stays mounted across a block's whole lifetime, and completing a block only
  // makes it render no active card — it does not unmount. A boolean would
  // survive that gap, so a user who expanded the disclosure, completed the
  // block, and started another one without leaving the Routine tab would meet
  // the new block with Unlink, block completion, and the inclusion switch
  // already exposed. Keying by id collapses on any block change with no effect
  // and no stale-state window.
  const [manageExpandedBlockId, setManageExpandedBlockId] = useState(null);
  // Double-tap the expanded note body to edit it (#841 owner amendment):
  // the same gesture/timing the Routine tab's card already uses
  // (LogPreviousRoutines.js's viewingNoteLastTapRef), reproduced here rather
  // than shared because the two components track different Allowed Files.
  const viewingNoteLastTapRef = useRef(0);

  const activeBlock = findActiveBlock(blocks);
  // Two distinct states. A PENDING operation locks conflicting actions, because a
  // second write over the same records is unsafe while one is unresolved. A
  // message with no pending operation is a terminal outcome that already retired
  // itself (a cancelled conflict): it must be explained, but it locks nothing —
  // otherwise an unreachable outcome would freeze recovery forever.
  const hasPendingRecovery = (pendingRecovery?.length || 0) > 0;
  const showRecoveryNotice = hasPendingRecovery || !!pendingRecoveryError;
  const pendingMessage = pendingRecoveryError
    || pendingRecovery?.[0]?.error
    || 'A recovery change is still being applied on this device.';
  // One flag for every lifecycle control. Unverified state is a third reason no
  // write may start (#716): a mutation decided against a placeholder snapshot is
  // exactly what the authoritative contract exists to refuse, and the lifecycle
  // hooks reject it at confirm time anyway — disabling here keeps the UI from
  // advertising an action that would only fail after Confirm.
  const actionsLocked = !!busy || hasPendingRecovery || !mutationsAllowed;
  const noticeIsTerminal = !hasPendingRecovery && !!pendingRecoveryError;

  // Unverified Recovery state is never rendered as "no recovery blocks" (#716).
  // A terminal first-load failure shows the failure and the same `Retry
  // recovery` control the pending-operation banner uses. Falling through to the
  // "nothing to show" return below would present a failed read as a verified
  // empty result.
  if (!stateReady) {
    // A cold first load stays visually neutral (#724): a non-adopter must not
    // see a Recovery card flash before the first verified read resolves, so an
    // in-flight initial read renders nothing at all. Only a terminal first-load
    // failure — a read that has stopped with nothing verified — earns the
    // explicit unknown state and its retry path.
    const isInitialLoad = !stateError && (stateLoading || stateRefreshing);
    if (isInitialLoad) return null;
    return (
      <View style={styles.container}>
        <View style={styles.activeGroup}>
          <SectionTitle>Recovery</SectionTitle>
          <Card style={styles.card}>
            <View
              style={styles.pendingBanner}
              accessible
              accessibilityRole="alert"
              accessibilityLabel={RECOVERY_UNVERIFIED_MESSAGE}
            >
              <Text style={styles.pendingBannerText}>{RECOVERY_UNVERIFIED_MESSAGE}</Text>
              <Pressable
                onPress={() => onRetryRecovery?.()}
                disabled={!!busy}
                style={styles.pendingRetryButton}
                accessibilityRole="button"
                accessibilityLabel="Retry recovery"
                accessibilityState={{ disabled: !!busy }}
              >
                <Text style={styles.pendingRetryText}>Retry recovery</Text>
              </Pressable>
            </View>
          </Card>
        </View>
      </View>
    );
  }

  // A pending recovery operation must stay visible even without an active block
  // — otherwise the retry affordance would disappear with the records it is
  // trying to repair. The same is true of a stale snapshot.
  if (!activeBlock && !showRecoveryNotice && !stateStale) return null;

  const notesById = new Map(notes.map(n => [n.id, n]));
  const activeWeeks = activeBlock ? orderedLiveWeeks(weeks, activeBlock.id) : [];
  const currentWeek = activeWeeks.length > 0 ? activeWeeks[activeWeeks.length - 1] : null;
  const canCompleteWeek = !!currentWeek && !currentWeek.completed_at;
  const canAddWeek = !!activeBlock && (!currentWeek || !!currentWeek.completed_at);
  // Undo is offered only when there IS a just-completed current week to
  // reopen (#836) — `canAddWeek` alone is also true for a block with no
  // weeks at all yet, which has nothing to undo.
  const canUndoCompleteWeek = !!currentWeek && !!currentWeek.completed_at;
  // The single fact that matters while logging (#789): which week you are on and
  // whether it needs an action. `addRecoveryWeekCore`/`completeCurrentWeekCore`
  // guarantee at most one non-completed week per block, so `currentWeek` is
  // always either the open week or the just-completed one — never a list to
  // scan, and never ambiguous between the two headline states.
  // Derived, never stored: a disclosure opened for a different block reads as
  // collapsed for this one.
  const manageExpanded = !!activeBlock && manageExpandedBlockId === activeBlock.id;
  const headline = currentWeek
    ? (currentWeek.completed_at
      ? `Week ${currentWeek.week_number} complete — add the next week`
      : `Week ${currentWeek.week_number} in progress`)
    : 'No recovery week yet — add a week';

  const runAction = async (action) => {
    setActionError(null);
    const result = await action();
    if (!result || result.ok === false) {
      setActionError((result && result.error) || 'That action could not be completed.');
    }
  };

  // Complete Week states its consequence before committing (#836): it
  // completes the current week and keeps its note exactly as it is — it does
  // not create or submit a note for the next week. That happens separately,
  // through `Add week`, once this confirms.
  const handleCompleteWeek = () => {
    Alert.alert(
      `Complete Week ${currentWeek.week_number}?`,
      `This marks Week ${currentWeek.week_number} complete and keeps its note as it is. It does not create or submit a note for the next week — you'll choose or create that note when you add it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete week',
          onPress: () => runAction(() => onCompleteWeek({ blockId: activeBlock.id })),
        },
      ]
    );
  };

  // Undo for the just-completed week (#836): only ever offered when
  // `canAddWeek` holds, so this can never reach a week that already has a
  // later week — restoring it to in-progress never leaves two weeks open at
  // once. The note is untouched either way.
  const handleUndoCompleteWeek = () => {
    Alert.alert(
      `Reopen Week ${currentWeek.week_number}?`,
      `Week ${currentWeek.week_number} goes back to in progress. Its note is unchanged.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reopen week',
          onPress: () => runAction(() => onUndoCompleteWeek({ blockId: activeBlock.id })),
        },
      ]
    );
  };

  const handleCompleteBlock = () => {
    Alert.alert(
      'Complete recovery block?',
      'Exercise targets are advisory — unmet targets will not block completion. The baseline routine is untouched. You can reopen your most recently completed block later, as long as no other block is active.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete',
          style: 'destructive',
          onPress: () => runAction(() => onCompleteBlock({ blockId: activeBlock.id })),
        },
      ]
    );
  };

  const handleUnlinkWeek = (week) => {
    // No claim is made about a note that is not there: an absent note has no
    // title to quote and cannot be "kept and stays editable" (#775). Unlinking
    // still works — it is how a user clears a week whose note is gone.
    const linkedNote = week.note_id ? notesById.get(week.note_id) : null;
    Alert.alert(
      `Unlink Week ${week.week_number}?`,
      linkedNote
        ? `"${_noteTitle(linkedNote)}" will be removed from this recovery block. The note itself is kept and stays editable.`
        : `Week ${week.week_number} will be removed from this recovery block.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: () => runAction(() => onUnlinkWeek({ blockId: activeBlock.id, weekId: week.id })),
        },
      ]
    );
  };

  // A failure is reported against the block it happened on, so a completed
  // block's rejected toggle never posts an error over the active block's card.
  const handleToggleInclusion = async (block, include) => {
    if (inclusionBusyBlockId) return;
    setInclusionError(null);
    setInclusionBusyBlockId(block.id);
    try {
      const result = await setIncludeInNormalAnalytics({ blockId: block.id, include });
      if (!result || result.ok === false) {
        setInclusionError({
          blockId: block.id,
          message: (result && result.error) || 'That setting could not be saved.',
        });
      }
    } finally {
      setInclusionBusyBlockId(null);
    }
  };

  const inclusionErrorFor = (blockId) =>
    (inclusionError && inclusionError.blockId === blockId) ? inclusionError.message : null;

  // EVERY inclusion switch is disabled while ANY inclusion write is in flight,
  // not just the one being written. `handleToggleInclusion` refuses a second
  // concurrent write, so leaving the other blocks' switches enabled would
  // present an affordance — to sighted and screen-reader users alike — that
  // silently discards the interaction.
  const inclusionLocked = actionsLocked || !!inclusionBusyBlockId;

  // A verified snapshot whose latest refresh failed (#716). Last-known-good
  // blocks and weeks stay on screen — they are still the truth as of the last
  // successful read — and this says so plainly rather than letting the user
  // assume the view is current.
  const staleBanner = (
    <View
      style={styles.pendingBanner}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={RECOVERY_STALE_MESSAGE}
    >
      <Text style={styles.pendingBannerText}>{RECOVERY_STALE_MESSAGE}</Text>
      <Pressable
        onPress={() => onRetryRecovery?.()}
        disabled={!!busy || stateRefreshing}
        style={styles.pendingRetryButton}
        accessibilityRole="button"
        accessibilityLabel="Retry recovery"
        accessibilityState={{ disabled: !!busy || stateRefreshing }}
      >
        <Text style={styles.pendingRetryText}>Retry recovery</Text>
      </Pressable>
    </View>
  );

  const pendingBanner = (
    <View
      style={styles.pendingBanner}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${noticeIsTerminal ? 'Recovery change not applied' : 'Recovery change pending'}. ${pendingMessage}`}
    >
      <Text style={styles.pendingBannerText}>{pendingMessage}</Text>
      {!noticeIsTerminal && (
        <Pressable
          onPress={() => runAction(() => onRetryRecovery?.())}
          disabled={!!busy}
          style={styles.pendingRetryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry recovery"
          accessibilityState={{ disabled: !!busy }}
        >
          <Text style={styles.pendingRetryText}>Retry recovery</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {!activeBlock && (showRecoveryNotice || stateStale) && (
        <View style={styles.activeGroup}>
          <SectionTitle>Recovery</SectionTitle>
          <Card style={styles.card}>
            {stateStale ? staleBanner : null}
            {showRecoveryNotice ? pendingBanner : null}
          </Card>
        </View>
      )}
      {activeBlock && (
        <View style={styles.activeGroup}>
          <SectionTitle>Recovery</SectionTitle>
          <Card style={styles.card}>
            {/* State-derived headline first, supporting evidence second (#789).
                The baseline is still stated in full, but as one de-emphasized
                caption rather than the card's loudest two rows. */}
            <Text style={styles.headline}>{headline}</Text>
            <Text style={styles.baselineCaption}>
              Baseline: {activeBlock.baseline_note_title || 'Untitled Routine'}
            </Text>

            {stateStale ? staleBanner : null}
            {showRecoveryNotice ? pendingBanner : null}

            {actionError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{actionError}</Text>
              </View>
            ) : null}

            <View style={styles.weekList}>
              {/* Every live week of this block renders as its own labeled
                  entry (#836) — completed weeks included, not just the
                  current one — so the block's whole sequence is visible and
                  a completed week's note stays reachable to view/edit. Each
                  is visually distinguished by its own `In progress`/
                  `Completed` status, in addition to the headline above, which
                  only ever states the CURRENT week's status. */}
              {activeWeeks.map(week => {
                const linkedNote = week.note_id ? notesById.get(week.note_id) : null;
                const isCompleted = !!week.completed_at;
                // The row stays — the week is still one of this block's weeks
                // — but it offers no read action, because there is nothing to
                // read. Unlink no longer lives on the row (#789); dropping
                // `onPress` AND
                // `accessibilityRole="button"` is what keeps it from being an
                // inert press for a sighted user and an announced-but-dead
                // button for a screen-reader user (#775).
                //
                // An in-progress row's label is unchanged from before (#836):
                // only a completed row's label gains an explicit ", completed"
                // suffix, since a completed week is new to this list and has
                // no existing label contract to preserve.
                const rowLabel = linkedNote
                  ? `View ${_noteTitle(linkedNote)}, Recovery Week ${week.week_number}${isCompleted ? ', completed' : ''}`
                  : `Recovery Week ${week.week_number}${isCompleted ? ', completed' : ''}, note unavailable`;
                const isViewingThisNote = !!linkedNote && viewingNoteId === week.note_id && !!viewingNote;
                // Freezes which week is expanded while ANY recovery note is
                // mid-edit (#841): the inline editor only renders inside
                // `isViewingThisNote`'s block below, so switching which week
                // is viewed while editing would silently unmount the editor
                // out from under an unsaved edit instead of routing the user
                // through Save/Cancel. Blocking every row's toggle — including
                // the edited row's own, which would otherwise collapse it
                // shut on the same note — is what keeps a second row from
                // ever opening for editing at the same time too.
                const rowBlockedByEdit = !!editingNoteId;
                const rowProps = linkedNote
                  ? { onPress: rowBlockedByEdit ? undefined : () => onViewNote?.(linkedNote), accessibilityRole: 'button' }
                  : {};
                const RowMain = linkedNote ? Pressable : View;
                return (
                  <View key={week.id} style={styles.weekItem}>
                    {/* One borderless line, not a bordered three-line box
                        (#804). The headline directly above already states
                        `Week {N} in progress`, so the row's own `Week {N}`
                        micro-label and `In progress` status were the same fact
                        rendered twice in a competing row. What is left is the
                        only thing the row uniquely offers: the note you can
                        read. The accessible name is unchanged — a screen-reader
                        user reaches this control out of context and still needs
                        the week number and the read verb in its label. */}
                    <RowMain
                      style={styles.weekRow}
                      accessible
                      accessibilityLabel={rowLabel}
                      accessibilityState={linkedNote ? { expanded: isViewingThisNote, disabled: rowBlockedByEdit } : undefined}
                      {...rowProps}
                    >
                      <View style={styles.weekRowInfo}>
                        <Text style={styles.weekNumberLabel}>Week {week.week_number}</Text>
                        <Text style={[styles.weekStatusText, isCompleted && styles.weekStatusTextCompleted]}>
                          {isCompleted ? 'Completed' : 'In progress'}
                        </Text>
                      </View>
                      <Text style={styles.weekNoteTitle} numberOfLines={1}>
                        {linkedNote ? _noteTitle(linkedNote) : RECOVERY_NOTE_UNAVAILABLE}
                      </Text>
                      {linkedNote ? (
                        <MaterialIcons
                          name={isViewingThisNote ? 'expand-less' : 'chevron-right'}
                          size={18}
                          color={colors.textMuted}
                          accessible={false}
                        />
                      ) : null}
                    </RowMain>
                    {isViewingThisNote && (() => {
                      // Editing THIS week's note inline, not some other row's
                      // (#841): `editingNoteId` is already scoped to a
                      // recovery-sourced session by LogScreen, so comparing it
                      // to this row's linked note id is enough to tell the two
                      // apart. `editingBlocked` disables Edit/double-tap on
                      // every OTHER row while one recovery note is mid-edit,
                      // so a second edit session can never start out from
                      // under the first without an explicit Save/Cancel.
                      const isEditingThisNote = !!linkedNote && editingNoteId === linkedNote.id;
                      const editingBlocked = !!editingNoteId && !isEditingThisNote;
                      const handleNoteBodyPress = () => {
                        if (editingBlocked) return;
                        const now = Date.now();
                        const DOUBLE_TAP_DELAY = 300;
                        if (now - viewingNoteLastTapRef.current < DOUBLE_TAP_DELAY) {
                          onEditNote?.();
                          viewingNoteLastTapRef.current = 0;
                        } else {
                          viewingNoteLastTapRef.current = now;
                        }
                      };
                      return (
                        <View style={styles.weekNoteContent}>
                          {isEditingThisNote ? (
                            <View style={styles.inlineEditor}>
                              <TextInput
                                value={editingTitle}
                                onChangeText={onChangeEditingTitle}
                                placeholder="Routine Name"
                                placeholderTextColor={colors.textMuted}
                                autoCorrect={false}
                                autoCapitalize="none"
                                spellCheck={false}
                                style={styles.inlineEditorTitleInput}
                                accessibilityLabel="Recovery note title"
                              />
                              <TextInput
                                value={editingText}
                                onChangeText={onChangeEditingText}
                                placeholder="Workout note…"
                                placeholderTextColor={colors.textMuted}
                                multiline
                                autoCorrect={false}
                                autoCapitalize="none"
                                spellCheck={false}
                                style={styles.inlineEditorTextInput}
                                accessibilityLabel="Recovery note text"
                              />
                              {editingSaveError ? (
                                <Text style={styles.errorBannerText}>{editingSaveError}</Text>
                              ) : null}
                              <View style={styles.weekNoteActions}>
                                {editingHasABWeeks && (
                                  <Pressable
                                    onPress={() => onToggleEditingWeek?.()}
                                    style={styles.inlineSwitchButton}
                                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Switch to Week ${editingEffectiveWeek === 'B' ? 'A' : 'B'}`}
                                    accessibilityState={{ selected: editingEffectiveWeek === 'B' }}
                                  >
                                    <Text style={styles.inlineSwitchButtonText}>
                                      Week {editingEffectiveWeek === 'B' ? 'A' : 'B'}
                                    </Text>
                                  </Pressable>
                                )}
                                <Pressable
                                  onPress={() => onCancelEdit?.()}
                                  style={styles.inlineSwitchButton}
                                  accessibilityRole="button"
                                  accessibilityLabel="Cancel editing recovery note"
                                >
                                  <Text style={styles.inlineSwitchButtonText}>Cancel</Text>
                                </Pressable>
                                <Pressable
                                  onPress={() => onSaveEdit?.()}
                                  disabled={editingIsSaving}
                                  style={[styles.inlineSwitchButton, editingIsSaving && styles.inlineSwitchButtonDisabled]}
                                  accessibilityRole="button"
                                  accessibilityLabel="Save recovery note"
                                  accessibilityState={{ disabled: editingIsSaving }}
                                >
                                  <Text style={styles.inlineSwitchButtonText}>
                                    {editingIsSaving ? 'Saving…' : 'Save'}
                                  </Text>
                                </Pressable>
                              </View>
                            </View>
                          ) : (
                            <>
                              {/* Double-tap is the primary direct-manipulation
                                  edit gesture (#841 owner amendment), matching
                                  the Routine tab's existing prior-routine
                                  interaction. */}
                              <Pressable onPress={handleNoteBodyPress} style={styles.weekNoteBody}>
                                <WorkoutContentRenderer
                                  dayGroups={viewingNoteDayGroups}
                                  emptyText="No exercises to display."
                                />
                              </Pressable>
                              <View style={styles.weekNoteActions}>
                                {/* The same Week A/B control the non-current
                                    routine card carries (#711), in its existing
                                    pill form and with the exact role/label/
                                    selected state it has there — it changes
                                    which week you are READING, not a
                                    routine-lifecycle action. */}
                                {viewingHasABWeeks && (
                                  <Pressable
                                    onPress={() => onToggleViewingWeek?.()}
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
                                )}
                                {/* Explicit, visible Edit affordance kept for
                                    discoverability/accessibility (#841 owner
                                    amendment) — a peer control of Week A/B, not
                                    a replacement for the double-tap gesture.
                                    Enters the SAME inline editor above; it
                                    never navigates to the shared full-screen
                                    Routine editor (see LogScreen's
                                    `editingSource === 'recovery'` gate). */}
                                {linkedNote && (
                                  <Pressable
                                    onPress={() => onEditNote?.()}
                                    disabled={editingBlocked}
                                    style={[styles.inlineSwitchButton, editingBlocked && styles.inlineSwitchButtonDisabled]}
                                    accessibilityRole="button"
                                    accessibilityLabel="Edit"
                                    accessibilityState={{ disabled: editingBlocked }}
                                  >
                                    <Text style={styles.inlineSwitchButtonText}>Edit</Text>
                                  </Pressable>
                                )}
                              </View>
                            </>
                          )}
                        </View>
                      );
                    })()}
                  </View>
                );
              })}
            </View>

            {/* Exactly one lifecycle action is primary and visible by default
                (#789). `canCompleteWeek` and `canAddWeek` are mutually
                exclusive by construction, so this row never holds two. */}
            <View style={styles.actionsRow}>
              {canCompleteWeek && (
                <Pressable
                  onPress={handleCompleteWeek}
                  disabled={actionsLocked}
                  style={styles.primaryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Complete week"
                  accessibilityState={{ disabled: actionsLocked }}
                >
                  <Text style={styles.primaryButtonText}>
                    {busy === 'week' ? 'Completing…' : 'Complete week'}
                  </Text>
                </Pressable>
              )}
              {canAddWeek && (
                <Pressable
                  onPress={onOpenAddWeek}
                  disabled={actionsLocked}
                  style={styles.primaryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Add next recovery week"
                  accessibilityState={{ disabled: actionsLocked }}
                >
                  <Text style={styles.primaryButtonText}>Add week</Text>
                </Pressable>
              )}
              {/* Reopens the week `Add week` would otherwise leave completed
                  forever (#836). Secondary chip styling, not the primary
                  fill: `Add week` is still the expected next step, and this
                  is the way back for the one case that is not. Restricted to
                  exactly the week `canUndoCompleteWeek` names — the most
                  recently completed week, only while no later week exists. */}
              {canUndoCompleteWeek && (
                <Pressable
                  onPress={handleUndoCompleteWeek}
                  disabled={actionsLocked}
                  style={styles.inlineButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Undo completing Week ${currentWeek.week_number}`}
                  accessibilityState={{ disabled: actionsLocked }}
                >
                  <Text style={styles.inlineButtonText}>
                    {busy === 'undo-week' ? 'Reopening…' : 'Undo completion'}
                  </Text>
                </Pressable>
              )}
            </View>

            {/* One disclosure for everything that is not needed to log today's
                workout (#789). The trigger carries no `disabled` key in any
                state — see `manageExpanded` above — so a locked user can always
                open it; each control inside keeps exactly the per-control
                gating it had when it lived in the flat action row. */}
            <Pressable
              onPress={() => setManageExpandedBlockId(id => (id === activeBlock.id ? null : activeBlock.id))}
              style={styles.disclosureTrigger}
              accessibilityRole="button"
              accessibilityLabel={`Manage recovery block: ${activeBlock.baseline_note_title || 'Untitled Routine'}`}
              accessibilityState={{ expanded: manageExpanded }}
            >
              <Text style={styles.disclosureTriggerText}>Manage recovery block</Text>
              {/* The one sanctioned disclosure glyph (`ui-design-rules.md` §6):
                  a `MaterialIcons` chevron, never a text arrow (#804). */}
              <MaterialIcons
                name={manageExpanded ? 'expand-less' : 'expand-more'}
                size={18}
                color={colors.textMuted}
                accessible={false}
              />
            </Pressable>

            {manageExpanded && (
              <View style={styles.disclosureContent}>
                <View style={styles.actionsRow}>
                  {/* Always names the concrete current week, open or just
                      completed, so Unlink is never a context-free button. */}
                  {currentWeek && (
                    <Pressable
                      onPress={() => handleUnlinkWeek(currentWeek)}
                      disabled={actionsLocked}
                      style={styles.inlineButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Unlink Week ${currentWeek.week_number}`}
                      accessibilityState={{ disabled: actionsLocked }}
                    >
                      <Text style={styles.inlineButtonText}>
                        {busy === currentWeek.id ? 'Unlinking…' : `Unlink Week ${currentWeek.week_number}`}
                      </Text>
                    </Pressable>
                  )}
                  {/* Demoted to the same secondary destructive chip Unlink
                      uses (#804). An accent fill here made the rarest,
                      irreversible action the loudest button on the card while
                      the expected next step was a plain chip — the hierarchy
                      inverted. The confirm, gating, and handler are unchanged. */}
                  <Pressable
                    onPress={handleCompleteBlock}
                    disabled={actionsLocked}
                    style={styles.inlineButton}
                    accessibilityRole="button"
                    accessibilityLabel="Complete recovery block"
                    accessibilityState={{ disabled: actionsLocked }}
                  >
                    <Text style={styles.inlineButtonText}>
                      {busy === 'block' ? 'Completing…' : 'Complete recovery block'}
                    </Text>
                  </Pressable>
                </View>

                <RecoveryInclusionToggle
                  block={activeBlock}
                  disabled={inclusionLocked}
                  busy={inclusionBusyBlockId === activeBlock.id}
                  error={inclusionErrorFor(activeBlock.id)}
                  onToggle={handleToggleInclusion}
                />
              </View>
            )}
          </Card>
        </View>
      )}

    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    gap: 16,
  },
  activeGroup: {
    gap: 16,
  },
  card: {
    gap: 10,
  },
  // Plain wrapping text at the weight the baseline title used to hold, so the
  // loudest row is now the state fact rather than the routine name. No
  // `numberOfLines`: large text wraps instead of truncating.
  headline: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  baselineCaption: {
    fontSize: 13,
    color: colors.textMuted,
  },
  // A disclosure, not an action: the chip fill and border are dropped (#804) so
  // the card's only bordered, filled control is the one primary lifecycle
  // action. Label plus chevron, at the same 44dp floor it already had.
  disclosureTrigger: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    minHeight: 44,
  },
  disclosureTriggerText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  disclosureContent: {
    gap: 10,
  },
  pendingBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.subtleBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 8,
  },
  pendingBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  pendingRetryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pendingRetryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  errorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.cardErrorBg,
    borderWidth: 1,
    borderColor: colors.cardErrorBg,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textLight,
  },
  weekList: {
    gap: 8,
  },
  // Groups one week's row with the note it renders inline when tapped (#775).
  // Layout-only containment; both values are the list's and the row's own
  // existing spacing, so no new Log-tab spacing decision is introduced.
  weekItem: {
    gap: 8,
  },
  weekNoteContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  weekNoteBody: {},
  // The inline recovery-note editor (#841): a compact title + text pair, no
  // outer Card — it already lives inside this week's own content area, so a
  // second nested bordered surface would only add chrome the note viewer
  // above it never had.
  inlineEditor: {
    gap: 8,
  },
  inlineEditorTitleInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  inlineEditorTextInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  // Holds the Week A/B pill at its natural width, exactly as the non-current
  // routine card's `viewActions` row does (LogPreviousRoutines.js).
  weekNoteActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  // The relocated pill keeps the treatment authorized for it in #710/#711:
  // same background, border, radius, 44dp floor, and shrink behavior. Edit
  // (#841) is a plain Pressable using this SAME style object, not a `Button`
  // wrapping it — `Button`'s own base style carries a `marginTop` Week A/B
  // never had, which broke the peer controls' vertical alignment when Edit
  // was rendered through it.
  inlineSwitchButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
    flexShrink: 1,
  },
  inlineSwitchButtonDisabled: {
    opacity: 0.45,
  },
  inlineSwitchButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  // Borderless single line (#804). Removing the box removes a border the card
  // did not need; the 44dp floor the bordered three-line row used to reach
  // incidentally is now stated explicitly, so a one-line row keeps the target.
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
  },
  weekNoteTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  // Groups the row's own week number and status so it reads as one unit
  // beside the note title (#836). A fixed floor, not 0, so it never gets
  // squeezed to nothing beside `weekNoteTitle`'s flex:1.
  weekRowInfo: {
    minWidth: 88,
  },
  weekNumberLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  // Distinguishes a completed week from the in-progress one at a glance
  // (#836), reusing the existing baselineCaption weight/size rather than
  // introducing a new type scale.
  weekStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
  },
  weekStatusTextCompleted: {
    color: colors.textMuted,
  },
  // The secondary chip for the disclosed, infrequent controls. `minHeight: 44`
  // is required, not incidental: at 12/6 padding a one-line chip fell short of
  // the touch-target floor (#804).
  inlineButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
  },
  inlineButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.error,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // The card's single primary action carries the only accent fill (#804), with
  // `onAccent` ink — the pairing already recorded for accent surfaces in
  // `docs/design-system-map.md`.
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onAccent,
  },
});
