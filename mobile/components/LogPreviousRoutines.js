// Routine management (#724, flattened #823, redesigned #843, recontained #847,
// decollapsed #1021): the non-current routines and their management actions
// are always listed naturally under the section header — `More Routines ·
// {count}` alongside a persistent `New routine` control.
//
// #847 removes the enclosing "More Routines panel" (#843's single
// card-equivalent surface with a tinted header and a flat divided row list)
// and returns non-current routines to individually rounded, quietly bordered
// `Card` surfaces — the pre-#843 hierarchy — so the Current routine stays the
// singular, highly highlighted note by comparison. `Set as current routine`
// stays reachable only from a row's own expanded body.
//
// #1021 removes the collection-level Show/Hide Routines disclosure that used
// to gate this whole list behind a collapsed-by-default toggle (#724/#775).
// Non-current cards are now always rendered; each card keeps its own
// independent per-card collapsed/expanded body exactly as before — only the
// outer collection-wide wrapper is gone. LogScreen no longer owns a
// collection-expanded flag or a reveal-nonce for this component; a
// navigation intent that targets a non-current note needs no "expand the
// disclosure" step because there is no disclosure left to expand.
//
// #847 owner-authorized exception to the Log tab's style lock, scoped to this
// file. The Current routine card remains locked.
//
// #918 owner-authorized exception, scoped to text `color` values only:
// `newRoutineButtonText` and `switchButtonText` take `colors.accentText`, and
// `inlineSwitchButtonText` — which sits on a `chipBackground` fill — takes
// `colors.chipAccentText`. The `accent` mark uses here (the `New routine` plus
// glyph) are unchanged.
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Button, Card, SectionTitle } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { localDate } from '../lib/LogScreenHelpers';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';
import {
  shareRoutine,
  copyRoutineToClipboard,
  ROUTINE_COPY_SUCCESS_MESSAGE,
  ROUTINE_COPY_FAILURE_MESSAGE,
} from '../lib/interoperability/routineShare';
import { RoutineShareModal } from './RoutineShareCard';

// A routine row's date has exactly one meaning: the day the routine was created
// (#775). It used to read `updated_at`, which is the sync conflict cursor
// (docs/backend-schema.md, "Conflict/sync columns") — every edit, every Week
// A/B tap, every restored backup rewrote it, so the same routine showed a
// different "date" depending on what the app had done to it last. `saved_at` is
// stamped once at creation and never rewritten, so it is the field the row
// displays and sorts by. `updated_at` itself is unchanged: the sync layer still
// stamps and needs it, and only this UI stops reading it.
//
// Fallback order is saved_at → the creation day encoded in the note id
// (`wn_YYYY-MM-DD_…`, makeWorkoutNoteItem) → no date at all. `updated_at` is
// never consulted, even as a last resort: an unstable date is worse than none.
const NOTE_ID_CREATED_DAY = /^wn_(\d{4}-\d{2}-\d{2})_/;
function routineCreatedKey(note) {
  if (note?.saved_at) return String(note.saved_at);
  const match = NOTE_ID_CREATED_DAY.exec(String(note?.id || ''));
  return match ? match[1] : null;
}

// Newest first by the same key the row displays, so `Latest:` can never name a
// different routine than the one the expanded list shows first. Undated
// routines sort last in their existing notebook order (Array#sort is stable).
function sortByCreatedDesc(notes) {
  return notes
    .map((note, index) => ({ note, index, key: routineCreatedKey(note) }))
    .sort((a, b) => {
      if (a.key && b.key) return b.key.localeCompare(a.key) || a.index - b.index;
      if (a.key) return -1;
      if (b.key) return 1;
      return a.index - b.index;
    })
    .map(entry => entry.note);
}

