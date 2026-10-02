import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from '../UI';
import { useTheme } from '../../theme/ThemeContext';
import { formatDate } from '../../lib/format';
import { MAX_RECOVERY_REASON_LENGTH } from '../../lib/data/recoveryBlocks';
import {
  deriveRecoveryComparison,
  RECOVERY_COMPARISON_STATUS,
  RECOVERY_WEEK_STATUS,
} from '../../lib/data/recoveryAnalytics';
import {
  deriveRecoveryBandSeries,
  deriveRecoveryMovement,
  deriveRecoveryWeekBands,
} from '../../lib/data/recoveryReturnBands';
import { WeekEvidence, WeekUnavailableNotice } from './RecoveryStateGroups';
import { WeekPicker } from './RecoveryWeekPicker';
import { deriveTrainedElsewhere } from './RecoveryWeekIndex';
import { createStyles } from './analyticsRecoveryStyles';
import { RecoveryBandBar, RecoveryChangeVisual, RecoveryHero, RecoveryRosterSummary, RecoveryWeeksStrip } from './RecoveryVisuals';

// Every piece of state below — selected week, disclosure — is a view onto ONE
// block, so the caller mounts this keyed by `block.id`. Reusing the instance
// across a history switch would carry the previous block's open disclosure and
// selected week onto a block that never had them.
export function BlockEvidence({
  block, weeks, notes, unit,
  // Movement is never derived off an unverified/stale snapshot (#1023 v2 §4
  // requirement 4) — mirrors the same gate Home and the Overview row apply.
  stateStale = false,
  // Reopen (#839): the secondary, non-destructive action offered ONLY on the
  // newest completed block's own card, and only while no block is active —
  // the parent computes both conditions and hands down a single `showReopen`
  // rather than this component re-deriving "newest" from a `blocks` array it
  // does not otherwise receive.
  showReopen = false,
  reopenDisabled = false,
  reopenBusy = false,
  reopenError = null,
  onReopen,
  // The optional reason (#872). Editing lives HERE, not only on Log's `Manage
  // block`, because this card is the one surface that presents a COMPLETED
  // block — and naming a past injury correctly is exactly what a lifter does
  // while reviewing a finished recovery. `setRecoveryBlockReasonCore` has
  // always accepted completed blocks; before this the domain simply had no UI
  // that reached them (Codex review, PR #877).
  reasonLocked = false,
  onSaveReason,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const [selectedWeekId, setSelectedWeekId] = useState(null);
  // Editor state is local to this component, and the parent renders it with
  // `key={focusedBlock.id}` — so switching which block is in focus remounts and
  // resets the draft rather than carrying one block's unsaved text onto another.
  const [editingReason, setEditingReason] = useState(false);
  const [reasonDraft, setReasonDraft] = useState('');
  const [reasonBusy, setReasonBusy] = useState(false);
  const [reasonError, setReasonError] = useState(null);
  // Details start collapsed (#758). The question this surface answers — how
  // close am I to my normal training — is answered by the summary above; the
  // per-exercise diagnostic panel is the follow-up, not the opening statement.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  // The non-medical note sits behind an info button in the footer row (#1219,
  // owner-directed change of the earlier "one persistent line", #1023 v2 §8).
  const [aboutShown, setAboutShown] = useState(false);

  // Seeded from the STORED value, so Cancel is a true discard — the record is
  // the only source of what the field currently says.
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
      // The raw draft goes to the domain, which owns normalization — clearing
      // the field is an ordinary save of empty text, not a separate action.
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
  const reasonEditable = !!onSaveReason;
  const reasonDisabled = reasonLocked || reasonBusy;

  const comparison = useMemo(
    () => deriveRecoveryComparison({ block, weeks, notes }),
    [block, weeks, notes]
  );

  const weekResults = comparison.weeks || [];
  const latestWeek = weekResults.length > 0 ? weekResults[weekResults.length - 1] : null;
  const selectedWeek = (selectedWeekId && weekResults.find(w => w.week_id === selectedWeekId)) || latestWeek;
  const isActive = !block.completed_at;
  const routineTitle = block.baseline_note_title || 'Untitled Routine';

  const totalBaselineExercises = selectedWeek ? (selectedWeek.exercises || []).length : 0;
  const addedCount = selectedWeek ? (selectedWeek.added || []).length : 0;
  const totalRows = totalBaselineExercises + addedCount;
  const weekLabel = selectedWeek ? `Week ${selectedWeek.week_number}` : null;
  // Bottom context line (#1219): dates (and the routine only when the hero does
  // not already name it). The hero names the selected week, so the bands above
  // are never ambiguous about which week they describe.
  const provenance = isActive
    ? `Started ${formatDate(block.started_at)}`
    : `${formatDate(block.started_at)} – ${formatDate(block.completed_at)}`;
  const trainedElsewhere = useMemo(() => deriveTrainedElsewhere(weekResults, selectedWeek, stateStale), [weekResults, selectedWeek, stateStale]);
  const weekRows = selectedWeek ? [...(selectedWeek.exercises || []), ...(selectedWeek.added || [])] : [];

  // #1029: the six-bucket derivation, one proportional row per TRAINED
  // performance bucket — never the met-count headline, never sized against
  // the roster. `Not trained yet` moves out of the bucket list into a
  // same-tier denominator caption.
  const bands = useMemo(() => deriveRecoveryWeekBands(selectedWeek), [selectedWeek]);
  const hasBands = !!bands.buckets;
  const trained = bands.trained;
  const rosterSize = bands.roster_size;
  const notTrainedCount = hasBands ? (bands.buckets.not_trained_yet || 0) : 0;

  // Movement since the most recent qualifying earlier week. Never derived off
  // an unverified/stale snapshot (#1023 v2 §4); stale shows nothing rather than
  // blaming insufficient evidence (#1029) — the stale banner carries the cause.
  const movement = useMemo(() => (
    (!stateStale && selectedWeek)
      ? deriveRecoveryMovement(weekResults, { currentWeekId: selectedWeek.week_id })
      : null
  ), [stateStale, selectedWeek, weekResults]);
  const movementUnavailable = !movement && !stateStale && hasBands && !!weekLabel && (selectedWeek?.week_number || 0) > 1;

  // Band strip (#1023 v2 §3/§10c) — one small stacked mini-bar per live week,
  // Analytics-only, separate from the current-week bucket rows above.
  const bandSeries = useMemo(() => deriveRecoveryBandSeries(comparison), [comparison]);

  // Even a baseline-empty week still has something to say if it carries
  // recovery-only work: the merged clause line names it, with no hero above it.
  const showBandsRegion = selectedWeek && (totalBaselineExercises > 0 || addedCount > 0);
  // The hero names the anchor routine (#1219) on every path that renders it (including zero trained);
  // only then does the bottom line stop repeating it.
  const heroNamesRoutine = !!showBandsRegion && hasBands && !!weekLabel;
  const provenanceText = heroNamesRoutine ? provenance : `Baseline: ${routineTitle} · ${provenance}`;
  return (
    <Card>
      {/* The section's only Recovery header is the outer SectionTitle (#1217);
          the card opens with the hero, and the routine + reason are quiet
          context at the bottom (#1219). */}
      {comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_UNAVAILABLE && (
        <Text style={styles.unavailablePanelText}>
          The frozen baseline for this recovery block is unavailable.
        </Text>
      )}
      {comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_UNSUPPORTED && (
        <Text style={styles.unavailablePanelText}>
          This recovery block's baseline was captured in a format this version can't read.
        </Text>
      )}
      {comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY && (
        <Text style={styles.unavailablePanelText}>
          No baseline exercises were captured for this block.
        </Text>
      )}

      {(comparison.status === RECOVERY_COMPARISON_STATUS.OK || comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY) && (
        <>
          {weekResults.length === 0 && (
            <Text style={styles.unavailablePanelText}>Baseline captured. No week logged yet.</Text>
          )}

          {/* A single, never-unmounted live region (#794 review): selecting a
              week can land on a hero, a missing/unreadable-note notice, or a
              zero-evidence notice — mutually exclusive outcomes of the same
              selectedWeek switch. Gating the live region on any one of them
              (e.g. the hero alone) drops the announcement entirely whenever
              the newly selected week resolves to a different branch. */}
          <View style={styles.weekStatusRegion} accessibilityLiveRegion="polite">
            {showBandsRegion && (
              <View style={styles.summaryBlock}>
                {hasBands && !!weekLabel && (
                  <RecoveryHero weekLabel={weekLabel} atOrAbove={bands.buckets.at_or_above || 0} trained={trained} routineTitle={routineTitle} />
                )}
                {movementUnavailable && (
                  <Text testID="recovery-movement" style={styles.summaryLine}>Not enough matched lifts to compare weeks yet.</Text>
                )}
                {hasBands && trained > 0 && (
                  <RecoveryBandBar buckets={bands.buckets} trained={trained} weekLabel={weekLabel} />
                )}
                {!!movement && <RecoveryChangeVisual movement={movement} />}
              </View>
            )}

            <WeekUnavailableNotice week={selectedWeek} />

            {selectedWeek?.status === RECOVERY_WEEK_STATUS.OK && totalRows === 0 && (
              <Text style={styles.unavailablePanelText}>No exercise evidence for this week.</Text>
            )}
          </View>

          {weekResults.length > 1 && (
            <WeekPicker
              weeks={weekResults}
              selectedWeekId={selectedWeek ? selectedWeek.week_id : null}
              onSelect={setSelectedWeekId}
            />
          )}

          {bandSeries.length > 1 && <RecoveryWeeksStrip series={bandSeries} />}

          {selectedWeek?.status === RECOVERY_WEEK_STATUS.OK && totalRows > 0 && (
            <View style={styles.detailsPanel}>
              <Pressable
                onPress={() => setDetailsExpanded(expanded => !expanded)}
                style={styles.detailsHeader}
                accessibilityRole="button"
                accessibilityLabel={detailsExpanded ? 'Collapse exercise details' : 'Expand exercise details'}
                accessibilityState={{ expanded: detailsExpanded }}
              >
                <View style={styles.detailsHeaderContent}>
                  <Text style={styles.detailsHeaderTitle}>Exercise details</Text>
                </View>
                <MaterialIcons
                  name={detailsExpanded ? 'expand-less' : 'expand-more'}
                  size={18}
                  color={kua ? kua.onSurfaceVariant : colors.textMuted}
                  accessible={false}
                />
              </Pressable>

              {/* One shared summary (#1219), rendered identically under the
                  header whether the details are collapsed or expanded. */}
              <RecoveryRosterSummary
                buckets={bands.buckets}
                trained={trained}
                rosterSize={hasBands ? rosterSize : 0}
                notTrained={notTrainedCount}
                gap={bands.most_common_gap}
                added={addedCount}
              />

              {detailsExpanded && (
                <View style={styles.detailsBody}>
                  <WeekEvidence rows={weekRows} unit={unit} weekNumber={selectedWeek.week_number} elsewhere={trainedElsewhere} />
                </View>
              )}
            </View>
          )}
        </>
      )}

      {showReopen && (
        <View style={styles.reopenWrapper}>
          <Pressable
            onPress={() => onReopen?.(block)}
            disabled={reopenDisabled}
            style={[styles.reopenButton, reopenDisabled && styles.reopenButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel={`Reopen recovery block: ${routineTitle}`}
            accessibilityState={{ disabled: reopenDisabled, busy: reopenBusy }}
          >
            <Text style={styles.reopenButtonText}>
              {reopenBusy ? 'Reopening…' : 'Reopen recovery block'}
            </Text>
          </Pressable>
          {!!reopenError && (
            <Text style={styles.reopenErrorText} accessibilityRole="alert">{reopenError}</Text>
          )}
        </View>
      )}

      {/* One quiet footer row (#1219): provenance · reason · info button. */}
      <View testID="recovery-footer-row" style={styles.footerRow}>
        <Text
          style={[styles.provenanceText, styles.footerProvenance]}
          numberOfLines={1}
          accessibilityLabel={provenanceText}
        >
          {provenanceText}
        </Text>
        {!editingReason && (reasonEditable || !!block.reason) && <Text style={styles.footerSeparator}>·</Text>}
        {!editingReason && reasonEditable && (
          <Pressable
            onPress={openReasonEditor}
            disabled={reasonDisabled}
            style={[styles.reasonPressable, styles.footerReason]}
            accessibilityRole="button"
            accessibilityLabel={block.reason
              ? `Edit reason for this recovery block: ${block.reason}`
              : 'Add a reason for this recovery block'}
            accessibilityState={{ disabled: reasonDisabled }}
          >
            <Text
              style={[styles.reasonCaption, reasonDisabled && styles.reasonCaptionDisabled]}
              numberOfLines={1}
            >
              {block.reason ? `Reason: ${block.reason}` : 'Add a reason'}
            </Text>
          </Pressable>
        )}
        {!editingReason && !reasonEditable && !!block.reason && (
          <Text style={[styles.reasonCaption, styles.footerReason]} numberOfLines={1}>
            Reason: {block.reason}
          </Text>
        )}
        {(comparison.status === RECOVERY_COMPARISON_STATUS.OK || comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY) && (
          <Pressable
            onPress={() => setAboutShown(shown => !shown)}
            style={styles.infoButton}
            accessibilityRole="button"
            accessibilityLabel="About these numbers"
            accessibilityState={{ expanded: aboutShown }}
          >
            <MaterialIcons
              name="info-outline"
              size={18}
              color={kua ? kua.onSurfaceVariant : colors.textMuted}
              accessible={false}
            />
          </Pressable>
        )}
      </View>
      {/* Always mounted so revealing the note is announced (live region). */}
      <View testID="recovery-about-note" accessibilityLiveRegion="polite">
        {aboutShown && (
          <Text style={styles.nonMedicalText}>
            Training numbers only. Not a medical judgment — only you end a Recovery block.
          </Text>
        )}
      </View>
      {/* The optional reason (#872) is context only — no metric or week status
          reads it. The footer row shows/edits it; the editor opens here. */}
      {editingReason ? (
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
          <Text style={styles.reasonCaption}>
            Only for your own records. Leave it empty to remove it.
          </Text>
          {reasonError ? <Text style={styles.reasonErrorText}>{reasonError}</Text> : null}
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
              <Text style={styles.reasonEditorSaveText}>
                {reasonBusy ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Card>
  );
}
