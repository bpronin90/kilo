// Analytics `Manage block` (#1307): the ONE place the focused block's maintenance
// controls live, as a sibling card under the evidence card. It hosts the optional
// reason, Rebuild baseline, Match exercise names, Tidy names, eligible Reopen,
// the per-block inclusion switch and the movement-group editor. The evidence card
// keeps only read-only numbers and quiet context.
//
// The parent mounts this keyed by `block.id`, so the disclosure, reason draft and
// per-control errors can never carry onto another block. Opening or closing the
// panel writes nothing, and the trigger is never disabled: a locked user can
// still open it to read why each action is unavailable. Every control keeps the
// gate it had before the move; the hooks re-check authoritatively on write.

import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from '../UI';
import { useTheme } from '../../theme/ThemeContext';
import { MAX_RECOVERY_REASON_LENGTH } from '../../lib/data/recoveryBlocks';
import { deriveRecoveryComparison } from '../../lib/data/recoveryAnalytics';
import { deriveMovementGroupBreakdown, resolveMovementGroupSource } from '../../lib/data/recoveryMovementGroups';
import { movementGroupLabel } from '../../lib/data/movementGroups';
import { RecoveryInclusionToggle } from '../RecoveryInclusionToggle';
import { RebuildBaselineAction } from './RebuildBaseline';
import { MatchExerciseNamesAction } from './MatchExerciseNames';
import { TidyRecoveryNamesAction } from './TidyRecoveryNames';
import { GROUP_EDIT_UNAVAILABLE, MovementGroupEditorControl } from './MovementGroupEditor';
import { createStyles } from './analyticsRecoveryStyles';
import { createManageBlockStyles } from './recoveryManageBlockStyles';
import { createMovementGroupStyles } from './recoveryMovementGroupStyles';

const LOCKED_NOTE = 'Changes are paused while a Recovery change is pending or Recovery data is unverified. Controls come back automatically.';
const STALE_NOTE = 'Some changes (matching or tidying names, and movement groups) are paused until Recovery data is current.';

