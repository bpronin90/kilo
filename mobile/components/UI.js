import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
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

// Shared text-input skin. Two forms because both call shapes exist (#689):
// createInputStyle(colors) so a screen's own createStyles() factory can spread
// it, and useInputStyle() for the JSX call sites that apply it directly.
export const createInputStyle = (colors) => ({
  backgroundColor: colors.inputBackground,
  borderWidth: 1,
  borderColor: colors.inputBorder,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 12,
  fontSize: 15,
  color: colors.text,
});

export function useInputStyle() {
  return useThemedStyles(createInputStyle);
}

export { LineChart } from './LineChart';

export function Card({ children, style, tone = 'default', onPress }) {
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Button({ onPress, title, loadingTitle, loading, style, textStyle, disabled = false, accessibilityLabel, tone = 'default' }) {
  const styles = useThemedStyles(createStyles);
  // Disabled and loading are different states. Preserve the existing shorthand
  // for callers that provide loadingTitle alongside disabled={busy}, while
  // allowing validation-disabled actions to keep their real label.
  const showLoading = loading === undefined ? disabled && Boolean(loadingTitle) : loading;
  // Announce the control as a button and expose truthful disabled/busy state so
  // assistive tech reflects both the non-interactive and loading conditions.
  // Titles stay the accessible name unless a caller supplies an explicit label.
  return (
    <Pressable
      onPress={disabled ? null : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: showLoading }}
      style={[styles.button, tone === 'danger' ? styles.buttonDanger : null, disabled ? styles.buttonDisabled : null, style]}
    >
      <Text style={[styles.buttonText, tone === 'danger' ? styles.buttonTextDanger : null, textStyle]}>
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

// Direct status mark color for a gauge tone. Resolved per render from the
// active palette rather than a module-level map, so dark mode uses the brighter
// success/caution/error values (#689).
function sessionGaugeToneColor(tone, colors) {
  if (tone === 'success') return colors.success;
  if (tone === 'warn') return colors.caution;
  if (tone === 'error') return colors.error;
  return colors.textMuted;
}

// Deload-risk meter: a three-zone scale (Building / Approaching / Deload) with a
// knob marking the current session depth — the UV-index / AQI pattern. Zone widths
// are proportional to their session ranges (1–6 / 7–9 / 10+) and the boundaries
// (6, 9) mirror getSessionTone. The knob is positioned on a 0–11 unit scale so
// session counts map linearly onto the zone segments.
export function SessionGauge({ count, total, showDeload = true }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const tone = getSessionTone(count);
  const toneColor = sessionGaugeToneColor(tone, colors);
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

      {/* The whole deload advisory — meter, zone labels, and caption — is gated
          on `showDeload`, not just the "Since deload" stat above it (#821).
          Gating only the number left the Building/Approaching/Deload scale and
          its caption ("Plan deload asap" at 10+) on screen while deload mode was
          switched off: an instruction about a disabled feature, driven by a
          count the card had just hidden. */}
      {showDeload && (
        <>
          <View style={styles.gaugeMeterWrap}>
            <View style={styles.gaugeBar}>
              <View style={[styles.gaugeSeg, styles.gaugeSegLeft, { flex: 6, backgroundColor: colors.success }]} />
              <View style={[styles.gaugeSeg, { flex: 3, backgroundColor: colors.caution }]} />
              <View style={[styles.gaugeSeg, styles.gaugeSegRight, { flex: 2, backgroundColor: colors.error }]} />
            </View>
            <View style={[styles.gaugeMarker, { left: `${markerPct}%`, borderColor: toneColor }]} />
          </View>

          <View style={styles.gaugeZoneLabels}>
            <Text style={[styles.gaugeZoneLabel, { flex: 6 }]}>Building</Text>
            <Text style={[styles.gaugeZoneLabel, styles.gaugeZoneLabelCenter, { flex: 3 }]}>Approaching</Text>
            <Text style={[styles.gaugeZoneLabel, styles.gaugeZoneLabelRight, { flex: 2 }]}>Deload</Text>
          </View>

          <Text style={[styles.sessionGaugeCaption, { color: toneColor }]}>{caption}</Text>
        </>
      )}
    </Card>
  );
}

export function StatCard({ label, value, tone = 'default' }) {
  const styles = useThemedStyles(createStyles);
  const isDarkTone = ['accent', 'success', 'error', 'warn'].includes(tone);
  return (
    <Card tone={tone} style={styles.statCard}>
      <Text style={[styles.statLabel, isDarkTone ? styles.textLight : null]}>{label}</Text>
      <Text style={[styles.statValue, isDarkTone ? styles.textLight : null]}>{value}</Text>
    </Card>
  );
}

export function Badge({ children, status = 'default' }) {
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

export function WorkoutHeading({ children, style, selectable }) {
  const styles = useThemedStyles(createStyles);
  return <Text selectable={selectable} style={[styles.workoutHeading, style]}>{children}</Text>;
}

export function WorkoutSubheading({ children, selectable }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.subheadingContainer}>
      <Text selectable={selectable} style={styles.workoutSubheading}>{children}</Text>
      <View style={styles.subheadingLine} />
    </View>
  );
}

