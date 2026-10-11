// The recovery-block "Manage block" card (#789/#843/#872, per-block since #1315):
// the ONE maintenance surface for a block, active or completed. Every block that
// has been focused keeps its own mounted card (hidden unless focused), so drafts,
// in-flight writes and rejected-write errors survive collapse AND switching
// blocks, and never leak onto another block. Rows: the optional reason, the
// inclusion control, then (active only) Unlink current week and End recovery
// block, then the relocated maintenance rows (LogRecoveryManageBlock).
//
// Opening or closing the disclosure writes nothing and the trigger is never
// disabled, so a locked user can open it and read why each control is
// unavailable. Collapsing never discards a reason draft; only Cancel does.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from '../UI';
import { MAX_RECOVERY_REASON_LENGTH } from '../../lib/data/recoveryBlocks';
import { RECOVERY_INCLUSION_HELP } from '../RecoveryInclusionToggle';
import { LOCKED_NOTE, LogRecoveryMaintenance, STALE_NOTE } from './LogRecoveryManageBlock';

export function LogRecoveryLifecycle({
  styles,
  colors,
  kua = null,
  block,
  weeks = [],
  notes = [],
  unit = 'lb',
  // Only the active block can unlink a week or be ended.
  isActive = false,
  currentWeek = null,
  busy = null,
  actionsLocked,
  stale = false,
  // Not the focused block: kept mounted for its state, hidden from sight and a11y.
  hidden = false,
  // Bumps (nonzero) when a navigation intent asks for this card to be revealed.
  revealKey = 0,
  // The Log read ScrollView ref, so a navigation reveal can bring the card into view.
  scrollRef = null,
  onUnlinkWeek,
  onOpenEndBlockModal,
  onSaveReason,
  // { busy, error, locked, onToggle } — serialized across blocks by the stack.
  inclusion,
  writes,
  groupEditing,
  reopen = null,
}) {
  const activeBlock = block;
  const rootRef = useRef(null);
  const [reasonEditing, setReasonEditing] = useState(false);
  const [reasonDraft, setReasonDraft] = useState('');
  const [reasonBusy, setReasonBusy] = useState(false);
  const [reasonError, setReasonError] = useState(null);
  const [manageExpanded, setManageExpanded] = useState(false);
  // Mounted on first open and kept mounted (hidden) while collapsed.
  const [everOpened, setEverOpened] = useState(false);
  const [inclusionHelpShown, setInclusionHelpShown] = useState(false);

  useEffect(() => {
    if (!revealKey) return;
    setEverOpened(true);
    setManageExpanded(true);
    const node = rootRef.current;
    const sc = scrollRef && scrollRef.current;
    const inner = sc && ((sc.getInnerViewRef && sc.getInnerViewRef()) || (sc.getInnerViewNode && sc.getInnerViewNode()));
    if (node && inner && node.measureLayout && sc.scrollTo) {
      try { node.measureLayout(inner, (_x, y) => sc.scrollTo({ y: Math.max(0, y - 8), animated: true }), () => {}); } catch (e) { /* best effort */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  const toggleExpanded = () => {
    setEverOpened(true);
    setManageExpanded(e => !e);
  };
  const inclusionLocked = actionsLocked || inclusion.locked;
  const inclusionBusy = inclusion.busy;
  const inclusionError = inclusion.error;

  // Opening the editor seeds the draft from the STORED value, so Cancel is a
  // true discard.
  const openReasonEditor = () => {
    setReasonError(null);
    setReasonDraft(block.reason || '');
    setReasonEditing(true);
  };
  const closeReasonEditor = () => {
    setReasonEditing(false);
    setReasonDraft('');
    setReasonError(null);
  };
  const handleSaveReason = async () => {
    if (reasonBusy) return;
    setReasonError(null);
    setReasonBusy(true);
    try {
      // The raw draft goes to the domain, which owns normalization.
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
  const reasonLocked = actionsLocked || reasonBusy;
  const reasonErrorFor = () => reasonError;
  const title = block.baseline_note_title || 'Untitled Routine';

  return (
    // Manage block (#843): a sibling card, not a disclosure inside the
    // active card. The trigger carries no `disabled` key in any state
    // — see `manageExpanded` above — so a locked user can always open
    // it; each row inside keeps exactly the per-control gating it had
    // before.
    <View
      ref={rootRef}
      testID={`recovery-manage-card-${block.id}`}
      style={hidden ? { display: 'none' } : undefined}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
    <Card style={styles.manageCard}>
      <Pressable
        testID={`recovery-manage-trigger-${block.id}`}
        onPress={toggleExpanded}
        style={styles.manageTrigger}
        accessibilityRole="button"
        accessibilityLabel={`Manage recovery block: ${title}`}
        accessibilityState={{ expanded: manageExpanded }}
      >
        <Text style={styles.manageTriggerText}>Manage block</Text>
        {/* The one sanctioned disclosure glyph (`ui-design-rules.md` §6):
            a `MaterialIcons` chevron, never a text arrow (#804). */}
        <MaterialIcons
          name={manageExpanded ? 'expand-less' : 'expand-more'}
          size={20}
          color={kua ? kua.onSurfaceVariant : colors.textMuted}
          accessible={false}
        />
      </Pressable>

      {everOpened && (
        <View
          testID={`recovery-manage-body-${block.id}`}
          style={manageExpanded ? styles.manageList : [styles.manageList, { display: 'none' }]}
          accessibilityElementsHidden={!manageExpanded}
          importantForAccessibility={manageExpanded ? 'auto' : 'no-hide-descendants'}
        >
          {actionsLocked || stale ? (
            <Text testID="recovery-manage-locked" style={styles.manageRowSubtitle} accessibilityLiveRegion="polite">{actionsLocked ? LOCKED_NOTE : STALE_NOTE}</Text>
          ) : null}
          {/* Reason (#872): the administration surface for the optional
              free text, collapsed to a single row until the user asks to
              change it. Writing it changes no note, week, baseline,
              fatigue record, or analytics result — only this one field —
              so it sits above the controls that do move lifecycle state.
          */}
          <View style={[styles.manageRow, styles.manageRowDivider]}>
            {reasonEditing ? (
              <View style={styles.reasonEditor}>
                <Text style={styles.manageRowTitle}>Reason for this block</Text>
                <TextInput
                  style={styles.reasonInput}
                  value={reasonDraft}
                  onChangeText={setReasonDraft}
                  placeholder="e.g. torn hamstring, 8 weeks off"
                  placeholderTextColor={kua ? kua.onSurfaceVariant : colors.textMuted}
                  maxLength={MAX_RECOVERY_REASON_LENGTH}
                  editable={!reasonLocked}
                  accessibilityLabel="Reason for this recovery block"
                />
                <Text style={styles.manageRowSubtitle}>
                  Only for your own records. Leave it empty to remove it.
                </Text>
                {reasonErrorFor() ? (
                  <Text style={styles.manageRowInlineError}>{reasonErrorFor()}</Text>
                ) : null}
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
                    disabled={reasonLocked}
                    style={[styles.reasonEditorButton, reasonLocked && styles.manageRowDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Save the reason"
                    accessibilityState={{
                      disabled: reasonLocked,
                      busy: reasonBusy,
                    }}
                  >
                    <Text style={styles.reasonEditorSaveText}>
                      {reasonBusy ? 'Saving…' : 'Save'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={openReasonEditor}
                disabled={reasonLocked}
                style={[styles.manageRowMain, reasonLocked && styles.manageRowDisabled]}
                accessibilityRole="button"
                accessibilityLabel={activeBlock.reason
                  ? `Edit reason for this recovery block: ${activeBlock.reason}`
                  : 'Add a reason for this recovery block'}
                accessibilityState={{ disabled: reasonLocked }}
              >
                <View style={styles.manageRowInfo}>
                  <Text style={styles.manageRowTitle}>Reason for this block</Text>
                  <Text style={styles.manageRowSubtitle} numberOfLines={2}>
                    {activeBlock.reason || 'Not set. Add why this recovery started.'}
                  </Text>
                  {reasonErrorFor() ? (
                    <Text style={styles.manageRowInlineError}>{reasonErrorFor()}</Text>
                  ) : null}
                </View>
                <MaterialIcons name="chevron-right" size={20} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
              </Pressable>
            )}
          </View>

          <View style={[styles.manageRow, styles.manageRowDivider]}>
            {/* The row IS the Log-surface inclusion control (#843
                review) — tapping it writes `include_in_normal_analytics`
                directly. There is no nested `RecoveryInclusionToggle`
                Switch here; that component, unchanged, still hosts the
                Switch presentation on Analytics/Home.
                The outer View is plain (non-accessible, non-Pressable)
                so the switch Pressable and the help Pressable below are
                TRUE siblings, not nested inside one another — VoiceOver
                groups a nested Pressable into its accessible ancestor,
                which would make the help button unreachable as its own
                action if it lived inside the switch's own Pressable
                (#843 review finding: `e.stopPropagation()` only affects
                event bubbling, not the accessibility tree). */}
            <View style={styles.manageRowMain}>
              <Pressable
                onPress={() => inclusion.onToggle(activeBlock, !(activeBlock.include_in_normal_analytics === true))}
                disabled={inclusionLocked}
                style={[styles.inclusionSwitchArea, inclusionLocked && styles.manageRowDisabled]}
                accessibilityRole="switch"
                accessibilityLabel={`Counting in normal analytics: ${activeBlock.include_in_normal_analytics === true ? 'On' : 'Off'}`}
                accessibilityState={{
                  checked: activeBlock.include_in_normal_analytics === true,
                  disabled: inclusionLocked,
                  busy: inclusionBusy,
                }}
              >
                <View style={styles.manageRowInfo}>
                  <Text style={styles.manageRowTitle}>Counting in normal analytics</Text>
                  {inclusionHelpShown ? (
                    <Text style={styles.manageRowSubtitle} accessibilityLiveRegion="polite">
                      {RECOVERY_INCLUSION_HELP}
                    </Text>
                  ) : (
                    <Text style={styles.manageRowSubtitle}>
                      Off keeps these weeks out of classifications, overload signals, Kilo Max,
                      1K, and Home summaries.
                    </Text>
                  )}
                  {inclusionError ? (
                    <Text style={styles.manageRowInlineError}>{inclusionError}</Text>
                  ) : null}
                </View>
                <Text style={styles.manageRowState}>
                  {inclusionBusy
                    ? 'Saving…'
                    : (activeBlock.include_in_normal_analytics === true ? 'On' : 'Off')}
                </Text>
              </Pressable>
              {/* On-demand help (#757's pattern, reproduced here rather
                  than shared — `RecoveryInclusionToggle` keeps its own
                  separate copy for Analytics/Home). A true sibling of
                  the switch Pressable above, not nested inside it. */}
              <Pressable
                onPress={() => setInclusionHelpShown(v => !v)}
                style={styles.inclusionHelpToggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: inclusionHelpShown }}
                accessibilityLabel={`${inclusionHelpShown ? 'Hide' : 'Show'} what counting these weeks in normal analytics does`}
              >
                <MaterialIcons name="info-outline" size={16} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
              </Pressable>
              <MaterialIcons name="chevron-right" size={20} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
            </View>
          </View>

          <LogRecoveryMaintenance
            block={block} weeks={weeks} notes={notes} unit={unit}
            locked={actionsLocked} stale={stale} writes={writes} groupEditing={groupEditing} reopen={reopen}
          />

          {isActive && currentWeek ? (
            // Always names the concrete current week, open or just completed, so
            // Unlink is never a context-free button.
            <Pressable
              onPress={() => onUnlinkWeek(currentWeek)}
              disabled={actionsLocked}
              style={[styles.manageRow, styles.manageRowDivider, styles.manageRowMain, actionsLocked && styles.manageRowDisabled]}
              accessibilityRole="button"
              accessibilityLabel={`Unlink Week ${currentWeek.week_number}`}
              accessibilityState={{ disabled: actionsLocked }}
            >
              <View style={styles.manageRowInfo}>
                <Text style={styles.manageRowTitle}>
                  {busy === currentWeek.id ? 'Unlinking…' : `Unlink Week ${currentWeek.week_number}'s note`}
                </Text>
                <Text style={styles.manageRowSubtitle}>
                  Removes the note from this block. The note itself is kept and stays editable.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
            </Pressable>
          ) : null}

          {isActive ? (
            <Pressable
              onPress={() => onOpenEndBlockModal?.()}
              disabled={actionsLocked}
              style={[styles.manageRow, styles.manageRowMain, actionsLocked && styles.manageRowDisabled]}
              accessibilityRole="button"
              accessibilityLabel="End recovery block"
              accessibilityState={{ disabled: actionsLocked }}
            >
              <View style={styles.manageRowInfo}>
                <Text style={styles.manageRowTitleError}>End recovery block</Text>
                <Text style={styles.manageRowSubtitle}>
                  Completes this block and asks how these weeks should count in analytics.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={kua ? kua.errorText : colors.error} accessible={false} />
            </Pressable>
          ) : null}
        </View>
      )}
    </Card>
    </View>
  );
}
