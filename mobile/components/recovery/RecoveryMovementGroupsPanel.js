// Glue for the read-only movement-group breakdown (#1306): derives the groups
// from the strength rows and the baseline note's overrides. The group EDITOR lives
// in Manage block (#1307); this panel carries numbers only.

import React, { useMemo } from 'react';
import { deriveMovementGroupBreakdown, resolveMovementGroupSource } from '../../lib/data/recoveryMovementGroups';
import { RecoveryMovementGroups } from './RecoveryMovementGroups';
import { GROUP_EDIT_UNAVAILABLE } from './MovementGroupEditor';

export function RecoveryMovementGroupsPanel({ block, notes, strength, selectedWeek, notesError = null }) {
  const source = useMemo(
    () => resolveMovementGroupSource({ block, notes, notesError }),
    [block, notes, notesError]
  );
  const breakdown = useMemo(() => deriveMovementGroupBreakdown({
    strength,
    baselineRows: (block.baseline && block.baseline.exercises) || [],
    addedRows: (selectedWeek && selectedWeek.added) || [],
    overrides: source.overrides,
  }), [strength, block, selectedWeek, source]);
  // Unavailable saved choices change what the numbers mean, so that stays here.
  const notice = !source.available ? GROUP_EDIT_UNAVAILABLE[source.reason] : null;
  return <RecoveryMovementGroups breakdown={breakdown} notice={notice} />;
}
