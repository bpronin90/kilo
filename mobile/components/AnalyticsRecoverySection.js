// Analytics Recovery section (#698): renders the #697 return-to-baseline
// comparison contract for the active recovery block and, on request, any
// completed block from history. It is READ-ONLY (#1315): nothing here writes,
// recomputes, gates, or claims medical recovery. The hero is the average % of
// baseline strength (#1305), never a completion gate. Every maintenance control
// (reason, inclusion, reopen, baseline rebuild/name matching/tidy, movement-group
// overrides) lives in Log's Manage block; this section offers no edit or Manage
// navigation (#1425). A completed block starts collapsed behind a header carrying
// the canonical compact summary (#1378). The strength week rows are the sole
// week selector, and the numbers come from the single Recovery snapshot.

import React, { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SectionTitle } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { formatDate } from '../lib/format';
import { findActiveBlock, isLiveRecord, orderedLiveWeeks } from '../lib/data/recoveryBlocks';
import { getRecoverySnapshot, compactRecoverySummary } from '../lib/data/recoverySnapshot';
import { compareRecoveryBlocksNewestCompletedFirst } from '../storage/entries/recoveryStorage';
import {
  RECOVERY_LOADING_MESSAGE,
  RECOVERY_STALE_MESSAGE,
  RECOVERY_UNVERIFIED_MESSAGE,
} from '../hooks/entries/recoveryBlockHooks';
import { BlockEvidence } from './recovery/RecoveryEvidence';
import { WeekIndexRow } from './recovery/RecoveryWeekIndex';
import { createStyles } from './recovery/analyticsRecoveryStyles';

const NOTES_UNREAD = 'Workout notes couldn’t be loaded, so there is no total to show.';

// Picking a block or week from the history list is an explicit request for its
// evidence (the row says so), so it opens that block.
// Disclosure identity (#1425): the block id AND its completion stamp, so a block
// that is reopened and completed again starts collapsed rather than inheriting
// the earlier open state, and one block's open state never reaches another.
const _blockKey = (b) => `${b.id}:${b.completed_at || 'active'}`;

