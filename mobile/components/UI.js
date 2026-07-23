import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { PlateCalculatorModal } from './PlateCalculatorModal';
import { useWeightUnit } from '../lib/unitPreference';
import { formatLiftWeightValue } from '../lib/units';

export const SET_ROW_FONT_SIZE = 14;

export const HeroMetric = {
  hero:          { fontSize: 48, fontWeight: '900', lineHeight: 52 },
  statPrimary:   { fontSize: 32, fontWeight: '900' },
  statSecondary: { fontSize: 24, fontWeight: '900' },
  statTertiary:  { fontSize: 20, fontWeight: '900' },
};

export const InputStyle = {
  backgroundColor: Colors.inputBackground,
  borderWidth: 1,
  borderColor: Colors.inputBorder,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 12,
  fontSize: 15,
  color: Colors.text,
};

export { LineChart } from './LineChart';

export function Card({ children, style, tone = 'default', onPress }) {
  const Container = onPress ? Pressable : View;
  
  const baseStyles = [
    styles.card,
    tone === 'accent' ? styles.cardAccent : null,
    tone === 'success' ? styles.cardSuccess : null,
    tone === 'error' ? styles.cardError : null,
    tone === 'warn' ? styles.cardWarn : null,
    style
  ];

  if (!onPress) {
    return <View style={baseStyles}>{children}</View>;
  }

  return (
    <Pressable 
      onPress={onPress}
      style={({ pressed }) => [
        ...baseStyles,
        pressed ? { opacity: 0.7 } : null
      ]}
    >
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Button({ onPress, title, loadingTitle, loading, style, textStyle, disabled = false }) {
  // Disabled and loading are different states. Preserve the existing shorthand
  // for callers that provide loadingTitle alongside disabled={busy}, while
  // allowing validation-disabled actions to keep their real label.
  const showLoading = loading === undefined ? disabled && Boolean(loadingTitle) : loading;
  return (
    <Pressable
      onPress={disabled ? null : onPress}
      style={[styles.button, disabled ? styles.buttonDisabled : null, style]}
    >
      <Text style={[styles.buttonText, textStyle]}>
        {showLoading ? (loadingTitle || 'Saving…') : title}
      </Text>
    </Pressable>
  );
}

export function getSessionTone(count) {
  if (count >= 10) return 'error';
  if (count >= 7) return 'warn';
  if (count >= 1) return 'success';
  return 'default';
}

// Deload-risk caption for a session-depth count. Zone boundaries (1 / 7 / 10)
// mirror getSessionTone. The 10+ caption is fixed per the issue contract.
export function getSessionZoneCaption(count) {
  if (count >= 10) return 'Plan deload asap';
  if (count >= 7) return 'Fatigue setting in';
  if (count >= 1) return 'Cultivating mass';
  return 'No sessions logged';
}

const _SESSION_GAUGE_TONE_COLORS = {
  success: Colors.success,
  warn: Colors.caution,
  error: Colors.error,
  default: Colors.textMuted,
};

// Deload-risk meter: a three-zone scale (Building / Approaching / Deload) with a
// knob marking the current session depth — the UV-index / AQI pattern. Zone widths
// are proportional to their session ranges (1–6 / 7–9 / 10+) and the boundaries
// (6, 9) mirror getSessionTone. The knob is positioned on a 0–11 unit scale so
// session counts map linearly onto the zone segments.
export function SessionGauge({ count, total, showDeload = true }) {
  const tone = getSessionTone(count);
  const toneColor = _SESSION_GAUGE_TONE_COLORS[tone] || Colors.textMuted;
  const caption = getSessionZoneCaption(count);
  const markerPct = (Math.min(count, 11) / 11) * 100;

  return (
    <Card style={styles.sessionGauge}>
      <Text style={styles.sessionGaugePanelTitle}>Routine Health</Text>
      <View style={styles.sessionGaugeHeader}>
        {showDeload && (
          <View style={styles.sessionGaugeStat}>
            <Text style={styles.sessionGaugeLabel}>Since deload</Text>
            <Text style={[styles.sessionGaugeCount, { color: toneColor }]}>{count}</Text>
          </View>
        )}
        {total != null && (
          <View style={[styles.sessionGaugeStat, styles.sessionGaugeStatRight]}>
            <Text style={styles.sessionGaugeLabel}>Total</Text>
            <Text style={styles.sessionGaugeCount}>{total}</Text>
          </View>
        )}
      </View>

      <View style={styles.gaugeMeterWrap}>
        <View style={styles.gaugeBar}>
          <View style={[styles.gaugeSeg, styles.gaugeSegLeft, { flex: 6, backgroundColor: Colors.success }]} />
          <View style={[styles.gaugeSeg, { flex: 3, backgroundColor: Colors.caution }]} />
          <View style={[styles.gaugeSeg, styles.gaugeSegRight, { flex: 2, backgroundColor: Colors.error }]} />
        </View>
        <View style={[styles.gaugeMarker, { left: `${markerPct}%`, borderColor: toneColor }]} />
      </View>

      <View style={styles.gaugeZoneLabels}>
        <Text style={[styles.gaugeZoneLabel, { flex: 6 }]}>Building</Text>
        <Text style={[styles.gaugeZoneLabel, styles.gaugeZoneLabelCenter, { flex: 3 }]}>Approaching</Text>
        <Text style={[styles.gaugeZoneLabel, styles.gaugeZoneLabelRight, { flex: 2 }]}>Deload</Text>
      </View>

      <Text style={[styles.sessionGaugeCaption, { color: toneColor }]}>{caption}</Text>
    </Card>
  );
}

export function StatCard({ label, value, tone = 'default' }) {
  const isDarkTone = ['accent', 'success', 'error', 'warn'].includes(tone);
  return (
    <Card tone={tone} style={styles.statCard}>
      <Text style={[styles.statLabel, isDarkTone ? styles.textLight : null]}>{label}</Text>
      <Text style={[styles.statValue, isDarkTone ? styles.textLight : null]}>{value}</Text>
    </Card>
  );
}

export function Badge({ children, status = 'default' }) {
  const isDarkStatus = ['improved', 'regressed', 'held'].includes(status);
  return (
    <View style={[styles.badge, styles[`badge_${status}`]]}>
      <Text style={[styles.badgeText, isDarkStatus ? styles.textLight : null]}>
        {children}
      </Text>
    </View>
  );
}

export function Chip({ children }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

export function WorkoutHeading({ children, style, selectable }) {
  return <Text selectable={selectable} style={[styles.workoutHeading, style]}>{children}</Text>;
}

export function WorkoutSubheading({ children, selectable }) {
  return (
    <View style={styles.subheadingContainer}>
      <Text selectable={selectable} style={styles.workoutSubheading}>{children}</Text>
      <View style={styles.subheadingLine} />
    </View>
  );
}

export function ExerciseBlock({ name, children, isTracked, onToggleTrack, disabledTrack, selectable }) {
  const TrackContainer = (disabledTrack || !onToggleTrack) ? View : Pressable;

  return (
    <View style={styles.exerciseBlock}>
      <View style={styles.exerciseHeader}>
        <Text selectable={selectable} style={styles.exerciseName}>{name}</Text>
        {(onToggleTrack || disabledTrack) && (
          <TrackContainer 
            onPress={disabledTrack ? null : onToggleTrack}
            disabled={disabledTrack}
            accessibilityState={disabledTrack ? { disabled: true } : undefined}
            style={[
              styles.trackToggle,
              isTracked ? styles.trackToggleActive : null,
              disabledTrack ? styles.trackToggleDisabled : null
            ]}
          >
            <Text selectable={selectable} style={[
              styles.trackToggleText,
              isTracked ? styles.trackToggleTextActive : null,
              disabledTrack ? styles.trackToggleTextDisabled : null
            ]}>
              {isTracked ? 'Tracked' : 'Track'}
            </Text>
          </TrackContainer>
        )}
      </View>
      <View style={styles.exerciseContent}>
        {children}
      </View>
    </View>
  );
}

export function SetLine({ sets, selectable, mark }) {
  const [plateWeight, setPlateWeight] = useState(null);
  const unit = useWeightUnit();
  if (!sets || sets.length === 0) return null;

  const groups = [];
  let currentGroup = null;

  for (const set of sets) {
    if (!currentGroup || currentGroup.weight !== set.weight_value) {
      currentGroup = { weight: set.weight_value, reps: [] };
      groups.push(currentGroup);
    }
    currentGroup.reps.push(set.skipped ? '-' : set.rep_count);
  }

  return (
    <View style={styles.setLine}>
      {groups.map((group, i) => (
        <View key={i} style={styles.setGroup}>
          {group.weight ? (
            <Pressable
              onPress={() => setPlateWeight(group.weight)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Show plate loading for ${group.weight} pounds`}
            >
              <Text selectable={selectable} style={styles.setWeight}>{`${formatLiftWeightValue(group.weight, unit)} ${unit}`}</Text>
            </Pressable>
          ) : (
            <Text selectable={selectable} style={styles.setWeight}>BW</Text>
          )}
          <Text selectable={selectable} style={styles.setReps}>{group.reps.join(', ')}</Text>
        </View>
      ))}
      {mark ? (
        <Text
          selectable={selectable}
          style={styles.setMark}
          accessibilityLabel={`Marked: ${mark}`}
        >
          {`★ ${mark}`}
        </Text>
      ) : null}
      <PlateCalculatorModal
        visible={plateWeight != null}
        weight={plateWeight}
        onClose={() => setPlateWeight(null)}
      />
    </View>
  );
}

// Muted, accessibility-labeled note line for a `--` comment stored beneath a
// logged set row. Never affects parsed sets or exercise names — display only.
export function AnnotationNote({ text, selectable }) {
  if (!text) return null;
  return (
    <Text
      selectable={selectable}
      style={styles.annotationNote}
      accessibilityLabel={`Note: ${text}`}
    >
      {text}
    </Text>
  );
}

// A single unrecognized set-row line in the read view. Without a parser
// `error` this preserves the prior bare-raw rendering (non-weight rows and
// fallback duplicates), muted or error-red per the section mode. With an
// `error` it adds a non-color-only affordance: a ⚠ glyph, the actionable
// parser message beneath the raw line, and an `accessibilityLabel` naming the
// raw line and its recovery hint so screen-reader users get the same guidance
// as the red text conveys visually (WCAG 1.4.1).
export function UnparsedRow({ raw, error, muted, selectable }) {
  const rawStyle = muted ? styles.unparsedRowMuted : styles.unparsedRow;
  if (!error) {
    return (
      <Text selectable={selectable} style={rawStyle}>
        {raw}
      </Text>
    );
  }
  return (
    <View
      style={styles.unparsedGroup}
      accessible={true}
      accessibilityLabel={`Unrecognized set row: ${raw}. ${error}`}
    >
      <View style={styles.unparsedRawLine}>
        <Text style={muted ? styles.unparsedGlyphMuted : styles.unparsedGlyph}>⚠</Text>
        <Text selectable={selectable} style={rawStyle}>{raw}</Text>
      </View>
      <Text selectable={selectable} style={styles.unparsedHint}>{error}</Text>
    </View>
  );
}

// Note-level parse-failure affordance for a whole note the parser refuses
// (e.g. an oversize note returning `ok: false`). Replaces the blank read view
// with a visible, accessibility-labeled message so the failure is never
// silent. No synthetic exercise/section is invented.
export function NoteParseError({ message }) {
  const text = message || 'This note could not be parsed.';
  return (
    <View
      style={styles.noteParseError}
      accessible={true}
      accessibilityLabel={`Note could not be parsed. ${text}`}
    >
      <Text style={styles.noteParseErrorText}>{`⚠ ${text}`}</Text>
    </View>
  );
}

export function ArtisanalPanel({ children, style }) {
  return <View style={[styles.artisanalPanel, style]}>{children}</View>;
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{message || 'Failed to load data.'}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={styles.errorBannerRetry}>
          <Text style={styles.errorBannerRetryText}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    backgroundColor: '#fff0f0',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.error,
  },
  errorBannerRetry: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.error,
  },
  errorBannerRetryText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textLight,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  artisanalPanel: {
    backgroundColor: Colors.panelBackground,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.divider,
    shadowColor: Colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  // Filled accent/success/caution tone cards render light text (textLight), so
  // they use the darkened card-only tone backgrounds
  // (cardAccentBg/cardSuccessBg/cardCautionBg) tuned to meet WCAG AA 4.5:1.
  // Error already passes with light text on Colors.error (5.36:1), so it keeps
  // the palette color.
  cardAccent: {
    backgroundColor: Colors.cardAccentBg,
    borderColor: Colors.cardAccentBg,
  },
  cardSuccess: {
    backgroundColor: Colors.cardSuccessBg,
    borderColor: Colors.cardSuccessBg,
  },
  cardError: {
    backgroundColor: Colors.error,
    borderColor: Colors.error,
  },
  cardWarn: {
    backgroundColor: Colors.cardCautionBg,
    borderColor: Colors.cardCautionBg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 6,
  },
  button: {
    backgroundColor: Colors.text,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: Colors.textLight,
    fontSize: 16,
    fontWeight: '700',
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
  },
  sessionGauge: {
    flex: 1,
    gap: 10,
    backgroundColor: Colors.panelBackground,
  },
  sessionGaugePanelTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  sessionGaugeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  sessionGaugeStat: {
    gap: 2,
  },
  sessionGaugeStatRight: {
    alignItems: 'flex-end',
    marginLeft: 'auto',
  },
  sessionGaugeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sessionGaugeCount: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.text,
  },
  sessionGaugeCountRow: {},
  sessionGaugeTotalStat: {},
  gaugeMeterWrap: {
    width: '100%',
    height: 16,
    justifyContent: 'center',
  },
  gaugeBar: {
    flexDirection: 'row',
    width: '100%',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  gaugeSeg: {
    height: '100%',
  },
  gaugeSegLeft: {
    borderTopLeftRadius: 5,
    borderBottomLeftRadius: 5,
  },
  gaugeSegRight: {
    borderTopRightRadius: 5,
    borderBottomRightRadius: 5,
  },
  gaugeMarker: {
    position: 'absolute',
    top: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.card,
    borderWidth: 3,
    transform: [{ translateX: -8 }],
  },
  gaugeZoneLabels: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 4,
  },
  gaugeZoneLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  gaugeZoneLabelCenter: {
    textAlign: 'center',
  },
  gaugeZoneLabelRight: {
    textAlign: 'right',
  },
  sessionGaugeCaption: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
  },
  textLight: {
    color: Colors.textLight,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.chipBackground,
  },
  // Trend badges render light text (textLight) for improved/held/regressed, so
  // improved/held use the darkened tone backgrounds to meet WCAG AA 4.5:1
  // (success #3a6035 -> 6.44:1, accent #96571c -> 5.09:1). regressed already
  // passes with light text on Colors.error (5.36:1), so it keeps the palette tone.
  badge_improved: {
    backgroundColor: Colors.cardSuccessBg,
  },
  badge_regressed: {
    backgroundColor: Colors.error,
  },
  badge_held: {
    backgroundColor: Colors.cardAccentBg,
  },
  badge_first_session: {
    backgroundColor: Colors.chipBackground,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.chipText,
    textTransform: 'uppercase',
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.chipBackground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.chipText,
  },
  workoutHeading: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    marginTop: 24,
    marginBottom: 8,
    textTransform: 'capitalize',
  },
  subheadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    marginBottom: 12,
  },
  workoutSubheading: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  subheadingLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.cardBorder,
    opacity: 0.5,
  },
  exerciseBlock: {
    marginBottom: 20,
    gap: 6,
  },
  exerciseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  exerciseName: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  trackToggle: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    backgroundColor: 'transparent',
  },
  trackToggleActive: {
    backgroundColor: Colors.chipBackground,
    borderColor: Colors.chipBackground,
  },
  trackToggleDisabled: {
    opacity: 0.4,
    borderColor: Colors.cardBorder,
  },
  trackToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  trackToggleTextActive: {
    color: Colors.chipText,
  },
  trackToggleTextDisabled: {
    color: Colors.textMuted,
  },
  exerciseContent: {
    paddingLeft: 4,
    gap: 4,
  },
  setLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  setGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  setWeight: {
    fontSize: SET_ROW_FONT_SIZE,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  setReps: {
    fontSize: SET_ROW_FONT_SIZE,
    fontWeight: '400',
    color: Colors.text,
  },
  setMark: {
    fontSize: SET_ROW_FONT_SIZE,
    fontWeight: '400',
    color: Colors.textMuted,
    marginLeft: 6,
  },
  annotationNote: {
    fontSize: SET_ROW_FONT_SIZE - 1,
    fontStyle: 'italic',
    color: Colors.textMuted,
    paddingLeft: 0,
  },
  // Unparsed-row styles. unparsedRow/unparsedRowMuted keep the exact single
  // color tokens the read view relied on before (Colors.error for unresolved
  // lifting fallbacks, Colors.text otherwise) so per-mode color parity holds.
  unparsedRow: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.error,
    paddingLeft: 0,
  },
  unparsedRowMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.text,
    paddingLeft: 0,
  },
  unparsedGroup: {
    paddingLeft: 0,
    gap: 1,
  },
  unparsedRawLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  unparsedGlyph: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.error,
  },
  unparsedGlyphMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.textMuted,
  },
  unparsedHint: {
    fontSize: SET_ROW_FONT_SIZE - 1,
    color: Colors.textMuted,
    paddingLeft: 18,
  },
  noteParseError: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    backgroundColor: Colors.panelBackground,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  noteParseErrorText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.error,
  },
});
