// Backup/restore gate for the per-exercise movement-group override map (#1306).
// Kept out of backupValidation.js / backupRestore.js (at the line cap). An
// omitted or null field is a legacy note (rules only) and is valid; anything
// else must be exactly {version: 1, overrides: {<key>: <one group id>}}. A
// malformed map is rejected rather than restored as a silently accepted mapping.

import { movementGroupMapError } from '../../lib/data/movementGroups';

// Replace-mode cloud restore (#1306): the backup is authoritative, so a restored
// note with no movement-group field must upload an explicit null (rules only);
// omitting the column would leave the account's old override in place.
export const withExplicitMovementGroups = (row) => ({ ...row, exercise_movement_groups: row.exercise_movement_groups ?? null });

export function movementGroupsNoteError(note) {
  const error = movementGroupMapError(note && note.exercise_movement_groups);
  return error ? `Invalid backup: workout note exercise_movement_groups ${error}` : null;
}
