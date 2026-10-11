import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from '../UI';
import { InfoButton, InfoNote, useInfoExplainer } from '../InfoExplainer';
import { useTheme } from '../../theme/ThemeContext';
import { formatDate } from '../../lib/format';
import { MAX_RECOVERY_REASON_LENGTH } from '../../lib/data/recoveryBlocks';
import {
  deriveRecoveryComparison,
  RECOVERY_COMPARISON_STATUS,
  RECOVERY_WEEK_STATUS,
} from '../../lib/data/recoveryAnalytics';
import { deriveRecoveryWeekBands } from '../../lib/data/recoveryReturnBands';
import { deriveRecoveryStrength, STRENGTH_STATUS } from '../../lib/data/recoveryStrength';
import { summarizeDetailRows, WeekEvidence, WeekUnavailableNotice } from './RecoveryStateGroups';
import { WeekPicker } from './RecoveryWeekPicker';
import { RebuildBaselineAction } from './RebuildBaseline';
import { MatchExerciseNamesAction } from './MatchExerciseNames';
import { TidyRecoveryNamesAction } from './TidyRecoveryNames';
import { deriveTrainedElsewhere } from './RecoveryWeekIndex';
import { createStyles } from './analyticsRecoveryStyles';
import { RecoveryRosterSummary } from './RecoveryVisuals';
import { RecoveryStrengthSummary } from './RecoveryStrengthSummary';
import { RecoveryStrengthLadder } from './RecoveryStrengthLadder';
import { RecoveryMovementGroupsPanel } from './RecoveryMovementGroupsPanel';
import { RecoveryStrengthWeeks, StrengthScaleNote, strengthScaleMax } from './RecoveryStrengthWeeks';

// A context row is announced ONCE: its visible label ("Started", "Dates",
// "Baseline") is hidden from assistive tech because the adjacent value's own
// accessible label already carries it ("Started 08-08-2026"); exposing both made
// a screen reader say the label twice.
const LABEL_HIDDEN = { accessibilityElementsHidden: true, importantForAccessibility: 'no' };

