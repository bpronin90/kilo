// Redesign v3 Log presentation (#1606, docs/design/app-redesign-v3 "Log"):
// the per-day heading, block label, exercise header and the compact inline
// session list the current-routine card renders through
// `WorkoutContentRenderer`'s opt-in `presentation="log"`. Every value shown
// here comes from the parse that produced `dayGroups` — rows, sets, skips,
// unparsed rows and annotations are rendered exactly as the default renderer
// renders them, only regrouped per session. Nothing is re-parsed, merged,
// reordered or reinterpreted; the "earlier sessions" fold only hides (never
// drops) older logged sessions, and parse warnings are never folded away.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useKuaStyle, useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { formatLiftWeightValue } from '../../lib/units';

// How many of the newest sessions stay visible while an exercise is folded.
export const LOG_INLINE_SESSIONS = 3;

// Day heading: a primary rail, the parsed heading verbatim (uppercased by
// style only) and the exercise count for that parsed day group.
export function LogDayHeading({ heading, count, first = false }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  return (
    <View style={[styles.dayHeading, first ? styles.dayHeadingFirst : null]}>
      <View style={styles.dayRail} />
      <Text selectable style={[typography['headline-sm'], styles.dayHeadingText]} accessibilityRole="header">
        {heading}
      </Text>
      {count > 0 ? (
        <Text style={[typography['label-md'], styles.dayCount]} accessibilityLabel={`${count} ${count === 1 ? 'exercise' : 'exercises'}`}>
          {`${count} EX`}
        </Text>
      ) : null}
    </View>
  );
}

// Block label (`+Strength` → STRENGTH) with a trailing hairline.
export function LogBlockLabel({ children }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  return (
    <View style={styles.blockLabel}>
      <Text selectable style={[typography['label-md'], styles.blockLabelText]}>{children}</Text>
      <View style={styles.blockLabelLine} />
    </View>
  );
}