export function LogPreviousRoutines({
  otherNotes,
  handleViewOtherNote,
  viewingNoteId,
  viewingNote,
  viewingNoteDayGroups,
  viewingHasABWeeks,
  viewingEffectiveWeek,
  handleToggleViewingWeek,
  handleSwitchCurrent,
  handleEditViewedNote,
  handleDeleteRoutine,
  handleCreateRoutine,
  // #881: exercise source-jump wiring, straight through to
  // WorkoutContentRenderer — a no-op gesture whenever any of these is null.
  viewingActiveText,
  onExerciseSourceJump,
  recoveryWeekNumberByNoteId = {},
  // #954 Share Routine. Injectable only so tests can observe the composed
  // payload; the app uses the module's own notice-then-share flow.
  onShareRoutine,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [imageShare, setImageShare] = useState(null);
  // Double-tap the viewed routine body to open it in the editor (matches main).
  const viewingNoteLastTapRef = useRef(0);
  const handleViewedNoteBodyPress = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - viewingNoteLastTapRef.current < DOUBLE_TAP_DELAY) {
      handleEditViewedNote();
      viewingNoteLastTapRef.current = 0;
    } else {
      viewingNoteLastTapRef.current = now;
    }
  };

  // The stored routine body, byte-for-byte — never the active-week slice the
  // viewer renders, so a shared A/B routine carries both halves (#954).
  const handleShareRoutine = (note) => {
    const payload = { title: note?.title, rawText: note?.raw_text || '' };
    if (onShareRoutine) onShareRoutine(payload);
    else shareRoutine(payload);
  };

  // Transient per-routine copy status: `{ noteId, message }`, so the line only
  // renders under the row it belongs to and never trails a previous routine
  // when the viewer switches. Copy carries the full stored `raw_text` (#956),
  // the same byte-for-byte body as Share.
  const [copyStatus, setCopyStatus] = useState(null);
  // Auto-expire the line like the Log tab's other transient confirmations
  // (`skipWeekStatus` / `saveSuccess` in the routine editors); a fast unmount
  // or a second copy cancels the pending clear.
  useEffect(() => {
    if (!copyStatus) return undefined;
    const timer = setTimeout(() => setCopyStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const handleCopyRoutine = (note) => {
    const payload = { title: note?.title, rawText: note?.raw_text || '' };
    return copyRoutineToClipboard(payload).then(({ ok, showConfirmation }) => {
      if (!ok) {
        setCopyStatus({ noteId: note?.id, message: ROUTINE_COPY_FAILURE_MESSAGE });
        AccessibilityInfo.announceForAccessibility?.(ROUTINE_COPY_FAILURE_MESSAGE);
        return;
      }
      // Android 13+ shows its own system clipboard popup; suppress the in-app
      // line there so the confirmation is not doubled.
      if (showConfirmation) {
        setCopyStatus({ noteId: note?.id, message: ROUTINE_COPY_SUCCESS_MESSAGE });
        AccessibilityInfo.announceForAccessibility?.(ROUTINE_COPY_SUCCESS_MESSAGE);
      } else {
        setCopyStatus(null);
      }
    });
  };

  const routineCount = otherNotes.length;
  const sortedNotes = sortByCreatedDesc(otherNotes);

  return (
    <View style={styles.previousRoutines}>
      {imageShare && <RoutineShareModal {...imageShare} onClose={() => setImageShare(null)} />}
      {/* The count and the create-routine affordance sit outside the
          disclosure entirely (#843) — both are visible whether the
          collection below is expanded or collapsed. */}
      <View style={styles.topRow}>
        <SectionTitle>{`More Routines · ${routineCount}`}</SectionTitle>
        <Pressable
          onPress={handleCreateRoutine}
          style={styles.newRoutineButton}
          accessibilityRole="button"
          accessibilityLabel="New routine"
        >
          <MaterialIcons name="add" size={16} color={colors.accent} accessible={false} />
          <Text style={styles.newRoutineButtonText} accessible={false}>New routine</Text>
        </Pressable>
      </View>

      {/* #1021: no collection-level disclosure — every non-current routine is
          always listed here. Each card keeps its own independent
          collapsed/expanded body below (`isViewedOther`), unchanged. */}
      <View style={styles.cardList}>
          {sortedNotes.map((other) => {
            // Same rule as LogActiveRoutineCard (#738 review): an explicit
            // accessibilityLabel replaces the label VoiceOver would otherwise derive
            // from this header's Text descendants. Two routines sharing a title are
            // permitted by the note-creation path, so the label must also carry the
            // visible date/week and recovery-week badge that distinguish them.
            const isViewedOther = viewingNoteId === other.id;
            const otherCreatedKey = routineCreatedKey(other);
            // A routine with neither a saved_at nor a dated id carries no date
            // at all, on screen or in the label — the title still identifies
            // it, and no unstable stand-in is invented (#775).
            const otherCreatedText = otherCreatedKey
              ? `Created ${localDate(otherCreatedKey).toLocaleDateString()}`
              : null;
            const otherDateLabel = otherCreatedText
              ? (isViewedOther && viewingHasABWeeks
                  ? `Week ${viewingEffectiveWeek} · ${otherCreatedText}`
                  : otherCreatedText)
              : null;
            const otherRecoveryWeek = recoveryWeekNumberByNoteId[other.id];
            const otherRecoveryLabel = otherRecoveryWeek != null
              ? `Recovery Week ${otherRecoveryWeek}`
              : null;
            // Collapsed metadata line: date and recovery-week fold into one
            // inline caption instead of a date line plus a separate
            // standalone badge — kept quiet, not a competing accent.
            const otherMetaText = [otherDateLabel, otherRecoveryWeek != null ? `Recovery week ${otherRecoveryWeek}` : null]
              .filter(Boolean)
              .join(' · ');
            const otherHeaderLabel = [
              `${isViewedOther ? 'Collapse' : 'Expand'} ${other.title || 'Untitled Routine'}`,
              otherDateLabel,
              otherRecoveryLabel,
            ].filter(Boolean).join(', ');
            return (
              <Card key={other.id} style={styles.otherNoteCard}>
                <Pressable
                  onPress={() => handleViewOtherNote(other)}
                  style={styles.otherNoteHeader}
                  accessibilityRole="button"
                  accessibilityLabel={otherHeaderLabel}
                  accessibilityState={{ expanded: isViewedOther }}
                >
                  <View style={styles.otherNoteInfo}>
                    <Text
                      style={styles.otherNoteTitle}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                    >
                      {other.title || 'Untitled Routine'}
                    </Text>
                    {otherMetaText ? (
                      <Text style={styles.otherNoteSub}>{otherMetaText}</Text>
                    ) : null}
                  </View>
                  <MaterialIcons
                    name={isViewedOther ? 'expand-less' : 'expand-more'}
                    size={18}
                    color={colors.textMuted}
                    accessible={false}
                  />
                </Pressable>
                {isViewedOther && viewingNote && (
                  <>
                    {/* The gesture is preserved; the visible "Double-tap to edit"
                        hint is gone (#724) — the expanded body's explicit `Edit
                        routine` control is the advertised path. */}
                    <Pressable onPress={handleViewedNoteBodyPress} style={styles.currentNoteContent}>
                      <WorkoutContentRenderer
                        dayGroups={viewingNoteDayGroups}
                        emptyText="No exercises to display."
                        sourceNoteId={viewingNoteId}
                        sourceWeekIndex={viewingHasABWeeks && viewingEffectiveWeek === 'B' ? 1 : 0}
                        sourceSliceText={viewingActiveText}
                        onExercisePress={onExerciseSourceJump}
                      />
                    </Pressable>
                    <View style={styles.inlineActions}>
                      {/* The viewed card's Week A/B switch (#711), unchanged
                          pill form: it changes which week you are READING,
                          not a routine-lifecycle action like the buttons
                          below, and keeps the exact role/label/selected
                          state it had before. */}
                      {viewingHasABWeeks && (
                        <View style={styles.viewActions}>
                          <Pressable
                            onPress={handleToggleViewingWeek}
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
                        </View>
                      )}
                      <Button
                        onPress={handleEditViewedNote}
                        title="Edit routine"
                        style={styles.switchButton}
                        textStyle={styles.switchButtonText}
                      />
                      <Button
                        onPress={() => handleShareRoutine(viewingNote)}
                        title="Share routine"
                        accessibilityLabel={`Share routine ${viewingNote?.title || 'Untitled Routine'}`}
                        style={styles.switchButton}
                        textStyle={styles.switchButtonText}
                      />
                      <Button
                        onPress={() => handleCopyRoutine(viewingNote)}
                        title="Copy routine"
                        accessibilityLabel={`Copy routine ${viewingNote?.title || 'Untitled Routine'}`}
                        style={styles.switchButton}
                        textStyle={styles.switchButtonText}
                      />
                      <Button
                        onPress={() => setImageShare({ title: viewingNote?.title, rawText: viewingNote?.raw_text || '' })}
                        title="Share as Image"
                        accessibilityLabel={`Share routine ${viewingNote?.title || 'Untitled Routine'} as image`}
                        style={styles.switchButton}
                        textStyle={styles.switchButtonText}
                      />
                      <Button
                        onPress={() => handleSwitchCurrent(other.id)}
                        title="Set as current routine"
                        style={styles.switchButton}
                        textStyle={styles.switchButtonText}
                      />
                      <Button
                        onPress={() => viewingNote && handleDeleteRoutine(viewingNoteId, viewingNote.title || 'Untitled Routine', false)}
                        title="Delete routine"
                        accessibilityLabel={`Delete routine ${viewingNote?.title || 'Untitled Routine'}`}
                        tone="danger"
                      />
                      {copyStatus && copyStatus.noteId === other.id ? (
                        <Text
                          style={styles.copyStatusText}
                          accessibilityLiveRegion="polite"
                          testID="copy-routine-status"
                        >
                          {copyStatus.message}
                        </Text>
                      ) : null}
                    </View>
                  </>
                )}
              </Card>
            );
          })}
      </View>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  previousRoutines: {
    marginTop: 4,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  // The persistent `New routine` control (#843): a sibling of the section
  // title, visible whether the collection below is expanded or collapsed.
  // #905, owner-authorized: the fixed 38dp height becomes a 44dp minimum so the
  // control clears the interaction-target floor (ui-design-rules §15). Padding,
  // radius, border, gap, and type are unchanged, and the width is untouched, so
  // the row still reads as the same button 6dp taller. A `hitSlop` would be
  // clipped at `topRow`'s bounds, which this button's own height defines.
  newRoutineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  newRoutineButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accentText,
  },
  // Individual quiet rounded cards (#847), pre-#843 hierarchy: separated by
  // normal shell spacing, no shared outer panel or divided-list chrome.
  cardList: {
    gap: 12,
  },
  otherNoteCard: {
    padding: 0,
    overflow: 'hidden',
  },
  otherNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    gap: 12,
    minHeight: 44,
  },
  otherNoteInfo: {
    flex: 1,
    minWidth: 96,
  },
  otherNoteTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  otherNoteSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
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
  inlineSwitchButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.chipAccentText,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  inlineActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  // Holds the Week A/B pill at its natural width inside the otherwise
  // full-width button stack (a column container would stretch it edge to edge).
  viewActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  switchButtonText: {
    color: colors.accentText,
  },
  // Transient copy confirmation / failure line (#956): the quiet muted-ink
  // status treatment already used across this file (otherNoteSub,
  // disclosureToggleText, skipWeekText). Not an accent — it is a passing
  // acknowledgement, not a call to action.
  copyStatusText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
});
