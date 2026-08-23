// Analytics overview block (#821). The tab's first section: one row per
// permanent signal, each stating where you are, what changed and over what
// window, and jumping to the section that itemises it.
//
// It computes nothing. Every value arrives from deriveOverviewRows, which in
// turn only reads series the tab already plots — so a number here and the same
// number in its own section cannot drift apart.
//
// This is also the destination for the `overview` navigation id, which Home's
// "Full history and insights" control requests. That id has always resolved to
// scroll offset 0; putting this block at the top is what finally makes offset 0
// mean "an overview" rather than "whatever section happens to be first".

import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ArtisanalPanel } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';

function formatValue(row) {
  if (row.value == null) return null;
  return row.decimals ? row.value.toFixed(row.decimals) : String(row.value);
}

function formatDelta(row) {
  if (row.delta == null || row.delta === 0) return null;
  const magnitude = row.decimals ? Math.abs(row.delta).toFixed(row.decimals) : String(Math.abs(row.delta));
  return { up: row.delta > 0, text: `${row.delta > 0 ? '▲' : '▼'} ${magnitude}` };
}

function OverviewRow({ row, unit, onPress }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const value = formatValue(row);
  const delta = formatDelta(row);
  const interactive = !!row.section && !!onPress && !row.unavailable;

  // The four "no number" conditions are deliberately distinct. A failed read
  // must never render as an empty state: "—, Unavailable" and "—, log something"
  // are different claims, and #737 exists because the tab used to make the
  // second one when the first was true. `paused` (#871) is its own condition
  // for the same reason: a frozen baseline count during active Recovery must
  // read as paused history, never as a fresh empty/loaded value.
  const caption = row.unavailable
    ? 'Unavailable — could not load'
    : row.paused
      ? (row.pausedCaption || 'Paused')
      : value == null
        ? row.emptyCaption
        : null;

  const accessibilityLabel = [
    row.label,
    row.unavailable
      ? 'unavailable, could not be loaded'
      : row.paused
        ? `${value != null ? `${value}${row.showUnit ? ` ${unit}` : ''}${row.valueSuffix ? ` ${row.valueSuffix}` : ''}, ` : ''}${row.pausedCaption || 'paused'}`
        : value == null
          ? (row.emptyCaption || 'no data yet')
          : `${value}${row.showUnit ? ` ${unit}` : ''}${row.valueSuffix ? ` ${row.valueSuffix}` : ''}`,
    delta && row.deltaCaption
      ? `${delta.up ? 'up' : 'down'} ${delta.text.replace(/[▲▼]\s*/, '')}${row.showUnit ? ` ${unit}` : ''}, ${row.deltaCaption}`
      : null,
  ].filter(Boolean).join(', ');

  const body = (
    <>
      <View style={styles.rowTop}>
        <Text style={styles.rowLabel} numberOfLines={1}>{row.label}</Text>
        <View style={styles.rowValueGroup}>
          {value == null ? (
            <Text style={styles.rowValueEmpty}>—</Text>
          ) : (
            // Paused rows (#871) keep their real value on screen — it is still
            // the true frozen count — but muted like the empty-value tone, so a
            // baseline count that has stopped accumulating never reads as a
            // fresh live one at a glance.
            <Text style={row.paused ? styles.rowValuePaused : styles.rowValue}>
              {value}
              {row.showUnit && <Text style={styles.rowValueUnit}> {unit}</Text>}
            </Text>
          )}
          {!!row.valueSuffix && <Text style={styles.rowValueSuffix}>{row.valueSuffix}</Text>}
          {interactive && (
            <MaterialIcons name="chevron-right" size={16} color={colors.textMuted} accessible={false} />
          )}
        </View>
      </View>

      {(delta || caption) && (
        <View style={styles.rowSub}>
          {!!delta && (
            <Text style={[styles.rowDelta, delta.up ? styles.rowDeltaUp : styles.rowDeltaDown]}>
              {delta.text}
              {row.showUnit ? ` ${unit}` : ''}
            </Text>
          )}
          {!!row.deltaCaption && !!delta && <Text style={styles.rowCaption}>{row.deltaCaption}</Text>}
          {!!caption && <Text style={styles.rowCaption}>{caption}</Text>}
        </View>
      )}
    </>
  );

  if (!interactive) {
    return (
      <View style={styles.row} accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={`overview-row-${row.key}`}
      style={styles.row}
      onPress={() => onPress(row.section)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens this section of the Analytics tab"
    >
      {body}
    </Pressable>
  );
}

export function AnalyticsOverviewCard({ rows = [], loading = false, asOf = null, onSelectSection }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();

  return (
    <View testID="analytics-overview" style={styles.container}>
      <ArtisanalPanel style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.headerLabel}>Overview</Text>
          {!!asOf && <Text style={styles.headerAsOf}>{asOf}</Text>}
        </View>

        {loading ? (
          <View style={styles.loading} accessible accessibilityLabel="Loading your overview">
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          rows.map(row => (
            <OverviewRow key={row.key} row={row} unit={unit} onPress={onSelectSection} />
          ))
        )}
      </ArtisanalPanel>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    gap: 16,
  },
  panel: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: colors.panelBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headerAsOf: {
    fontSize: 11,
    color: colors.textMuted,
    flexShrink: 1,
  },
  loading: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  // Full-width rows rather than a column grid: at a large font scale the value
  // wraps under its own label instead of colliding with a fixed-width cell.
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    minHeight: 44,
    justifyContent: 'center',
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  rowValueGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  rowValue: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  rowValueEmpty: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textMuted,
  },
  // Same weight/size as a normal value, muted like the empty tone (#871): a
  // paused baseline count is a real, true number — not absent — but must not
  // read with the same visual weight as a value that is live right now.
  rowValuePaused: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textMuted,
  },
  rowValueUnit: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  rowValueSuffix: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  rowSub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  rowDelta: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  rowDeltaUp: {
    color: colors.success,
  },
  rowDeltaDown: {
    color: colors.error,
  },
  rowCaption: {
    fontSize: 12,
    color: colors.textMuted,
    flexShrink: 1,
  },
});
