// Log Recovery focus state (#1315): which block the single Manage card is for,
// the completed-block list behind Recovery History, and the typed
// `recovery-manage` navigation intent from Analytics. Selecting a block only
// changes focus; nothing here writes. A target that does not resolve to a live
// block yields an explicit unavailable state, never another block's card.

import { useEffect, useMemo, useRef, useState } from 'react';
import { findActiveBlock, isLiveRecord } from '../../lib/data/recoveryBlocks';
import { compareRecoveryBlocksNewestCompletedFirst } from '../../storage/entries/recoveryStorage';

export const MANAGE_TARGET_UNAVAILABLE = 'That recovery block is no longer available.';

export function useLogRecoveryManage({ blocks = [], ready = true, navManageBlockId = null, navKey = 0 }) {
  const activeBlock = findActiveBlock(blocks);
  const completedBlocks = useMemo(
    () => blocks.filter(b => isLiveRecord(b) && b.completed_at).sort(compareRecoveryBlocksNewestCompletedFirst),
    [blocks]
  );
  const [selectedId, setSelectedId] = useState(null);
  const [reveal, setReveal] = useState({ blockId: null, key: 0 });
  const [unavailable, setUnavailable] = useState(false);
  const appliedRef = useRef(0);

  useEffect(() => {
    if (!navManageBlockId || navKey === appliedRef.current) return;
    // Never resolve a target against placeholder arrays: wait for the verified read.
    if (!ready) return;
    appliedRef.current = navKey;
    const target = [activeBlock, ...completedBlocks].find(b => b && b.id === navManageBlockId);
    if (target) {
      setSelectedId(target.id);
      setReveal({ blockId: target.id, key: navKey });
      setUnavailable(false);
    } else {
      setReveal({ blockId: null, key: 0 });
      setUnavailable(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navManageBlockId, navKey, ready, blocks]);

  const live = [activeBlock, ...completedBlocks].filter(Boolean);
  const focused = live.find(b => b.id === selectedId) || activeBlock || completedBlocks[0] || null;
  return {
    completedBlocks,
    hasCompleted: completedBlocks.length > 0,
    manage: {
      focusedBlockId: focused ? focused.id : null,
      revealBlockId: reveal.blockId,
      revealKey: reveal.key,
      unavailable,
      newestCompletedId: completedBlocks[0] ? completedBlocks[0].id : null,
      onSelectBlock: (id) => { setUnavailable(false); setSelectedId(id); },
    },
  };
}
