// Maintenance rows of Log's single Manage block (#1307, moved to Log by #1315):
// rebuild baseline, match exercise names, tidy names, the movement-group editor
// and the eligible Reopen. They were Analytics' Manage block; the same action
// components, gates, confirmations and hooks apply unchanged. The parent card
// owns the disclosure and keeps this mounted (hidden) while collapsed so a
// pending or failed write keeps its draft and error.

import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { deriveRecoveryComparison } from '../../lib/data/recoveryAnalytics';
import { deriveMovementGroupBreakdown, resolveMovementGroupSource } from '../../lib/data/recoveryMovementGroups';
import { movementGroupLabel } from '../../lib/data/movementGroups';
import { RebuildBaselineAction } from './RebuildBaseline';
import { MatchExerciseNamesAction } from './MatchExerciseNames';
import { TidyRecoveryNamesAction } from './TidyRecoveryNames';
import { GROUP_EDIT_UNAVAILABLE, MovementGroupEditorControl } from './MovementGroupEditor';
import { createStyles } from './analyticsRecoveryStyles';
import { createLogManageStyles } from './logRecoveryManageStyles';
import { createMovementGroupStyles } from './recoveryMovementGroupStyles';

export const LOCKED_NOTE = 'Changes are paused while a Recovery change is pending or Recovery data is unverified. Controls come back automatically.';
export const STALE_NOTE = 'Some changes (matching or tidying names, and movement groups) are paused until Recovery data is current.';

// Per-exercise group editor. Lists every baseline lift plus any added during
// recovery; the numeric breakdown stays read-only in Analytics.
export function MovementGroupsManage({ block, weeks, notes, routineTitle, groupEditing }) {
  const { colors, kuaPalette: kua } = useTheme();
  const manage = useMemo(() => createLogManageStyles(colors, kua), [colors, kua]);
  const mg = useMemo(() => createMovementGroupStyles(colors, kua), [colors, kua]);
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const source = useMemo(
    () => resolveMovementGroupSource({ block, notes, notesError: groupEditing.notesError }),
    [block, notes, groupEditing.notesError]
  );
  const exercises = useMemo(() => {
    const baselineRows = block.baseline && Array.isArray(block.baseline.exercises) ? block.baseline.exercises : [];
    const addedRows = [];
    const seen = new Set(baselineRows.map(r => r && r.key));
    for (const w of deriveRecoveryComparison({ block, weeks, notes }).weeks || []) {
      for (const row of w.added || []) {
        if (row && row.key && !seen.has(row.key)) { seen.add(row.key); addedRows.push(row); }
      }
    }
    const order = new Map([...baselineRows, ...addedRows].map((r, i) => [r && r.key, i]));
    const breakdown = deriveMovementGroupBreakdown({ baselineRows, addedRows, overrides: source.overrides });
    return breakdown.groups.flatMap(g => g.exercises).sort((a, b) => order.get(a.key) - order.get(b.key));
  }, [block, weeks, notes, source]);
  if (exercises.length === 0) return null;
  const editing = { available: source.available, locked: groupEditing.locked === true, noteId: source.noteId, onSet: groupEditing.onSet };
  const notice = !source.available ? GROUP_EDIT_UNAVAILABLE[source.reason]
    : editing.locked ? GROUP_EDIT_UNAVAILABLE.locked : null;
  return (
    <View testID="recovery-manage-groups" style={[manage.row, manage.rowDivider]}>
      <Pressable
        testID="recovery-manage-groups-header"
        onPress={() => { setEverOpened(true); setOpen(o => !o); }}
        style={manage.groupsTrigger}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Collapse movement groups editor' : 'Expand movement groups editor'}
        accessibilityState={{ expanded: open }}
      >
        <View style={mg.headerText}>
          <Text style={manage.groupsTitle}>Movement groups</Text>
          <Text style={manage.groupsCaption}>Choose which group each lift counts in.</Text>
        </View>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={18} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
      </Pressable>
      {everOpened ? (
        <View
          testID="recovery-manage-groups-body"
          style={open ? undefined : manage.hidden}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        >
          {notice ? <Text testID="movement-groups-notice" style={mg.notice}>{notice}</Text> : null}
          {exercises.map(ex => (
            <View key={ex.key} testID={`manage-group-exercise-${ex.key}`} style={mg.exercise}>
              <View style={mg.exerciseHead}>
                <Text style={mg.exerciseName}>{ex.name}</Text>
                <MovementGroupEditorControl exercise={ex} editing={editing} routineTitle={routineTitle} />
              </View>
              <Text style={mg.exerciseMeta}>
                {`${movementGroupLabel(ex.group)} · ${ex.source === 'override' ? 'Your choice' : 'Automatic'}${ex.origin === 'added' ? ' · added during recovery' : ''}`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function LogRecoveryMaintenance({
  block, weeks, notes, unit, locked, stale, writes, groupEditing, reopen,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const manage = useMemo(() => createLogManageStyles(colors, kua), [colors, kua]);
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const nameLocked = locked || stale;
  const routineTitle = block.baseline_note_title || 'Untitled Routine';
  const rowStyle = [manage.row, manage.rowDivider];
  return (
    <>
      <RebuildBaselineAction block={block} weeks={weeks} notes={notes} unit={unit} locked={locked} rowStyle={rowStyle} onRebuild={writes.rebuildBaseline} />
      <MatchExerciseNamesAction block={block} weeks={weeks} notes={notes} locked={nameLocked} rowStyle={rowStyle} onMatch={writes.matchBaselineName} />
      {writes.tidyNames ? (
        <TidyRecoveryNamesAction block={block} weeks={weeks} notes={notes} locked={nameLocked} rowStyle={rowStyle} onTidy={writes.tidyNames.tidyNames} />
      ) : null}
      <MovementGroupsManage block={block} weeks={weeks} notes={notes} routineTitle={routineTitle} groupEditing={groupEditing} />
      {reopen && reopen.show ? (
        <View style={[manage.row, manage.rowDivider, styles.reopenWrapper]}>
          <Pressable
            testID={`recovery-reopen-${block.id}`}
            onPress={reopen.onReopen}
            disabled={reopen.disabled}
            style={[styles.reopenButton, reopen.disabled && styles.reopenButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel={`Reopen recovery block: ${routineTitle}`}
            accessibilityState={{ disabled: !!reopen.disabled, busy: !!reopen.busy }}
          >
            <Text style={styles.reopenButtonText}>{reopen.busy ? 'Reopening…' : 'Reopen recovery block'}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
