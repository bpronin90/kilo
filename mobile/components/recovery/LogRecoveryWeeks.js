// The recovery-block week table (#843) and its single primary lifecycle
// action (#836), split out of LogRecoverySection.js for the #1056 file-size
// refactor. Behavior-only: this renders the SAME week rows (status dot, label,
// note title, expand caret, per-row accessibility) and the SAME one full-width
// primary action (Complete week / Add week) plus the muted Undo completion
// control. The expanded note surface for a viewed row is delegated verbatim to
// LogRecoveryEvidence.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LogRecoveryEvidence } from './LogRecoveryEvidence';

// A week whose `note_id` is null, or names a note that is not in the notebook,
// has no readable content (#775). `Untitled Routine` is reserved for notes that
// EXIST and were left untitled — using it here claimed a note was present and
// made a dead row look like an ordinary one.
const RECOVERY_NOTE_UNAVAILABLE = 'Note unavailable';

export function noteTitle(note) {
  return note?.title || 'Untitled Routine';
}

// `colors.accent`/`colors.success` are plain `#rrggbb` strings in both
// palettes (theme/colors.js) — this derives the two alpha tints the design
// calls for (accent-6%, success-12%) without introducing any new raw hex
// (#843 constraint: "Use only palette role names and derived colors.accent at
// 6% / colors.success at 12%").
function withAlpha(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function LogRecoveryWeeks({
  styles,
  colors,
  activeWeeks,
  currentWeek,
  notesById,
  editingNoteId = null,
  viewingNoteId = null,
  viewingNote = null,
  onViewNote,
  // Primary lifecycle actions (Alert-confirmed in the section boundary): these
  // arrive already wrapped, so this surface only decides which single one to
  // present and reflects the in-flight `busy` label.
  canCompleteWeek,
  canAddWeek,
  canUndoCompleteWeek,
  actionsLocked,
  busy = null,
  onCompleteWeek,
  onOpenAddWeek,
  onUndoCompleteWeek,
  // Everything the expanded note surface (LogRecoveryEvidence) consumes for a
  // viewed row, forwarded unchanged.
  editingTitle = '',
  onChangeEditingTitle,
  editingText = '',
  onChangeEditingText,
  editingHasABWeeks = false,
  editingEffectiveWeek = null,
  onToggleEditingWeek,
  editingIsSaving = false,
  editingSaveError = '',
  editingSaveSuccess = '',
  editingSaveStatus = null,
  onEditorInteraction,
  onSaveEdit,
  onCancelEdit,
  onEditNote,
  viewingNoteDayGroups = [],
  viewingHasABWeeks = false,
  viewingEffectiveWeek = null,
  viewingActiveText = null,
  onToggleViewingWeek,
  onExerciseSourceJump,
  pendingSourceJump = null,
  onSourceJumpApplied,
}) {
  return (
    <>
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
          const isEditingThisNote = !!linkedNote && editingNoteId === linkedNote.id;
          const rowLabel = linkedNote
            ? `${isEditingThisNote ? 'Close editor for' : 'View'} ${noteTitle(linkedNote)}, Recovery Week ${week.week_number}${isCompleted ? ', completed' : ''}`
            : `Recovery Week ${week.week_number}${isCompleted ? ', completed' : ''}, note unavailable`;
          const isViewingThisNote = !!linkedNote && viewingNoteId === week.note_id && !!viewingNote;
          // Freezes which week is expanded while ANY recovery note is
          // mid-edit (#841): the inline editor only renders inside
          // `isViewingThisNote`'s block below, so switching which week
          // is viewed while editing would silently unmount the editor
          // out from under an unsaved edit instead of routing the user
          // through Save/Cancel. Other rows stay blocked, while the
          // edited row's existing expand-less affordance routes through
          // the same close decision as its Cancel control instead of
          // becoming an inert button.
          const rowBlockedByEdit = !!editingNoteId && !isEditingThisNote;
          const handleRowPress = isEditingThisNote
            ? () => onCancelEdit?.()
            : (rowBlockedByEdit ? undefined : () => onViewNote?.(linkedNote));
          const rowProps = linkedNote
            ? { onPress: handleRowPress, accessibilityRole: 'button' }
            : {};
          const RowMain = linkedNote ? Pressable : View;
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
                isCurrentWeek && { backgroundColor: withAlpha(colors.accent, 0.06), borderLeftWidth: 3, borderLeftColor: colors.accent },
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
                      ? { backgroundColor: withAlpha(colors.success, 0.12) }
                      : { borderWidth: 2, borderColor: colors.accent },
                  ]}
                >
                  {isCompleted && <MaterialIcons name="check" size={16} color={colors.success} accessible={false} />}
                </View>
                <Text style={styles.weekLabel}>Week {week.week_number}</Text>
                <Text style={styles.weekNoteTitle} numberOfLines={1}>
                  {linkedNote ? noteTitle(linkedNote) : RECOVERY_NOTE_UNAVAILABLE}
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
              {isViewingThisNote && (
                <LogRecoveryEvidence
                  styles={styles}
                  colors={colors}
                  week={week}
                  linkedNote={linkedNote}
                  isCurrentWeek={isCurrentWeek}
                  isEditingThisNote={isEditingThisNote}
                  editingNoteId={editingNoteId}
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
              )}
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
              onPress={onCompleteWeek}
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
            onPress={onUndoCompleteWeek}
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
    </>
  );
}
