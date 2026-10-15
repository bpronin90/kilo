// Recovery Blocks selector and the focused-block Manage stack (#1315). The
// selector lists the active block (when present) and every live completed block
// (newest completed first, the storage comparator) and only changes which block
// is focused: selecting writes nothing. It is labelled `Recovery Blocks`, not
// `Recovery History`, because it includes the active block (#1331). Each completed
// row prints its canonical latest-week total from the shared snapshot (#1378). The
// stack renders ONE visible Manage card, for the focused block.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { formatDate } from '../../lib/format';
import { useRecoveryBlockLifecycle, useRecoveryBaselineNames } from '../../hooks/entries/recoveryBlockHooks';
import { useRecoveryTidyNames } from '../../hooks/entries/recoveryTidyMutations';
import { useMovementGroupEditor } from '../../hooks/entries/movementGroupHooks';
import { useWeightUnit } from '../../lib/unitPreference';
import { useTheme } from '../../theme/ThemeContext';
import { LogRecoveryLifecycle } from './LogRecoveryLifecycle';
import { createLogManageStyles } from './logRecoveryManageStyles';
import { getRecoveryRowSummary } from '../../lib/data/recoverySnapshot';

// The write hooks are stable module bindings; tolerate a partially mocked hooks module.
const optionalHook = (hook) => (typeof hook === 'function' ? hook() : null);
const _title = (b) => b.baseline_note_title || 'Untitled Routine';

export function LogRecoveryHistory({
  activeBlock, completedBlocks, focusedBlockId, onSelect, alwaysShow = false, weeks = [], notes = [], stale = false,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const st = useMemo(() => createLogManageStyles(colors, kua), [colors, kua]);
  const [open, setOpen] = useState(false);
  // Read-only, per block id, and only while expanded: the latest-week summary the
  // block's evidence shows, re-derived only when that block's inputs change.
  const summaries = useMemo(() => (open
    ? new Map(completedBlocks.map(block => [block.id, getRecoveryRowSummary({ block, weeks, notes, stale })]))
    : null), [open, completedBlocks, weeks, notes, stale]);
  // With a vanished selection the selector must stay reachable, even if only the
  // active block remains to be picked.
  if (completedBlocks.length === 0 && !(alwaysShow && activeBlock)) return null;
  const rows = [...(activeBlock ? [{ block: activeBlock, active: true }] : []), ...completedBlocks.map(block => ({ block, active: false }))];
  const n = completedBlocks.length;
  const completedText = activeBlock ? `${n} completed` : `${n} completed ${n === 1 ? 'block' : 'blocks'}`;
  const caption = activeBlock ? `1 active · ${completedText}` : completedText;
  return (
    <View testID="recovery-history" style={st.historyPanel}>
      <Pressable
        testID="recovery-history-header"
        onPress={() => setOpen(o => !o)}
        style={st.historyHeader}
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} recovery blocks`}
        accessibilityState={{ expanded: open }}
      >
        <View>
          <Text style={st.historyTitle}>Recovery Blocks</Text>
          <Text style={st.historyCaption}>{caption}</Text>
        </View>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={18} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
      </Pressable>
      {open ? rows.map(({ block, active }) => {
        const selected = block.id === focusedBlockId;
        const dates = active ? `Started ${formatDate(block.started_at)}` : `${formatDate(block.started_at)} to ${formatDate(block.completed_at)}`;
        const summary = active ? null : summaries.get(block.id);
        return (
          <Pressable
            key={block.id}
            testID={`recovery-history-row-${block.id}`}
            onPress={() => onSelect(block.id)}
            style={[st.historyRow, selected && st.historyRowSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Manage ${active ? 'active' : 'completed'} recovery block ${_title(block)}, ${dates}${block.reason ? `. Reason: ${block.reason}` : ''}${summary ? `. ${summary.a11y}` : ''}`}
          >
            <Text style={st.historyRowTitle}>{`${active ? 'Active: ' : ''}${_title(block)}`}</Text>
            {summary ? <Text testID={`recovery-history-summary-${block.id}`} style={st.historyRowSummary}>{summary.text}</Text> : null}
            {summary ? summary.qualifiers.map(q => <Text key={q} style={st.historyRowMeta}>{q}</Text>) : null}
            <Text style={st.historyRowMeta}>{dates}</Text>
            {block.reason ? <Text style={st.historyRowMeta} numberOfLines={1}>{block.reason}</Text> : null}
          </Pressable>
        );
      }) : null}
    </View>
  );
}

