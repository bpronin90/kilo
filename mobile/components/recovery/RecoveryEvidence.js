import React, { useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from '../UI';
import { InfoButton, InfoNote, useInfoExplainer } from '../InfoExplainer';
import { useTheme } from '../../theme/ThemeContext';
import { formatDate } from '../../lib/format';
import { RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS } from '../../lib/data/recoveryAnalytics';
import { STRENGTH_STATUS } from '../../lib/data/recoveryStrength';
import { useRecoveryStrengthSnapshot } from '../../hooks/entries/useRecoveryStrengthSnapshot';
import { summarizeDetailRows, WeekEvidence, WeekUnavailableNotice } from './RecoveryStateGroups';
import { deriveTrainedElsewhere } from './RecoveryWeekIndex';
import { createStyles } from './analyticsRecoveryStyles';
import { RecoveryRosterSummary } from './RecoveryVisuals';
import { RecoveryStrengthSummary } from './RecoveryStrengthSummary';
import { RecoveryStrengthLadder, scoredLifts } from './RecoveryStrengthLadder';
import { RecoveryMovementGroupsPanel } from './RecoveryMovementGroupsPanel';
import { RecoveryStrengthWeeks } from './RecoveryStrengthWeeks';
import { NotRetestedDisclosure, NotScoredDisclosure, RecoveryDisclosure, notScoredEntries } from './RecoveryStrengthDisclosures';
import { numbersInfoLines } from './RecoveryNumbersInfo';

// A context row is announced ONCE: its visible label ("Started", "Dates",
// "Baseline") is hidden from assistive tech because the adjacent value's own
// accessible label already carries it ("Started 08-08-2026"); exposing both made
// a screen reader say the label twice.
const LABEL_HIDDEN = { accessibilityElementsHidden: true, importantForAccessibility: 'no' };

// Every piece of state below — selected week, disclosure — is a view onto ONE
// block, so the caller mounts this keyed by `block.id`. Reusing the instance
// across a history switch would carry the previous block's open disclosure and
// selected week onto a block that never had them.
//
// Structure (#1315), all under the section's one `Recovery` SectionTitle and
// read-only (maintenance lives in Log's Manage block): card 1 is the summary,
// the week-by-week trend and quiet block context; card 2 is the per-exercise
// disclosures (lifts, movement groups, not retested, not scored), every one
// collapsed by default with a counted header. The numbers come from the single
// Recovery snapshot and are never re-derived here.
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
  // The only way to change this block from Analytics: a quiet link to Log.
  onManageInLog = null,
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
  // The non-medical note and every relocated sentence sit behind one info button.
  const [aboutShown, toggleAbout] = useInfoExplainer();

  const snapshot = useRecoveryStrengthSnapshot({ block, weeks, notes, selectedWeekId, stale: stateStale, notesError });
  const { comparison, weekResults, selectedWeek, strength, scaleMax, bands, display } = snapshot;
  const isActive = !block.completed_at;
  const routineTitle = block.baseline_note_title || 'Untitled Routine';

  const totalBaselineExercises = selectedWeek ? (selectedWeek.exercises || []).length : 0;
  const addedCount = selectedWeek ? (selectedWeek.added || []).length : 0;
  const totalRows = totalBaselineExercises + addedCount;
  const weekLabel = selectedWeek ? `Week ${selectedWeek.week_number}` : null;
  const dateLabel = isActive ? 'Started' : 'Dates';
  const dateValue = isActive
    ? formatDate(block.started_at)
    : `${formatDate(block.started_at)} to ${formatDate(block.completed_at)}`;
  const trainedElsewhere = useMemo(() => deriveTrainedElsewhere(weekResults, selectedWeek, stateStale), [weekResults, selectedWeek, stateStale]);
  const weekRows = selectedWeek ? [...(selectedWeek.exercises || []), ...(selectedWeek.added || [])] : [];

  const strengthOk = strength.status === STRENGTH_STATUS.OK;
  // A baseline-empty block has nothing to score. An unreadable/missing selected
  // week keeps its earlier history and its own gap row; only its aggregate is
  // withheld (#1305).
  const showStrength = comparison.status === RECOVERY_COMPARISON_STATUS.OK
    && !!weekLabel && (strengthOk || strength.status === STRENGTH_STATUS.PAIR_UNAVAILABLE);
  const showInfo = comparison.status === RECOVERY_COMPARISON_STATUS.OK || comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY;
  const showDetails = selectedWeek?.status === RECOVERY_WEEK_STATUS.OK && totalRows > 0;
  const scored = scoredLifts(strength).length;
  const liftsCount = scored > 0 ? scored : totalRows;
  const hasLifts = (showStrength && scored > 0) || showDetails;
  const hasNotRetested = showStrength && (strength.not_retested || []).length > 0;
  const hasNotScored = showStrength && notScoredEntries(strength).length > 0;
  const hasDisclosures = hasLifts || (showStrength && strengthOk) || hasNotRetested || hasNotScored;
  const infoLines = useMemo(() => numbersInfoLines({ snapshot, routineTitle }), [snapshot, routineTitle]);
  // The first disclosure has no top rule (the card edge is its boundary).
  let firstDisc = true;
  const first = () => { const f = firstDisc; firstDisc = false; return f; };

  return (
    <>
      <Card>
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

        {showInfo && (
          <>
            {weekResults.length === 0 && (
              <Text style={styles.unavailablePanelText}>Baseline captured. No week logged yet.</Text>
            )}

            {/* A single, never-unmounted live region (#794 review): selecting a
                week can land on a summary, a missing/unreadable-note notice, or a
                zero-evidence notice — mutually exclusive outcomes of the same
                selectedWeek switch. */}
            <View style={styles.weekStatusRegion} accessibilityLiveRegion="polite">
              {showStrength && (
                <View style={styles.summaryBlock}>
                  <RecoveryStrengthSummary display={display} />
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
          </>
        )}

        {/* Block context (#1219): a quiet two-row "label  value" list under one
            divider. The info button sits beside the date it accompanies and its
            note opens right under it; the other rows are text, not targets. */}
        <View testID="recovery-footer-row" style={styles.contextBlock}>
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
              <Text style={[styles.contextValue, styles.contextDateText]}>{isActive ? dateValue : `${formatDate(block.started_at)} to`}</Text>
              {!isActive && <Text style={[styles.contextValue, styles.contextDateText]}>{formatDate(block.completed_at)}</Text>}
            </View>
          </View>
          <InfoNote shown={aboutShown} testID="recovery-about-note">
            {infoLines.map((line, i) => (
              <Text key={`${i}:${line}`} testID={i === infoLines.length - 1 ? 'recovery-non-medical-note' : undefined} style={styles.nonMedicalText}>{line}</Text>
            ))}
          </InfoNote>
          {/* Quiet read-only context (#1307): editing lives in Log's Manage block. */}
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
          {onManageInLog ? (
            <Pressable
              testID="recovery-manage-in-log"
              onPress={onManageInLog}
              style={[styles.contextRow, styles.manageLinkRow]}
              accessibilityRole="button"
              accessibilityLabel={`Manage this recovery block in Log: ${routineTitle}`}
            >
              <Text style={styles.manageLinkText}>Manage in Log</Text>
              <MaterialIcons name="chevron-right" size={18} color={kua ? kua.primary : colors.accentText} accessible={false} />
            </Pressable>
          ) : null}
        </View>
      </Card>

      {showInfo && hasDisclosures ? (
        <Card key={`${block.id}:${selectedWeek ? selectedWeek.week_id : 'none'}`}>
          {hasLifts ? (
            <RecoveryDisclosure
              testID="recovery-strength-lifts"
              title="Lifts"
              caption={`${liftsCount} ${liftsCount === 1 ? 'lift' : 'lifts'}`}
              name="lifts"
              first={first()}
            >
              {scored > 0 ? <RecoveryStrengthLadder strength={strength} scaleMax={scaleMax} unit={unit} /> : null}
              {showDetails ? (
                <View testID="recovery-exercise-details" style={styles.detailsBody}>
                  <RecoveryRosterSummary summary={summarizeDetailRows(weekRows)} bands={bands} gap={bands.most_common_gap} />
                  <WeekEvidence key={`${block.id}:${selectedWeek.week_id}`} rows={weekRows} unit={unit} weekNumber={selectedWeek.week_number} elsewhere={trainedElsewhere} />
                </View>
              ) : null}
            </RecoveryDisclosure>
          ) : null}
          {showStrength && strengthOk ? (
            <RecoveryMovementGroupsPanel snapshot={snapshot} first={first()} />
          ) : null}
          {hasNotRetested ? <NotRetestedDisclosure strength={strength} first={first()} /> : null}
          {hasNotScored ? <NotScoredDisclosure strength={strength} first={first()} /> : null}
        </Card>
      ) : null}
    </>
  );
}
