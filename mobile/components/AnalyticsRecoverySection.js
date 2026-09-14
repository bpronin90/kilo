// Analytics Recovery section (#698): renders the #697 return-to-baseline
// comparison contract for the active recovery block and, on request, any
// completed block from history. The comparison itself is read-only — nothing
// here recomputes, gates, or claims medical recovery, and the hero is a factual
// exercise count ("X of Y baseline exercises met"), never a composite percentage
// or a completion gate. The few controls that DO write (the inclusion toggle
// #728, Reopen #839, and the optional reason #872) each change one presentation
// or lifecycle field and none of them feed the comparison above.

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Alert } from '../lib/platformAlert';
import { SectionTitle } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { formatDate } from '../lib/format';
import { findActiveBlock, isLiveRecord } from '../lib/data/recoveryBlocks';
import { compareRecoveryBlocksNewestCompletedFirst } from '../storage/entries/recoveryStorage';
import {
  RECOVERY_LOADING_MESSAGE,
  RECOVERY_STALE_MESSAGE,
  RECOVERY_UNVERIFIED_MESSAGE,
  useRecoveryBlockLifecycle,
} from '../hooks/entries/recoveryBlockHooks';
import { RecoveryInclusionToggle } from './RecoveryInclusionToggle';
import { BlockEvidence } from './recovery/RecoveryEvidence';
import { WeekIndexRow } from './recovery/RecoveryWeekIndex';
import { createStyles } from './recovery/analyticsRecoveryStyles';

function _noteTitle(notesById, noteId) {
  const note = notesById.get(noteId);
  return note?.title || 'Untitled Routine';
}

