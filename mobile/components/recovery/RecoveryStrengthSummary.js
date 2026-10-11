// Primary selected-week summary for the strength view (#1305): one headline,
// the average % of baseline strength over the ONE consistent cohort, with its
// coverage stated beside it. When no aggregate can be honest (legacy baseline,
// empty cohort, unreadable week) the reason is shown instead of a number.

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { STRENGTH_STATUS, displayPercent } from '../../lib/data/recoveryStrength';
import { routineLabel } from './RecoveryVisuals';
import { createStrengthStyles } from './recoveryStrengthStyles';

export const STRENGTH_EMPTY_COPY = Object.freeze({
  pair_unavailable: 'Baseline best-set data unavailable. Rebuild the baseline in Manage block to score strength.',
  no_readable_weeks: 'No readable week to score yet.',
  no_common_lifts: 'No lift has a strength score in every readable week yet, so there is no average.',
  selected_unreadable: 'This week’s note can’t be read, so it has no score.',
});

const _lifts = (n) => `${n} ${n === 1 ? 'lift' : 'lifts'}`;

export function RecoveryStrengthSummary({ strength, weekLabel, routineTitle }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const { full, visible } = routineLabel(routineTitle);

  if (strength.status === STRENGTH_STATUS.PAIR_UNAVAILABLE) {
    return (
      <View testID="recovery-strength-summary" style={styles.summary} accessible accessibilityLabel={STRENGTH_EMPTY_COPY.pair_unavailable}>
        <Text style={styles.caption}>{STRENGTH_EMPTY_COPY.pair_unavailable}</Text>
      </View>
    );
  }
  if (strength.status !== STRENGTH_STATUS.OK) return null;

  const cohortSize = strength.cohort.length;
  const coverage = `Average of ${_lifts(cohortSize)} scored every week · ${cohortSize} of ${strength.roster_size} baseline lifts`;
  const notes = [];
  if (strength.excluded_weeks.length > 0) {
    notes.push(`Week ${strength.excluded_weeks.join(', ')} couldn’t be read and is left out of the comparison.`);
  }
  if (strength.cohort_dropped.length > 0) {
    notes.push(`Left the average this week (not scored every week): ${strength.cohort_dropped.join(', ')}.`);
  }

  const cohortLine = cohortSize > 0 ? `In the average: ${strength.cohort.map(c => c.name).join(', ')}` : null;
  if (strength.headline == null) {
    const message = STRENGTH_EMPTY_COPY[strength.empty_reason] || STRENGTH_EMPTY_COPY.no_common_lifts;
    // Earlier weeks may still plot an average (selected week unreadable): their
    // population stays disclosed even with no number for this week.
    const lines = [message, ...(cohortLine ? [coverage, cohortLine] : []), ...notes];
    return (
      <View testID="recovery-strength-summary" style={styles.summary} accessible accessibilityLabel={`${weekLabel}: ${lines.join(' ')}`}>
        <Text style={styles.week}>{weekLabel}</Text>
        {lines.map(n => <Text key={n} testID={n === cohortLine ? 'recovery-strength-cohort' : undefined} style={styles.caption}>{n}</Text>)}
      </View>
    );
  }

  const pct = displayPercent(strength.headline);
  const label = `${weekLabel}: ${pct}% of ${full} baseline strength. ${coverage}. ${cohortLine}. ${notes.join(' ')}`.trim();
  return (
    <View testID="recovery-strength-summary" style={styles.summary} accessible accessibilityLabel={label}>
      <Text style={styles.week}>{weekLabel}</Text>
      <Text style={styles.number}>{`${pct}%`}</Text>
      <Text style={styles.numberLabel} numberOfLines={1} ellipsizeMode="tail">{`of ${visible} baseline strength`}</Text>
      <Text style={styles.caption}>{coverage}</Text>
      <Text testID="recovery-strength-cohort" style={styles.caption}>{cohortLine}</Text>
      {notes.map(n => <Text key={n} style={styles.caption}>{n}</Text>)}
    </View>
  );
}
