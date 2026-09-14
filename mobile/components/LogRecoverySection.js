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
// to this file plus RecoveryBlockEndModal.js and LogPreviousRoutines.js. The
// Current routine card remains locked. `End recovery block` now opens
// `RecoveryBlockEndModal` (owned by LogScreen) instead of `Alert.alert`.
//
// #1056 file-size refactor (behavior-only): the presentation is split into
// `components/recovery/*` — the week table + primary action (LogRecoveryWeeks),
// the expanded note viewer/editor (LogRecoveryEvidence), the Manage block card
// (LogRecoveryLifecycle), and the StyleSheet (logRecoveryStyles). This file
// stays the public boundary: it owns the props, the authoritative read-state
// gating, the pending/stale banners, and the Alert-confirmed lifecycle
// transitions, and it re-exports `RECOVERY_INCLUSION_LABEL` unchanged.
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Alert } from '../lib/platformAlert';
import { Card, SectionTitle } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import {
  findActiveBlock,
  orderedLiveWeeks,
} from '../lib/data/recoveryBlocks';
import {
  RECOVERY_STALE_MESSAGE,
  RECOVERY_UNVERIFIED_MESSAGE,
} from '../hooks/entries/recoveryBlockHooks';
import { createStyles } from './recovery/logRecoveryStyles';
import { LogRecoveryWeeks, noteTitle } from './recovery/LogRecoveryWeeks';
import { LogRecoveryLifecycle } from './recovery/LogRecoveryLifecycle';
export { RECOVERY_INCLUSION_LABEL } from './RecoveryInclusionToggle';

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
  // #881: the exact slice `viewingNoteDayGroups` was built from, and the
  // handler that resolves+opens a double-tapped exercise's source jump.
  viewingActiveText = null,
  onExerciseSourceJump,
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
  // #880 revised body: the same durable-save state the shared editor card
  // shows (Saved / Not yet synced), sourced from the SAME
  // useLogOtherRoutineEditor instance (`editingSource === 'recovery'` is
  // just one entry point into it).
  editingSaveSuccess = '',
  editingSaveStatus = null,
  onEditorInteraction,
  onSaveEdit,
  onCancelEdit,
  // #881 (F10a §4/§6): a double-tapped exercise's resolved source jump,
  // built by useLogOtherRoutineEditor's `resolveAndOpenSourceJump` and
  // consumed by the inline editor — never in the shared LogScreenEditorCard —
  // because the Recovery inline editor has no shared TextInput scaffolding of
  // its own. `null` unless the pending jump targets THIS surface (`source ===
  // 'recovery'`); LogScreen is responsible for that filtering.
  pendingSourceJump = null,
  onSourceJumpApplied,
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
        ? `"${noteTitle(linkedNote)}" will be removed from this recovery block. The note itself is kept and stays editable.`
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
              {/* #870: the open week is what a returning user is actually
                  training right now, so it is labelled as such — not merely
                  "a recovery block" — while a completed-week or no-week
                  state (between weeks) keeps the neutral "RECOVERY BLOCK"
                  kicker, since neither has an open workout to claim. */}
              <Text style={styles.stateKicker}>{canCompleteWeek ? 'CURRENT TRAINING' : 'RECOVERY BLOCK'}</Text>
              <Text style={styles.headline}>{headline}</Text>
              <Text style={styles.baselineCaption}>
                Baseline: {activeBlock.baseline_note_title || 'Untitled Routine'}
              </Text>
              {/* The optional reason (#872), rendered only when there is one:
                  a block started without an explanation shows no empty
                  "Reason: —" row claiming a field the user never filled in.
                  A caption beside the baseline, capped at two lines — this
                  zone states what the block IS, and the reason is part of
                  that, not an action. */}
              {activeBlock.reason ? (
                <Text style={styles.baselineCaption} numberOfLines={2}>
                  Reason: {activeBlock.reason}
                </Text>
              ) : null}

              {stateStale ? staleBanner : null}
              {showRecoveryNotice ? pendingBanner : null}

              {actionError ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>{actionError}</Text>
                </View>
              ) : null}
            </View>

            {/* Zones 2 & 3 — the week table and the single primary lifecycle
                action (#843), both inside this card. */}
            <LogRecoveryWeeks
              styles={styles}
              colors={colors}
              activeWeeks={activeWeeks}
              currentWeek={currentWeek}
              notesById={notesById}
              editingNoteId={editingNoteId}
              viewingNoteId={viewingNoteId}
              viewingNote={viewingNote}
              onViewNote={onViewNote}
              canCompleteWeek={canCompleteWeek}
              canAddWeek={canAddWeek}
              canUndoCompleteWeek={canUndoCompleteWeek}
              actionsLocked={actionsLocked}
              busy={busy}
              onCompleteWeek={handleCompleteWeek}
              onOpenAddWeek={onOpenAddWeek}
              onUndoCompleteWeek={handleUndoCompleteWeek}
              editingTitle={editingTitle}
              onChangeEditingTitle={onChangeEditingTitle}
              editingText={editingText}
              onChangeEditingText={onChangeEditingText}
              editingHasABWeeks={editingHasABWeeks}
              editingEffectiveWeek={editingEffectiveWeek}
              onToggleEditingWeek={onToggleEditingWeek}
              editingIsSaving={editingIsSaving}
              editingSaveError={editingSaveError}
              editingSaveSuccess={editingSaveSuccess}
              editingSaveStatus={editingSaveStatus}
              onEditorInteraction={onEditorInteraction}
              onSaveEdit={onSaveEdit}
              onCancelEdit={onCancelEdit}
              onEditNote={onEditNote}
              viewingNoteDayGroups={viewingNoteDayGroups}
              viewingHasABWeeks={viewingHasABWeeks}
              viewingEffectiveWeek={viewingEffectiveWeek}
              viewingActiveText={viewingActiveText}
              onToggleViewingWeek={onToggleViewingWeek}
              onExerciseSourceJump={onExerciseSourceJump}
              pendingSourceJump={pendingSourceJump}
              onSourceJumpApplied={onSourceJumpApplied}
            />
          </Card>

          <LogRecoveryLifecycle
            styles={styles}
            colors={colors}
            activeBlock={activeBlock}
            currentWeek={currentWeek}
            busy={busy}
            actionsLocked={actionsLocked}
            onUnlinkWeek={handleUnlinkWeek}
            onOpenEndBlockModal={onOpenEndBlockModal}
          />
        </View>
      )}

    </View>
  );
}