// Every block that has been focused keeps its own mounted Manage card; only the
// focused one is visible. That is what keeps one card on screen (never a duplicate
// for active + completed) while a pending/failed write, a reason draft or a tidy
// preview survives switching away and back, and never reaches another block.
export function LogRecoveryManageStack({
  styles, colors, kua, activeBlock, completedBlocks, weeks, notes, currentWeek, busy, actionsLocked, stale,
  onUnlinkWeek, onOpenEndBlockModal, manage,
}) {
  const unit = useWeightUnit();
  const lifecycle = optionalHook(useRecoveryBlockLifecycle) || {};
  const names = optionalHook(useRecoveryBaselineNames) || {};
  const tidyNames = optionalHook(useRecoveryTidyNames);
  const groups = optionalHook(useMovementGroupEditor) || {};
  const all = [activeBlock, ...completedBlocks].filter(Boolean);
  const focusedId = manage.focusedBlockId;
  const [visited, setVisited] = useState(() => new Set());
  useEffect(() => {
    if (focusedId && !visited.has(focusedId)) setVisited(prev => new Set(prev).add(focusedId));
  }, [focusedId, visited]);
  // One inclusion write at a time across blocks (the hook serializes the write;
  // this keeps every other switch from advertising an action that would be dropped).
  const [inclusionBusyId, setInclusionBusyId] = useState(null);
  // Errors are kept per block, so toggling another block never clears this one's.
  const [inclusionErrors, setInclusionErrors] = useState({});
  const toggleInclusion = async (block, include) => {
    if (inclusionBusyId || !lifecycle.setIncludeInNormalAnalytics) return;
    setInclusionErrors(prev => ({ ...prev, [block.id]: null }));
    setInclusionBusyId(block.id);
    try {
      const result = await lifecycle.setIncludeInNormalAnalytics({ blockId: block.id, include });
      if (!result || result.ok === false) {
        setInclusionErrors(prev => ({ ...prev, [block.id]: (result && result.error) || 'That setting could not be saved.' }));
      }
    } finally {
      setInclusionBusyId(null);
    }
  };
  const writes = {
    rebuildBaseline: lifecycle.rebuildBaseline, matchBaselineName: names.matchBaselineName, tidyNames,
  };
  const groupEditing = { notesError: manage.notesError, locked: actionsLocked || stale, onSet: groups.setMovementGroup };
  return (
    <>
      {all.filter(b => b.id === focusedId || visited.has(b.id)).map(block => {
        const isActive = !!activeBlock && block.id === activeBlock.id;
        return (
          <LogRecoveryLifecycle
            key={block.id}
            styles={styles} colors={colors} kua={kua}
            block={block} weeks={weeks} notes={notes} unit={unit}
            isActive={isActive} currentWeek={isActive ? currentWeek : null}
            busy={busy} actionsLocked={actionsLocked} stale={stale}
            hidden={block.id !== focusedId}
            revealKey={block.id === manage.revealBlockId ? manage.revealKey : 0}
            scrollRef={manage.scrollRef}
            onRevealConsumed={manage.onRevealConsumed}
            onUnlinkWeek={onUnlinkWeek} onOpenEndBlockModal={onOpenEndBlockModal}
            onSaveReason={lifecycle.setBlockReason}
            inclusion={{
              busy: inclusionBusyId === block.id,
              locked: !!inclusionBusyId,
              error: inclusionErrors[block.id] || null,
              onToggle: toggleInclusion,
            }}
            writes={writes}
            groupEditing={groupEditing}
            reopen={{
              show: !activeBlock && !!manage.newestCompletedId && block.id === manage.newestCompletedId,
              disabled: actionsLocked || stale,
              busy: busy === 'reopen',
              onReopen: manage.onReopenBlock,
            }}
          />
        );
      })}
    </>
  );
}
