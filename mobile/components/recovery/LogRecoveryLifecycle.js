// The recovery-block "Manage block" card (#789/#843/#872), split out of
// LogRecoverySection.js for the #1056 file-size refactor. Behavior-only: this
// is the block-level lifecycle-admin surface — the optional reason editor, the
// Log-surface inclusion control, the Unlink current week row, and End recovery
// block — with exactly the per-control gating, confirmations, and accessibility
// it had before.
//
// The two single-field writes it owns directly (inclusion, reason) go through
// `useRecoveryBlockLifecycle`, the same mock seam the section used, so a
// single-collection patch needs no cross-record serialization from LogScreen —
// only the shared `actionsLocked` gate so neither can race a journaled
// lifecycle operation over the same block.
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from '../UI';
import { MAX_RECOVERY_REASON_LENGTH } from '../../lib/data/recoveryBlocks';
import { useRecoveryBlockLifecycle } from '../../hooks/entries/recoveryBlockHooks';
import { RECOVERY_INCLUSION_HELP } from '../RecoveryInclusionToggle';

export function LogRecoveryLifecycle({
  styles,
  colors,
  activeBlock,
  currentWeek,
  busy = null,
  actionsLocked,
  // The Alert-confirmed unlink wrapper, owned by the section boundary (it
  // quotes the linked note and reports failures against the state zone).
  onUnlinkWeek,
  onOpenEndBlockModal,
}) {
  // The inclusion preference (#699) is the one recovery mutation this component
  // owns directly rather than receiving as a handler from LogScreen. It changes
  // no week, no note, and no baseline — only a single field on one block — so
  // there is no cross-record state for LogScreen to serialize, and it carries
  // its own in-flight key. It is still disabled by `actionsLocked` below, so it
  // can never race a journaled lifecycle operation over the same block.
  const { setIncludeInNormalAnalytics, setBlockReason } = useRecoveryBlockLifecycle();
  const [inclusionBusyBlockId, setInclusionBusyBlockId] = useState(null);
  const [inclusionError, setInclusionError] = useState(null);
  // The optional reason editor (#872), owned here for the same reason the
  // inclusion preference is: a single-field patch on a single collection needs
  // no cross-record serialization from LogScreen, only the shared
  // `actionsLocked` gate so it cannot race a journaled lifecycle operation.
  //
  // Keyed by block id, not a boolean, for the reason `manageExpandedBlockId`
  // is: this component stays mounted across a block's whole lifetime, so a
  // boolean would carry an open editor (and its draft text) from a block the
  // user just completed onto the next one they start.
  const [reasonEditingBlockId, setReasonEditingBlockId] = useState(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [reasonBusyBlockId, setReasonBusyBlockId] = useState(null);
  const [reasonError, setReasonError] = useState(null);
  // The `Manage block` disclosure (#789, restyled #843), collapsed by default.
  // It is presentation state only: nothing inside it changes handler, gating,
  // or confirm copy, and the trigger itself is NEVER disabled — a locked user
  // must still be able to open it and see WHY each control inside is
  // unavailable (#780 corrected blocked-mutation contract).
  //
  // Stored as the block id it was opened FOR, not as a boolean. This component
  // stays mounted across a block's whole lifetime, and completing a block only
  // makes it render no active card — it does not unmount. A boolean would
  // survive that gap, so a user who expanded the disclosure, completed the
  // block, and started another one without leaving the Routine tab would meet
  // the new block with Unlink, block completion, and the inclusion switch
  // already exposed. Keying by id collapses on any block change with no effect
  // and no stale-state window.
  const [manageExpandedBlockId, setManageExpandedBlockId] = useState(null);
  // `Counting in normal analytics` IS the Log-surface inclusion control now
  // (#843 review): tapping the row itself writes `include_in_normal_analytics`
  // — there is no separate `RecoveryInclusionToggle` Switch nested under it
  // on Log any more (that component, and its Switch presentation, remain
  // exactly as they are for Analytics/Home). This tracks only whether the
  // row's own on-demand help text (the same `RECOVERY_INCLUSION_HELP` copy)
  // is shown, mirroring `RecoveryInclusionToggle`'s own local `helpShown`
  // pattern — it never gates the write.
  const [inclusionHelpShownBlockId, setInclusionHelpShownBlockId] = useState(null);

  // Derived, never stored: a disclosure opened for a different block reads as
  // collapsed for this one.
  const manageExpanded = !!activeBlock && manageExpandedBlockId === activeBlock.id;
  const inclusionHelpShown = !!activeBlock && inclusionHelpShownBlockId === activeBlock.id;

  // A failure is reported against the block it happened on, so a completed
  // block's rejected toggle never posts an error over the active block's card.
  const handleToggleInclusion = async (block, include) => {
    if (inclusionBusyBlockId) return;
    setInclusionError(null);
    setInclusionBusyBlockId(block.id);
    try {
      const result = await setIncludeInNormalAnalytics({ blockId: block.id, include });
      if (!result || result.ok === false) {
        setInclusionError({
          blockId: block.id,
          message: (result && result.error) || 'That setting could not be saved.',
        });
      }
    } finally {
      setInclusionBusyBlockId(null);
    }
  };

  const inclusionErrorFor = (blockId) =>
    (inclusionError && inclusionError.blockId === blockId) ? inclusionError.message : null;

  // EVERY inclusion switch is disabled while ANY inclusion write is in flight,
  // not just the one being written. `handleToggleInclusion` refuses a second
  // concurrent write, so leaving the other blocks' switches enabled would
  // present an affordance — to sighted and screen-reader users alike — that
  // silently discards the interaction.
  const inclusionLocked = actionsLocked || !!inclusionBusyBlockId;

  // ── the optional reason (#872) ──────────────────────────────────────────────
  //
  // Opening the editor seeds the draft from the STORED value, so Cancel is a
  // true discard: the record is the only source of what the field currently
  // says, and an editor seeded from a previous draft would quietly re-offer
  // text the user already abandoned.
  const openReasonEditor = (block) => {
    setReasonError(null);
    setReasonDraft(block.reason || '');
    setReasonEditingBlockId(block.id);
  };
  const closeReasonEditor = () => {
    setReasonEditingBlockId(null);
    setReasonDraft('');
    setReasonError(null);
  };
  const handleSaveReason = async (block) => {
    if (reasonBusyBlockId) return;
    setReasonError(null);
    setReasonBusyBlockId(block.id);
    try {
      // The raw draft goes to the domain, which owns normalization — clearing
      // the field is therefore an ordinary save of empty text, not a separate
      // "remove" action with its own contract.
      const result = await setBlockReason({ blockId: block.id, reason: reasonDraft });
      if (!result || result.ok === false) {
        setReasonError({
          blockId: block.id,
          message: (result && result.error) || 'That reason could not be saved.',
        });
        return;
      }
      closeReasonEditor();
    } finally {
      setReasonBusyBlockId(null);
    }
  };
  const reasonErrorFor = (blockId) =>
    (reasonError && reasonError.blockId === blockId) ? reasonError.message : null;
  const reasonLocked = actionsLocked || !!reasonBusyBlockId;

  return (
    // Manage block (#843): a sibling card, not a disclosure inside the
    // active card. The trigger carries no `disabled` key in any state
    // — see `manageExpanded` above — so a locked user can always open
    // it; each row inside keeps exactly the per-control gating it had
    // before.
    <Card style={styles.manageCard}>
      <Pressable
        onPress={() => setManageExpandedBlockId(id => {
          // Collapsing the disclosure would unmount an open reason
          // editor along with it, stranding whatever the user had
          // typed with no Save or Cancel to reach. Closing the editor
          // as part of the same gesture makes the discard explicit
          // instead of silent (#872).
          if (id === activeBlock.id) {
            closeReasonEditor();
            return null;
          }
          return activeBlock.id;
        })}
        style={styles.manageTrigger}
        accessibilityRole="button"
        accessibilityLabel={`Manage recovery block: ${activeBlock.baseline_note_title || 'Untitled Routine'}`}
        accessibilityState={{ expanded: manageExpanded }}
      >
        <Text style={styles.manageTriggerText}>Manage block</Text>
        {/* The one sanctioned disclosure glyph (`ui-design-rules.md` §6):
            a `MaterialIcons` chevron, never a text arrow (#804). */}
        <MaterialIcons
          name={manageExpanded ? 'expand-less' : 'expand-more'}
          size={20}
          color={colors.textMuted}
          accessible={false}
        />
      </Pressable>

      {manageExpanded && (
        <View style={styles.manageList}>
          {/* Reason (#872): the administration surface for the optional
              free text, collapsed to a single row until the user asks to
              change it. Writing it changes no note, week, baseline,
              fatigue record, or analytics result — only this one field —
              so it sits above the controls that do move lifecycle state.
          */}
          <View style={[styles.manageRow, styles.manageRowDivider]}>
            {reasonEditingBlockId === activeBlock.id ? (
              <View style={styles.reasonEditor}>
                <Text style={styles.manageRowTitle}>Reason for this block</Text>
                <TextInput
                  style={styles.reasonInput}
                  value={reasonDraft}
                  onChangeText={setReasonDraft}
                  placeholder="e.g. torn hamstring, 8 weeks off"
                  placeholderTextColor={colors.textMuted}
                  maxLength={MAX_RECOVERY_REASON_LENGTH}
                  editable={!reasonLocked}
                  accessibilityLabel="Reason for this recovery block"
                />
                <Text style={styles.manageRowSubtitle}>
                  Only for your own records. Leave it empty to remove it.
                </Text>
                {reasonErrorFor(activeBlock.id) ? (
                  <Text style={styles.manageRowInlineError}>{reasonErrorFor(activeBlock.id)}</Text>
                ) : null}
                <View style={styles.reasonEditorActions}>
                  <Pressable
                    onPress={closeReasonEditor}
                    disabled={reasonBusyBlockId === activeBlock.id}
                    style={styles.reasonEditorButton}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel editing the reason"
                    accessibilityState={{ disabled: reasonBusyBlockId === activeBlock.id }}
                  >
                    <Text style={styles.reasonEditorCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleSaveReason(activeBlock)}
                    disabled={reasonLocked}
                    style={[styles.reasonEditorButton, reasonLocked && styles.manageRowDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Save the reason"
                    accessibilityState={{
                      disabled: reasonLocked,
                      busy: reasonBusyBlockId === activeBlock.id,
                    }}
                  >
                    <Text style={styles.reasonEditorSaveText}>
                      {reasonBusyBlockId === activeBlock.id ? 'Saving…' : 'Save'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => openReasonEditor(activeBlock)}
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
                  {reasonErrorFor(activeBlock.id) ? (
                    <Text style={styles.manageRowInlineError}>{reasonErrorFor(activeBlock.id)}</Text>
                  ) : null}
                </View>
                <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
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
                onPress={() => handleToggleInclusion(activeBlock, !(activeBlock.include_in_normal_analytics === true))}
                disabled={inclusionLocked}
                style={[styles.inclusionSwitchArea, inclusionLocked && styles.manageRowDisabled]}
                accessibilityRole="switch"
                accessibilityLabel={`Counting in normal analytics: ${activeBlock.include_in_normal_analytics === true ? 'On' : 'Off'}`}
                accessibilityState={{
                  checked: activeBlock.include_in_normal_analytics === true,
                  disabled: inclusionLocked,
                  busy: inclusionBusyBlockId === activeBlock.id,
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
                  {inclusionErrorFor(activeBlock.id) ? (
                    <Text style={styles.manageRowInlineError}>{inclusionErrorFor(activeBlock.id)}</Text>
                  ) : null}
                </View>
                <Text style={styles.manageRowState}>
                  {inclusionBusyBlockId === activeBlock.id
                    ? 'Saving…'
                    : (activeBlock.include_in_normal_analytics === true ? 'On' : 'Off')}
                </Text>
              </Pressable>
              {/* On-demand help (#757's pattern, reproduced here rather
                  than shared — `RecoveryInclusionToggle` keeps its own
                  separate copy for Analytics/Home). A true sibling of
                  the switch Pressable above, not nested inside it. */}
              <Pressable
                onPress={() => setInclusionHelpShownBlockId(id => (id === activeBlock.id ? null : activeBlock.id))}
                style={styles.inclusionHelpToggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: inclusionHelpShown }}
                accessibilityLabel={`${inclusionHelpShown ? 'Hide' : 'Show'} what counting these weeks in normal analytics does`}
              >
                <MaterialIcons name="info-outline" size={16} color={colors.textMuted} accessible={false} />
              </Pressable>
              <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
            </View>
          </View>

          {/* Always names the concrete current week, open or just
              completed, so Unlink is never a context-free button. */}
          {currentWeek && (
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
              <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
            </Pressable>
          )}

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
            <MaterialIcons name="chevron-right" size={20} color={colors.error} accessible={false} />
          </Pressable>
        </View>
      )}
    </Card>
  );
}
