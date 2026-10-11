// Analytics Recovery section (#698): renders the #697 return-to-baseline
// comparison contract for the active recovery block and, on request, any
// completed block from history. The comparison itself is read-only — nothing
// here recomputes, gates, or claims medical recovery. The hero is the average %
// of baseline strength (#1305), never a completion gate. The controls that DO
// write (inclusion toggle #728, Reopen #839, optional reason #872, baseline
// rebuild/name matching/tidy #1227/#1298/#1309, movement-group overrides #1306)
// each change one presentation, lifecycle or baseline-name field. All of them
// live in the sibling Manage block panel (#1307), never in the evidence card;
// the strength week rows are the sole week selector.

import React, { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Alert } from '../lib/platformAlert';
import { SectionTitle } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { formatDate } from '../lib/format';
import { findActiveBlock, isLiveRecord } from '../lib/data/recoveryBlocks';
import { compareRecoveryBlocksNewestCompletedFirst } from '../storage/entries/recoveryStorage';
import {
  RECOVERY_LOADING_MESSAGE,
  RECOVERY_STALE_MESSAGE,
  RECOVERY_UNVERIFIED_MESSAGE,
  useRecoveryBlockLifecycle,
  useRecoveryBaselineNames,
} from '../hooks/entries/recoveryBlockHooks';
import { useRecoveryTidyNames } from '../hooks/entries/recoveryTidyMutations';
import { useMovementGroupEditor } from '../hooks/entries/movementGroupHooks';
import { BlockEvidence } from './recovery/RecoveryEvidence';
import { RecoveryManageBlock } from './recovery/RecoveryManageBlock';
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
  // A failed notes read (#1306): the saved movement-group choices are then
  // unavailable, which is not the same as there being none.
  notesError = null,
  onRetry,
  onNavigate,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const unit = useWeightUnit();
  // Completed-block history starts collapsed for the same reason the details do
  // (#758): its collapsed header already states how many blocks there are and
  // names the latest, which is the whole answer for most visits.
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [focusedBlockId, setFocusedBlockId] = useState(null);
  // Selected week, scoped to ONE block (#1307): a selection made on another block
  // is ignored, so switching blocks always starts at the latest week.
  const [weekSelection, setWeekSelection] = useState({ blockId: null, weekId: null });
  const lastFocusedRef = useRef(null);
  const { setIncludeInNormalAnalytics, reopenBlock, setBlockReason, rebuildBaseline } = useRecoveryBlockLifecycle();
  const { matchBaselineName } = useRecoveryBaselineNames();
  const tidyNames = useRecoveryTidyNames();
  const { setMovementGroup } = useMovementGroupEditor();
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

  // Changing which block is in focus always resets the week selection (#1307).
  const focusBlock = (blockId) => {
    // Re-tapping the block already in focus keeps its selected week.
    if (focusedBlock && blockId === focusedBlock.id) return;
    setFocusedBlockId(blockId);
    setWeekSelection({ blockId: null, weekId: null });
  };

  const handleReopen = (block) => {
    const baselineTitle = block.baseline_note_title || 'Untitled Routine';
    Alert.alert(
      'Reopen this recovery block?',
      `This reactivates ${baselineTitle} as your active recovery block. Every week's status stays exactly as it is. You can add a new week or undo the latest week's completion once it's reopened. You can only reopen your most recently completed block, and only while no other block is active.`,
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

  // The EFFECTIVE focused block can change through data (the requested block
  // disappears and focus falls back), not only through taps. Clear a selection
  // that belongs to another block so it can never resurrect later (#1307).
  if (lastFocusedRef.current !== focusedBlock.id) {
    lastFocusedRef.current = focusedBlock.id;
    if (weekSelection.blockId && weekSelection.blockId !== focusedBlock.id) {
      setWeekSelection({ blockId: null, weekId: null });
    }
  }

  const notesById = new Map(notes.map(n => [n.id, n]));

  return (
    <View style={styles.container}>
      <SectionTitle>Recovery</SectionTitle>

      {staleBanner}

      {activeBlock && focusedBlock.id !== activeBlock.id && (
        <Pressable
          onPress={() => focusBlock(activeBlock.id)}
          style={styles.backToActive}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="View active recovery block"
        >
          <MaterialIcons name="chevron-left" size={16} color={kua ? kua.primary : colors.accent} accessible={false} />
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
        selectedWeekId={weekSelection.blockId === focusedBlock.id ? weekSelection.weekId : null}
        onSelectWeek={(weekId) => setWeekSelection({ blockId: focusedBlock.id, weekId })}
        notesError={notesError}
      />

      {/* Sibling card, not part of the evidence card (#1307). Keyed by block so
          drafts and errors never cross blocks. */}
      <RecoveryManageBlock
        key={`manage:${focusedBlock.id}`}
        block={focusedBlock}
        weeks={weeks}
        notes={notes}
        unit={unit}
        // Gated exactly like the inclusion switch (#872): a write that
        // `ensureVerifiedRecoveryState` would reject anyway must not be
        // advertised as available.
        locked={!mutationsAllowed || hasPendingRecovery}
        stale={stateStale}
        onSaveReason={setBlockReason}
        onRebuildBaseline={rebuildBaseline}
        onMatchNames={matchBaselineName}
        tidyNames={tidyNames}
        groupEditing={{ notesError, locked: !mutationsAllowed || hasPendingRecovery || stateStale, onSet: setMovementGroup }}
        reopen={{
          show: !activeBlock && !!newestCompletedBlock && focusedBlock.id === newestCompletedBlock.id,
          disabled: !mutationsAllowed || hasPendingRecovery || reopenBusy,
          busy: reopenBusy,
          error: reopenError,
          onReopen: handleReopen,
        }}
        inclusion={{
          disabled: inclusionLocked,
          busy: inclusionBusyBlockId === focusedBlock.id,
          error: inclusionErrorFor(focusedBlock.id),
          onToggle: handleToggleInclusion,
        }}
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
              color={kua ? kua.onSurfaceVariant : colors.textMuted}
              accessible={false}
            />
          </Pressable>

          {!historyCollapsed && completedBlocks.map((block, index) => {
            const isLast = index === completedBlocks.length - 1;
            const selected = focusedBlock.id === block.id;
            const blockWeeks = weeks
              .filter(w => isLiveRecord(w) && w.block_id === block.id)
              .sort((a, b) => a.week_number - b.week_number);
            // Mirrors the evidence: the stored selection while its week exists, else
            // the latest week (the default).
            const picked = weekSelection.blockId === block.id && blockWeeks.some(w => w.id === weekSelection.weekId)
              ? weekSelection.weekId : null;
            const effectiveWeekId = picked || (blockWeeks.length ? blockWeeks[blockWeeks.length - 1].id : null);
            return (
              <View key={block.id} style={[styles.historyBlockGroup, !isLast && styles.historyBlockGroupBorder]}>
                <Pressable
                  onPress={() => focusBlock(block.id)}
                  style={[styles.historyRow, selected && styles.historyRowSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`View recovery evidence for ${block.baseline_note_title || 'Untitled Routine'}, completed ${formatDate(block.completed_at)}${block.reason ? `. Reason: ${block.reason}` : ''}`}
                >
                  <Text style={styles.historyBaselineTitle}>{block.baseline_note_title || 'Untitled Routine'}</Text>
                  <Text style={styles.historyDates}>
                    {formatDate(block.started_at)} to {formatDate(block.completed_at)}
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
                    selected={selected && w.id === effectiveWeekId}
                    onFocusWeek={(blockId, weekId) => { setFocusedBlockId(blockId); setWeekSelection({ blockId, weekId }); }}
                    onNavigate={onNavigate}
                  />
                ))}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
