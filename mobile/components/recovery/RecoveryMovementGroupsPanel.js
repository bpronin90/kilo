// Glue for the read-only movement-group breakdown (#1306): renders the groups the
// single Recovery snapshot already derived (#1315). The group EDITOR lives in
// Log's Manage block; this panel carries numbers only.

import React from 'react';
import { RecoveryMovementGroups } from './RecoveryMovementGroups';
import { GROUP_EDIT_UNAVAILABLE } from './MovementGroupEditor';

export function RecoveryMovementGroupsPanel({ snapshot, first = false }) {
  const mg = snapshot.movementGroups;
  if (!mg) return null;
  // Unavailable saved choices change what the numbers mean, so that stays here.
  const notice = !mg.source.available ? GROUP_EDIT_UNAVAILABLE[mg.source.reason] : null;
  return <RecoveryMovementGroups breakdown={mg.breakdown} notice={notice} first={first} />;
}
