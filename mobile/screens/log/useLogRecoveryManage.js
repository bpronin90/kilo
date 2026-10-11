// Log Recovery focus state (#1315): which block the single Manage card is for,
// the completed-block list behind Recovery History, and the typed
// `recovery-manage` navigation intent from Analytics. Selecting a block only
// changes focus; nothing here writes. A target that does not resolve to a live
// block yields an explicit unavailable state, never another block's card.

import { useEffect, useMemo, useRef, useState } from 'react';
import { findActiveBlock, isLiveRecord } from '../../lib/data/recoveryBlocks';
import { compareRecoveryBlocksNewestCompletedFirst } from '../../storage/entries/recoveryStorage';

export const MANAGE_TARGET_UNAVAILABLE = 'That recovery block is no longer available.';

export function useLogRecoveryManage({
  blocks = [], ready = true, readError = null, navManageBlockId = null, navKey = 0,
  // Brings the Recovery view forward when a target cannot otherwise be shown.
  onShow = null,
}) {
  const activeBlock = findActiveBlock(blocks);
  const completedBlocks = useMemo(
    () => blocks.filter(b => isLiveRecord(b) && b.completed_at).sort(compareRecoveryBlocksNewestCompletedFirst),
    [blocks]
  );
  const [selectedId, setSelectedId] = useState(null);
  const [reveal, setReveal] = useState({ blockId: null, key: 0 });
  const [unavailable, setUnavailable] = useState(false);
  const appliedRef = useRef(0);
  const shownRef = useRef(0);
  // A reveal is one-shot: once a card has expanded and scrolled for a key, a
  // remount (tab switch) must not repeat it.
  const [consumedKey, setConsumedKey] = useState(0);

  // A newly active block (a started or reopened one) takes focus over a completed
  // block the user had selected earlier; otherwise Manage would stay on a stale
  // history selection while the new block's controls are one tap away.
  const activeId = activeBlock ? activeBlock.id : null;
  const lastActiveRef = useRef(activeId);
  useEffect(() => {
    if (lastActiveRef.current !== activeId) {
      lastActiveRef.current = activeId;
      if (activeId) setSelectedId(null);
    }
  }, [activeId]);

  useEffect(() => {
    if (!navManageBlockId || navKey === appliedRef.current) return;
    // Never resolve a target against placeholder arrays: wait for the verified
    // read. A failed read is shown (the Recovery view's own unverified state with
    // `Retry recovery`), and the target applies once a retry verifies.
    if (!ready) {
      if (readError && shownRef.current !== navKey) {
        shownRef.current = navKey;
        if (onShow) onShow();
      }
      return;
    }
    appliedRef.current = navKey;
    const target = [activeBlock, ...completedBlocks].find(b => b && b.id === navManageBlockId);
    if (target) {
      setSelectedId(target.id);
      setReveal({ blockId: target.id, key: navKey });
      setUnavailable(false);
    } else {
      setReveal({ blockId: null, key: 0 });
      setUnavailable(true);
      // With no block left the Recovery tab may not otherwise exist; surface it.
      if (onShow) onShow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navManageBlockId, navKey, ready, readError, blocks]);

  const live = [activeBlock, ...completedBlocks].filter(Boolean);
  const focused = live.find(b => b.id === selectedId) || activeBlock || completedBlocks[0] || null;
  return {
    completedBlocks,
    hasCompleted: completedBlocks.length > 0,
    manage: {
      focusedBlockId: focused ? focused.id : null,
      revealBlockId: reveal.blockId,
      revealKey: reveal.key === consumedKey ? 0 : reveal.key,
      onRevealConsumed: setConsumedKey,
      unavailable,
      newestCompletedId: completedBlocks[0] ? completedBlocks[0].id : null,
      onSelectBlock: (id) => { setUnavailable(false); setSelectedId(id); },
    },
  };
}