// Per-exercise group editor, relocated from the evidence breakdown (#1306). Lists
// every baseline lift plus any added during recovery; the numeric breakdown stays
// with the evidence.
function MovementGroupsManage({ block, weeks, notes, routineTitle, groupEditing }) {
  const { colors, kuaPalette: kua } = useTheme();
  const manage = useMemo(() => createManageBlockStyles(colors, kua), [colors, kua]);
  const mg = useMemo(() => createMovementGroupStyles(colors, kua), [colors, kua]);
  const [open, setOpen] = useState(false);
  const source = useMemo(
    () => resolveMovementGroupSource({ block, notes, notesError: groupEditing.notesError }),
    [block, notes, groupEditing.notesError]
  );
  const exercises = useMemo(() => {
    const baselineRows = (block.baseline && block.baseline.exercises) || [];
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
        onPress={() => setOpen(o => !o)}
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
      {open ? (
        <>
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
        </>
      ) : null}
    </View>
  );
}

export function RecoveryManageBlock({
  block, weeks, notes, unit,
  // Gate for every write: shared mutation gate or a pending recovery operation.
  locked = false,
  // Stale/unverified reads additionally pause the name/group controls.
  stale = false,
  onSaveReason,
  onRebuildBaseline,
  onMatchNames,
  tidyNames = null,
  // { notesError, locked, onSet }; null hides the group editor.
  groupEditing = null,
  // Reopen (#839): { show, disabled, busy, error, onReopen }.
  reopen = null,
  // Inclusion (#728): { disabled, busy, error, onToggle }.
  inclusion = null,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const manage = useMemo(() => createManageBlockStyles(colors, kua), [colors, kua]);
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const labelStyle = (windowWidth < 300 || fontScale >= 1.6)
    ? [styles.contextLabel, { minWidth: 0 }]
    : styles.contextLabel;
  const [expanded, setExpanded] = useState(false);
  const [editingReason, setEditingReason] = useState(false);
  const [reasonDraft, setReasonDraft] = useState('');
  const [reasonBusy, setReasonBusy] = useState(false);
  const [reasonError, setReasonError] = useState(null);
  const routineTitle = block.baseline_note_title || 'Untitled Routine';

  // Seeded from the STORED value, so Cancel is a true discard.
  const openReasonEditor = () => {
    setReasonError(null);
    setReasonDraft(block.reason || '');
    setEditingReason(true);
  };
  const closeReasonEditor = () => {
    setEditingReason(false);
    setReasonDraft('');
    setReasonError(null);
  };
  const handleSaveReason = async () => {
    if (reasonBusy || !onSaveReason) return;
    setReasonError(null);
    setReasonBusy(true);
    try {
      // The raw draft goes to the domain, which owns normalization; clearing the
      // field is an ordinary save of empty text.
      const result = await onSaveReason({ blockId: block.id, reason: reasonDraft });
      if (!result || result.ok === false) {
        setReasonError((result && result.error) || 'That reason could not be saved.');
        return;
      }
      closeReasonEditor();
    } finally {
      setReasonBusy(false);
    }
  };
  const toggle = () => {
    // Collapsing would unmount an open editor with no Save or Cancel to reach, so
    // closing it is part of the same gesture: the discard is explicit.
    if (expanded) closeReasonEditor();
    setExpanded(e => !e);
  };
  const reasonDisabled = locked || reasonBusy;
  const nameLocked = locked || stale;
  const actionRow = [manage.row, manage.rowDivider];

  return (
    <Card style={manage.card}>
      <Pressable
        testID="recovery-manage-block-trigger"
        onPress={toggle}
        style={manage.trigger}
        accessibilityRole="button"
        accessibilityLabel={`Manage recovery block: ${routineTitle}`}
        accessibilityState={{ expanded }}
      >
        <Text style={manage.triggerText}>Manage block</Text>
        <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={20} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
      </Pressable>
      {expanded ? (
        <View testID="recovery-manage-block" style={manage.list}>
          {locked || stale ? (
            <Text testID="recovery-manage-locked" style={manage.lockedNote} accessibilityLiveRegion="polite">{locked ? LOCKED_NOTE : STALE_NOTE}</Text>
          ) : null}
          {onSaveReason ? (
            <View style={manage.row}>
              {!editingReason ? (
                <Pressable
                  testID="recovery-reason-row"
                  onPress={openReasonEditor}
                  disabled={reasonDisabled}
                  style={[styles.contextRow, styles.reasonRow]}
                  accessibilityRole="button"
                  accessibilityLabel={block.reason
                    ? `Edit reason for this recovery block: ${block.reason}`
                    : 'Add a reason for this recovery block'}
                  accessibilityState={{ disabled: reasonDisabled }}
                >
                  <Text style={labelStyle}>Reason</Text>
                  <Text
                    style={[
                      styles.contextValue, styles.contextValueShrink,
                      !block.reason && styles.contextPlaceholder,
                      reasonDisabled && styles.reasonCaptionDisabled,
                    ]}
                    numberOfLines={2}
                  >
                    {block.reason || 'Add a reason'}
                  </Text>
                  <MaterialIcons
                    name={block.reason ? 'edit' : 'add'}
                    size={16}
                    color={kua ? kua.onSurfaceVariant : colors.textMuted}
                    style={[styles.reasonEditIcon, reasonDisabled && styles.reasonCaptionDisabled]}
                    accessible={false}
                  />
                </Pressable>
              ) : (
                <View style={styles.reasonEditor}>
                  <TextInput
                    style={styles.reasonInput}
                    value={reasonDraft}
                    onChangeText={setReasonDraft}
                    placeholder="e.g. torn hamstring, 8 weeks off"
                    placeholderTextColor={kua ? kua.onSurfaceVariant : colors.textMuted}
                    maxLength={MAX_RECOVERY_REASON_LENGTH}
                    editable={!reasonDisabled}
                    accessibilityLabel="Reason for this recovery block"
                  />
                  <Text style={styles.reasonCaption}>Only for your own records. Leave it empty to remove it.</Text>
                  {reasonError ? <Text style={styles.reasonErrorText} accessibilityRole="alert">{reasonError}</Text> : null}
                  <View style={styles.reasonEditorActions}>
                    <Pressable
                      onPress={closeReasonEditor}
                      disabled={reasonBusy}
                      style={styles.reasonEditorButton}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel editing the reason"
                      accessibilityState={{ disabled: reasonBusy }}
                    >
                      <Text style={styles.reasonEditorCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveReason}
                      disabled={reasonDisabled}
                      style={styles.reasonEditorButton}
                      accessibilityRole="button"
                      accessibilityLabel="Save the reason"
                      accessibilityState={{ disabled: reasonDisabled, busy: reasonBusy }}
                    >
                      <Text style={styles.reasonEditorSaveText}>{reasonBusy ? 'Saving…' : 'Save'}</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ) : null}
          {/* Each action owns its row and divider, so an ineligible (null) action
              leaves no empty padded row behind. */}
          {onRebuildBaseline ? (
            <RebuildBaselineAction block={block} weeks={weeks} notes={notes} unit={unit} locked={locked} rowStyle={actionRow} onRebuild={onRebuildBaseline} />
          ) : null}
          {onMatchNames ? (
            <MatchExerciseNamesAction block={block} weeks={weeks} notes={notes} locked={nameLocked} rowStyle={actionRow} onMatch={onMatchNames} />
          ) : null}
          {tidyNames ? (
            <TidyRecoveryNamesAction block={block} weeks={weeks} notes={notes} locked={nameLocked} rowStyle={actionRow} onTidy={tidyNames.tidyNames} />
          ) : null}
          {groupEditing ? (
            <MovementGroupsManage block={block} weeks={weeks} notes={notes} routineTitle={routineTitle} groupEditing={groupEditing} />
          ) : null}
          {reopen && reopen.show ? (
            <View style={[manage.row, manage.rowDivider, styles.reopenWrapper]}>
              <Pressable
                onPress={() => reopen.onReopen?.(block)}
                disabled={reopen.disabled}
                style={[styles.reopenButton, reopen.disabled && styles.reopenButtonDisabled]}
                accessibilityRole="button"
                accessibilityLabel={`Reopen recovery block: ${routineTitle}`}
                accessibilityState={{ disabled: !!reopen.disabled, busy: !!reopen.busy }}
              >
                <Text style={styles.reopenButtonText}>{reopen.busy ? 'Reopening…' : 'Reopen recovery block'}</Text>
              </Pressable>
              {reopen.error ? <Text style={styles.reopenErrorText} accessibilityRole="alert">{reopen.error}</Text> : null}
            </View>
          ) : null}
          {inclusion ? (
            <View style={manage.row}>
              <RecoveryInclusionToggle
                block={block}
                disabled={inclusion.disabled}
                busy={inclusion.busy}
                error={inclusion.error}
                onToggle={inclusion.onToggle}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