// One logged session: the same grouping, kg suffix, BW, duration and skipped
// set ink as `SetLine` (components/ui/workout.js), laid out as the design's
// compact weight/reps groups. `tone` is 'old' (muted), 'last' (bold, LAST tag) or
// 'lead' (bold, no tag: a deload's prescribed line is not a logged session).
export function LogSetLine({ sets, unit, mark, tone = 'old' }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  if (!sets || sets.length === 0) return null;
  const groups = [];
  let current = null;
  for (const set of sets) {
    const convertedFromKg = !!set.converted_from_kg;
    const kgValue = set.kg_value ?? null;
    if (!current || current.weight !== set.weight_value || current.convertedFromKg !== convertedFromKg || current.kgValue !== kgValue) {
      current = { weight: set.weight_value, reps: [], convertedFromKg, kgValue };
      groups.push(current);
    }
    current.reps.push(set.skipped ? '-' : (set.duration_seconds != null ? `${set.duration_seconds}s` : set.rep_count));
  }
  const last = tone === 'last' || tone === 'lead';
  const text = [typography['label-lg'], last ? styles.lastText : styles.oldText, last ? { fontFamily: typography['metric-display-mobile'].fontFamily, fontWeight: typography['metric-display-mobile'].fontWeight } : null];
  return (
    <View style={styles.setLine} testID={tone === 'last' ? 'log-set-line-last' : 'log-set-line'}>
      <View style={styles.setGroups}>
        {groups.map((group, i) => (
          <View key={i} style={styles.setGroup}>
            <Text selectable style={[text, styles.setWeight]}>
              {group.weight
                ? (group.convertedFromKg
                  ? `${formatLiftWeightValue(group.weight, unit)} ${unit} (${group.kgValue}kg)`
                  : `${formatLiftWeightValue(group.weight, unit)} ${unit}`)
                : 'BW'}
            </Text>
            <Text selectable style={[text, styles.setReps]}>{group.reps.join(', ')}</Text>
          </View>
        ))}
        {mark ? (
          <Text selectable style={[text, styles.setMark]} accessibilityLabel={`Marked: ${mark}`}>{`★ ${mark}`}</Text>
        ) : null}
        {tone === 'last' ? (
          <View style={styles.lastTag} accessibilityLabel="Last session">
            <Text style={[typography['label-sm'], styles.lastTagText]}>LAST</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// Exercise header + session list. `units` are the renderer's per-occurrence
// items grouped by session (`{ session, row, render(tone) }`), in note order.
// Folded, only the newest LOG_INLINE_SESSIONS sessions are visible; older ones
// stay mounted but hidden, and every non-session unit (unparsed/warning rows)
// always shows. Tracked keeps ExerciseBlock's exact label, hint and handler.
// `onOpenHistory(returnRef)` (#1607) adds the labelled 44dp history button;
// the ref lets the sheet hand focus back to it on close.
export function LogExerciseBlock({ name, isTracked, onToggleTrack, onNamePress, units, expanded, onToggleExpanded, testID, lastTone = 'last', onOpenHistory }) {
  const historyRef = React.useRef(null);
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const sessionCount = units.filter(u => u.session).length;
  const hidden = Math.max(0, sessionCount - LOG_INLINE_SESSIONS);
  let lastRowIndex = -1;
  units.forEach((u, i) => { if (u.row) lastRowIndex = i; });
  let ordinal = 0;
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  return (
    <View style={styles.exercise} testID={testID}>
      <View style={styles.exerciseHeader}>
        <Text selectable style={[typography['headline-sm'], styles.exerciseName]} onPress={onNamePress}>{name}</Text>
        {typeof onOpenHistory === 'function' ? (
          <Pressable
            ref={historyRef}
            onPress={(e) => { e?.stopPropagation?.(); onOpenHistory(historyRef); }}
            style={styles.historyTarget}
            accessibilityRole="button"
            accessibilityLabel={`${name} history`}
            accessibilityHint="Opens every logged session of this exercise"
            testID={testID ? `${testID}-history` : undefined}
          >
            <MaterialIcons name="history" size={22} color={muted} accessible={false} />
          </Pressable>
        ) : null}
        {typeof onToggleTrack === 'function' ? (
          <Pressable
            onPress={(e) => { e?.stopPropagation?.(); onToggleTrack(); }}
            style={styles.trackTarget}
            accessibilityRole="button"
            accessibilityLabel={isTracked ? 'Tracked' : 'Track'}
            accessibilityHint={isTracked
              ? 'Removes this exercise from Progressive Overload'
              : 'Adds this exercise to Progressive Overload and starts a new tracked span'}
            accessibilityState={{ selected: !!isTracked }}
          >
            <View style={[styles.trackPill, isTracked ? styles.trackPillOn : null]}>
              {isTracked ? <MaterialIcons name="check" size={14} color={kua ? kua.onPrimary : colors.background} accessible={false} /> : null}
              <Text style={[typography['label-md'], styles.trackText, isTracked ? styles.trackTextOn : null]}>
                {isTracked ? 'Tracked' : 'Track'}
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>
      {hidden > 0 ? (
        <Pressable
          onPress={(e) => { e?.stopPropagation?.(); onToggleExpanded(); }}
          style={styles.earlier}
          accessibilityRole="button"
          accessibilityState={{ expanded: !!expanded }}
          aria-expanded={!!expanded}
          accessibilityLabel={expanded ? `Show last ${LOG_INLINE_SESSIONS} sessions of ${name}` : `${hidden} earlier ${hidden === 1 ? 'session' : 'sessions'} of ${name}`}
          testID={testID ? `${testID}-earlier` : undefined}
        >
          <MaterialIcons name={expanded ? 'unfold-less' : 'unfold-more'} size={16} color={muted} accessible={false} />
          <Text style={[typography['label-md'], styles.earlierText]}>
            {expanded ? `Show last ${LOG_INLINE_SESSIONS}` : `${hidden} earlier ${hidden === 1 ? 'session' : 'sessions'}`}
          </Text>
        </Pressable>
      ) : null}
      {units.map((unit, i) => {
        const folded = unit.session && !expanded && ordinal++ < hidden;
        if (!unit.session) return <React.Fragment key={unit.key}>{unit.render(null)}</React.Fragment>;
        return (
          <View key={unit.key} style={folded ? styles.folded : null}>
            {unit.render(i === lastRowIndex ? lastTone : 'old')}
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (colors, kua = null) => {
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const on = kua ? kua.onSurface : colors.text;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  const mark = kua ? kua.primary : colors.accent;
  return StyleSheet.create({
    dayHeading: { flexDirection: 'row', alignItems: 'stretch', gap: 10, paddingTop: 20, paddingBottom: 2 },
    dayHeadingFirst: { paddingTop: 8 },
    dayRail: { width: 3, borderRadius: 2, backgroundColor: mark },
    dayHeadingText: { flex: 1, fontSize: 15, lineHeight: 20, letterSpacing: 0.6, textTransform: 'uppercase', color: on },
    dayCount: { alignSelf: 'center', color: muted },
    blockLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 14, paddingBottom: 2 },
    blockLabelText: { letterSpacing: 1.2, textTransform: 'uppercase', color: kua ? kua.primaryOnContainer : colors.accentText },
    blockLabelLine: { flex: 1, height: 1, backgroundColor: border },
    exercise: { paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: border, gap: 2 },
    exerciseHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
    exerciseName: { flex: 1, fontSize: 16, lineHeight: 22, color: on },
    historyTarget: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
    trackTarget: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
    trackPill: {
      flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28, paddingHorizontal: 12,
      borderRadius: GEOMETRY['radius-md'], borderWidth: 1, borderColor: border,
    },
    trackPillOn: { backgroundColor: kua ? kua.primary : colors.accent, borderColor: kua ? kua.primary : colors.accent },
    trackText: { letterSpacing: 1.2, textTransform: 'uppercase', color: muted },
    trackTextOn: { color: kua ? kua.onPrimary : colors.background },
    earlier: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start', paddingRight: 8 },
    earlierText: { fontSize: 13, color: muted },
    folded: { display: 'none' },
    setLine: { minHeight: 30, paddingRight: 8, justifyContent: 'center' },
    setGroups: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 16 },
    // Each natural-width group wraps as one item in the session rail. Only a
    // group wider than the whole rail wraps its own text as a fallback.
    setGroup: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 4, maxWidth: '100%' },
    setWeight: { maxWidth: '100%' },
    setReps: { maxWidth: '100%' },
    oldText: { fontSize: 15, lineHeight: 22, color: muted },
    lastText: { fontSize: 17, lineHeight: 24, color: on },
    setMark: { fontSize: 13, maxWidth: '100%' },
    lastTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: GEOMETRY['radius-sm'] ?? 4, backgroundColor: kua ? kua.primaryContainer : colors.chipBackground },
    lastTagText: { fontWeight: '700', letterSpacing: 0.9, color: kua ? kua.primaryOnContainer : colors.chipAccentText },
  });
};
