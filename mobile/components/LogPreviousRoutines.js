// Routine management (#724, flattened #823, redesigned #843): the
// non-current routines and their management actions live inside a
// collapsed-by-default disclosure so the active routine stays the dominant
// Log surface. The count and the create-routine affordance are now OUTSIDE
// the disclosure panel entirely (#843) — `More Routines · {count}` is always
// visible, expanded or collapsed, alongside a persistent `New routine`
// control, so neither ever depends on the panel's own open state. The panel
// itself is one flat, divided list — no nested row-card borders, radii, or
// horizontal margins (#843) — matching a single card-equivalent surface
// rather than a stack of small cards. `Set as current routine` is reachable
// only from a row's own expanded body now; the former icon-only quick action
// and the standalone recovery badge on collapsed rows are gone (#843).
//
// The disclosure's open/closed state is owned by LogScreen (#775) — see the
// `expanded`/`onToggleExpanded` props below.
//
// #843 owner-authorized exception to the Log tab's style lock, scoped to this
// file plus LogActiveRoutineCard.js, LogRecoverySection.js, and
// RecoveryBlockEndModal.js.
import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Button, SectionTitle } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { localDate } from '../lib/LogScreenHelpers';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';

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
  recoveryWeekNumberByNoteId = {},
  expanded = false,
  onToggleExpanded,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const toggleExpanded = () => onToggleExpanded?.();
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

  const routineCount = otherNotes.length;
  const sortedNotes = sortByCreatedDesc(otherNotes);

  return (
    <View style={styles.previousRoutines}>
      {/* The count and the create-routine affordance sit outside the
          disclosure panel entirely (#843) — both are visible whether the
          panel is expanded or collapsed. */}
      <View style={styles.topRow}>
        <SectionTitle>{`More Routines · ${routineCount}`}</SectionTitle>
        <Pressable
          onPress={handleCreateRoutine}
          style={styles.newRoutineButton}
          accessibilityRole="button"
          accessibilityLabel="New routine"
        >
          <MaterialIcons name="add" size={16} color={colors.accent} accessible={false} />
          <Text style={styles.newRoutineButtonText}>New routine</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Pressable
          onPress={toggleExpanded}
          style={[styles.header, expanded && styles.headerBordered]}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse routine management' : 'Expand routine management'}
          accessibilityState={{ expanded }}
        >
          <View style={styles.headerContent} />
          <MaterialIcons
            name={expanded ? 'expand-less' : 'expand-more'}
            size={18}
            color={colors.textMuted}
            accessible={false}
          />
        </Pressable>

        {expanded && (
          <View style={styles.body}>
            {sortedNotes.map((other, index) => {
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
              // Collapsed metadata line (#843): date and recovery-week fold
              // into one inline caption instead of a date line plus a
              // separate standalone badge.
              const otherMetaText = [otherDateLabel, otherRecoveryWeek != null ? `Recovery week ${otherRecoveryWeek}` : null]
                .filter(Boolean)
                .join(' · ');
              const otherHeaderLabel = [
                `${isViewedOther ? 'Collapse' : 'Expand'} ${other.title || 'Untitled Routine'}`,
                otherDateLabel,
                otherRecoveryLabel,
              ].filter(Boolean).join(', ');
              return (
                <View
                  key={other.id}
                  style={[styles.row, index < sortedNotes.length - 1 && styles.rowDivider, isViewedOther && styles.rowOpen]}
                >
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
                      </View>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        )}
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
  // title, visible whether the panel below is expanded or collapsed.
  newRoutineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  newRoutineButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  // One card-equivalent panel with a flat divided list (#843): no nested
  // row-card borders, radii, or horizontal margins inside it.
  panel: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    backgroundColor: colors.subtleBg,
  },
  headerBordered: {
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerContent: {
    flex: 1,
  },
  body: {
    paddingVertical: 4,
  },
  row: {
    paddingHorizontal: 0,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowOpen: {
    backgroundColor: colors.subtleBg,
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
    color: colors.accent,
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
    color: colors.accent,
  },
});
