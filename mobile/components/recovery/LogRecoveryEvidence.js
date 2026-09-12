// The expanded recovery-week note surface (#843/#841/#881), split out of
// LogRecoverySection.js for the #1056 file-size refactor. Behavior-only: this
// renders the SAME inline note viewer and inline editor a viewed week row
// showed before, including the A/B reading segment, the shared save-status
// region, the double-tap-to-edit gesture, and the source-jump caret handoff.
//
// It mounts only while a week's note is expanded (its parent gates it on
// `isViewingThisNote`), which is exactly when the source-jump effect could
// apply — the pending jump only targets a recovery note that is open and being
// edited — so keeping the refs/effects local to this surface preserves the
// original top-level behavior.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { WorkoutContentRenderer } from '../WorkoutContentRenderer';
// #880 revised body: Recovery renders its own inline editor and does not
// inherit LogScreenEditorCard's status region, so it reuses the exact same
// component — same Saving…/Saved/Not-yet-synced semantics, same reserved
// layout space, same debounced-announcement behavior — rather than a
// parallel implementation that could silently drift from it.
import { SaveStatusRegion } from '../LogScreenEditorCard';

export function LogRecoveryEvidence({
  styles,
  colors,
  week,
  linkedNote,
  isCurrentWeek,
  isEditingThisNote,
  editingNoteId,
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
  // Compact Recovery reading intentionally leaves the first day to this
  // surface's kicker so it is not duplicated by WorkoutContentRenderer. Make
  // later weekday boundaries visible in the renderer's existing subheading
  // slot instead. This is a display-only projection: it neither changes the
  // parsed section order nor inserts sections, so source anchors retain their
  // original positional coordinates.
  const recoveryDisplayDayGroups = useMemo(() => viewingNoteDayGroups.map((group, groupIndex) => {
    if (groupIndex === 0 || !group.heading || !group.sections?.length) return group;
    return {
      ...group,
      sections: group.sections.map((section, sectionIndex) => (
        sectionIndex === 0
          ? {
            ...section,
            subheading: [group.heading, section.subheading].filter(Boolean).join(' · '),
          }
          : section
      )),
    };
  }), [viewingNoteDayGroups]);

  // Double-tap the expanded note body to edit it (#841 owner amendment):
  // the same gesture/timing the Routine tab's card already uses
  // (LogPreviousRoutines.js's viewingNoteLastTapRef), reproduced here rather
  // than shared because the two components track different Allowed Files.
  const viewingNoteLastTapRef = useRef(0);

  // #881 (F10a §4): equivalent one-shot collapsed-caret behavior for the
  // Recovery inline editor's own `editingText` TextInput — no shared
  // scaffolding exists here (LogScreenEditorCard's `problemSelectionRequest`
  // is a different file), so this reproduces the same set-once, render-once,
  // release-on-onSelectionChange lifecycle locally. Applied only once
  // `editingNoteId`/`editingText` actually match the jump's target (guards
  // against focusing before the target text has loaded, per #865).
  const recoveryEditingTextInputRef = useRef(null);
  const [recoverySelectionRequest, setRecoverySelectionRequest] = useState(null);
  useEffect(() => {
    if (!recoverySelectionRequest) return undefined;
    const timer = setTimeout(() => setRecoverySelectionRequest(null), 0);
    return () => clearTimeout(timer);
  }, [recoverySelectionRequest]);
  useEffect(() => {
    if (!pendingSourceJump || pendingSourceJump.source !== 'recovery') return;
    if (pendingSourceJump.editingNoteId !== editingNoteId) return;
    if (pendingSourceJump.expectedText !== editingText) return;
    setRecoverySelectionRequest({ start: pendingSourceJump.start, end: pendingSourceJump.end });
    recoveryEditingTextInputRef.current?.focus();
    onSourceJumpApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSourceJump, editingNoteId, editingText]);

  // Editing THIS week's note inline, not some other row's (#841):
  // `editingNoteId` is already scoped to a recovery-sourced session by
  // LogScreen, so comparing it to this row's linked note id is enough to tell
  // the two apart. `editingBlocked` disables Edit/double-tap on every OTHER
  // row while one recovery note is mid-edit, so a second edit session can
  // never start out from under the first without an explicit Save/Cancel.
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
  const dayHeading = viewingNoteDayGroups?.[0]?.heading || `Week ${week.week_number}`;

  return (
    <View style={[styles.weekNoteContent, isCurrentWeek && styles.weekNoteContentCurrent]}>
      {isEditingThisNote ? (
        <View style={styles.inlineEditor}>
          <TextInput
            value={editingTitle}
            onChangeText={(next) => {
              onEditorInteraction?.();
              onChangeEditingTitle?.(next);
            }}
            onFocus={onEditorInteraction}
            placeholder="Routine Name"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            style={styles.inlineEditorTitleInput}
            accessibilityLabel="Recovery note title"
          />
          <TextInput
            ref={recoveryEditingTextInputRef}
            value={editingText}
            onChangeText={(next) => {
              onEditorInteraction?.();
              onChangeEditingText?.(next);
            }}
            onFocus={onEditorInteraction}
            placeholder="Workout note…"
            placeholderTextColor={colors.textMuted}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            style={styles.inlineEditorTextInput}
            accessibilityLabel="Recovery note text"
            selection={recoverySelectionRequest ?? undefined}
            onSelectionChange={() => {
              if (!recoverySelectionRequest) return;
              setRecoverySelectionRequest(null);
            }}
          />
          {editingSaveError ? (
            <Text style={styles.errorBannerText}>{editingSaveError}</Text>
          ) : null}
          <SaveStatusRegion
            status={editingSaveStatus}
            savedLabel={editingSaveSuccess || undefined}
          />
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
                Save
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
                sits above the content it governs. Its 32dp
                visual sits inside a real 44dp target box
                (#921), so this header row is 44dp tall. */}
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
              dayGroups={recoveryDisplayDayGroups}
              emptyText="No exercises to display."
              compact
              sourceNoteId={linkedNote?.id ?? null}
              sourceWeekIndex={viewingHasABWeeks && viewingEffectiveWeek === 'B' ? 1 : 0}
              sourceSliceText={viewingActiveText}
              onExercisePress={onExerciseSourceJump}
            />
          </Pressable>
          <View style={styles.weekNoteActions}>
            {/* The card's single expanded-note action
                (#843): one outlined `Edit note` control,
                raised to the 44dp floor in #921 with its
                13px label and outline unchanged. Enters
                the SAME inline editor
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
}

// The Recovery `A`/`B` segment (#843): a two-item segmented control replacing
// the former `Week A`/`Week B` pill. Keeps the exact role/label/selected
// state the pill had — this changes which week is being READ, not a
// lifecycle action.
//
// The PRESSABLE is the target box (#921), not the visual. The segment's 32dp
// visual is unchanged, but it is now a child of a `minHeight: 44` /
// `minWidth: 44` box rather than the press target itself. The former
// `hitSlop` of 6 is gone because it never worked: `noteSurfaceHeader` is an
// unsized flex row whose height was set by this 32dp segment, so React Native
// clipped the slop at the parent's bounds and the effective target stayed
// 32dp — exactly the failure `ui-design-rules.md` §15 names.
function ABSegment({ styles, colors, effectiveWeek, onToggle }) {
  const isB = effectiveWeek === 'B';
  return (
    <Pressable
      onPress={onToggle}
      style={styles.abSegmentTarget}
      accessibilityRole="button"
      accessibilityLabel={`Switch to Week ${isB ? 'A' : 'B'}`}
      accessibilityState={{ selected: isB }}
    >
      <View style={styles.abSegment}>
        <View style={[styles.abSegmentItem, !isB && styles.abSegmentItemActive]}>
          <Text style={[styles.abSegmentText, !isB && styles.abSegmentTextActive]}>A</Text>
        </View>
        <View style={[styles.abSegmentItem, isB && styles.abSegmentItemActive]}>
          <Text style={[styles.abSegmentText, isB && styles.abSegmentTextActive]}>B</Text>
        </View>
      </View>
    </Pressable>
  );
}
