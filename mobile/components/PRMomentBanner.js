import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';
import { formatLiftWeightValue } from '../lib/units';
import { useWeightUnit } from '../lib/unitPreference';

// Non-modal PR-moment celebration (#577 Contract 3). Mounted at LogScreen's
// top level, outside the editor card branch, so Done switching read/edit
// mode cannot unmount it. Never claims modal authorization, never suppresses
// the fatigue check-in modal, and coexists with the rest-timer banner —
// each has fully independent close/state ownership.
export function PRMomentBanner({ moment, onDismiss }) {
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();
  if (!moment) return null;

  const weightLabel = moment.weight_value != null
    ? `${formatLiftWeightValue(moment.weight_value, unit)} ${unit} × ${moment.rep_count}`
    : null;

  return (
    <View style={styles.banner} accessibilityRole="summary">
      <Text style={styles.text}>
        New PR{weightLabel ? ` — ${weightLabel}` : ''}
      </Text>
      <Pressable
        onPress={onDismiss}
        hitSlop={8}
        style={styles.dismissBtn}
        accessibilityRole="button"
        accessibilityLabel="Dismiss PR celebration"
      >
        <Text style={styles.dismissText}>✕</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.successBackground ?? colors.panelBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: colors.success ?? colors.text,
  },
  dismissBtn: {
    minHeight: 32,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
  },
});
