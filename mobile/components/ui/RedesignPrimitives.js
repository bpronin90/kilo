import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useKuaStyle, useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { Icon } from '../Icon';

// Redesign v3 presentation primitives (#1600; docs/design/app-redesign-v3).
// They add only what Card (ui/containers.js) lacks: a flat, unpadded panel
// whose rows are separated by full-width hairlines, the hairline row itself, an
// uppercase mono label, and an accessible disclosure. Card stays the padded
// content card. Rules: no panel inside a panel; 1px ordinary border, 2px
// primary border only on the screen's single `active` panel; text floor 12px
// (rows 16px, subtitles 13px). Colours come from the KUA court palette, with
// the legacy palette outside the KUA gate; there is no parallel palette.

const HAIRLINE = 1;
const ACTIVE_BORDER = 2;

// Flat panel: card background, large radius, clipped corners, no padding (rows
// and sections bring their own). `active` marks the one primary panel.
export function Panel({ children, active = false, dashed = false, style, testID, ...a11y }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View testID={testID} style={[styles.panel, active ? styles.panelActive : null, dashed ? styles.panelDashed : null, style]} {...a11y}>
      {children}
    </View>
  );
}

// Uppercase mono label (12px, tracked), e.g. "LATEST · 10-22-2026" or column heads.
export function MonoLabel({ children, tone = 'muted', style, numberOfLines, ...rest }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  return (
    <Text style={[typography['label-md'], styles.upper, tone === 'primary' ? styles.primaryText : styles.mutedText, style]} numberOfLines={numberOfLines} {...rest}>
      {children}
    </Text>
  );
}

// A panel section with padding; `divider` draws the hairline above it.
export function PanelSection({ children, divider = false, style, testID }) {
  const styles = useThemedStyles(createStyles);
  return <View testID={testID} style={[styles.section, divider ? styles.topHairline : null, style]}>{children}</View>;
}

// One row inside a Panel: optional leading icon, 16px title, optional 13px
// subtitle, optional trailing content, and a chevron when it navigates. Rows
// after the first pass `divider` for the separating hairline. Pressable rows
// are >=48dp buttons whose accessible name is the title (+ subtitle).
export function HairlineRow({ title, subtitle = null, icon = null, right = null, onPress = null, chevron = !!onPress, divider = false, accessibilityLabel, accessibilityHint, testID, style }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const body = (
    <>
      {icon ? <Icon name={icon} size={22} color={muted} /> : null}
      <View style={styles.rowText}>
        <Text style={[typography['body-lg'], styles.rowTitle]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={[typography['body-sm'], styles.mutedText]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
      {chevron ? <Icon name="chevron-right" size={22} color={muted} /> : null}
    </>
  );
  const rowStyle = [styles.row, divider ? styles.topHairline : null, style];
  if (!onPress) return <View testID={testID} style={rowStyle}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || (subtitle && typeof title === 'string' ? `${title}, ${subtitle}` : undefined)}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [...rowStyle, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

// Accessible disclosure: a >=48dp header button exposing `expanded`, with an
// expand/collapse chevron, and its children rendered below only when open.
// Controlled (`expanded` + `onToggle`) or uncontrolled (`defaultExpanded`).
export function Disclosure({ title, summary = null, children, expanded: expandedProp, defaultExpanded = false, onToggle, divider = false, dashed = false, testID, style, bodyStyle }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const [own, setOwn] = useState(defaultExpanded);
  const controlled = typeof expandedProp === 'boolean';
  const expanded = controlled ? expandedProp : own;
  const toggle = () => {
    const next = !expanded;
    if (!controlled) setOwn(next);
    if (onToggle) onToggle(next);
  };
  return (
    <View testID={testID} style={style}>
      <Pressable
        testID={testID ? `${testID}-toggle` : undefined}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        style={({ pressed }) => [styles.row, divider ? styles.topHairline : null, dashed ? styles.dashedRow : null, pressed ? styles.pressed : null]}
      >
        <View style={styles.rowText}>
          <Text style={[typography['body-lg'], styles.rowTitle]} numberOfLines={2}>{title}</Text>
          {summary ? <Text style={[typography['body-sm'], styles.mutedText]} numberOfLines={2}>{summary}</Text> : null}
        </View>
        <Icon name={expanded ? 'expand-less' : 'expand-more'} size={24} color={kua ? kua.onSurfaceVariant : colors.textMuted} />
      </Pressable>
      {expanded ? <View testID={testID ? `${testID}-body` : undefined} style={bodyStyle}>{children}</View> : null}
    </View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  panel: {
    backgroundColor: kua ? kua.surfaceCard : colors.card,
    borderRadius: GEOMETRY['radius-2xl'],
    borderWidth: HAIRLINE,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    overflow: 'hidden',
  },
  panelActive: {
    borderWidth: ACTIVE_BORDER,
    borderColor: kua ? kua.primary : colors.accent,
  },
  panelDashed: {
    borderStyle: 'dashed',
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  topHairline: {
    borderTopWidth: HAIRLINE,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  row: {
    minHeight: 48,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dashedRow: {
    borderStyle: 'dashed',
    borderWidth: HAIRLINE,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    borderRadius: GEOMETRY['radius-2xl'],
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    color: kua ? kua.onSurface : colors.text,
  },
  mutedText: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  primaryText: {
    color: kua ? kua.primary : colors.chipText,
  },
  upper: {
    textTransform: 'uppercase',
  },
  // Press feedback lives in the fill, never a whole-control opacity fade.
  pressed: {
    backgroundColor: kua ? kua.surfaceCardHeader : colors.chipBackground,
  },
});
