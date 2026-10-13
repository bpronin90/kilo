import React, { useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from '../UI';
import { InfoButton, InfoNote, useInfoExplainer } from '../InfoExplainer';
import { useTheme } from '../../theme/ThemeContext';
import { formatDate } from '../../lib/format';
import { RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS } from '../../lib/data/recoveryAnalytics';
import { STRENGTH_STATUS } from '../../lib/data/recoveryStrength';
import { SNAPSHOT_STATE } from '../../lib/data/recoverySnapshot';
import { useRecoveryStrengthSnapshot } from '../../hooks/entries/useRecoveryStrengthSnapshot';
import { WeekEvidence, WeekUnavailableNotice } from './RecoveryStateGroups';
import { createStyles } from './analyticsRecoveryStyles';
import { RecoveryRosterSummary } from './RecoveryVisuals';
import { RecoveryStrengthSummary } from './RecoveryStrengthSummary';
import { scoredLifts } from './RecoveryStrengthLadder';
import { RecoveryMovementGroupsPanel } from './RecoveryMovementGroupsPanel';
import { RecoveryStrengthWeeks } from './RecoveryStrengthWeeks';
import { NotRetestedDisclosure, NotScoredDisclosure, RecoveryDisclosure, notScoredEntries } from './RecoveryStrengthDisclosures';
import { PACE_INFO_LINES, PERCENT_INFO_LINES, hasVisiblePace } from './RecoveryInfoCopy';
import { deriveRecoveryBig3, recoveryBig3Rows } from '../../lib/data/recoveryBig3';
import { Big3Bars } from '../Big3Bars';

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
  // The effective 1K selection (resolveOneKSelections), the same one Home's
  // Recovery card reads its Big 3 from (#1351).
  oneKSelections = null,
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
  // #1358: each explainer is scoped to the one thing beside it — the total
  // recovery percentage or the per-lift pace (the bar scale's lives with the
  // week bars). Block metadata has none.
  const [percentShown, togglePercent] = useInfoExplainer();
  const [paceShown, togglePace] = useInfoExplainer();

  const snapshot = useRecoveryStrengthSnapshot({ block, weeks, notes, selectedWeekId, stale: stateStale, notesError });
  const { comparison, weekResults, selectedWeek, strength, total, scaleMax, bands, display } = snapshot;
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
  // Everything below is READ from the snapshot; this component derives nothing.
  const { detailRows: weekRows, bandById, detailSummary, trainedElsewhere } = snapshot;
  const strengthByKey = useMemo(() => new Map(scoredLifts(strength).map(l => [l.key, l])), [strength]);
  // #1351/#1353: an active block's Big 3 in the primary summary — the shared
  // lib/data/recoveryBig3 mapping Home reads, over this same snapshot, so the
  // two surfaces cannot disagree.
  const big3Rows = useMemo(
    () => (isActive && oneKSelections ? recoveryBig3Rows(deriveRecoveryBig3(snapshot, oneKSelections).big3) : []),
    [isActive, oneKSelections, snapshot]
  );

  const strengthOk = strength.status === STRENGTH_STATUS.OK;
  // A baseline-empty block has nothing to score. An unreadable/missing selected
  // week keeps its earlier history and its own gap row; only its aggregate is
  // withheld (#1305).
  const showStrength = comparison.status === RECOVERY_COMPARISON_STATUS.OK
    && !!weekLabel && (strengthOk || strength.status === STRENGTH_STATUS.PAIR_UNAVAILABLE);
  const showInfo = comparison.status === RECOVERY_COMPARISON_STATUS.OK || comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY;
  const showDetails = selectedWeek?.status === RECOVERY_WEEK_STATUS.OK && totalRows > 0;
  const scored = scoredLifts(strength).length;
  // The counted header names exactly what the body lists: the scored strength
  // rows and, when the week is readable, every raw evidence row.
  const liftsCaption = [
    scored > 0 ? `${scored} scored` : null,
    showDetails ? `${totalRows} in details` : null,
  ].filter(Boolean).join(' · ');
  // One per-lift list: strength % and the raw evidence on demand live in the same row.
  const hasLifts = showDetails;
  const hasNotRetested = showStrength && (strength.not_retested || []).length > 0;
  const hasNotScored = showStrength && notScoredEntries(strength).length > 0;
  // A null group panel (no groups) must not consume the first-row border token.
  const hasGroups = showStrength && strengthOk && !!snapshot.movementGroups
    && snapshot.movementGroups.breakdown.groups.length > 0;
  const hasDisclosures = hasLifts || hasGroups || hasNotRetested || hasNotScored;
  const showPercentInfo = display.state === SNAPSHOT_STATE.SCORE;
  const showPaceInfo = strengthOk && hasVisiblePace(strength);
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
                  {/* One child of the gapped block, so the hidden note adds no space. */}
                  <View>
                    <RecoveryStrengthSummary
                      display={display}
                      info={showPercentInfo ? (
                        <InfoButton testID="recovery-percent-info-toggle" expanded={percentShown} onPress={togglePercent} label="About total recovery" />
                      ) : null}
                    />
                    <InfoNote shown={percentShown && showPercentInfo} testID="recovery-percent-note" style={styles.infoNote}>
                      {PERCENT_INFO_LINES.map((line, i) => (
                        <Text key={`${i}:${line}`} testID={i === PERCENT_INFO_LINES.length - 1 ? 'recovery-non-medical-note' : undefined} style={styles.nonMedicalText}>{line}</Text>
                      ))}
                    </InfoNote>
                  </View>
                  {big3Rows.length > 0 ? (
                    <Big3Bars rows={big3Rows} idPrefix="recovery-big3-lift" testID="recovery-big3" />
                  ) : null}
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
                total={total}
                selectedWeekId={selectedWeek ? selectedWeek.week_id : null}
                onSelect={setSelectedWeekId}
              />
            )}
          </>
        )}

        {/* Block context (#1219): a quiet "label  value" list under one divider.
            Plain metadata, so no row carries an explainer (#1358). */}
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
              caption={liftsCaption}
              name="lifts"
              first={first()}
            >
              <View testID="recovery-exercise-details" style={styles.detailsBody}>
                <RecoveryRosterSummary summary={detailSummary} bands={bands} gap={bands.most_common_gap} />
                {/* Pace help only where a lift row prints a pace (#1358). */}
                {showPaceInfo ? (
                  <View>
                    <View testID="recovery-pace-info-row" style={styles.paceInfoRow}>
                      <Text style={[styles.contextLabel, styles.paceLabel]}>Pace</Text>
                      <InfoButton testID="recovery-pace-info-toggle" expanded={paceShown} onPress={togglePace} label="About pace" />
                    </View>
                    <InfoNote shown={paceShown} testID="recovery-pace-note" style={styles.infoNote}>
                      {PACE_INFO_LINES.map((line, i) => (
                        <Text key={`${i}:${line}`} style={styles.nonMedicalText}>{line}</Text>
                      ))}
                    </InfoNote>
                  </View>
                ) : null}
                <WeekEvidence
                  key={`${block.id}:${selectedWeek.week_id}`}
                  rows={weekRows} unit={unit} weekNumber={selectedWeek.week_number} elsewhere={trainedElsewhere}
                  bandById={bandById} strengthByKey={strengthByKey} scaleMax={scaleMax}
                />
              </View>
            </RecoveryDisclosure>
          ) : null}
          {hasGroups ? (
            <RecoveryMovementGroupsPanel snapshot={snapshot} first={first()} />
          ) : null}
          {hasNotRetested ? <NotRetestedDisclosure strength={strength} first={first()} /> : null}
          {hasNotScored ? <NotScoredDisclosure strength={strength} first={first()} /> : null}
        </Card>
      ) : null}
    </>
  );
}