// The collapsed header's canonical summary for a completed block: the shared
// compact summary (never a second percentage), a missing/failed notes read is
// "no total" rather than a zero, and a stale read stays qualified.
function _endedSummary(block, weeks, notes, stale, notesError) {
  const live = orderedLiveWeeks(weeks, block.id);
  const weekLabel = live.length ? `Week ${live[live.length - 1].week_number}` : null;
  let summary;
  if (notesError && notes.length === 0) {
    summary = { text: NOTES_UNREAD, weekLabel: null, qualifiers: [], a11y: NOTES_UNREAD };
  } else {
    summary = compactRecoverySummary(
      getRecoverySnapshot({ block, weeks, notes, stale: stale || !!notesError })
    );
  }
  const text = !summary.weekLabel && weekLabel ? `${weekLabel}: ${summary.text}` : summary.text;
  // The visible outcome drops the trailing week label (#1461): the status line
  // carries the block length, and the full wording stays on the accessibility label.
  const tail = summary.weekLabel ? ` · ${summary.weekLabel}` : '';
  const primary = tail && text.endsWith(tail) ? text.slice(0, -tail.length) : text;
  return { ...summary, text, primary, weeks: live.length };
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
  // Which completed block's evidence is open (#1425): local view state only.
  const [openKey, setOpenKey] = useState(null);
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

  const endedSummary = useMemo(
    () => (stateReady && focusedBlock && focusedBlock.completed_at
      ? _endedSummary(focusedBlock, weeks, notes, stateStale, notesError)
      : null),
    [stateReady, focusedBlock, weeks, notes, stateStale, notesError]
  );

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
    // The same boundary drops an open ended disclosure that does not belong to the
    // block now shown (store replacement, unverified read, removed block).
    if (openKey && (effectiveFocusId === null || !openKey.startsWith(`${effectiveFocusId}:`))) {
      setOpenKey(null);
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
  const ended = !!focusedBlock.completed_at;
  const expanded = !ended || openKey === _blockKey(focusedBlock);

  // The percentage is shown ONCE (#1536): collapsed it is the header's outcome;
  // expanded the evidence's own summary carries it, so the header drops it. A
  // failed notes read has no evidence summary to state it, so that message stays.
  const notesFailed = !!(notesError && notes.length === 0);
  const showHeaderOutcome = !!endedSummary && (!expanded || notesFailed);
  const endedLabel = ended
    ? (expanded
      ? `Collapse ended recovery block. ${focusedBlock.baseline_note_title || 'Untitled Routine'}, completed, ${endedSummary.weeks} ${endedSummary.weeks === 1 ? 'week' : 'weeks'}${notesFailed ? `. ${NOTES_UNREAD}` : ''}`
      : `Expand ended recovery block. ${endedSummary.a11y}`)
    : undefined;
  // One completed block and nothing else selectable: the History list would only
  // repeat the block already shown, and its weeks are the evidence's own week
  // rows. With any other block (active or completed) it stays (#1536).
  const showHistory = completedBlocks.length > 0 && (completedBlocks.length > 1 || !!activeBlock);

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

      {ended && (
        <View testID="recovery-ended-panel" style={styles.endedPanel}>
          <Pressable
            testID="recovery-ended-header"
            onPress={() => setOpenKey(expanded ? null : _blockKey(focusedBlock))}
            style={[styles.historyHeader, expanded && styles.historyHeaderBordered]}
            accessibilityRole="button"
            accessibilityLabel={endedLabel}
            accessibilityState={{ expanded }}
          >
            <View style={styles.historyHeaderContent}>
              {showHeaderOutcome && <Text style={styles.endedSummary}>{endedSummary.primary}</Text>}
              {endedSummary.qualifiers.map(q => <Text key={q} style={styles.endedMeta}>{q}</Text>)}
              <Text style={styles.endedStatus}>
                {`Completed · ${endedSummary.weeks} ${endedSummary.weeks === 1 ? 'week' : 'weeks'}`}
              </Text>
              {/* Collapsed, the header IDENTIFIES the block (reason/routine). Expanded,
                  Reason/Baseline/Dates live once in the evidence context group, so
                  this line is not repeated (#1536). */}
              {!expanded && (
                <Text style={styles.endedMeta} numberOfLines={1}>
                  {[focusedBlock.reason, focusedBlock.baseline_note_title || 'Untitled Routine'].filter(Boolean).join(' · ')}
                </Text>
              )}
            </View>
            <MaterialIcons
              name={expanded ? 'expand-less' : 'expand-more'}
              size={18}
              color={kua ? kua.onSurfaceVariant : colors.textMuted}
              accessible={false}
            />
          </Pressable>
        </View>
      )}

      {expanded && (
        <BlockEvidence
          key={_blockKey(focusedBlock)}
          block={focusedBlock}
          weeks={weeks}
          notes={notes}
          unit={unit}
          stateStale={stateStale}
          selectedWeekId={weekSelection.blockId === focusedBlock.id ? weekSelection.weekId : null}
          onSelectWeek={(weekId) => setWeekSelection({ blockId: focusedBlock.id, weekId })}
          notesError={notesError}
          oneKSelections={oneKSelections}
        />
      )}

      {showHistory && (
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
                  onPress={() => { focusBlock(block.id); setOpenKey(_blockKey(block)); }}
                  style={[styles.historyRow, selected && styles.historyRowSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`View recovery evidence for ${block.baseline_note_title || 'Untitled Routine'}, completed ${formatDate(block.completed_at)}${block.reason ? `. Reason: ${block.reason}` : ''}`}
                >
                  <Text style={styles.historyBaselineTitle}>{block.baseline_note_title || 'Untitled Routine'}</Text>
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
                  <Text style={styles.historyDates}>
                    {formatDate(block.started_at)} to {formatDate(block.completed_at)}
                  </Text>
                </Pressable>
                {blockWeeks.map(w => (
                  <WeekIndexRow
                    key={w.id}
                    block={block}
                    week={w}
                    notesById={notesById}
                    selected={selected && w.id === effectiveWeekId}
                    onFocusWeek={(blockId, weekId) => { setFocusedBlockId(blockId); setOpenKey(_blockKey(block)); setWeekSelection({ blockId, weekId }); }}
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
