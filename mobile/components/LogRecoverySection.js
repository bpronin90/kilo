// Recovery Block lifecycle UI (#696, redesigned #843): the active block's
// baseline, current week, lifecycle actions, and active-block inclusion
// control. Completed-block history lives in Analytics (#729). Week 1
// attach/start lives in RecoveryBlockStartModal (#695); this component only
// ever advances or completes a block that already exists.
//
// All lifecycle mutation (complete week, add week, complete block, unlink
// week) is delegated to the handlers passed in from LogScreen, which bind to
// hooks/entries/recoveryBlockHooks.js — this file never imports storage
// directly and never decides eligibility itself beyond what those handlers
// already enforce.
//
// #843 owner-authorized exception to the Log tab's style lock: this file's
// card, week-table, and action-zone visuals are the approved redesign, scoped
// to this file plus RecoveryBlockEndModal.js, LogActiveRoutineCard.js, and
// LogPreviousRoutines.js. `End recovery block` now opens
// `RecoveryBlockEndModal` (owned by LogScreen) instead of `Alert.alert`.

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
import { RECOVERY_INCLUSION_HELP } from './RecoveryInclusionToggle';
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

// `colors.accent`/`colors.success` are plain `#rrggbb` strings in both
// palettes (theme/colors.js) — this derives the two alpha tints the design
// calls for (accent-6%, success-12%) without introducing any new raw hex
// (#843 constraint: "Use only palette role names and derived colors.accent at
// 6% / colors.success at 12%").
function _withAlpha(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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
  // Inline recovery-note editor (#841): both the explicit `Edit note` action
  // and double-tapping the expanded note body open the SAME inline editor
  // here, never the shared full-screen Routine editor. `editingNoteId` is
  // null unless the currently open editor session was opened FROM this block
  // (see LogScreen's `editingSource === 'recovery'` gate) — a full-screen or
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
  // Opens LogScreen's `RecoveryBlockEndModal` (#843) — this component no
  // longer completes a block itself, and never shows the old `Alert.alert`
  // for it. LogScreen owns `endBlockModalOpen` and the modal's confirm/error
  // handling; this is purely "ask to open it".
  onOpenEndBlockModal,
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
  // The `Manage block` disclosure (#789, restyled #843), collapsed by default.
  // It is presentation state only: nothing inside it changes handler, gating,
  // or confirm copy, and the trigger itself is NEVER disabled — a locked user
  // must still be able to open it and see WHY each control inside is
  // unavailable (#780 corrected blocked-mutation contract).
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
  // `Counting in normal analytics` IS the Log-surface inclusion control now
  // (#843 review): tapping the row itself writes `include_in_normal_analytics`
  // — there is no separate `RecoveryInclusionToggle` Switch nested under it
  // on Log any more (that component, and its Switch presentation, remain
  // exactly as they are for Analytics/Home). This tracks only whether the
  // row's own on-demand help text (the same `RECOVERY_INCLUSION_HELP` copy)
  // is shown, mirroring `RecoveryInclusionToggle`'s own local `helpShown`
  // pattern — it never gates the write.
  const [inclusionHelpShownBlockId, setInclusionHelpShownBlockId] = useState(null);
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
  //
  // A fourth reason (#841 automated review finding): `Complete recovery
  // block` unmounts this whole active-block card, and `Unlink Week` removes
  // a week's row outright — either can fire while a recovery note is
  // mid-edit and take the inline editor's only Save/Cancel down with it,
  // stranding an unsaved (or already-autosaved) edit with no way back to
  // confirm or discard it. Locking every lifecycle control — not just those
  // two — while `editingNoteId` is set keeps this one flag's meaning intact
  // ("nothing here may mutate right now") instead of drawing a new
  // action-by-action distinction.
  const actionsLocked = !!busy || hasPendingRecovery || !mutationsAllowed || !!editingNoteId;
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
            <View style={styles.stateZone}>
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
  const inclusionHelpShown = !!activeBlock && inclusionHelpShownBlockId === activeBlock.id;
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
            <View style={styles.stateZone}>
              {stateStale ? staleBanner : null}
              {showRecoveryNotice ? pendingBanner : null}
            </View>
          </Card>
        </View>
      )}
      {activeBlock && (
        <View style={styles.activeGroup}>
          <SectionTitle>Recovery</SectionTitle>
          <Card style={styles.card}>
            {/* Zone 1 — state: a kicker, the headline fact, and the
                de-emphasized baseline caption (#843). */}
            <View style={styles.stateZone}>
              <Text style={styles.stateKicker}>RECOVERY BLOCK</Text>
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
            </View>

            {/* Zone 2 — the week table (#843): every live week of this block,
                completed weeks included, so the block's whole sequence is
                visible and a completed week's note stays reachable. Status is
                carried by the dot alone, not a repeated text label — the
                accessibility label still states it explicitly. */}
            <View style={styles.weekTable}>
              {activeWeeks.map((week, weekIndex) => {
                const linkedNote = week.note_id ? notesById.get(week.note_id) : null;
                const isCompleted = !!week.completed_at;
                const isCurrentWeek = !!currentWeek && week.id === currentWeek.id;
                const isLastRow = weekIndex === activeWeeks.length - 1;
                // The row stays — the week is still one of this block's weeks
                // — but it offers no read action, because there is nothing to
                // read. Unlink no longer lives on the row (#789); dropping
                // `onPress` AND `accessibilityRole="button"` is what keeps it
                // from being an inert press for a sighted user and an
                // announced-but-dead button for a screen-reader user (#775).
                //
                // Status suffix on the label is unchanged from #836: only a
                // completed row's label gains an explicit ", completed"
                // suffix.
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
                const dayHeading = viewingNoteDayGroups?.[0]?.heading || `Week ${week.week_number}`;
                return (
                  <View
                    key={week.id}
                    style={[
                      styles.weekItem,
                      !isLastRow && styles.weekItemDivider,
                      // Current-week wrapper: accent-at-6%-alpha background and
                      // a 3px accent left rail, with left padding compensated
                      // from 18 to 15 so the rail's own width completes the
                      // table's 18px rhythm (#843).
                      isCurrentWeek && { backgroundColor: _withAlpha(colors.accent, 0.06), borderLeftWidth: 3, borderLeftColor: colors.accent },
                    ]}
                  >
                    <RowMain
                      style={[styles.weekRow, isCurrentWeek && styles.weekRowCurrent]}
                      accessible
                      accessibilityLabel={rowLabel}
                      accessibilityState={linkedNote ? { expanded: isViewingThisNote, disabled: rowBlockedByEdit } : undefined}
                      {...rowProps}
                    >
                      <View
                        style={[
                          styles.statusDot,
                          isCompleted
                            ? { backgroundColor: _withAlpha(colors.success, 0.12) }
                            : { borderWidth: 2, borderColor: colors.accent },
                        ]}
                      >
                        {isCompleted && <MaterialIcons name="check" size={16} color={colors.success} accessible={false} />}
                      </View>
                      <Text style={styles.weekLabel}>Week {week.week_number}</Text>
                      <Text style={styles.weekNoteTitle} numberOfLines={1}>
                        {linkedNote ? _noteTitle(linkedNote) : RECOVERY_NOTE_UNAVAILABLE}
                      </Text>
                      {linkedNote ? (
                        <MaterialIcons
                          name={isViewingThisNote ? 'expand-less' : 'expand-more'}
                          size={20}
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
                        <View style={[styles.weekNoteContent, isCurrentWeek && styles.weekNoteContentCurrent]}>
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
                                  <ABSegment
                                    styles={styles}
                                    colors={colors}
                                    effectiveWeek={editingEffectiveWeek}
                                    onToggle={() => onToggleEditingWeek?.()}
                                  />
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
                            <View style={styles.noteSurface}>
                              <View style={styles.noteSurfaceHeader}>
                                <Text style={styles.noteSurfaceKicker} numberOfLines={1}>
                                  {String(dayHeading).toUpperCase()}
                                </Text>
                                {/* The Recovery `A`/`B` segment (#843), replacing
                                    the pill: it changes which week you are
                                    READING, not a routine-lifecycle action, and
                                    sits above the content it governs. 32px
                                    visual height with hitSlop closing the gap to
                                    the 44dp touch floor — the design's
                                    documented exception. */}
                                {viewingHasABWeeks && (
                                  <ABSegment
                                    styles={styles}
                                    colors={colors}
                                    effectiveWeek={viewingEffectiveWeek}
                                    onToggle={() => onToggleViewingWeek?.()}
                                  />
                                )}
                              </View>
                              {/* Double-tap is the primary direct-manipulation
                                  edit gesture (#841 owner amendment), matching
                                  the Routine tab's existing prior-routine
                                  interaction. */}
                              <Pressable onPress={handleNoteBodyPress} style={styles.weekNoteBody}>
                                <WorkoutContentRenderer
                                  dayGroups={viewingNoteDayGroups}
                                  emptyText="No exercises to display."
                                  compact
                                />
                              </Pressable>
                              <View style={styles.weekNoteActions}>
                                {/* The card's single expanded-note action
                                    (#843): one 36px outlined `Edit note`
                                    control. Enters the SAME inline editor
                                    above; it never navigates to the shared
                                    full-screen Routine editor (see LogScreen's
                                    `editingSource === 'recovery'` gate). */}
                                {linkedNote && (
                                  <Pressable
                                    onPress={() => onEditNote?.()}
                                    disabled={editingBlocked}
                                    style={[styles.editNoteButton, editingBlocked && styles.inlineSwitchButtonDisabled]}
                                    accessibilityRole="button"
                                    accessibilityLabel="Edit"
                                    accessibilityState={{ disabled: editingBlocked }}
                                  >
                                    <MaterialIcons name="edit" size={14} color={colors.accent} accessible={false} />
                                    <Text style={styles.editNoteButtonText}>Edit note</Text>
                                  </Pressable>
                                )}
                              </View>
                            </View>
                          )}
                        </View>
                      );
                    })()}
                  </View>
                );
              })}
            </View>

            {/* Zone 3 — the action zone (#843): exactly one primary lifecycle
                action, full-width and 48px. `canCompleteWeek` and
                `canAddWeek` are mutually exclusive by construction, so this
                never holds two. */}
            <View style={styles.actionZone}>
              {canCompleteWeek && (
                <>
                  <Pressable
                    onPress={handleCompleteWeek}
                    disabled={actionsLocked}
                    style={[styles.primaryButton, actionsLocked && styles.primaryButtonDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel={`Complete Week ${currentWeek.week_number}`}
                    accessibilityState={{ disabled: actionsLocked }}
                  >
                    <Text style={styles.primaryButtonText}>
                      {busy === 'week' ? 'Completing…' : `Complete Week ${currentWeek.week_number}`}
                    </Text>
                  </Pressable>
                  <Text style={styles.actionCaption}>
                    Keeps Week {currentWeek.week_number}'s note as it is — you'll choose or create next
                    week's note separately.
                  </Text>
                </>
              )}
              {canAddWeek && (
                <>
                  <Pressable
                    onPress={onOpenAddWeek}
                    disabled={actionsLocked}
                    style={[styles.primaryButton, actionsLocked && styles.primaryButtonDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Add next recovery week"
                    accessibilityState={{ disabled: actionsLocked }}
                  >
                    <Text style={styles.primaryButtonText}>Add week</Text>
                  </Pressable>
                  <Text style={styles.actionCaption}>
                    Attach an existing note or create a new one as the next recovery week.
                  </Text>
                </>
              )}
              {/* Reopens the week `Add week` would otherwise leave completed
                  forever (#836). Muted ink, not error — this is a routine
                  correction, not a destructive action. Restricted to exactly
                  the week `canUndoCompleteWeek` names — the most recently
                  completed week, only while no later week exists. */}
              {canUndoCompleteWeek && (
                <Pressable
                  onPress={handleUndoCompleteWeek}
                  disabled={actionsLocked}
                  style={styles.undoButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Undo completing Week ${currentWeek.week_number}`}
                  accessibilityState={{ disabled: actionsLocked }}
                >
                  <Text style={styles.undoButtonText}>
                    {busy === 'undo-week' ? 'Reopening…' : 'Undo completion'}
                  </Text>
                </Pressable>
              )}
            </View>
          </Card>

          {/* Manage block (#843): a sibling card, not a disclosure inside the
              active card. The trigger carries no `disabled` key in any state
              — see `manageExpanded` above — so a locked user can always open
              it; each row inside keeps exactly the per-control gating it had
              before. */}
          <Card style={styles.manageCard}>
            <Pressable
              onPress={() => setManageExpandedBlockId(id => (id === activeBlock.id ? null : activeBlock.id))}
              style={styles.manageTrigger}
              accessibilityRole="button"
              accessibilityLabel={`Manage recovery block: ${activeBlock.baseline_note_title || 'Untitled Routine'}`}
              accessibilityState={{ expanded: manageExpanded }}
            >
              <Text style={styles.manageTriggerText}>Manage block</Text>
              {/* The one sanctioned disclosure glyph (`ui-design-rules.md` §6):
                  a `MaterialIcons` chevron, never a text arrow (#804). */}
              <MaterialIcons
                name={manageExpanded ? 'expand-less' : 'expand-more'}
                size={20}
                color={colors.textMuted}
                accessible={false}
              />
            </Pressable>

            {manageExpanded && (
              <View style={styles.manageList}>
                <View style={[styles.manageRow, styles.manageRowDivider]}>
                  {/* The row IS the Log-surface inclusion control (#843
                      review) — tapping it writes `include_in_normal_analytics`
                      directly. There is no nested `RecoveryInclusionToggle`
                      Switch here; that component, unchanged, still hosts the
                      Switch presentation on Analytics/Home. */}
                  <Pressable
                    onPress={() => handleToggleInclusion(activeBlock, !(activeBlock.include_in_normal_analytics === true))}
                    disabled={inclusionLocked}
                    style={[styles.manageRowMain, inclusionLocked && styles.manageRowDisabled]}
                    accessibilityRole="switch"
                    accessibilityLabel={`Counting in normal analytics: ${activeBlock.include_in_normal_analytics === true ? 'On' : 'Off'}`}
                    accessibilityState={{
                      checked: activeBlock.include_in_normal_analytics === true,
                      disabled: inclusionLocked,
                      busy: inclusionBusyBlockId === activeBlock.id,
                    }}
                  >
                    <View style={styles.manageRowInfo}>
                      <View style={styles.manageRowTitleRow}>
                        <Text style={styles.manageRowTitle}>Counting in normal analytics</Text>
                        {/* On-demand help (#757's pattern, reproduced here
                            rather than shared — `RecoveryInclusionToggle`
                            keeps its own separate copy for Analytics/Home).
                            A sibling of the row's own Pressable, not nested
                            inside it, so it stays reachable as its own
                            action. */}
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            setInclusionHelpShownBlockId(id => (id === activeBlock.id ? null : activeBlock.id));
                          }}
                          style={styles.inclusionHelpToggle}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: inclusionHelpShown }}
                          accessibilityLabel={`${inclusionHelpShown ? 'Hide' : 'Show'} what counting these weeks in normal analytics does`}
                        >
                          <MaterialIcons name="info-outline" size={16} color={colors.textMuted} accessible={false} />
                        </Pressable>
                      </View>
                      {inclusionHelpShown ? (
                        <Text style={styles.manageRowSubtitle} accessibilityLiveRegion="polite">
                          {RECOVERY_INCLUSION_HELP}
                        </Text>
                      ) : (
                        <Text style={styles.manageRowSubtitle}>
                          Off keeps these weeks out of classifications, overload signals, Kilo Max,
                          1K, and Home summaries.
                        </Text>
                      )}
                      {inclusionErrorFor(activeBlock.id) ? (
                        <Text style={styles.manageRowInlineError}>{inclusionErrorFor(activeBlock.id)}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.manageRowState}>
                      {inclusionBusyBlockId === activeBlock.id
                        ? 'Saving…'
                        : (activeBlock.include_in_normal_analytics === true ? 'On' : 'Off')}
                    </Text>
                    <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
                  </Pressable>
                </View>

                {/* Always names the concrete current week, open or just
                    completed, so Unlink is never a context-free button. */}
                {currentWeek && (
                  <Pressable
                    onPress={() => handleUnlinkWeek(currentWeek)}
                    disabled={actionsLocked}
                    style={[styles.manageRow, styles.manageRowDivider, styles.manageRowMain, actionsLocked && styles.manageRowDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel={`Unlink Week ${currentWeek.week_number}`}
                    accessibilityState={{ disabled: actionsLocked }}
                  >
                    <View style={styles.manageRowInfo}>
                      <Text style={styles.manageRowTitle}>
                        {busy === currentWeek.id ? 'Unlinking…' : `Unlink Week ${currentWeek.week_number}'s note`}
                      </Text>
                      <Text style={styles.manageRowSubtitle}>
                        Removes the note from this block. The note itself is kept and stays editable.
                      </Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
                  </Pressable>
                )}

                <Pressable
                  onPress={() => onOpenEndBlockModal?.()}
                  disabled={actionsLocked}
                  style={[styles.manageRow, styles.manageRowMain, actionsLocked && styles.manageRowDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="End recovery block"
                  accessibilityState={{ disabled: actionsLocked }}
                >
                  <View style={styles.manageRowInfo}>
                    <Text style={styles.manageRowTitleError}>End recovery block</Text>
                    <Text style={styles.manageRowSubtitle}>
                      Completes this block and asks how these weeks should count in analytics.
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={colors.error} accessible={false} />
                </Pressable>
              </View>
            )}
          </Card>
        </View>
      )}

    </View>
  );
}

// The Recovery `A`/`B` segment (#843): a two-item segmented control replacing
// the former `Week A`/`Week B` pill. Keeps the exact role/label/selected
// state the pill had — this changes which week is being READ, not a
// lifecycle action.
function ABSegment({ styles, colors, effectiveWeek, onToggle }) {
  const isB = effectiveWeek === 'B';
  return (
    <Pressable
      onPress={onToggle}
      style={styles.abSegment}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityLabel={`Switch to Week ${isB ? 'A' : 'B'}`}
      accessibilityState={{ selected: isB }}
    >
      <View style={[styles.abSegmentItem, !isB && styles.abSegmentItemActive]}>
        <Text style={[styles.abSegmentText, !isB && styles.abSegmentTextActive]}>A</Text>
      </View>
      <View style={[styles.abSegmentItem, isB && styles.abSegmentItemActive]}>
        <Text style={[styles.abSegmentText, isB && styles.abSegmentTextActive]}>B</Text>
      </View>
    </Pressable>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    gap: 16,
  },
  activeGroup: {
    gap: 12,
  },
  // Clipped card chrome (#843): padding:0 so the three internal zones each
  // own their own padding, with the existing 24px radius/border doing the
  // clipping.
  card: {
    padding: 0,
    overflow: 'hidden',
    gap: 0,
  },
  stateZone: {
    backgroundColor: colors.subtleBg,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 6,
  },
  stateKicker: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: colors.textMuted,
  },
  headline: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  baselineCaption: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  errorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.cardErrorBg,
    borderWidth: 1,
    borderColor: colors.cardErrorBg,
    marginTop: 4,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textLight,
  },
  weekTable: {},
  weekItem: {},
  weekItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 18,
  },
  // Left padding compensated from 18 to 15 to absorb the 3px accent rail on
  // the current-week wrapper, so the row's content still lands on the same
  // 18px rhythm as every other row (#843).
  weekRowCurrent: {
    paddingLeft: 15,
  },
  statusDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekLabel: {
    width: 56,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  weekNoteTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  weekNoteContent: {
    paddingHorizontal: 18,
    paddingBottom: 16,
    gap: 10,
  },
  weekNoteContentCurrent: {
    paddingLeft: 15,
  },
  // The expanded note's own inset, card-colored bordered surface (#843) — a
  // 14px-radius surface distinct from the week row it belongs to.
  noteSurface: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    gap: 10,
  },
  noteSurfaceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  noteSurfaceKicker: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: colors.accent,
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
  weekNoteActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
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
  // The one expanded-note action (#843): a 36px outlined `Edit note` control.
  editNoteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    justifyContent: 'center',
  },
  editNoteButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  // The Recovery A/B segment (#843): 32px visual height, documented exception
  // to the 44dp floor — hitSlop closes most of the gap, matching the same
  // exception pattern the former pill already used.
  abSegment: {
    flexDirection: 'row',
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.chipBackground,
    overflow: 'hidden',
  },
  abSegmentItem: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  abSegmentItemActive: {
    backgroundColor: colors.accent,
  },
  abSegmentText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  abSegmentTextActive: {
    color: colors.onAccent,
  },
  actionZone: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 8,
  },
  // The card's single primary action carries the only accent fill (#843),
  // full-width and 48px, with `onAccent` ink — the pairing already recorded
  // for accent surfaces in `docs/design-system-map.md`.
  primaryButton: {
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onAccent,
  },
  actionCaption: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  // `Undo completion` (#843): muted, not error, ink — reopening the latest
  // week is a routine correction, not a destructive action.
  undoButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 6,
  },
  undoButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  manageCard: {
    padding: 0,
    overflow: 'hidden',
    gap: 0,
  },
  manageTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  manageTriggerText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  manageList: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  manageRow: {},
  manageRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  manageRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  manageRowDisabled: {
    opacity: 0.5,
  },
  manageRowInfo: {
    flex: 1,
    gap: 2,
  },
  manageRowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: 2,
  },
  manageRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  manageRowTitleError: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.error,
  },
  manageRowSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  manageRowInlineError: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.error,
  },
  manageRowState: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  // On-demand inclusion help toggle (#843 review), matching
  // `RecoveryInclusionToggle`'s own info-button box: a real 44dp target, not
  // a `hitSlop`, which React Native clips at the parent's bounds.
  inclusionHelpToggle: {
    flexShrink: 0,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.subtleBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 8,
    marginTop: 4,
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
});
