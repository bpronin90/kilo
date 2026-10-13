// Analytics Recovery section (#698): renders the #697 return-to-baseline
// comparison contract for the active recovery block and, on request, any
// completed block from history. It is READ-ONLY (#1315): nothing here writes,
// recomputes, gates, or claims medical recovery. The hero is the average % of
// baseline strength (#1305), never a completion gate. Every maintenance control
// (reason, inclusion, reopen, baseline rebuild/name matching/tidy, movement-group
// overrides) lives in Log's Manage block; this section offers at most one quiet
// `Manage in Log` link for the focused block. The strength week rows are the sole
// week selector, and the numbers come from the single Recovery snapshot.

import React, { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
} from '../hooks/entries/recoveryBlockHooks';
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
  // A failed notes read (#1306): the saved movement-group choices are then
  // unavailable, which is not the same as there being none.
  notesError = null,
  onRetry,
  onNavigate,
  // Effective 1K selection for the active block's Big 3 (#1351).
  oneKSelections = null,
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

  const activeBlock = findActiveBlock(blocks);
  // Same comparator storage's own uncompleteRecoveryBlock enforces — newest
  // `completed_at` first, `id` breaking a tie (#839 review) — applied to both
  // the history list's display order and which single card offers Reopen, so
  // the ONE card offering it is always the block a confirm will actually be
  // allowed to act on, on every device.
  const completedBlocks = blocks
    .filter(b => isLiveRecord(b) && b.completed_at)
    .sort(compareRecoveryBlocksNewestCompletedFirst);

  // Changing which block is in focus always resets the week selection (#1307).
  const focusBlock = (blockId) => {
    // Re-tapping the block already in focus keeps its selected week.
    if (focusedBlock && blockId === focusedBlock.id) return;
    setFocusedBlockId(blockId);
    setWeekSelection({ blockId: null, weekId: null });
  };

  const focusedBlock =
    (focusedBlockId && [activeBlock, ...completedBlocks].find(b => b && b.id === focusedBlockId)) ||
    activeBlock ||
    completedBlocks[0] || null;

  // The EFFECTIVE focused block id (null when nothing is shown: unverified state
  // or no blocks). It can change through data, not only taps, and it is resolved
  // before every early return so a transition to or from "nothing shown" also
  // clears a selection that belongs to another block (#1307). Hooks above stay
  // unconditional.
  const effectiveFocusId = stateReady && focusedBlock ? focusedBlock.id : null;
  if (lastFocusedRef.current !== effectiveFocusId) {
    lastFocusedRef.current = effectiveFocusId;
    if (weekSelection.blockId && weekSelection.blockId !== effectiveFocusId) {
      setWeekSelection({ blockId: null, weekId: null });
    }
  }

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
        oneKSelections={oneKSelections}
        onManageInLog={onNavigate ? () => onNavigate('Log', { kind: 'recovery-manage', blockId: focusedBlock.id }) : null}
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
