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
  deriveRecoveryTrainedRows,
  deriveRecoveryWeekBands,
} from '../../lib/data/recoveryReturnBands';
import { MetricLegend, WeekEvidence, WeekUnavailableNotice } from './RecoveryStateGroups';
import { deriveTrainedElsewhere } from './RecoveryWeekIndex';
import { createStyles } from './analyticsRecoveryStyles';
import { presentBandIds, RecoveryBandBar, RecoveryChangeVisual, RecoveryHero, RecoveryWeeksStrip } from './RecoveryVisuals';

// #697 state words, used only for the below-four-trained-lifts sparse
// sentence and the details-panel group headings — permitted vocabulary
// (#1023 v2 §8), unchanged from the detail row it names.
const STATE_LABEL = Object.freeze({
  baseline_met: 'at or above baseline',
  rebuilding: 'rebuilding',
  not_comparable: "can't compare",
  added_during_recovery: 'added during recovery',
});

// One-line week summary inside the details panel; zero-count states are dropped
// and `Baseline met` is absent (it is the hero).
function _summaryLine(weekLabel, summary) {
  if (!weekLabel) return null;
  const parts = [weekLabel];
  const add = (count, noun) => { if (count > 0) parts.push(`${count} ${noun}`); };
  add(summary?.rebuilding, 'rebuilding');
  add(summary?.not_reintroduced, 'not reintroduced');
  add(summary?.not_comparable, 'not comparable');
  add(summary?.added_during_recovery, 'added during recovery');
  return parts.join(' · ');
}

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
  const metCount = selectedWeek ? (selectedWeek.summary?.baseline_met || 0) : 0;
  const addedCount = selectedWeek ? (selectedWeek.added || []).length : 0;
  const totalRows = totalBaselineExercises + addedCount;
  const weekLabel = selectedWeek ? `Week ${selectedWeek.week_number}` : null;
  // Folded into the collapsed "Exercise details" header instead of the first
  // screenful (#1029 §10c).
  const summaryLine = _summaryLine(weekLabel, selectedWeek?.summary);
  // One-line identity caption, replacing the old "Baseline routine" label +
  // title pair (#793/R5b cut list). The selected week is always named here so
  // the bands below are never ambiguous about which week they describe (§5).
  const identityCaption = weekLabel ? `${weekLabel} · ${routineTitle}` : `Baseline: ${routineTitle}`;
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
  // Below four trained lifts, no bucket bars: one plain sentence names the
  // lift(s) and their state, with the denominator in the sentence itself.
  const sparse = hasBands && trained > 0 && trained < 4;
  // Same source of truth as `bands`/`trained` above — never a parallel filter
  // over `selectedWeek.exercises` (#1029 review finding 1: that would let a
  // `baseline_value_unusable` row be named even though it is outside the
  // roster/denominator this sentence itself states).
  const trainedExercises = deriveRecoveryTrainedRows(selectedWeek);
  const sparseSentence = sparse
    ? `${trainedExercises.map(row => `${row.name} (${STATE_LABEL[row.state] || row.state})`).join(', ')} — ${trained} of ${rosterSize} roster exercises trained.`
    : null;
  const trainedDenominatorCaption = hasBands
    ? `Trained this week: ${trained} of ${rosterSize} roster exercises${notTrainedCount > 0 && !sparse ? ` · ${notTrainedCount} not trained yet` : ''}`
    : null;

  // Movement since the most recent qualifying earlier week. Never derived off
  // an unverified/stale snapshot (#1023 v2 §4); stale shows nothing rather than
  // blaming insufficient evidence (#1029) — the stale banner carries the cause.
  const movement = useMemo(() => (
    (!stateStale && selectedWeek)
      ? deriveRecoveryMovement(weekResults, { currentWeekId: selectedWeek.week_id })
      : null
  ), [stateStale, selectedWeek, weekResults]);
  const movementUnavailable = !movement && !stateStale && hasBands && !!weekLabel && (selectedWeek?.week_number || 0) > 1;
  const mostCommonGapLine = hasBands && bands.most_common_gap
    ? `Most common gap: ${bands.most_common_gap}`
    : null;

  // Band strip (#1023 v2 §3/§10c) — one small stacked mini-bar per live week,
  // Analytics-only, separate from the current-week bucket rows above.
  const bandSeries = useMemo(() => deriveRecoveryBandSeries(comparison), [comparison]);

  // Even a baseline-empty week still has something to say if it carries
  // recovery-only work: the merged clause line names it, with no hero above it.
  const showBandsRegion = selectedWeek && (totalBaselineExercises > 0 || addedCount > 0);

  return (
    <Card style={styles.card}>
      <Text style={styles.identityCaption}>{identityCaption}</Text>
      {/* The optional reason (#872), on the active and the completed block
          alike — this card is the same evidence surface for both. Rendered
          only when the block carries one, so a block started without an
          explanation (including every block written before the field existed)
          shows nothing rather than an empty placeholder. It is context for
          reading the comparison, never an input to it: no metric, week status,
          or summary line below reads this value. */}
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
      ) : reasonEditable ? (
        /* Tapping the caption opens the editor in place. A block with no reason
           still offers the affordance — that is the only way to ADD one to a
           completed block — but it reads as an invitation, not as a field
           claiming a value it does not have. */
        <Pressable
          onPress={openReasonEditor}
          disabled={reasonDisabled}
          accessibilityRole="button"
          accessibilityLabel={block.reason
            ? `Edit reason for this recovery block: ${block.reason}`
            : 'Add a reason for this recovery block'}
          accessibilityState={{ disabled: reasonDisabled }}
        >
          <Text
            style={[styles.reasonCaption, reasonDisabled && styles.reasonCaptionDisabled]}
            numberOfLines={2}
          >
            {block.reason ? `Reason: ${block.reason}` : 'Add a reason'}
          </Text>
        </Pressable>
      ) : block.reason ? (
        <Text style={styles.reasonCaption} numberOfLines={2}>
          Reason: {block.reason}
        </Text>
      ) : null}

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
                  <RecoveryHero weekLabel={weekLabel} atOrAbove={bands.buckets.at_or_above || 0} trained={trained} />
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
            <View style={styles.chipRow}>
              <Text style={styles.chipRowLabel}>Week</Text>
              {weekResults.map((w) => {
                const selected = selectedWeek && w.week_id === selectedWeek.week_id;
                return (
                  <Pressable
                    key={w.week_id}
                    onPress={() => setSelectedWeekId(w.week_id)}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Week ${w.week_number}${w.completed_at ? ', completed' : ''}`}
                  >
                    <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                      {w.week_number}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

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
                  {/* #1029 acceptance criterion 2: the removed met-count
                      headline survives ONLY here, worded "X of Y at or above
                      baseline". */}
                  {totalBaselineExercises > 0 && (
                    <Text style={styles.detailsHeaderCount}>
                      {`${metCount} of ${totalBaselineExercises} at or above baseline`}
                    </Text>
                  )}
                  {!detailsExpanded && (
                    <Text style={styles.detailsHeaderCount}>
                      {`${totalRows} exercise${totalRows === 1 ? '' : 's'}`}
                    </Text>
                  )}
                </View>
                <MaterialIcons
                  name={detailsExpanded ? 'expand-less' : 'expand-more'}
                  size={18}
                  color={kua ? kua.onSurfaceVariant : colors.textMuted}
                  accessible={false}
                />
              </Pressable>

              {detailsExpanded && (
                <View style={styles.detailsBody}>
                  {/* The removed first-screenful clause line, folded in here
                      (#1029 §10c). */}
                  {!!summaryLine && <Text style={styles.summaryLine}>{summaryLine}</Text>}
                  {/* Roster, not-trained and most-common-gap facts moved here
                      from the overview (#1209). */}
                  {!!trainedDenominatorCaption && <Text style={styles.summaryLine}>{trainedDenominatorCaption}</Text>}
                  {!!sparseSentence && <Text testID="recovery-bands-sparse" style={styles.summaryLine}>{sparseSentence}</Text>}
                  {!!mostCommonGapLine && <Text style={styles.summaryLine}>{mostCommonGapLine}</Text>}
                  <MetricLegend rows={weekRows} weekNumber={selectedWeek.week_number} />
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

      {bandSeries.length > 1 && <RecoveryWeeksStrip series={bandSeries} shownBands={hasBands && trained > 0 ? presentBandIds(bands.buckets) : []} />}

      {/* One persistent line, above the provenance stamp (#1023 v2 §8). */}
      {(comparison.status === RECOVERY_COMPARISON_STATUS.OK || comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY) && (
        <Text style={styles.nonMedicalText}>
          Training numbers only. Not a medical judgment — only you end a Recovery block.
        </Text>
      )}
      <Text style={styles.provenanceText}>{provenance}</Text>
    </Card>
  );
}