// Every piece of state below — selected week, disclosure — is a view onto ONE
// block, so the caller mounts this keyed by `block.id`. Reusing the instance
// across a history switch would carry the previous block's open disclosure and
// selected week onto a block that never had them.
export function BlockEvidence({
  block, weeks, notes, unit,
  // Stale/unverified state suppresses pace and trend-change conclusions (#1305).
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
  // v1 baseline rebuild (#1227): offered only when the block + routine qualify.
  onRebuildBaseline,
  // Name match (#1298): link renamed exercises to frozen v2 baseline rows.
  onMatchNames,
  // Tidy names (#1309): clean week headers and baseline names together.
  tidyNames = null,
  // Movement groups (#1306): { notesError, locked, onSet }; null hides the panel.
  groupEditing = null,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  // The labels share one column start so the values line up; on a very narrow
  // card or at large text that column would squeeze the date, so it relaxes to
  // each label's own width there.
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const labelStyle = (windowWidth < 300 || fontScale >= 1.6)
    ? [styles.contextLabel, { minWidth: 0 }]
    : styles.contextLabel;
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
  const [aboutShown, toggleAbout] = useInfoExplainer();

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
  // Bottom context line (#1219): dates (and the routine only when the summary
  // does not already name it). The summary names the selected week.
  const dateLabel = isActive ? 'Started' : 'Dates';
  const dateValue = isActive
    ? formatDate(block.started_at)
    : `${formatDate(block.started_at)} to ${formatDate(block.completed_at)}`;
  const trainedElsewhere = useMemo(() => deriveTrainedElsewhere(weekResults, selectedWeek, stateStale), [weekResults, selectedWeek, stateStale]);
  const weekRows = selectedWeek ? [...(selectedWeek.exercises || []), ...(selectedWeek.added || [])] : [];

  // Six-bucket bands now feed only the Exercise details summary (#1305): the
  // strength view below is the primary explanation.
  const bands = useMemo(() => deriveRecoveryWeekBands(selectedWeek), [selectedWeek]);

  // #1305: strength relative to the frozen best set, as of the selected week.
  const strength = useMemo(() => deriveRecoveryStrength({
    block, weeks, notes, selectedWeekId: selectedWeek ? selectedWeek.week_id : null, stale: stateStale,
  }), [block, weeks, notes, selectedWeek, stateStale]);
  const scaleMax = strengthScaleMax(strength);
  const strengthOk = strength.status === STRENGTH_STATUS.OK;
  // A baseline-empty block has nothing to score.
  // An unreadable/missing selected week keeps its earlier history and its own
  // gap row; only its aggregate is withheld (#1305).
  const showStrength = comparison.status === RECOVERY_COMPARISON_STATUS.OK
    && !!weekLabel && (strengthOk || strength.status === STRENGTH_STATUS.PAIR_UNAVAILABLE);
  // The summary names the anchor routine (#1219) whenever it shows a headline;
  // only then does the bottom line stop repeating it.
  const heroNamesRoutine = showStrength && strengthOk && strength.headline != null;
  const showInfo = comparison.status === RECOVERY_COMPARISON_STATUS.OK || comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY;
  const showReasonRow = !editingReason && (reasonEditable || !!block.reason);
  const reasonValue = block.reason || 'Add a reason';
  const tidyNode = tidyNames ? (
        <TidyRecoveryNamesAction
          key={block.id}
          block={block}
          weeks={weeks}
          notes={notes}
          locked={reasonLocked || stateStale}
          onTidy={tidyNames.tidyNames}
        />
      ) : null;
  return (
    <Card>
      {/* The section's only Recovery header is the outer SectionTitle (#1217);
          the card opens with the strength summary, and the routine + reason are quiet
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
              week can land on a summary, a missing/unreadable-note notice, or a
              zero-evidence notice — mutually exclusive outcomes of the same
              selectedWeek switch. Gating the live region on any one of them
              (e.g. the summary alone) drops the announcement entirely whenever
              the newly selected week resolves to a different branch. */}
          <View style={styles.weekStatusRegion} accessibilityLiveRegion="polite">
            {showStrength && (
              <View style={styles.summaryBlock}>
                <RecoveryStrengthSummary strength={strength} weekLabel={weekLabel} routineTitle={routineTitle} />
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

          {showStrength && (
            <>
              {strengthOk && <RecoveryStrengthWeeks strength={strength} scaleMax={scaleMax} />}
              {/* A legacy baseline still lists what was not retested (#1305). */}
              <RecoveryStrengthLadder strength={strength} scaleMax={scaleMax} unit={unit} />
              {strengthOk && <StrengthScaleNote scaleMax={scaleMax} />}
              {strengthOk && groupEditing && (
                <RecoveryMovementGroupsPanel
                  block={block} notes={notes} strength={strength} selectedWeek={selectedWeek}
                  routineTitle={routineTitle} groupEditing={groupEditing}
                />
              )}
            </>
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
              <RecoveryRosterSummary summary={summarizeDetailRows(weekRows)} bands={bands} gap={bands.most_common_gap} />

              {detailsExpanded && (
                <View style={styles.detailsBody}>
                  <WeekEvidence key={`${block.id}:${selectedWeek.week_id}`} rows={weekRows} unit={unit} weekNumber={selectedWeek.week_number} elsewhere={trainedElsewhere} />
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

      {/* Block context (#1219): a quiet two-row "label  value" list under one
          divider. Row 1 is the start date with the info button directly after
          it (the control sits beside the text it explains, not at the card
          edge) and the disclosure opens right under it; row 2 is the labelled,
          editable Reason. Every row is a real >=44dp target; nothing floats. */}
      <View testID="recovery-footer-row" style={styles.contextBlock}>
        {!heroNamesRoutine && (
          <View testID="recovery-context-routine" style={styles.contextRow}>
            <Text style={labelStyle} {...LABEL_HIDDEN}>Baseline</Text>
            <Text
              style={[styles.contextValue, styles.contextValueShrink]}
              numberOfLines={1}
              accessibilityLabel={`Baseline: ${routineTitle}`}
            >
              {routineTitle}
            </Text>
          </View>
        )}
        <View testID="recovery-context-date" style={[styles.contextRow, styles.contextRowWrap]}>
          <Text style={labelStyle} {...LABEL_HIDDEN}>{dateLabel}</Text>
          {/* #1245: the shared info icon is anchored beside the label it explains. */}
          {showInfo && (
            <InfoButton expanded={aboutShown} onPress={toggleAbout} label="About these numbers" />
          )}
          {/* A date is never ellipsized: at narrow widths or large text a
              completed range wraps to a second line instead. */}
          <View
            style={[styles.contextDates, styles.contextValueShrink]}
            accessible
            accessibilityLabel={`${dateLabel} ${dateValue}`}
          >
            {/* A completed range is two whole dates, so a narrow card wraps
                BETWEEN them ("08-08-2026 –" / "09-20-2026"), never mid-date. */}
            <Text style={[styles.contextValue, styles.contextDateText]}>{isActive ? dateValue : `${formatDate(block.started_at)} to`}</Text>
            {!isActive && <Text style={[styles.contextValue, styles.contextDateText]}>{formatDate(block.completed_at)}</Text>}
          </View>
        </View>
        <InfoNote shown={aboutShown} testID="recovery-about-note">
          <Text style={styles.nonMedicalText}>
            Training numbers only. Not a medical judgment. Only you end a Recovery block.
          </Text>
        </InfoNote>
        {showReasonRow && (reasonEditable ? (
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
              {reasonValue}
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
          <View
            testID="recovery-reason-row"
            style={[styles.contextRow, styles.reasonRow]}
            accessible
            accessibilityLabel={`Reason: ${block.reason}`}
          >
            <Text style={labelStyle}>Reason</Text>
            <Text style={[styles.contextValue, styles.contextValueShrink]} numberOfLines={2}>
              {block.reason}
            </Text>
          </View>
        ))}
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
      {onRebuildBaseline ? (
        <RebuildBaselineAction block={block} weeks={weeks} notes={notes} unit={unit} locked={reasonLocked} onRebuild={onRebuildBaseline} />
      ) : null}
      {onMatchNames ? (
        <MatchExerciseNamesAction block={block} weeks={weeks} notes={notes} locked={reasonLocked || stateStale} onMatch={onMatchNames} />
      ) : null}
      {tidyNode}
    </Card>
  );
}
