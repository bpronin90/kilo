import React, { useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from '../UI';
import { InfoButton, InfoNote, useInfoExplainer } from '../InfoExplainer';
import { useTheme } from '../../theme/ThemeContext';
import { formatDate } from '../../lib/format';
import {
  deriveRecoveryComparison,
  RECOVERY_COMPARISON_STATUS,
  RECOVERY_WEEK_STATUS,
} from '../../lib/data/recoveryAnalytics';
import { deriveRecoveryWeekBands } from '../../lib/data/recoveryReturnBands';
import { deriveRecoveryStrength, STRENGTH_STATUS } from '../../lib/data/recoveryStrength';
import { summarizeDetailRows, WeekEvidence, WeekUnavailableNotice } from './RecoveryStateGroups';
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
  // Selected week (#1307): controlled by the section so history rows can focus a
  // week; uncontrolled (own state) when no `onSelectWeek` is given. The strength
  // week rows are the only selector.
  selectedWeekId: controlledWeekId = null,
  onSelectWeek = null,
  // Failed notes read (#1306): saved group choices are then unavailable.
  notesError = null,
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
  const [localWeekId, setLocalWeekId] = useState(null);
  const selectedWeekId = onSelectWeek ? controlledWeekId : localWeekId;
  const setSelectedWeekId = onSelectWeek || setLocalWeekId;
  // Details start collapsed (#758). The question this surface answers — how
  // close am I to my normal training — is answered by the summary above; the
  // per-exercise diagnostic panel is the follow-up, not the opening statement.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  // The non-medical note sits behind an info button in the footer row (#1219,
  // owner-directed change of the earlier "one persistent line", #1023 v2 §8).
  const [aboutShown, toggleAbout] = useInfoExplainer();

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

          {weekResults.length > 0 && (
            <RecoveryStrengthWeeks
              weekResults={weekResults}
              strength={strength}
              scaleMax={scaleMax}
              selectedWeekId={selectedWeek ? selectedWeek.week_id : null}
              onSelect={setSelectedWeekId}
            />
          )}

          {showStrength && (
            <>
              {/* A legacy baseline still lists what was not retested (#1305). */}
              <RecoveryStrengthLadder strength={strength} scaleMax={scaleMax} unit={unit} />
              {strengthOk && <StrengthScaleNote scaleMax={scaleMax} />}
              {strengthOk && (
                <RecoveryMovementGroupsPanel
                  block={block} notes={notes} strength={strength} selectedWeek={selectedWeek} notesError={notesError}
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
        {/* Quiet read-only context (#1307): editing lives in Manage block only. */}
        {block.reason ? (
          <View
            testID="recovery-reason-context"
            style={[styles.contextRow, styles.reasonRow]}
            accessible
            accessibilityLabel={`Reason: ${block.reason}`}
          >
            <Text style={labelStyle}>Reason</Text>
            <Text style={[styles.contextValue, styles.contextValueShrink]} numberOfLines={2}>
              {block.reason}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}
