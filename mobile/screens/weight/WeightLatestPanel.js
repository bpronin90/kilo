import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { HairlineRow, MonoLabel, Panel } from '../../components/ui/RedesignPrimitives';
import { useTheme } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { formatDate } from '../../lib/format';
import { displayWeight, formatBodyweightValue } from '../../lib/units';
import { formatTrendDeltaValue } from '../../lib/WeightScreenHelpers';
import { weightDirection, weightTrendTone } from '../../lib/data/derivedAnalytics';
import { ToneDelta } from './WeightScreenPanels';
import { createStyles } from './weightStyles';

// One rolling-average cell: "7-DAY AVG / 188.0 ↓ -0.7". The change is the
// existing vs-prior-window delta (buildTrendSections' rows), toned by
// production's goal-aware weightTrendTone; a missing side shows no change.
function AvgCell({ label, value, prior, unit, goalDirection, styles, testID }) {
  const direction = weightDirection(value, prior);
  const tone = weightTrendTone({ direction, goalDirection });
  const delta = formatTrendDeltaValue(value, prior, unit);
  return (
    <View style={styles.avgItem} testID={testID}>
      <Text style={styles.avgLabel}>{label}</Text>
      <View style={styles.avgValueRow}>
        <Text style={styles.avgValue}>{value != null ? displayWeight(value, unit).toFixed(1) : '-'}</Text>
        {delta !== '-' ? <ToneDelta text={delta} direction={direction} tone={tone} /> : null}
      </View>
    </View>
  );
}

// The Latest panel (Redesign v3, #1601): latest weigh-in as the screen's 44px
// hero with its date and the change vs the previous weigh-in day, the 7- and
// 30-day rolling averages behind a hairline, and the Analytics handoff. Every
// number is an existing trendSummary value (#947: the change compares the two
// most recent local-date averages, like the former Today row); nothing here
// is a new calculation. The weight trend chart lives only in Analytics.
export function WeightLatestPanel({ trends, paceInfo, latestDate, goalDirection, unit, onNavigate }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
  const hasLatest = trends.currentWeight != null;
  const changeDirection = weightDirection(trends.recentDateWeight, trends.priorDateWeight);
  const changeTone = weightTrendTone({ direction: changeDirection, goalDirection, paceLevel: paceInfo?.level ?? null });
  const change = formatTrendDeltaValue(trends.recentDateWeight, trends.priorDateWeight, unit);

  return (
    <Panel testID="weight-latest-panel">
      <View style={styles.latestRow}>
        <View style={styles.latestMain}>
          <MonoLabel numberOfLines={1}>{hasLatest && latestDate ? `Latest · ${formatDate(latestDate)}` : 'Latest'}</MonoLabel>
          {hasLatest ? (
            <View style={styles.heroRow} accessible accessibilityLabel={`Latest weigh-in ${formatBodyweightValue(trends.currentWeight, unit)} ${unit}`}>
              <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>{formatBodyweightValue(trends.currentWeight, unit)}</Text>
              <Text style={styles.heroUnit}>{unit}</Text>
            </View>
          ) : (
            <Text style={styles.caption}>No weight entries yet.</Text>
          )}
          {hasLatest && change !== '-' ? (
            <View style={styles.deltaLine}>
              <ToneDelta text={change} direction={changeDirection} tone={changeTone} testID="weight-latest-change" />
              <Text style={styles.caption}>vs previous</Text>
            </View>
          ) : hasLatest ? (
            <Text style={styles.caption}>Weigh in on two different days to see this trend.</Text>
          ) : null}
        </View>
        <View style={styles.avgs}>
          <AvgCell label="7-day avg" value={trends.avg7} prior={trends.priorAvg7} unit={unit} goalDirection={goalDirection} styles={styles} testID="weight-avg-7" />
          <AvgCell label="30-day avg" value={trends.avg30} prior={trends.priorAvg30} unit={unit} goalDirection={goalDirection} styles={styles} testID="weight-avg-30" />
        </View>
      </View>
      <HairlineRow
        testID="weight-see-full-trends"
        title="Full trend in Analytics"
        icon="show-chart"
        divider
        onPress={() => onNavigate?.('Analytics', 'weight')}
        accessibilityLabel="Full trend in Analytics"
        accessibilityHint="Opens the weight section of the Analytics tab"
      />
    </Panel>
  );
}