export function ExerciseBlock({ name, children, isTracked, onToggleTrack, disabledTrack, selectable, onNamePress }) {
  const styles = useThemedStyles(createStyles);
  const TrackContainer = (disabledTrack || !onToggleTrack) ? View : Pressable;

  return (
    <View style={styles.exerciseBlock}>
      <View style={styles.exerciseHeader}>
        {/* #881: `onNamePress` (when provided) carries WorkoutContentRenderer's
            manual double-tap detector — a plain onPress on a selectable Text
            has no effect on native long-press/selection, so single-tap and
            text-selection behavior are unchanged. */}
        <Text selectable={selectable} style={styles.exerciseName} onPress={onNamePress}>{name}</Text>
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
  const styles = useThemedStyles(createStyles);
  const [plateWeight, setPlateWeight] = useState(null);
  const unit = useWeightUnit();
  if (!sets || sets.length === 0) return null;

  const groups = [];
  let currentGroup = null;

  for (const set of sets) {
    // #852: a kg-marked load ("40kg 10") converts to its canonical lb
    // weight_value at parse time, so a converted set and a bare-lb set can
    // share a weight_value ("88 10" then "40kg 8") while needing different
    // labels. Break the group on the conversion identity too, not just the
    // number, so a genuine lb set is never labelled as converted. kgValue is
    // compared as well: 40kg and 41kg both round to 88 lb but render
    // different suffixes, so they must not merge either.
    const convertedFromKg = !!set.converted_from_kg;
    const kgValue = set.kg_value ?? null;
    if (
      !currentGroup
      || currentGroup.weight !== set.weight_value
      || currentGroup.convertedFromKg !== convertedFromKg
      || currentGroup.kgValue !== kgValue
    ) {
      currentGroup = { weight: set.weight_value, reps: [], convertedFromKg, kgValue };
      groups.push(currentGroup);
    }
    // #854/G4: a duration set (header-declared, e.g. "3x30 sec") carries
    // duration_seconds instead of rep_count.
    currentGroup.reps.push(
      set.skipped ? '-' : (set.duration_seconds != null ? `${set.duration_seconds}s` : set.rep_count)
    );
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
              accessibilityLabel={
                group.convertedFromKg
                  ? `Show plate loading for ${group.weight} pounds, converted from ${group.kgValue} kilograms`
                  : `Show plate loading for ${group.weight} pounds`
              }
            >
              {/* #852: a converted group's "(40kg)" suffix is part of the
                  SAME plain string as the weight, not a separately styled
                  nested Text — `children` then stays a plain string in
                  every case, exactly as before #852 (several tests match on
                  `typeof children === 'string'`), and the parenthetical
                  already reads as an annotation without needing its own
                  font treatment. */}
              <Text selectable={selectable} style={styles.setWeight}>
                {group.convertedFromKg
                  ? `${formatLiftWeightValue(group.weight, unit)} ${unit} (${group.kgValue}kg)`
                  : `${formatLiftWeightValue(group.weight, unit)} ${unit}`}
              </Text>
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
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
  return <View style={[styles.artisanalPanel, style]}>{children}</View>;
}

export function ErrorBanner({ message, onRetry }) {
  const styles = useThemedStyles(createStyles);
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

const createStyles = (colors) => StyleSheet.create({
  errorBanner: {
    backgroundColor: colors.errorSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
  },
  // Filled, so it takes the error *surface* tone rather than the direct error
  // color: dark mode's `error` is a bright foreground red that cannot carry a
  // textLight label.
  errorBannerRetry: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.cardErrorBg,
  },
  errorBannerRetryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textLight,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 10,
  },
  artisanalPanel: {
    backgroundColor: colors.panelBackground,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  // Filled tone cards render light text (textLight), so every tone uses its
  // mode-specific card surface (cardAccentBg/cardSuccessBg/cardCautionBg/
  // cardErrorBg) rather than the direct status color. Each pair is tuned to
  // WCAG AA 4.5:1 in both palettes and asserted in theme-rendering.test.js.
  cardAccent: {
    backgroundColor: colors.cardAccentBg,
    borderColor: colors.cardAccentBg,
  },
  cardSuccess: {
    backgroundColor: colors.cardSuccessBg,
    borderColor: colors.cardSuccessBg,
  },
  cardError: {
    backgroundColor: colors.cardErrorBg,
    borderColor: colors.cardErrorBg,
  },
  cardWarn: {
    backgroundColor: colors.cardCautionBg,
    borderColor: colors.cardCautionBg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginTop: 6,
  },
  button: {
    backgroundColor: colors.text,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  // Destructive/irreversible actions: transparent fill with an error-colored
  // outline and label, so severity reads as hierarchy (a visually distinct
  // control) rather than color alone — the wording still states the
  // consequence. See ui-design-rules.md #14.
  buttonDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.error,
  },
  buttonTextDanger: {
    color: colors.error,
  },
  // The pill is the palette `text`, so the label is the semantic contrasting
  // ink: light mode stays dark pill / light label, dark mode inverts to light
  // pill / dark label. Both exceed 4.5:1 (15.65:1 and 16.81:1).
  buttonText: {
    color: colors.buttonLabel,
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
    backgroundColor: colors.panelBackground,
  },
  sessionGaugePanelTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
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
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sessionGaugeCount: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.text,
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
    backgroundColor: colors.card,
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
    color: colors.textMuted,
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
    color: colors.textMuted,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
  },
  textLight: {
    color: colors.textLight,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.chipBackground,
  },
  // Trend badges render light text (textLight) for improved/held/regressed, so
  // all three take the mode-specific filled tone surfaces rather than the
  // direct status colors.
  badge_improved: {
    backgroundColor: colors.cardSuccessBg,
  },
  badge_regressed: {
    backgroundColor: colors.cardErrorBg,
  },
  badge_held: {
    backgroundColor: colors.cardAccentBg,
  },
  badge_first_session: {
    backgroundColor: colors.chipBackground,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.chipText,
    textTransform: 'uppercase',
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.chipBackground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
  },
  workoutHeading: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
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
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  subheadingLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.cardBorder,
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
    color: colors.text,
    flex: 1,
  },
  trackToggle: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: 'transparent',
  },
  trackToggleActive: {
    backgroundColor: colors.chipBackground,
    borderColor: colors.chipBackground,
  },
  trackToggleDisabled: {
    opacity: 0.4,
    borderColor: colors.cardBorder,
  },
  trackToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  trackToggleTextActive: {
    color: colors.chipText,
  },
  trackToggleTextDisabled: {
    color: colors.textMuted,
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
    color: colors.textMuted,
  },
  setReps: {
    fontSize: SET_ROW_FONT_SIZE,
    fontWeight: '400',
    color: colors.text,
  },
  setMark: {
    fontSize: SET_ROW_FONT_SIZE,
    fontWeight: '400',
    color: colors.textMuted,
    marginLeft: 6,
  },
  annotationNote: {
    fontSize: SET_ROW_FONT_SIZE - 1,
    fontStyle: 'italic',
    color: colors.textMuted,
    paddingLeft: 0,
  },
  // Unparsed-row styles. unparsedRow/unparsedRowMuted keep the exact single
  // color tokens the read view relied on before (colors.error for unresolved
  // lifting fallbacks, colors.text otherwise) so per-mode color parity holds.
  unparsedRow: {
    fontSize: SET_ROW_FONT_SIZE,
    color: colors.error,
    paddingLeft: 0,
  },
  unparsedRowMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: colors.text,
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
    color: colors.error,
  },
  unparsedGlyphMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: colors.textMuted,
  },
  unparsedHint: {
    fontSize: SET_ROW_FONT_SIZE - 1,
    color: colors.textMuted,
    paddingLeft: 18,
  },
  noteParseError: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.panelBackground,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  noteParseErrorText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
  },
});
