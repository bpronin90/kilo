import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { Card } from './containers';
import { SET_ROW_FONT_SIZE } from './styles';
import { PlateCalculatorModal } from '../PlateCalculatorModal';
import { useWeightUnit } from '../../lib/unitPreference';
import { formatLiftWeightValue } from '../../lib/units';

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
            accessibilityRole={disabledTrack ? undefined : 'button'}
            accessibilityState={disabledTrack ? { disabled: true } : undefined}
            // #894: label matches the visible text exactly (ui-design-rules
            // §11); the hint is what a screen-reader user can't see from the
            // one-word label alone — logging doesn't track, and tracking
            // always opens a fresh progression span (#893), even on a
            // re-track.
            accessibilityLabel={disabledTrack ? undefined : (isTracked ? 'Tracked' : 'Track')}
            accessibilityHint={disabledTrack ? undefined : (isTracked
              ? 'Removes this exercise from Progressive Overload'
              : 'Adds this exercise to Progressive Overload and starts a new tracked span')}
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
  const [plateTarget, setPlateTarget] = useState(null);
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
              onPress={() => setPlateTarget({
                weightLb: group.weight,
                authoredKg: group.convertedFromKg ? group.kgValue : null,
              })}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={
                group.convertedFromKg
                  // Describes provenance in the units actually typed/parsed
                  // (canonical lb, converted from an explicit kg marker) —
                  // independent of the display-unit preference, matching
                  // the visible "(40kg)" parenthetical.
                  ? `Show plate loading for ${group.weight} pounds, converted from ${group.kgValue} kilograms`
                  // #577 review: this used to hardcode "pounds" even when
                  // displaying in kg — a kg value would be visually shown
                  // ("88 kg") but announced as "88 pounds". Must match the
                  // same display unit/value shown on screen.
                  : `Show plate loading for ${formatLiftWeightValue(group.weight, unit)} ${unit === 'kg' ? 'kilograms' : 'pounds'}`
              }
            >
              {/* #852: a converted group's "(40kg)" suffix is part of the
                  SAME plain string as the weight, not a separately styled
                  nested Text — `children` then stays a plain string in
                  every case, exactly as before #852 (several tests match on
                  `typeof children === 'string'`), and the parenthetical
                  already reads as an annotation without needing its own
                  font treatment. #577: a dotted underline is the visible
                  "this is tappable" cue — plain color/weight alone read as
                  inert text (review finding), and the underline degrades
                  fine as a border in every theme without relying on color. */}
              <Text selectable={selectable} style={[styles.setWeight, styles.setWeightTappable]}>
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
        visible={plateTarget != null}
        weightLb={plateTarget?.weightLb ?? null}
        authoredKg={plateTarget?.authoredKg ?? null}
        onClose={() => setPlateTarget(null)}
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

const createStyles = (colors) => StyleSheet.create({
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
    color: colors.accentText,
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
  // #577: visible tappable cue for the plate-calculator affordance.
  setWeightTappable: {
    borderBottomWidth: 1,
    borderBottomColor: colors.textMuted,
    borderStyle: 'dashed',
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
});
