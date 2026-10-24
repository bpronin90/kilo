import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { TYPOGRAPHY, useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { establishingBaselineMessage } from '../../lib/data/exerciseProgress';

// Progressive Overload status filter (redesign v3, #1604). Presentation only:
// the counts are `analytics.exerciseProgress` verbatim (the object Home also
// renders); a chip only chooses which of the existing statuses the list shows.

export const OVERLOAD_FILTERS = Object.freeze([
  { key: 'all', label: 'All' },
  { key: 'progressing', label: 'Progressing' },
  { key: 'stalled', label: 'Steady' },
  { key: 'regressing', label: 'Regressing' },
]);

// Whether the chips (and so an active filter) exist at all. The summary is
// held back while loading, with no tracked exercises, and in the baseline
// state where every exercise is still on its first session (#1391) — the
// list must never stay filtered by a control that is not on screen.
export function overloadChipsVisible(analytics, isLoading) {
  const progress = analytics?.exerciseProgress;
  if (isLoading || !progress) return false;
  const hasTracked = progress.classified > 0
    || progress.newlyTracked > 0
    || (analytics?.signals?.length ?? 0) > 0
    || Object.keys(analytics?.nonWeightedMetrics || {}).length > 0;
  return hasTracked && !establishingBaselineMessage(progress);
}

export function overloadCounts(progress) {
  return {
    all: (progress?.classified ?? 0) + (progress?.newlyTracked ?? 0),
    progressing: progress?.progressing ?? 0,
    stalled: progress?.stalled ?? 0,
    regressing: progress?.regressing ?? 0,
  };
}

function useStatusColors() {
  const { colors, kuaPalette: kua } = useTheme();
  return {
    progressing: kua ? kua.success : colors.success,
    stalled: kua ? kua.warning : colors.caution,
    regressing: kua ? kua.errorText : colors.error,
  };
}

// Text equivalent of the stacked bar: the three counts, in words.
export function OverloadStatusBar({ counts }) {
  const { colors, kuaPalette: kua } = useTheme();
  const palette = useStatusColors();
  const styles = useMemo(() => createStyles(colors, kua, TYPOGRAPHY), [colors, kua]);
  const segments = ['progressing', 'stalled', 'regressing'].filter(key => counts[key] > 0);
  return (
    <View
      testID="po-progress-bar"
      style={styles.bar}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${counts.progressing} progressing, ${counts.stalled} steady, ${counts.regressing} regressing`}
    >
      {segments.map(key => (
        <View key={key} style={{ flex: counts[key], backgroundColor: palette[key] }} />
      ))}
    </View>
  );
}

export function OverloadFilterChips({ counts, value, onChange }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  return (
    <View testID="po-filter-chips" style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Filter exercises by progress">
      {OVERLOAD_FILTERS.map(({ key, label }) => {
        const selected = key === value;
        return (
          <Pressable
            key={key}
            testID={`po-filter-${key}`}
            onPress={() => onChange(key)}
            style={[styles.chip, selected ? styles.chipSelected : null]}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={`${label}, ${counts[key]}`}
          >
            <Text style={[styles.chipLabel, selected ? styles.chipTextSelected : null]} accessible={false}>{label}</Text>
            <View testID={`po-progress-${key}`} accessible={false}>
              <Text style={[styles.chipCount, selected ? styles.chipTextSelected : null]}>{counts[key]}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (colors, kua = null, typography = TYPOGRAPHY) => {
  const on = kua ? kua.onSurface : colors.text;
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  return StyleSheet.create({
    bar: {
      height: 8,
      flexDirection: 'row',
      gap: 2,
      overflow: 'hidden',
      borderRadius: GEOMETRY['radius-sm'],
      backgroundColor: border,
    },
    // Wraps rather than scrolling sideways, so every status stays reachable
    // and no chip is clipped at large text sizes.
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 6,
      paddingHorizontal: 14,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: border,
    },
    chipSelected: {
      backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
      borderColor: kua ? kua.primaryContainerBorder ?? kua.primary : colors.accent,
    },
    chipLabel: {
      ...typography['label-lg'],
      color: muted,
    },
    chipCount: {
      ...typography['label-lg'],
      color: on,
    },
    chipTextSelected: {
      color: kua ? kua.primaryOnContainer ?? kua.primary : colors.chipAccentText,
    },
  });
};
