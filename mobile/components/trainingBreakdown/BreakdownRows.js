import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { tint } from './breakdownPalette';

// Shared ranked-row primitives for the Training breakdown dashboard (#1588):
// a label with printed count (and optional share), and a proportional bar under
// it. Unknown rows use a muted label and a hatched bar, so they read as
// "not known" without relying on colour alone.

export const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const width = (n, max) => `${Math.max(3, Math.min(100, (n / Math.max(1, max)) * 100))}%`;

export function Hatch({ styles, p, w }) {
  return (
    <View style={[styles.hatch, { width: w, backgroundColor: tint(p.muted, 0.22) }]} testID="training-breakdown-hatch">
      {/* Base fill carries the proportional length; stripes are clipped texture. */}
      {Array.from({ length: 240 }, (_, i) => (
        <View key={i} style={{ width: 3, height: '200%', marginTop: -2, backgroundColor: tint(p.muted, 0.55), transform: [{ skewX: '-40deg' }] }} />
      ))}
    </View>
  );
}

export function Bar({ styles, p, value, max, secondary = 0, unknown = false, light = false }) {
  if (unknown) return <View style={styles.bar}><Hatch styles={styles} p={p} w={width(value, max)} /></View>;
  return (
    <View style={styles.bar}>
      <View style={{ width: value > 0 ? width(value, max) : 0, backgroundColor: light ? tint(p.primary, 0.75) : p.primary, borderRadius: 4 }} />
      {secondary > 0 ? (
        <View testID="training-breakdown-secondary-bar" style={{ width: `${Math.min(100, (secondary / Math.max(1, max)) * 100)}%`, backgroundColor: tint(p.primary, 0.3) }} />
      ) : null}
    </View>
  );
}

export function RankedRow({
  styles, p, label, value, total = null, max, first = false, unknown = false, tag = null,
  extra = null, secondary = 0, plain = false, light = false, onPress = null, testID, a11y,
}) {
  const Container = onPress ? Pressable : View;
  const share = total != null ? `${pct(value, total)}%` : null;
  return (
    <Container
      testID={testID}
      onPress={onPress || undefined}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={a11y || `${label}, ${value}${share ? `, ${share}` : ''}`}
      style={[styles.row, !first && styles.rowBorder]}
    >
      <View style={styles.rowHead}>
        <View style={styles.rowLabelWrap}>
          <Text style={[styles.rowLabel, plain && styles.rowLabelPlain, unknown && styles.rowMuted]}>{label}</Text>
          {tag ? <View style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View> : null}
        </View>
        <Text style={[styles.rowValue, unknown && styles.rowMuted]}>
          {value}
          {extra ? <Text style={styles.rowPct}>{` ${extra}`}</Text> : null}
          {share ? <Text style={styles.rowPct}>{` ${share}`}</Text> : null}
        </Text>
      </View>
      <Bar styles={styles} p={p} value={value} max={max} secondary={secondary} unknown={unknown} light={light} />
    </Container>
  );
}
