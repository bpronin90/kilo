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

import { TYPOGRAPHY } from '../theme/typography';
import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ArtisanalPanel } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { isGoodWeightTone } from '../lib/data/derivedAnalytics';

function formatValue(row) {
  if (row.value == null) return null;
  return row.decimals ? row.value.toFixed(row.decimals) : String(row.value);
}

function formatDelta(row) {
  if (row.delta == null || row.delta === 0) return null;
  const magnitude = row.decimals ? Math.abs(row.delta).toFixed(row.decimals) : String(Math.abs(row.delta));
  return { up: row.delta > 0, text: `${row.delta > 0 ? '▲' : '▼'} ${magnitude}` };
}

// A row that carries the shared goal-aware `deltaTone` (#1242, weight) is
// colored by it; every other row keeps the plain up-is-good reading.
function deltaStyleFor(row, delta, styles) {
  if (row.deltaTone !== undefined) {
    if (!row.deltaTone) return null;
    return isGoodWeightTone(row.deltaTone) ? styles.rowDeltaUp : styles.rowDeltaDown;
  }
  return delta.up ? styles.rowDeltaUp : styles.rowDeltaDown;
}

function OverviewRow({ row, unit, onPress }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);

  if (row.note) {
    return (
      <View style={styles.row} accessible accessibilityLabel={row.note}>
        <Text style={[styles.rowCaption, { textAlign: 'left' }]}>{row.note}</Text>
      </View>
    );
  }

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
    ? 'Unavailable: could not load'
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
    // Purely additive (#1029 amendment): an informational caption independent
    // of `delta`, joined into the accessible label like every other fact this
    // row already carries. Absent on every row except Recovery during active
    // Recovery, so every other row's accessible label is unchanged.
    row.infoCaption || null,
  ].filter(Boolean).join(', ');
  const label = row.accessibilityText ? `${row.label}, ${row.accessibilityText}` : accessibilityLabel;

  // Rows with `stackDetail` (Recovery) keep the right-hand value compact and
  // put the long suffix + caption on full-width wrapping lines under the label,
  // so nothing nonwrapping can outgrow the row at 320dp or large text.
  const stacked = !!row.stackDetail;
  const body = (
    <View>
    <View style={styles.rowTop}>
      <Text style={styles.rowLabel} numberOfLines={1}>{row.label}</Text>
      <View style={styles.rowValueStack}>
        <View style={styles.rowValueGroup}>
          {value == null ? (
            <Text style={styles.rowValueEmpty}>N/A</Text>
          ) : (
            <Text style={row.paused ? styles.rowValuePaused : styles.rowValue}>
              {value}
              {row.showUnit && <Text style={styles.rowValueUnit}> {unit}</Text>}
            </Text>
          )}
          {!stacked && !!row.valueSuffix && <Text style={styles.rowValueSuffix}>{row.valueSuffix}</Text>}
          {interactive
            ? <MaterialIcons name="chevron-right" size={16} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
            : <View style={styles.rowValueSpacer} accessible={false} />
          }
        </View>
        {(delta || caption || (!stacked && row.infoCaption)) && (
          <View style={styles.rowSub}>
            {!!delta && (
              <Text style={[styles.rowDelta, deltaStyleFor(row, delta, styles)]}>
                {delta.text}{row.showUnit ? ` ${unit}` : ''}{row.deltaCaption ? ` · ${row.deltaCaption}` : ''}
              </Text>
            )}
            {!!caption && <Text style={styles.rowCaption}>{caption}</Text>}
            {!stacked && !!row.infoCaption && <Text style={styles.rowInfoCaption}>{row.infoCaption}</Text>}
          </View>
        )}
      </View>
    </View>
    {stacked && (
      <View style={styles.rowDetail} testID={`overview-detail-${row.key}`}>
        {!!row.valueSuffix && <Text style={styles.rowDetailText}>{row.valueSuffix}</Text>}
        {!!row.infoCaption && <Text style={styles.rowDetailText}>{row.infoCaption}</Text>}
      </View>
    )}
    </View>
  );

  if (!interactive) {
    return (
      <View style={styles.row} accessible accessibilityLabel={label}>
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
      accessibilityLabel={label}
      accessibilityHint="Opens this section of the Analytics tab"
    >
      {body}
    </Pressable>
  );
}

export function AnalyticsOverviewCard({ rows = [], loading = false, asOf = null, onSelectSection }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
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
            <ActivityIndicator color={kua ? kua.primary : colors.accent} />
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

const createStyles = (colors, kua = null) => StyleSheet.create({
  container: {
    gap: 16,
  },
  panel: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: kua ? kua.surfaceCard : colors.panelBackground,
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
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '800',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headerAsOf: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
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
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
    minHeight: 44,
    justifyContent: 'center',
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowLabel: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurface : colors.text,
    flex: 1,
  },
  rowDetail: {
    marginTop: 2,
    gap: 2,
  },
  rowDetailText: {
    ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    flexShrink: 1,
  },
  rowValueStack: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: 2,
  },
  rowValueGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rowValue: {
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: TYPOGRAPHY['label-lg'].fontSize, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  rowValueEmpty: {
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: TYPOGRAPHY['label-lg'].fontSize, fontWeight: '700' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Same weight/size as a normal value, muted like the empty tone (#871): a
  // paused baseline count is a real, true number — not absent — but must not
  // read with the same visual weight as a value that is live right now.
  rowValuePaused: {
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: TYPOGRAPHY['label-lg'].fontSize, fontWeight: '700' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  rowValueUnit: {
    ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  rowValueSuffix: {
    ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Matches the chevron's footprint (16 icon width; the group's own `gap: 5`
  // still applies) so a non-interactive row's value column ends at the same
  // right edge as an interactive one.
  rowValueSpacer: {
    width: 16,
  },
  rowSub: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
  },
  rowDelta: {
    ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '700' }),
  },
  rowDeltaUp: {
    color: kua ? kua.completion : colors.success,
  },
  rowDeltaDown: {
    color: kua ? kua.error : colors.error,
  },
  rowCaption: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textAlign: 'right',
  },
  // Bucket-row font-weight tier (#1029 amendment) — matches
  // AnalyticsRecoverySection's `bandDenominatorCaption`/`bandRowLabel`
  // (fontWeight '700'), so week identity/anchor/matched-population facts read
  // with the same visual weight they carry on the Recovery section itself,
  // not as a subordinate footnote like the plain-weight `rowCaption`.
  rowInfoCaption: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textAlign: 'right',
  },
});