export function AnalyticsRecoverySection({
  blocks = [],
  weeks = [],
  notes = [],
  // Authoritative Recovery read state (#716), from the same shared store the Log
  // screen renders. Defaults describe a verified, current snapshot so a caller
  // that does not supply them is unchanged.
  stateReady = true,
  stateLoading = false,
  stateRefreshing = false,
  stateStale = false,
  stateError = null,
  // Writes are open only when the shared state has verified eligibility. False
  // covers terminal-repair-error, journal-corrupt, and every other gate the
  // authoritative hook enforces (#728).
  mutationsAllowed = true,
  pendingRecovery = [],
  onRetry,
  onNavigate,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();
  // Completed-block history starts collapsed for the same reason the details do
  // (#758): its collapsed header already states how many blocks there are and
  // names the latest, which is the whole answer for most visits.
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [focusedBlockId, setFocusedBlockId] = useState(null);
  const { setIncludeInNormalAnalytics, reopenBlock, setBlockReason } = useRecoveryBlockLifecycle();
  const [inclusionBusyBlockId, setInclusionBusyBlockId] = useState(null);
  const [inclusionError, setInclusionError] = useState(null);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenError, setReopenError] = useState(null);

  const activeBlock = findActiveBlock(blocks);
  // Same comparator storage's own uncompleteRecoveryBlock enforces — newest
  // `completed_at` first, `id` breaking a tie (#839 review) — applied to both
  // the history list's display order and which single card offers Reopen, so
  // the ONE card offering it is always the block a confirm will actually be
  // allowed to act on, on every device.
  const completedBlocks = blocks
    .filter(b => isLiveRecord(b) && b.completed_at)
    .sort(compareRecoveryBlocksNewestCompletedFirst);
  const newestCompletedBlock = completedBlocks[0] || null;

  const handleReopen = (block) => {
    const baselineTitle = block.baseline_note_title || 'Untitled Routine';
    Alert.alert(
      'Reopen this recovery block?',
      `This reactivates ${baselineTitle} as your active recovery block. Every week's status stays exactly as it is — you can add a new week or undo the latest week's completion once it's reopened. You can only reopen your most recently completed block, and only while no other block is active.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reopen block',
          onPress: async () => {
            setReopenError(null);
            setReopenBusy(true);
            try {
              const result = await reopenBlock({ blockId: block.id });
              if (!result || result.ok === false) {
                setReopenError((result && result.error) || 'Could not reopen this recovery block.');
              }
            } finally {
              setReopenBusy(false);
            }
          },
        },
      ]
    );
  };

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

  const hasPendingRecovery = (pendingRecovery?.length || 0) > 0;
  // EVERY inclusion switch is disabled while ANY write is in flight (#728),
  // not just the one being written — presenting an enabled switch that would
  // silently discard the interaction is worse than disabling all of them.
  // Also disabled while reconciliation is pending: the hook rejects those
  // writes via ensureVerifiedRecoveryState anyway, so the UI must not
  // advertise an action that can only fail.
  const inclusionLocked = !mutationsAllowed || hasPendingRecovery || !!inclusionBusyBlockId;

  // Unverified state is not "this user has never recovered" (#716). Rendering
  // nothing here would silently retract an entire evidence surface on a failed
  // read, so an unverified snapshot states its own condition instead.
  if (!stateReady) {
    const isInitialLoad = !stateError && (stateLoading || stateRefreshing);
    const message = isInitialLoad ? RECOVERY_LOADING_MESSAGE : RECOVERY_UNVERIFIED_MESSAGE;
    return (
      <View style={styles.container}>
        <SectionTitle>Recovery</SectionTitle>
        <View
          style={styles.stateBanner}
          accessible
          accessibilityRole={isInitialLoad ? 'text' : 'alert'}
          accessibilityLabel={message}
        >
          <Text style={styles.stateBannerText}>{message}</Text>
          {!isInitialLoad && !!onRetry && (
            <Pressable
              onPress={() => onRetry()}
              style={styles.stateRetryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry recovery"
            >
              <Text style={styles.stateRetryText}>Retry recovery</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  const staleBanner = stateStale ? (
    <View
      style={styles.stateBanner}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={RECOVERY_STALE_MESSAGE}
    >
      <Text style={styles.stateBannerText}>{RECOVERY_STALE_MESSAGE}</Text>
      {!!onRetry && (
        <Pressable
          onPress={() => onRetry()}
          disabled={stateRefreshing}
          style={styles.stateRetryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry recovery"
          accessibilityState={{ disabled: stateRefreshing }}
        >
          <Text style={styles.stateRetryText}>Retry recovery</Text>
        </Pressable>
      )}
    </View>
  ) : null;

  // A stale snapshot with no blocks in it still has something to say: the last
  // good read is what is on screen and it may be out of date. Hiding the section
  // would hide the retry path with it.
  if (!activeBlock && completedBlocks.length === 0) {
    if (!stateStale) return null;
    return (
      <View style={styles.container}>
        <SectionTitle>Recovery</SectionTitle>
        {staleBanner}
      </View>
    );
  }

  const focusedBlock =
    (focusedBlockId && [activeBlock, ...completedBlocks].find(b => b && b.id === focusedBlockId)) ||
    activeBlock ||
    completedBlocks[0];

  const notesById = new Map(notes.map(n => [n.id, n]));

  return (
    <View style={styles.container}>
      <SectionTitle>Recovery</SectionTitle>

      {staleBanner}

      {activeBlock && focusedBlock.id !== activeBlock.id && (
        <Pressable
          onPress={() => setFocusedBlockId(activeBlock.id)}
          style={styles.backToActive}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="View active recovery block"
        >
          <MaterialIcons name="chevron-left" size={16} color={colors.accent} accessible={false} />
          <Text style={styles.backToActiveText}>Back to active block</Text>
        </Pressable>
      )}

      <BlockEvidence
        key={focusedBlock.id}
        block={focusedBlock}
        weeks={weeks}
        notes={notes}
        unit={unit}
        stateStale={stateStale}
        showReopen={!activeBlock && !!newestCompletedBlock && focusedBlock.id === newestCompletedBlock.id}
        reopenDisabled={!mutationsAllowed || hasPendingRecovery || reopenBusy}
        reopenBusy={reopenBusy}
        reopenError={reopenError}
        onReopen={handleReopen}
        // Gated exactly like the inclusion switch (#872): a write that
        // `ensureVerifiedRecoveryState` would reject anyway must not be
        // advertised as available.
        reasonLocked={!mutationsAllowed || hasPendingRecovery}
        onSaveReason={setBlockReason}
      />

      {completedBlocks.length > 0 && (
        <View style={styles.historyPanel}>
          <Pressable
            onPress={() => setHistoryCollapsed(c => !c)}
            style={[styles.historyHeader, !historyCollapsed && styles.historyHeaderBordered]}
            accessibilityRole="button"
            accessibilityLabel={historyCollapsed ? 'Expand recovery history' : 'Collapse recovery history'}
            accessibilityState={{ expanded: !historyCollapsed }}
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
            const isLast = index === completedBlocks.length - 1;
            const selected = focusedBlock.id === block.id;
            const blockWeeks = weeks
              .filter(w => isLiveRecord(w) && w.block_id === block.id)
              .sort((a, b) => a.week_number - b.week_number);
            return (
              <View key={block.id} style={[styles.historyBlockGroup, !isLast && styles.historyBlockGroupBorder]}>
                <Pressable
                  onPress={() => setFocusedBlockId(block.id)}
                  style={[styles.historyRow, selected && styles.historyRowSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`View recovery evidence for ${block.baseline_note_title || 'Untitled Routine'}, completed ${formatDate(block.completed_at)}${block.reason ? `. Reason: ${block.reason}` : ''}`}
                >
                  <Text style={styles.historyBaselineTitle}>{block.baseline_note_title || 'Untitled Routine'}</Text>
                  <Text style={styles.historyDates}>
                    {formatDate(block.started_at)} – {formatDate(block.completed_at)}
                  </Text>
                  {/* What a completed block was FOR is usually the fastest way
                      to recognize it in a list of past recoveries (#872) —
                      more so than its baseline routine, which several blocks
                      may share. One line; the row is a selector, not the
                      evidence panel. */}
                  {block.reason ? (
                    <Text style={styles.historyDates} numberOfLines={1}>
                      {block.reason}
                    </Text>
                  ) : null}
                </Pressable>
                {blockWeeks.map(w => (
                  <WeekIndexRow
                    key={w.id}
                    block={block}
                    week={w}
                    notesById={notesById}
                    onNavigate={onNavigate}
                  />
                ))}
                <View style={styles.historyInclusionWrapper}>
                  <RecoveryInclusionToggle
                    block={block}
                    disabled={inclusionLocked}
                    busy={inclusionBusyBlockId === block.id}
                    error={inclusionErrorFor(block.id)}
                    onToggle={handleToggleInclusion}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
