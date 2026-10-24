import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { WEIGHT_DIRECTION, WEIGHT_TONE } from '../../lib/data/derivedAnalytics';
import { formatGoalWeightValue } from '../../lib/units';
import { createStyles } from './weightStyles';

function useWeightStyles() {
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  return useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
}

// Ink for production's goal-aware weightTrendTone (#1242), the same mapping
// as WeightTrendSection: pace anomalies keep their severity, under a gain/loss
// goal toward is success and away is error, and without one a bare rise/fall
// keeps its directional cue. Stable and missing data stay neutral (null).
export function weightToneColor(tone, colors, kua) {
  const success = kua ? kua.success : colors.success;
  const error = kua ? kua.errorText : colors.error;
  switch (tone) {
    case WEIGHT_TONE.SPIKE: return error;
    case WEIGHT_TONE.NOTABLE: return kua ? kua.warning : colors.cautionText;
    case WEIGHT_TONE.POSITIVE: return success;
    case WEIGHT_TONE.NEGATIVE: return error;
    case WEIGHT_TONE.GAINING: return error;
    case WEIGHT_TONE.LOSING: return success;
    default: return null;
  }
}

// "<arrow> <signed change>" in the tone's ink; the arrow is decorative, the
// sign carries direction, so color is never the only carrier.
export function ToneDelta({ text, direction, tone, testID }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useWeightStyles();
  const color = weightToneColor(tone, colors, kua) || (kua ? kua.onSurface : colors.text);
  const icon = direction === WEIGHT_DIRECTION.UP ? 'arrow-upward' : direction === WEIGHT_DIRECTION.DOWN ? 'arrow-downward' : null;
  return (
    <View style={styles.delta} testID={testID}>
      {icon ? <MaterialIcons name={icon} size={14} color={color} accessible={false} /> : null}
      <Text style={[styles.deltaText, { color }]}>{text}</Text>
    </View>
  );
}

// RootHeader context line: "43 weigh-ins · Cutting → 183 lb". Only verified
// values appear: the goal part needs a readable goal and its direction.
export function weightHeaderContext({ count, verified, goal, goalInfo, unit }) {
  if (!verified) return null;
  const parts = [`${count} ${count === 1 ? 'weigh-in' : 'weigh-ins'}`];
  if (goal && goal.target_weight != null) {
    const dir = goalInfo?.direction;
    const mode = dir === 'loss' ? 'Cutting' : dir === 'gain' ? 'Bulking' : dir === 'maintain' ? 'Maintaining' : 'Goal';
    parts.push(`${mode} → ${formatGoalWeightValue(goal.target_weight, unit)} ${unit}`);
  }
  return parts.join(' · ');
}

// One banner per failed source, each retrying only its own read (#737): a
// weigh-in read and a goal read fail independently, and merging them would
// offer a retry for something that never failed.
export function WeightErrorBanners({ entriesError, goalError, refreshEntries, refreshGoal }) {
  const styles = useWeightStyles();
  const banner = (message, onRetry) => (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.errorBannerRetry} accessibilityRole="button" accessibilityLabel="Retry">
        <Text style={styles.errorBannerRetryText} accessible={false}>Retry</Text>
      </Pressable>
    </View>
  );
  return (
    <>
      {entriesError ? banner('Could not load weight entries.', refreshEntries) : null}
      {goalError ? banner('Could not load your weight goal.', refreshGoal) : null}
    </>
  );
}

// First-paint placeholder for the derived sections (#737). Static bars, no
// motion; the shapes track Latest / Goal / History so nothing shifts when the
// real panels land.
export function WeightSkeleton() {
  const styles = useWeightStyles();
  return (
    <View
      testID="weight-skeleton"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your weight history"
      style={styles.stack}
    >
      <View style={styles.skeletonCard}>
        <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
        <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
      </View>
      <View style={styles.skeletonCard}>
        <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
        <View style={[styles.skeletonBar, styles.skeletonBarFull]} />
        <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
      </View>
    </View>
  );
}
