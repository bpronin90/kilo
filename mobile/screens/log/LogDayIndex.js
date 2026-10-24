// Sticky day index for the current-routine card (#1606, redesign v3 "Log").
// One chip per parsed day group that carries a heading — the parser's own
// headings (any label: "Monday — Upper", "Day 1", "Push"), never fixture
// weekdays — in note order, keyed by the group's index so repeated headings
// stay distinct. Tapping a chip scrolls the read view to that group; while the
// card's own index has scrolled away and the card is still on screen, the same
// chips float pinned under the root header. Layout offsets are transient and
// are dropped whenever the routine, A/B slice or parsed text changes.
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useThemedStyles } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { centeredColumnInsets } from '../../components/adaptiveLayout';
import { useReducedMotion } from '../../lib/useReducedMotion';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Display-only split of a parsed heading into the chip's two lines. The
// heading itself (and every parse result) is untouched.
export function deriveLogDays(dayGroups = []) {
  const days = [];
  dayGroups.forEach((group, index) => {
    const heading = typeof group?.heading === 'string' ? group.heading.trim() : '';
    if (!heading) return;
    const m = heading.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    const head = (m ? m[1] : heading).trim();
    const weekday = WEEKDAYS.includes(head.toLowerCase());
    days.push({ index, heading, label: weekday ? head.slice(0, 3) : head, sub: m ? m[2].trim() : null });
  });
  return days;
}

// A tiny external store so scroll events re-render only the index chips,
// never the whole Log read view.
export function useLogDayNav({ scrollRef, scopeKey }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef(null);
  if (!ref.current) {
    ref.current = { y: 0, cardY: 0, cardH: 0, indexY: 0, indexH: 0, bodyY: 0, dayY: {}, listeners: new Set(), snap: { stuck: false, active: null } };
  }
  const recompute = useCallback(() => {
    const s = ref.current;
    const top = s.cardY + s.indexY;
    const stuck = s.indexH > 0 && s.y > top + s.indexH && s.y < s.cardY + s.cardH - s.indexH * 2;
    let active = null;
    Object.keys(s.dayY).map(Number).sort((a, b) => s.dayY[a] - s.dayY[b]).forEach((i) => {
      if (s.cardY + s.bodyY + s.dayY[i] <= s.y + s.indexH + 24) active = i;
    });
    if (stuck !== s.snap.stuck || active !== s.snap.active) {
      s.snap = { stuck, active };
      s.listeners.forEach(fn => fn(s.snap));
    }
  }, []);
  useEffect(() => {
    ref.current.dayY = {};
    ref.current.snap = { stuck: false, active: null };
    ref.current.listeners.forEach(fn => fn(ref.current.snap));
  }, [scopeKey]);
  return useMemo(() => {
    const set = (patch) => { Object.assign(ref.current, patch); recompute(); };
    return {
      subscribe: (fn) => { ref.current.listeners.add(fn); return () => ref.current.listeners.delete(fn); },
      snapshot: () => ref.current.snap,
      onScroll: (e) => set({ y: e?.nativeEvent?.contentOffset?.y ?? 0 }),
      onCardLayout: (e) => set({ cardY: e.nativeEvent.layout.y, cardH: e.nativeEvent.layout.height }),
      onIndexLayout: (e) => set({ indexY: e.nativeEvent.layout.y, indexH: e.nativeEvent.layout.height }),
      onBodyLayout: (e) => set({ bodyY: e.nativeEvent.layout.y }),
      onDayLayout: (i, y) => { ref.current.dayY = { ...ref.current.dayY, [i]: y }; recompute(); },
      jumpTo: (i) => {
        const s = ref.current;
        if (s.dayY[i] == null) return;
        const y = Math.max(0, s.cardY + s.bodyY + s.dayY[i] - s.indexH - 4);
        scrollRef?.current?.scrollTo?.({ y, animated: !reduceMotion });
        set({ y });
      },
    };
  }, [recompute, scrollRef, reduceMotion]);
}

function useNavSnapshot(nav) {
  const [snap, setSnap] = useState(() => (nav ? nav.snapshot() : { stuck: false, active: null }));
  useEffect(() => (nav ? nav.subscribe(setSnap) : undefined), [nav]);
  return snap;
}

function DayChips({ days, nav, active, testID }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const current = active ?? days[0]?.index;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist" testID={testID}>
      {days.map((day) => {
        const on = day.index === current;
        return (
          <Pressable
            key={`day-${day.index}`}
            onPress={(e) => { e?.stopPropagation?.(); nav?.jumpTo(day.index); }}
            style={[styles.chip, on ? styles.chipOn : null]}
            accessibilityRole="tab"
            accessibilityLabel={day.heading}
            accessibilityHint="Scrolls to this day"
            accessibilityState={{ selected: on }}
          >
            <Text style={[typography['label-md'], styles.chipLabel, on ? styles.chipTextOn : null]} numberOfLines={1}>{day.label}</Text>
            {day.sub ? <Text style={[typography['body-sm'], styles.chipSub, on ? styles.chipTextOn : null]} numberOfLines={1}>{day.sub}</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// The card's own index row (sits between the card header and its body).
export function LogDayIndex({ days, nav }) {
  const styles = useThemedStyles(createStyles);
  const { active } = useNavSnapshot(nav);
  if (!days || days.length < 2) return null;
  return (
    <View style={styles.inline} onLayout={nav?.onIndexLayout}>
      <DayChips days={days} nav={nav} active={active} testID="log-day-index" />
    </View>
  );
}

// The pinned copy, absolutely positioned under the root header (`top`).
export function LogDayIndexOverlay({ days, nav, top }) {
  const styles = useThemedStyles(createStyles);
  const { stuck, active } = useNavSnapshot(nav);
  const { left: l = 0, right: r = 0 } = useContext(SafeAreaInsetsContext) || {};
  const { width } = useWindowDimensions();
  const column = centeredColumnInsets(width, { left: l, right: r });
  if (!stuck || !days || days.length < 2) return null;
  return (
    <View style={[styles.overlay, { top, left: column.left, right: column.right }]} testID="log-day-index-pinned">
      <DayChips days={days} nav={nav} active={active} />
    </View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  inline: { borderBottomWidth: 1, borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder },
  overlay: {
    position: 'absolute', zIndex: 5,
    backgroundColor: kua ? kua.surfaceCard : colors.card,
    borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 1,
    borderLeftColor: kua ? kua.primary : colors.accent, borderRightColor: kua ? kua.primary : colors.accent,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  chips: { flexGrow: 1, gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  chip: {
    flexGrow: 1, minWidth: 72, minHeight: 44, paddingHorizontal: 12, paddingVertical: 4, justifyContent: 'center',
    borderRadius: GEOMETRY['radius-lg'], borderWidth: 1, borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  chipOn: { borderColor: kua ? kua.primary : colors.accent, backgroundColor: kua ? kua.primaryContainer : colors.chipBackground },
  chipLabel: { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, color: kua ? kua.onSurface : colors.text },
  chipSub: { fontSize: 12, lineHeight: 16, color: kua ? kua.onSurfaceVariant : colors.textMuted },
  chipTextOn: { color: kua ? kua.primaryOnContainer : colors.chipAccentText },
});
