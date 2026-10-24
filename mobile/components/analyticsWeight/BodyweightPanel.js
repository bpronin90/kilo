import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { HairlineRow, MonoLabel, Panel } from '../ui/RedesignPrimitives';
import { formatPaceElapsed } from '../../lib/format';
import { paceDirection, WEIGHT_TONE, weightPaceBadgeText, weightTrendTone } from '../../lib/data/derivedAnalytics';
import { ToneDelta } from '../../screens/weight/WeightScreenPanels';

// The single Analytics Bodyweight panel (Redesign v3, #1603): the fixed LATEST
// WEIGH-IN metric top-left, the 7D AVG / 30D AVG selector top-right, the
// measurement date with its change vs the previous weigh-in, the existing pace
// badge, the chart and its caption (children), the averages/goal split
// (`stats`) and the Weight handoff. Selected chart points never reach this
// header: they are shown in the chart's own callout. Styles come from the
// card's createStyles.

function PaceBadge({ summary, styles }) {
  if (!summary.paceFlag) return null;
  const isSpike = weightTrendTone({ direction: paceDirection(summary.paceFlag), paceLevel: summary.paceLevel }) === WEIGHT_TONE.SPIKE;
  return (
    <View style={[styles.paceBadge, isSpike ? styles.paceSpike : styles.paceNotable]} testID="bodyweight-pace-badge">
      <Text style={[styles.paceText, !isSpike && styles.paceTextNotable]}>{weightPaceBadgeText(paceDirection(summary.paceFlag))}</Text>
      <Text style={[styles.pacePeriodText, !isSpike && styles.paceTextNotable]}>{formatPaceElapsed(summary.paceElapsedDays)}</Text>
    </View>
  );
}

function WindowToggle({ windows, windowKey, onWindow, styles }) {
  return (
    <View style={styles.toggle} accessibilityRole="radiogroup" accessibilityLabel="Rolling average window">
      {windows.map((w) => {
        const selected = w.key === windowKey;
        return (
          <Pressable
            key={w.key}
            testID={`weight-trends-window-${w.key}`}
            onPress={() => onWindow(w.key)}
            style={[styles.toggleOption, selected && styles.toggleOptionSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={w.label}
          >
            <Text style={[styles.toggleText, selected && styles.toggleTextSelected]} accessible={false}>{w.short}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function BodyweightPanel({
  summary, unit, latestDate, change, windows, windowKey, onWindow, stats, onNavigate, styles, children,
}) {
  const hasLatest = summary.latestWeightValue !== 'N/A';
  return (
    <Panel testID="bodyweight-panel" style={styles.weightCard}>
      <View style={styles.header}>
        <View style={styles.headerMain}>
          <MonoLabel numberOfLines={1}>Latest weigh-in</MonoLabel>
          <View style={styles.valueRow} accessible accessibilityLabel={hasLatest ? `Latest weigh-in ${summary.latestWeightValue} ${unit}` : 'No weigh-ins yet'}>
            <Text style={styles.weightValueLarge} numberOfLines={1} adjustsFontSizeToFit>{summary.latestWeightValue}</Text>
            {summary.showUnit ? <Text style={styles.unit}>{unit}</Text> : null}
          </View>
        </View>
        <WindowToggle windows={windows} windowKey={windowKey} onWindow={onWindow} styles={styles} />
      </View>
      {hasLatest ? (
        <View style={styles.metaRow} testID="bodyweight-latest-meta">
          {latestDate ? <Text style={styles.metaText}>{latestDate}</Text> : null}
          {change ? (
            <View style={styles.changeLine}>
              <ToneDelta text={change.text} direction={change.direction} tone={change.tone} testID="bodyweight-latest-change" />
              <Text style={styles.metaText}>vs previous weigh-in</Text>
            </View>
          ) : null}
          <PaceBadge summary={summary} styles={styles} />
        </View>
      ) : null}
      <View style={styles.chartSection}>{children}</View>
      {stats}
      <HairlineRow
        testID="bodyweight-log-weight"
        title="Log or manage weight"
        icon="Weight"
        divider
        onPress={() => onNavigate?.('Weight')}
        accessibilityLabel="Log or manage weight"
        accessibilityHint="Opens the Weight tab"
      />
    </Panel>
  );
}
