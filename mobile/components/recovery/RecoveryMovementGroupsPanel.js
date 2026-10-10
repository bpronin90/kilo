// Glue for the movement-group breakdown (#1306): derives the groups from the
// strength rows and the baseline note's overrides, then renders the read-only
// breakdown with the editor control slotted in. Kept out of RecoveryEvidence so
// that file stays small and C (#1307) can re-home the controls by changing only
// the `renderControl` line here.

import React, { useMemo } from 'react';
import { deriveMovementGroupBreakdown, resolveMovementGroupSource } from '../../lib/data/recoveryMovementGroups';
import { RecoveryMovementGroups } from './RecoveryMovementGroups';
import { GROUP_EDIT_UNAVAILABLE, MovementGroupEditorControl } from './MovementGroupEditor';

export function RecoveryMovementGroupsPanel({ block, notes, strength, selectedWeek, routineTitle, groupEditing }) {
  const source = useMemo(
    () => resolveMovementGroupSource({ block, notes, notesError: groupEditing.notesError }),
    [block, notes, groupEditing.notesError]
  );
  const breakdown = useMemo(() => deriveMovementGroupBreakdown({
    strength,
    baselineRows: (block.baseline && block.baseline.exercises) || [],
    addedRows: (selectedWeek && selectedWeek.added) || [],
    overrides: source.overrides,
  }), [strength, block, selectedWeek, source]);
  const editing = {
    available: source.available,
    locked: groupEditing.locked === true,
    noteId: source.noteId,
    onSet: groupEditing.onSet,
  };
  const notice = !source.available ? GROUP_EDIT_UNAVAILABLE[source.reason]
    : editing.locked ? GROUP_EDIT_UNAVAILABLE.locked : null;
  return (
    <RecoveryMovementGroups
      breakdown={breakdown}
      notice={notice}
      renderControl={(exercise) => (
        <MovementGroupEditorControl exercise={exercise} editing={editing} routineTitle={routineTitle} />
      )}
    />
  );
}
