import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

// The exact control label, shared by the active card on Log and every
// completed-block row on Analytics. Exported so tests assert one string.
export const RECOVERY_INCLUSION_LABEL = 'Include recovery notes in normal analytics';
// On-demand explanation (#757). Exported for the same reason as the label: one
// string, asserted where it is disclosed.
//
// It describes what turning the switch ON does — the direction the user is
// about to move, since off is the default they are already in — names every
// surface that changes, and closes the two questions the old always-visible
// paragraph existed to answer: the notes are not taken out of Recovery, and
// they stay editable either way.
export const RECOVERY_INCLUSION_HELP =
  "On: this block’s linked recovery notes are included in normal analytics — classifications, overload signals, Kilo Max, 1K, and Home summaries. Off (the default) keeps them out. Either way the notes stay in Recovery Analytics and stay fully visible and editable.";

// Per-block inclusion control (#699 / #728). The switch reads and writes
// `include_in_normal_analytics` on THIS block only, so two blocks with
// different preferences never affect each other. Driven by the persisted
// record, never by optimistic local state.
//
// The explanation is disclosed on demand behind an info button (#757) rather
// than printed under every row. On Analytics one row exists per completed
// block, so the paragraph was repeated down the whole section and pushed the
// switches — the only thing on those rows anyone acts on — off a phone screen.
// Disclosure state is per mounted control and deliberately local: it is a
// reading choice, not a preference worth persisting.
export function RecoveryInclusionToggle({ block, disabled, busy, error, onToggle }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [helpShown, setHelpShown] = useState(false);
  const checked = block.include_in_normal_analytics === true;
  const blockTitle = block.baseline_note_title || 'Untitled Routine';
  return (
    <View style={styles.inclusionGroup}>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      ) : null}
      <View style={styles.inclusionRow}>
        <View style={styles.inclusionInfo}>
          <View style={styles.inclusionLabelRow}>
            <Text style={styles.inclusionLabel}>{RECOVERY_INCLUSION_LABEL}</Text>
            {/* Icon-only, so the accessible name carries the whole meaning and
                the block title disambiguates one row from the next on
                Analytics. The 44dp target is the Pressable's OWN box, not
                `hitSlop`: a touch slop is clipped at the parent's bounds, and
                this parent is one text line tall in the common case, so slop
                alone would have claimed a target the control never had. */}
            <Pressable
              testID={`recovery-inclusion-help-${block.id}`}
              onPress={() => setHelpShown(shown => !shown)}
              style={styles.inclusionHelpToggle}
              accessibilityRole="button"
              accessibilityState={{ expanded: helpShown }}
              accessibilityLabel={
                `${helpShown ? 'Hide' : 'Show'} what including recovery notes in normal analytics does: ${blockTitle}`
              }
            >
              <MaterialIcons name="info-outline" size={16} color={colors.textMuted} accessible={false} />
            </Pressable>
          </View>
          {helpShown ? (
            <Text
              testID={`recovery-inclusion-help-text-${block.id}`}
              style={styles.inclusionHelp}
              accessibilityLiveRegion="polite"
            >
              {RECOVERY_INCLUSION_HELP}
            </Text>
          ) : null}
        </View>
        <Switch
          testID={`recovery-inclusion-switch-${block.id}`}
          value={checked}
          disabled={disabled}
          onValueChange={(next) => onToggle(block, next)}
          accessibilityRole="switch"
          accessibilityLabel={`${RECOVERY_INCLUSION_LABEL}: ${blockTitle}`}
          accessibilityHint={`Recovery block baselined from ${blockTitle}.${busy ? ' Saving.' : ''}`}
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
  // Wraps rather than truncating: at 320dp with enlarged text the label is
  // several lines, and the icon must stay beside its last line, never be
  // squeezed out of the row.
  inclusionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    // No column gap: the info button's 44dp box already centers its 16dp glyph,
    // so it carries 14dp of its own separation from the label.
    rowGap: 2,
  },
  inclusionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  inclusionHelpToggle: {
    flexShrink: 0,
    // A real box, not a hit slop. Losing the paragraph under every row frees
    // far more vertical space than this reclaims, so the control row is still
    // markedly shorter than it was.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
