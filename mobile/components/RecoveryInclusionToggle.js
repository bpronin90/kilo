import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';

// The exact control label, shared by the active card on Log and every
// completed-block row on Analytics. Exported so tests assert one string.
export const RECOVERY_INCLUSION_LABEL = 'Include recovery notes in normal analytics';
const RECOVERY_INCLUSION_HELP =
  "Off by default. When off, this block’s linked notes stay out of classifications, overload signals, Kilo Max, 1K, and Home summaries — they remain visible, editable, and in Recovery Analytics.";

// Per-block inclusion control (#699 / #728). The switch reads and writes
// `include_in_normal_analytics` on THIS block only, so two blocks with
// different preferences never affect each other. Driven by the persisted
// record, never by optimistic local state.
export function RecoveryInclusionToggle({ block, disabled, busy, error, onToggle }) {
  const styles = useThemedStyles(createStyles);
  const checked = block.include_in_normal_analytics === true;
  return (
    <View style={styles.inclusionGroup}>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      ) : null}
      <View style={styles.inclusionRow}>
        <View style={styles.inclusionInfo}>
          <Text style={styles.inclusionLabel}>{RECOVERY_INCLUSION_LABEL}</Text>
          <Text style={styles.inclusionHelp}>{RECOVERY_INCLUSION_HELP}</Text>
        </View>
        <Switch
          testID={`recovery-inclusion-switch-${block.id}`}
          value={checked}
          disabled={disabled}
          onValueChange={(next) => onToggle(block, next)}
          accessibilityRole="switch"
          accessibilityLabel={RECOVERY_INCLUSION_LABEL}
          accessibilityHint={`Recovery block baselined from ${block.baseline_note_title || 'Untitled Routine'}.${busy ? ' Saving.' : ''}`}
          accessibilityState={{ checked, disabled: !!disabled }}
        />
      </View>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  inclusionGroup: {
    gap: 8,
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  inclusionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  inclusionInfo: {
    flex: 1,
    gap: 2,
  },
  inclusionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  inclusionHelp: {
    fontSize: 12,
    color: colors.textMuted,
  },
  errorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.cardErrorBg,
    borderWidth: 1,
    borderColor: colors.cardErrorBg,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textLight,
  },
});
