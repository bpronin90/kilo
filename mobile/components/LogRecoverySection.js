// Recovery Block lifecycle UI (#696): the active block's baseline, current
// week, and ordered linked-note history, plus a collapsible completed-block
// history panel. Week 1 attach/start lives in RecoveryBlockStartModal (#695);
// this component only ever advances or completes a block that already exists.
//
// All lifecycle mutation (complete week, add week, complete block, unlink
// week) is delegated to the handlers passed in from LogScreen, which bind to
// hooks/entries/recoveryBlockHooks.js — this file never imports storage
// directly and never decides eligibility itself beyond what those handlers
// already enforce.

import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card, SectionTitle } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { formatDate } from '../lib/format';
import { findActiveBlock, isLiveRecord, orderedLiveWeeks } from '../lib/data/recoveryBlocks';

function _noteTitle(notesById, noteId) {
  const note = notesById.get(noteId);
  return note?.title || 'Untitled Routine';
}

export function LogRecoverySection({
  blocks = [],
  weeks = [],
  notes = [],
  onViewNote,
  onCompleteWeek,
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
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [actionError, setActionError] = useState(null);

  const activeBlock = findActiveBlock(blocks);
  const hasPendingRecovery = (pendingRecovery?.length || 0) > 0 || !!pendingRecoveryError;
  const pendingMessage = pendingRecoveryError
    || pendingRecovery?.[0]?.error
    || 'A recovery change is still being applied on this device.';
  // One flag for every lifecycle control: a pending operation and an in-flight
  // action are both reasons no second write may start.
  const actionsLocked = !!busy || hasPendingRecovery;
  const completedBlocks = blocks
    .filter(b => isLiveRecord(b) && b.completed_at)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));

  // A pending recovery operation must stay visible even when neither an active
  // block nor any completed block renders — otherwise the retry affordance
  // would disappear with the records it is trying to repair.
  if (!activeBlock && completedBlocks.length === 0 && !hasPendingRecovery) return null;

  const notesById = new Map(notes.map(n => [n.id, n]));
  const activeWeeks = activeBlock ? orderedLiveWeeks(weeks, activeBlock.id) : [];
  const currentWeek = activeWeeks.length > 0 ? activeWeeks[activeWeeks.length - 1] : null;
  const canCompleteWeek = !!currentWeek && !currentWeek.completed_at;
  const canAddWeek = !!activeBlock && (!currentWeek || !!currentWeek.completed_at);
  const latestWeekId = activeWeeks.length > 0 ? activeWeeks[activeWeeks.length - 1].id : null;

  const runAction = async (action) => {
    setActionError(null);
    const result = await action();
    if (!result || result.ok === false) {
      setActionError((result && result.error) || 'That action could not be completed.');
    }
  };

  const handleCompleteWeek = () => {
    runAction(() => onCompleteWeek({ blockId: activeBlock.id }));
  };

  const handleCompleteBlock = () => {
    Alert.alert(
      'Complete recovery block?',
      'Exercise targets are advisory — unmet targets will not block completion. The baseline routine is untouched and this cannot be undone.',
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
    Alert.alert(
      `Unlink Week ${week.week_number}?`,
      `"${_noteTitle(notesById, week.note_id)}" will be removed from this recovery block. The note itself is kept and stays editable.`,
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

  const pendingBanner = (
    <View
      style={styles.pendingBanner}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`Recovery change pending. ${pendingMessage}`}
    >
      <Text style={styles.pendingBannerText}>{pendingMessage}</Text>
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
    </View>
  );

  return (
    <View style={styles.container}>
      {!activeBlock && hasPendingRecovery && (
        <View style={styles.activeGroup}>
          <SectionTitle>Recovery</SectionTitle>
          <Card style={styles.card}>{pendingBanner}</Card>
        </View>
      )}
      {activeBlock && (
        <View style={styles.activeGroup}>
          <SectionTitle>Recovery</SectionTitle>
          <Card style={styles.card}>
            <Text style={styles.baselineLabel}>Baseline routine</Text>
            <Text style={styles.baselineTitle}>{activeBlock.baseline_note_title || 'Untitled Routine'}</Text>

            {hasPendingRecovery ? pendingBanner : null}

            {actionError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{actionError}</Text>
              </View>
            ) : null}

            <View style={styles.weekList}>
              {activeWeeks.map(week => (
                <View key={week.id} style={styles.weekRow}>
                  <Pressable
                    style={styles.weekRowMain}
                    onPress={() => onViewNote?.(notesById.get(week.note_id))}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${_noteTitle(notesById, week.note_id)}, Recovery Week ${week.week_number}`}
                  >
                    <Text style={styles.weekNumber}>Week {week.week_number}</Text>
                    <Text style={styles.weekNoteTitle} numberOfLines={1}>
                      {_noteTitle(notesById, week.note_id)}
                    </Text>
                    <Text style={styles.weekStatus}>
                      {week.completed_at ? `Completed ${formatDate(week.completed_at)}` : 'In progress'}
                    </Text>
                  </Pressable>
                  {week.id === latestWeekId && (
                    <Pressable
                      onPress={() => handleUnlinkWeek(week)}
                      disabled={actionsLocked}
                      style={styles.inlineButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Unlink Week ${week.week_number}`}
                      accessibilityState={{ disabled: actionsLocked }}
                    >
                      <Text style={styles.inlineButtonText}>{busy === week.id ? 'Unlinking…' : 'Unlink'}</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>

            <View style={styles.actionsRow}>
              {canCompleteWeek && (
                <Pressable
                  onPress={handleCompleteWeek}
                  disabled={actionsLocked}
                  style={styles.actionButton}
                  accessibilityRole="button"
                  accessibilityLabel="Complete week"
                  accessibilityState={{ disabled: actionsLocked }}
                >
                  <Text style={styles.actionButtonText}>
                    {busy === 'week' ? 'Completing…' : 'Complete week'}
                  </Text>
                </Pressable>
              )}
              {canAddWeek && (
                <Pressable
                  onPress={onOpenAddWeek}
                  disabled={actionsLocked}
                  style={styles.actionButton}
                  accessibilityRole="button"
                  accessibilityLabel="Add next recovery week"
                  accessibilityState={{ disabled: actionsLocked }}
                >
                  <Text style={styles.actionButtonText}>Add week</Text>
                </Pressable>
              )}
              <Pressable
                onPress={handleCompleteBlock}
                disabled={actionsLocked}
                style={[styles.actionButton, styles.actionButtonPrimary]}
                accessibilityRole="button"
                accessibilityLabel="Complete recovery block"
                accessibilityState={{ disabled: actionsLocked }}
              >
                <Text style={styles.actionButtonPrimaryText}>
                  {busy === 'block' ? 'Completing…' : 'Complete recovery block'}
                </Text>
              </Pressable>
            </View>
          </Card>
        </View>
      )}

      {completedBlocks.length > 0 && (
        <View style={styles.historyGroup}>
          <SectionTitle>Recovery History</SectionTitle>
          <View style={styles.historyPanel}>
            <Pressable
              onPress={() => setHistoryCollapsed(c => !c)}
              style={[styles.historyHeader, !historyCollapsed && styles.historyHeaderBordered]}
              accessibilityRole="button"
              accessibilityLabel={historyCollapsed ? 'Expand recovery history' : 'Collapse recovery history'}
            >
              <View style={styles.historyHeaderContent}>
                <Text style={styles.historySummaryCount}>
                  {`${completedBlocks.length} completed ${completedBlocks.length === 1 ? 'block' : 'blocks'}`}
                </Text>
                {historyCollapsed && (
                  <Text style={styles.historySummaryLatest} numberOfLines={1}>
                    {'Latest: '}
                    <Text style={styles.historySummaryEmphasis}>
                      {completedBlocks[0].baseline_note_title || 'Untitled Routine'}
                    </Text>
                  </Text>
                )}
              </View>
              <MaterialIcons
                name={historyCollapsed ? 'expand-more' : 'expand-less'}
                size={18}
                color={colors.textMuted}
                accessible={false}
              />
            </Pressable>

            {!historyCollapsed && completedBlocks.map((block, index) => {
              const blockWeeks = orderedLiveWeeks(weeks, block.id);
              const isLast = index === completedBlocks.length - 1;
              return (
                <View key={block.id} style={[styles.historyRow, isLast && styles.historyRowLast]}>
                  <Text style={styles.historyBaselineTitle}>{block.baseline_note_title || 'Untitled Routine'}</Text>
                  <Text style={styles.historyDates}>
                    {formatDate(block.started_at)} – {formatDate(block.completed_at)}
                  </Text>
                  {blockWeeks.length === 0 ? (
                    <Text style={styles.historyEmptyText}>No linked weeks.</Text>
                  ) : (
                    blockWeeks.map(week => (
                      <Pressable
                        key={week.id}
                        onPress={() => onViewNote?.(notesById.get(week.note_id))}
                        style={styles.historyWeekRow}
                        accessibilityRole="button"
                        accessibilityLabel={`View ${_noteTitle(notesById, week.note_id)}, Recovery Week ${week.week_number}`}
                      >
                        <Text style={styles.historyWeekNumber}>Week {week.week_number}</Text>
                        <Text style={styles.historyWeekNoteTitle} numberOfLines={1}>
                          {_noteTitle(notesById, week.note_id)}
                        </Text>
                        <Text style={styles.historyWeekStatus}>
                          {week.completed_at ? formatDate(week.completed_at) : 'Not completed'}
                        </Text>
                      </Pressable>
                    ))
                  )}
                </View>
              );
            })}
          </View>
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
  historyGroup: {
    gap: 16,
  },
  card: {
    gap: 10,
  },
  baselineLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textMuted,
  },
  baselineTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
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
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  weekRowMain: {
    flex: 1,
  },
  weekNumber: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textMuted,
  },
  weekNoteTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  weekStatus: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  inlineButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  inlineButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.error,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  actionButtonPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  actionButtonPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onAccent,
  },
  historyPanel: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.subtleBg,
  },
  historyHeaderBordered: {
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  historyHeaderContent: {
    flex: 1,
  },
  historySummaryCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  historySummaryLatest: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  historySummaryEmphasis: {
    fontWeight: '700',
    color: colors.text,
  },
  historyRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    gap: 4,
  },
  historyRowLast: {
    borderBottomWidth: 0,
  },
  historyBaselineTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  historyDates: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  historyEmptyText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  historyWeekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  historyWeekNumber: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    width: 56,
  },
  historyWeekNoteTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  historyWeekStatus: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
