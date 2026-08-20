// Routine management (#724, flattened #823): the non-current routines and
// their management actions live inside a collapsed-by-default disclosure so
// the active routine stays the dominant Log surface. Collapsed, the section
// shows a count + latest-routine summary, the shared chevron, and (#756) a
// compact icon-only `New routine` affordance in the header itself — creating
// a routine is common enough that it must not require opening the disclosure
// first. Expanded, it renders the routine cards (#711 information hierarchy:
// each card's header carries identity only; a compact `Set as current
// routine` icon sits on every collapsed row (#756) so switching never
// requires opening the row and scrolling to its body; Week A/B, the full Set
// as current, Edit, and Delete stay in that row's own expand-on-tap body).
// `Start recovery block` no longer lives here (#823) — it moved to a
// persistent control under the current routine card, since gating it behind
// this disclosure meant the one way to see it required opening the exact
// panel this section is deliberately flattened out of. The disclosure's
// open/closed state is owned by LogScreen (#775) — see the
// `expanded`/`onToggleExpanded` props below. The disclosure no longer sits
// inside a bordered/radius panel (#823): the header and expanded rows render
// as a flat list matching the rest of the Routine tab, not a boxed-off
// sub-section.
import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card, Button, SectionTitle } from './UI';
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
  // The disclosure is CONTROLLED by LogScreen (#775). Routine and Deload are
  // mutually exclusive branches, so this component unmounts on every view
  // switch; local state made a user's collapse choice die with the unmount and
  // reappear expanded (or collapsed) at random. The state — and the auto-reveal
  // that opens it for a cross-screen note handoff — now live in LogScreen,
  // which stays mounted across the switch.
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
  // One ordering for both surfaces: the collapsed summary names whichever
  // routine the expanded list puts first.
  const latestRoutine = sortedNotes[0] ?? null;

  return (
    <View style={styles.previousRoutines}>
      <SectionTitle>More Routines</SectionTitle>
      <View style={styles.panel}>
        <View style={[styles.header, expanded && styles.headerBordered]}>
          <Pressable
            onPress={toggleExpanded}
            style={styles.headerToggle}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Collapse routine management' : 'Expand routine management'}
            accessibilityState={{ expanded }}
          >
            <View style={styles.headerContent}>
              <Text style={styles.summaryCount}>
                {`${routineCount} ${routineCount === 1 ? 'routine' : 'routines'}`}
              </Text>
              {!expanded && latestRoutine && (
                <Text style={styles.summaryLatest} numberOfLines={1}>
                  {'Latest: '}
                  <Text style={styles.summaryEmphasis}>
                    {latestRoutine.title || 'Untitled Routine'}
                  </Text>
                </Text>
              )}
            </View>
          </Pressable>
          {/* Compact New Note affordance (#756): the collapsed disclosure used to
              hide `+ New routine` inside the expanded body, so creating a routine
              cost an extra tap that scanning the section shouldn't require. This
              icon-only control sits in the header — present collapsed or
              expanded — so it never competes for space with the count/latest
              summary or the expanded routine list. It is a SIBLING of the toggle
              Pressable above, not nested inside it: VoiceOver groups a nested
              Pressable into its accessible ancestor, which would make this
              unreachable as its own action (PR #760 review). */}
          <Pressable
            onPress={handleCreateRoutine}
            style={styles.headerNewRoutineButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="New routine"
          >
            <MaterialIcons name="add" size={18} color={colors.accent} accessible={false} />
          </Pressable>
          <Pressable
            onPress={toggleExpanded}
            style={styles.headerChevronButton}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Collapse routine management' : 'Expand routine management'}
            accessibilityState={{ expanded }}
          >
            <MaterialIcons
              name={expanded ? 'expand-less' : 'expand-more'}
              size={18}
              color={colors.textMuted}
              accessible={false}
            />
          </Pressable>
        </View>

        {expanded && (
          <View style={styles.body}>
            {sortedNotes.map(other => {
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
              const otherRecoveryLabel = recoveryWeekNumberByNoteId[other.id] != null
                ? `Recovery Week ${recoveryWeekNumberByNoteId[other.id]}`
                : null;
              const otherHeaderLabel = [
                `${isViewedOther ? 'Collapse' : 'Expand'} ${other.title || 'Untitled Routine'}`,
                otherDateLabel,
                otherRecoveryLabel,
              ].filter(Boolean).join(', ');
              return (
              <Card
                key={other.id}
                style={styles.otherNoteCard}
              >
                <View style={styles.otherNoteHeaderRow}>
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
                      {otherDateLabel && (
                        <Text style={styles.otherNoteSub}>{otherDateLabel}</Text>
                      )}
                      {recoveryWeekNumberByNoteId[other.id] != null && (
                        <View
                          style={styles.recoveryBadge}
                          accessible
                          accessibilityLabel={`Recovery Week ${recoveryWeekNumberByNoteId[other.id]}`}
                        >
                          <Text style={styles.recoveryBadgeText}>
                            Recovery Week {recoveryWeekNumberByNoteId[other.id]}
                          </Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                  {/* Compact set-current affordance (#756): before this, switching
                      the current routine required opening this row's expand-on-tap
                      body and scrolling past its rendered content to the action
                      strip at the bottom. This quick action calls the same
                      `handleSwitchCurrent`, which owns every existing confirmation
                      and safeguard (useLogOtherRoutineEditor.js), so behavior is
                      unchanged — only reach improves. It only shows while the row
                      itself is collapsed; once opened, the full action lives in
                      the body below like before, so the action never appears
                      twice for the same row. It is a SIBLING of the row's own
                      Pressable, not nested inside it, for the same VoiceOver
                      grouping reason as the header's New Note control above. */}
                  {!isViewedOther && (
                    <Pressable
                      onPress={() => handleSwitchCurrent(other.id)}
                      style={styles.rowSetCurrentButton}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Set as current routine: ${other.title || 'Untitled Routine'}`}
                    >
                      <MaterialIcons name="check-circle-outline" size={20} color={colors.accent} accessible={false} />
                    </Pressable>
                  )}
                </View>
                {viewingNoteId === other.id && viewingNote && (
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
                      {/* The viewed card's Week A/B switch (#711). It keeps the
                          pill form — it changes which week you are READING, not a
                          routine-lifecycle action like the buttons below — and
                          keeps the exact role/label/selected state it had in the
                          header it moved out of. */}
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
              </Card>
              );
            })}

            <Button
              onPress={handleCreateRoutine}
              title="+ New routine"
              style={styles.createButton}
              textStyle={styles.createButtonText}
            />
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
  // No enclosing bordered/radius panel (#823) — this used to mirror the
  // Recovery History panel's chrome; the section is now a flat list, matching
  // the rest of the Routine tab.
  panel: {},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: 4,
    minHeight: 44,
  },
  headerBordered: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  // The disclosure toggle (#756): a sibling of the New Note and chevron
  // controls below, not their parent — a nested Pressable would be grouped
  // into its accessible ancestor by VoiceOver, making the nested control
  // unreachable as its own action (PR #760 review). A 44dp floor keeps it a
  // legible touch/motor target under large text too (#724 review).
  headerToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  headerContent: {
    flex: 1,
  },
  // The compact header-level New Note affordance (#756): icon-only so it never
  // grows the header past its existing count/latest-summary footprint.
  headerNewRoutineButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The chevron is its own tap target now too (#756), a sibling of the toggle
  // Pressable rather than a bare icon nested inside it, for the same
  // VoiceOver-grouping reason as headerNewRoutineButton.
  headerChevronButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  summaryLatest: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  summaryEmphasis: {
    fontWeight: '700',
    color: colors.text,
  },
  body: {
    paddingTop: 12,
    gap: 12,
  },
  otherNoteCard: {
    padding: 0,
    overflow: 'hidden',
  },
  // The row's outer layout (#756): holds the identity Pressable and the
  // compact set-current Pressable as siblings, so neither is nested inside
  // the other (same VoiceOver-grouping reason as the panel header above).
  otherNoteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 24,
    gap: 12,
    minHeight: 44,
  },
  otherNoteHeader: {
    flex: 1,
  },
  otherNoteInfo: {
    flex: 1,
    // See LogActiveRoutineCard.js's otherNoteInfo comment: a hard floor, not 0
    // (#710 review), retained now that the header holds identity only (#711).
    minWidth: 96,
  },
  // The compact row-level set-current affordance (#756): icon-only, matching
  // the header's New Note control, so a collapsed row stays a single compact
  // line rather than growing a second button-height row.
  rowSetCurrentButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otherNoteTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  otherNoteSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  // Purely presentational metadata layered on top of the ordinary note
  // header — the badge never affects title, text, selection, or rendering.
  recoveryBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.chipBackground,
  },
  recoveryBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: colors.chipText,
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
    // See LogActiveRoutineCard.js's inlineSwitchButton comment (#710 review).
    flexShrink: 1,
  },
  inlineSwitchButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
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
  createButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
    borderStyle: 'dashed',
  },
  createButtonText: {
    color: colors.accent,
  },
});
