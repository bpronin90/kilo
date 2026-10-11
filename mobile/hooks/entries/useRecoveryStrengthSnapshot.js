// Hooks over the single Recovery snapshot (#1315). Both read
// `getRecoverySnapshot`, which derives each input once and shares the frozen
// result, so Home, the Analytics Overview row and the Analytics Recovery section
// can be mounted together without any of them re-deriving.

import { useMemo } from 'react';
import { findActiveBlock } from '../../lib/data/recoveryBlocks';
import { getRecoverySnapshot } from '../../lib/data/recoverySnapshot';
import { useRecoveryBlockState } from './recoveryBlockHooks';

// A caller that already holds the block (the Analytics section, which lets the
// user focus a completed block and pick a week).
export function useRecoveryStrengthSnapshot({ block, weeks, notes, selectedWeekId = null, stale = false, notesError = null }) {
  return useMemo(
    () => getRecoverySnapshot({ block, weeks, notes, selectedWeekId, stale, notesError }),
    [block, weeks, notes, selectedWeekId, stale, notesError]
  );
}

// The ACTIVE block's latest-week snapshot for the compact surfaces (Overview row,
// Home panel), from a Recovery read state the caller already holds.
// `snapshot` is null unless the read is verified and a block is active.
export function useRecoverySnapshotFromState(state, notes, { notesError = null } = {}) {
  const { blocks, weeks, ready, stale, activeBlock } = state || {};
  const block = useMemo(() => activeBlock || findActiveBlock(blocks || []), [activeBlock, blocks]);
  // Never derive off a placeholder snapshot: with the read unverified the block
  // handed to the store is null.
  const verifiedBlock = ready ? block : null;
  const snapshot = useRecoveryStrengthSnapshot({ block: verifiedBlock, weeks, notes, stale: !!stale, notesError });
  return { snapshot, block: verifiedBlock, ready: !!ready, stale: !!stale };
}

// Same, reading the authoritative shared store directly.
export function useActiveRecoverySnapshot(notes, opts) {
  return useRecoverySnapshotFromState(useRecoveryBlockState(), notes, opts);
}
