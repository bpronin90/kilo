import React from 'react';
import { Text, View } from 'react-native';
import { displayWeight, formatGoalWeightValue } from '../../lib/units';
import { formatTrendDeltaValue } from '../../lib/WeightScreenHelpers';
import { weightDirection, weightTrendTone } from '../../lib/data/derivedAnalytics';
import { ToneDelta } from '../../screens/weight/WeightScreenPanels';

// The split cells under the Bodyweight chart (Redesign v3, #1603): 7-day and
// 30-day averages with their goal-aware change, then (only with a verified
// active goal) the Goal mode / target / to-go and Target pace. Every value is
// an existing derivation passed in; nothing here calculates a metric. Styles come
// from the card's createStyles.

const MODES = { loss: 'Cutting', gain: 'Bulking', maintain: 'Maintaining' };

function Cell({ label, testID, divider, styles, children }) {
  return (
    <View testID={testID} style={[styles.cell, divider ? styles.cellDivider : null]}>
      <Text style={styles.weightStatLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.cellValueRow}>{children}</View>
    </View>
  );
}

// "188.0 lb ↓ -0.7": the average, then its change vs the prior window in the
// goal-aware tone. A missing average reads N/A; a missing prior shows no change.
function AvgCell({ label, value, prior, unit, goalDirection, styles, testID, divider }) {
  const direction = weightDirection(value, prior);
  const tone = weightTrendTone({ direction, goalDirection });
  const delta = formatTrendDeltaValue(value, prior, unit);
  return (
    <Cell label={label} testID={testID} divider={divider} styles={styles}>
      <Text style={styles.weightStatValue}>
        {value != null ? `${displayWeight(value, unit).toFixed(1)} ${unit}` : 'N/A'}
      </Text>
      {delta !== '-' ? <ToneDelta text={delta} direction={direction} tone={tone} testID={`${testID}-change`} /> : null}
    </Cell>
  );
}

// Target pace exactly as the Weight goal panel states it.
function paceText(info, unit) {
  if (!info || info.required_weekly_pace == null) return { value: '-', unit: null };
  if (info.direction === 'maintain') return { value: 'Maintain', unit: null };
  return { value: Math.abs(displayWeight(info.required_weekly_pace, unit)).toFixed(2), unit: `${unit}/wk` };
}

export function BodyweightStats({ trends, goalContext, currentWeight, unit, styles }) {
  const goalDirection = goalContext ? goalContext.direction : null;
  const t = trends || {};
  const toGo = goalContext && !goalContext.met && currentWeight != null
    ? Math.abs(displayWeight(currentWeight - goalContext.target, unit)).toFixed(1)
    : null;
  const pace = goalContext ? paceText(goalContext.info, unit) : null;
  return (
    <View testID="bodyweight-stats" style={styles.weightFooter}>
      <View style={styles.row}>
        <AvgCell label="7-day avg" value={t.avg7 ?? null} prior={t.priorAvg7 ?? null} unit={unit} goalDirection={goalDirection} styles={styles} testID="bodyweight-avg-7" />
        <AvgCell label="30-day avg" value={t.avg30 ?? null} prior={t.priorAvg30 ?? null} unit={unit} goalDirection={goalDirection} styles={styles} testID="bodyweight-avg-30" divider />
      </View>
      {goalContext ? (
        <View style={[styles.row, styles.rowDivider]}>
          <Cell label={`Goal · ${MODES[goalContext.direction] || 'Target'}`} testID="bodyweight-goal" styles={styles}>
            <Text style={styles.weightStatValue}>
              {formatGoalWeightValue(goalContext.target, unit)}
              <Text style={styles.cellUnit}>{` ${unit}`}</Text>
            </Text>
            {toGo != null ? <Text style={styles.cellNote}>{`${toGo} to go`}</Text> : null}
          </Cell>
          <Cell label="Target pace" testID="bodyweight-target-pace" styles={styles} divider>
            <Text style={styles.weightStatValue}>
              {pace.value}
              {pace.unit ? <Text style={styles.cellUnit}>{` ${pace.unit}`}</Text> : null}
            </Text>
          </Cell>
        </View>
      ) : null}
    </View>
  );
}
