// Routine management (#724): the non-current routines and every routine/recovery
// management action now live inside a collapsed-by-default disclosure so the
// active routine stays the dominant Log surface. Collapsed, the section is
// action-free — it shows only a count + latest-routine summary and the shared
// chevron. Expanded, it renders the routine cards (#711 information hierarchy:
// each card's header carries identity only; Week A/B, Set as current, Edit, and
// Delete live in its own expand-on-tap body) plus the section's two management
// actions: `Start recovery block` and `+ New routine`.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card, Button, SectionTitle } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { localDate } from '../lib/LogScreenHelpers';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';

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
  // The one relocated Recovery entry point (#724). `showRecoveryStart` is the
  // full startability predicate decided by LogScreen from the shared
  // authoritative Recovery state: no active block, verified, not stale, an
  // eligible baseline, AND no pending/in-flight action or mutation lock — the
  // contract requires the control ABSENT (not merely disabled) whenever a block
  // cannot be started. The callback takes no subject — RecoveryBlockStartModal
  // picks its own baseline and Week 1 — and the precondition is rechecked at
  // confirm.
  onStartRecoveryBlock,
  showRecoveryStart = false,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Collapsed by default (#724): scanning the active routine must not compete
  // with routine/recovery management. The whole header is the disclosure.
  const [expanded, setExpanded] = useState(false);
  // An externally requested selection must be visible even though the disclosure
  // is collapsed by default (#724 review): a typed navigation intent (#718) or a
  // Recovery-history/lifecycle tap sets `viewingNoteId` on a non-current
  // routine, and that note is unmounted while collapsed. Expand for a NEW
  // external selection, but never re-expand the same still-selected note — so a
  // later explicit user collapse of the disclosure stands. Clearing the
  // selection re-arms this, so re-selecting the same note later reopens it.
  const autoExpandedForRef = useRef(null);
  useEffect(() => {
    if (!viewingNoteId) { autoExpandedForRef.current = null; return; }
    if (autoExpandedForRef.current === viewingNoteId) return;
    if (otherNotes.some(n => n.id === viewingNoteId)) {
      autoExpandedForRef.current = viewingNoteId;
      setExpanded(true);
    }
  }, [viewingNoteId, otherNotes]);
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
  // ISO timestamps sort lexicographically, so the max updated_at is the latest
  // routine without parsing a Date. The list order below is left untouched.
  const latestRoutine = routineCount > 0
    ? otherNotes.reduce((a, b) => (String(b.updated_at || '') > String(a.updated_at || '') ? b : a))
    : null;

  return (
    <View style={styles.previousRoutines}>
      <SectionTitle>More Routines</SectionTitle>
      <View style={styles.panel}>
        <Pressable
          onPress={() => setExpanded(e => !e)}
          style={[styles.header, expanded && styles.headerBordered]}
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
          <MaterialIcons
            name={expanded ? 'expand-less' : 'expand-more'}
            size={18}
            color={colors.textMuted}
            accessible={false}
          />
        </Pressable>

        {expanded && (
          <View style={styles.body}>
            {otherNotes.map(other => (
              <Card
                key={other.id}
                style={styles.otherNoteCard}
              >
                <Pressable
                  onPress={() => handleViewOtherNote(other)}
                  style={styles.otherNoteHeader}
                >
                  <View style={styles.otherNoteInfo}>
                    <Text
                      style={styles.otherNoteTitle}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                    >
                      {other.title || 'Untitled Routine'}
                    </Text>
                    {other.updated_at && (
                      <Text style={styles.otherNoteSub}>
                        {viewingNoteId === other.id && viewingHasABWeeks
                          ? `Week ${viewingEffectiveWeek} · ${localDate(other.updated_at).toLocaleDateString()}`
                          : localDate(other.updated_at).toLocaleDateString()}
                      </Text>
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
                        style={styles.deleteButton}
                        textStyle={styles.deleteButtonText}
                      />
                    </View>
                  </>
                )}
              </Card>
            ))}

            {/* The single `Start recovery block` entry point (#724). Rendered
                only when a block can actually be started right now (LogScreen
                folds the pending/busy/mutation lock into `showRecoveryStart`),
                and absent otherwise — so it is reachable only by opening this
                disclosure, and never shown as a dead or locked control. */}
            {showRecoveryStart && (
              <Button
                onPress={onStartRecoveryBlock}
                title="Start recovery block"
                style={styles.recoveryStartButton}
                textStyle={styles.recoveryStartButtonText}
              />
            )}
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
  // Collapse panel (#724), mirroring the Recovery History panel on this same
  // screen: radius 24, 1px border, clipped, with a `subtleBg` header row that is
  // the whole-header press target and the shared MaterialIcons chevron.
  panel: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    // The whole header is the only expand/collapse target, and collapsed-with-
    // zero-routines or expanded it holds only the 12px count; a 44dp floor keeps
    // it a legible touch/motor target under large text too (#724 review).
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
    padding: 16,
    gap: 12,
  },
  otherNoteCard: {
    padding: 0,
    overflow: 'hidden',
  },
  otherNoteHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 24,
    gap: 12,
  },
  otherNoteInfo: {
    flex: 1,
    // See LogActiveRoutineCard.js's otherNoteInfo comment: a hard floor, not 0
    // (#710 review), retained now that the header holds identity only (#711).
    minWidth: 96,
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
  deleteButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.error,
  },
  deleteButtonText: {
    color: colors.error,
  },
  // The relocated recovery entry point keeps the accent-filled primary look it
  // had in LogRecoverySection. It is only ever rendered when live (the lock is
  // folded into visibility upstream), so it carries no disabled variant; the
  // authoritative precondition is rechecked at confirm.
  recoveryStartButton: {
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  recoveryStartButtonText: {
    color: colors.onAccent,
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
