import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HeroMetric } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { TYPOGRAPHY } from '../theme/typography';
import { GEOMETRY } from '../theme/spacing';
import { Chevron } from '../screens/home/HomeActionStrip';

// #1458: the one presentation unit for 1K Progress on Home and Analytics. Analytics'
// look is the authority (heading → 36px total → 1,000-lb bar → Big 3 values); Analytics
// layers its graph, explainer and plate calculator on top via `belowTitle`/`children`.
// Presentation only: callers pass display-space numbers and own all derivation.
export function OneKProgressSummary({
  total,
  target,
  unit,
  lifts,
  totalColor,
  emptyText = null,
  onTitlePress = null,
  titleHint,
  titleAccessory = null,
  belowTitle = null,
  children = null,
  testIDPrefix,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createOneKSummaryStyles(colors, kua), [colors, kua]);
  const id = suffix => (testIDPrefix ? `${testIDPrefix}-${suffix}` : undefined);

  const title = <Text style={styles.oneKLabel} numberOfLines={1}>1K Progress</Text>;

  return (
    <View style={styles.oneKSummary}>
      <View style={styles.oneKLabelRow}>
        {onTitlePress ? (
          <Pressable
            testID={id('link')}
            onPress={onTitlePress}
            style={styles.oneKTitleLink}
            hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
            accessibilityRole="button"
            accessibilityLabel="1K Progress"
            accessibilityHint={titleHint}
          >
            {title}
            <View style={styles.oneKChevron}>
              <Chevron color={kua ? kua.onSurfaceVariant : colors.textMuted} />
            </View>
          </Pressable>
        ) : title}
        {titleAccessory}
      </View>
      {belowTitle}
      {total != null ? (
        <>
          <Text testID={id('total')} style={[styles.oneKValue, totalColor ? { color: totalColor } : null]}>
            {total.toFixed(0)}<Text style={styles.oneKUnit}> {unit}</Text>
          </Text>
          <View testID={id('progress-track')} style={styles.oneKProgressBarContainer}>
            <View testID={id('progress-fill')} style={[styles.oneKProgressBar, { width: `${Math.min(100, (total / target) * 100)}%` }]} />
          </View>
        </>
      ) : emptyText ? (
        // The total needs one complete cycle of all three lifts (lib/data/oneK.js).
        <Text testID={id('setup')} style={styles.oneKEmptyText}>{emptyText}</Text>
      ) : null}
      {lifts.length > 0 ? (
        <View testID={id('big3')} style={styles.oneKBreakdown}>
          {lifts.map(item => {
            const hasValue = item.value != null;
            const body = (
              <>
                <Text testID={id(`lift-${item.key}-value`)} style={styles.oneKItemValue}>
                  {hasValue ? item.value.toFixed(0) : 'N/A'}
                </Text>
                <Text style={styles.oneKItemLabel}>{item.label}</Text>
              </>
            );
            return item.onPress && hasValue ? (
              <Pressable
                key={item.key}
                testID={id(`lift-${item.key}`)}
                style={[styles.oneKItem, styles.oneKItemTappable]}
                onPress={item.onPress}
                accessibilityRole="button"
                accessibilityLabel={item.accessibilityLabel}
              >
                {body}
              </Pressable>
            ) : (
              <View
                key={item.key}
                testID={id(`lift-${item.key}`)}
                style={styles.oneKItem}
                accessible
                accessibilityLabel={hasValue ? `${item.label} ${item.value.toFixed(0)} ${unit}` : `${item.label} not available`}
              >
                {body}
              </View>
            );
          })}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export const createOneKSummaryStyles = (colors, kua = null) => StyleSheet.create({
  oneKSummary: {
    alignItems: 'center',
    alignSelf: 'stretch',
    // #1535: one 4dp rhythm from heading to values; the bar and breakdown add
    // their own 4dp so total -> bar and bar -> lifts read as 8dp groups.
    gap: 4,
  },
  // Card identity: a real heading (heading → metric → evidence), sized below
  // the hero value so it never competes with it.
  oneKLabel: {
    ...(kua ? TYPOGRAPHY['headline-sm'] : { fontSize: TYPOGRAPHY['headline-sm'].fontSize, fontWeight: '800' }),
    color: kua ? kua.onSurface : colors.text,
    flexShrink: 1,
  },
  oneKLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 4,
    maxWidth: '100%',
  },
  oneKTitleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    minHeight: 44,
    flexShrink: 1,
  },
  oneKChevron: {
    flexShrink: 0,
  },
  oneKValue: {
    // display exception per #1283 foundation
    ...(kua ? { ...TYPOGRAPHY['metric-display-mobile'], fontSize: 36, lineHeight: 40 } : { ...HeroMetric.hero }),
    color: kua ? kua.onSurface : colors.text,
  },
  // Literal leading space, not marginLeft — this Text is nested inside the
  // value Text, and native RN treats a nested Text as an inline attributed
  // run rather than a Yoga box, so marginLeft is not guaranteed to render
  // (#763 review).
  oneKUnit: {
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: TYPOGRAPHY['label-lg'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  oneKEmptyText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textAlign: 'center',
  },
  oneKProgressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: kua ? kua.surfaceBorder : colors.divider,
    borderRadius: GEOMETRY['radius-sm'],
    marginTop: 4,
    overflow: 'hidden',
  },
  oneKProgressBar: {
    height: '100%',
    backgroundColor: kua ? kua.primary : colors.accent,
    borderRadius: GEOMETRY['radius-sm'],
  },
  // Wraps rather than ellipsizing at large text sizes.
  oneKBreakdown: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  oneKItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 88,
    minHeight: 44,
  },
  // #577: visible tappable cue matching the set-row plate-calculator
  // affordance (UI.js's setWeightTappable).
  oneKItemTappable: {
    borderBottomWidth: 1,
    borderBottomColor: kua ? kua.onSurfaceVariant : colors.textMuted,
    borderStyle: 'dashed',
  },
  oneKItemValue: {
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: TYPOGRAPHY['label-lg'].fontSize, fontWeight: '700' }),
    color: kua ? kua.primary : colors.text,
  },
  oneKItemLabel: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
  },
});
