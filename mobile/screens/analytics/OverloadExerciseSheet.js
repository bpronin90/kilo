import React, { useMemo } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { TYPOGRAPHY, useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { MODAL_SUPPORTED_ORIENTATIONS } from '../../components/adaptiveLayout';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { formatWorkoutSets } from '../../lib/format';
import { normalizeExerciseKey } from '../../lib/parser/workoutPure';
import { TrendPill } from './OverloadRows';

// Exercise detail sheet (redesign v3, #1604). It shows only what the row
// already derived plus the parsed set rows of that exercise under the day the
// row sits in: no new metric, no fitted series, no broadened note scope.

// The parsed logged sessions of `sig`'s exercise under its own day section of
// the current routine, newest first. An entry is one `session_entries` item, or
// one parsed row for a note without them — the unit the parser already writes.
export function overloadSessionHistory(currentSections, sig, unit) {
  const key = normalizeExerciseKey(sig.name);
  const section = (currentSections || []).find(s => s.heading === sig.currentDayHeading);
  const exercise = section?.exercises?.find(e => normalizeExerciseKey(e.name) === key);
  if (!exercise) return [];
  const entries = (exercise.session_entries || []).length > 0
    ? exercise.session_entries
    : (exercise.rows || []).map(row => ({ ...row, skipped: false }));
  return entries
    .map((entry, i) => ({
      ordinal: i + 1,
      text: entry.skipped
        ? 'Skipped'
        : (formatWorkoutSets(entry.sets, unit) || entry.raw || '—'),
      muted: Boolean(entry.skipped || entry.unparsed),
    }))
    .reverse();
}

export function OverloadExerciseSheet({ visible, model, sig, currentSections, unit, styles, colors, kua = null, onClose, onViewInLog }) {
  const reduceMotion = useReducedMotion();
  const typography = useKuaTypography();
  const { colors: themeColors, kuaPalette: themeKua } = useTheme();
  const sheet = useMemo(() => createStyles(themeColors, themeKua, typography), [themeColors, themeKua, typography]);
  if (!visible || !model || !sig) return null;
  const history = overloadSessionHistory(currentSections, sig, unit);
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const labels = ['1RM', 'Kilo', 'Best'];

  return (
    <Modal
      visible
      transparent
      supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <Pressable testID="po-sheet-backdrop" style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
      <View style={sheet.overlay} pointerEvents="box-none">
        <View testID="po-exercise-sheet" style={sheet.sheet} accessibilityViewIsModal accessibilityLabel={`${model.name} details`}>
          <View style={sheet.grabber} />
          <View style={sheet.header}>
            <View style={sheet.headerText}>
              <Text accessibilityRole="header" style={sheet.title} numberOfLines={2}>{model.name}</Text>
              <Text style={sheet.subtitle}>
                {[sig.currentDayHeading, history.length ? `${history.length} logged ${history.length === 1 ? 'session' : 'sessions'}` : null].filter(Boolean).join(' · ')}
              </Text>
              {model.status ? (
                <View style={sheet.pillRow}>
                  <TrendPill testID="po-sheet-trend" status={model.status} styles={styles} colors={colors} kua={kua} />
                </View>
              ) : null}
            </View>
            <Pressable
              testID="po-sheet-close"
              onPress={onClose}
              style={sheet.close}
              accessibilityRole="button"
              accessibilityLabel="Close exercise details"
            >
              <MaterialIcons name="close" size={22} color={muted} accessible={false} />
            </Pressable>
          </View>
          <ScrollView style={sheet.scroll} contentContainerStyle={sheet.scrollBody}>
            <View testID="po-sheet-metrics" style={sheet.metrics}>
              {model.columns.map((col, i) => (
                <View key={labels[i]} style={[sheet.metric, i > 0 ? sheet.metricDivider : null]}>
                  <Text style={sheet.metricLabel}>{col ? (col.caption || labels[i]) : labels[i]}</Text>
                  <Text style={sheet.metricValue}>{col ? `${col.text}${col.suffix ? ` ${col.suffix}` : ''}` : '—'}</Text>
                </View>
              ))}
            </View>
            {history.length > 0 ? (
              <View testID="po-sheet-history">
                <View style={sheet.historyHead}>
                  <Text style={[sheet.metricLabel, sheet.ordinalCol]}>#</Text>
                  <Text style={sheet.metricLabel}>Logged sets</Text>
                </View>
                {history.map(item => (
                  <View key={item.ordinal} style={sheet.historyRow}>
                    <Text style={[sheet.historyText, sheet.ordinalCol, item.muted ? sheet.historyMuted : null]}>{item.ordinal}</Text>
                    <Text style={[sheet.historyText, sheet.setsCol, item.muted ? sheet.historyMuted : null]}>{item.text}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
          {onViewInLog ? (
            <Pressable
              testID="po-sheet-view-in-log"
              onPress={onViewInLog}
              style={sheet.logAction}
              accessibilityRole="button"
              accessibilityLabel={`View ${model.name} in Log`}
              accessibilityHint="Opens the Log tab on your current routine"
            >
              <Text style={sheet.logActionText} accessible={false}>View in Log</Text>
              <MaterialIcons name="chevron-right" size={22} color={kua ? kua.primary : colors.accentText} accessible={false} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors, kua = null, typography = TYPOGRAPHY) => {
  const on = kua ? kua.onSurface : colors.text;
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlay,
    },
    sheet: {
      backgroundColor: kua ? kua.surfaceCard : colors.card,
      borderTopLeftRadius: GEOMETRY['radius-2xl'],
      borderTopRightRadius: GEOMETRY['radius-2xl'],
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: border,
      maxHeight: '85%',
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
      ...Platform.select({ web: { overflow: 'hidden' }, default: {} }),
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      marginTop: 8,
      backgroundColor: border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 8,
      paddingLeft: 16,
      paddingRight: 4,
      paddingTop: 8,
      paddingBottom: 12,
    },
    headerText: { flex: 1, gap: 2 },
    pillRow: { flexDirection: 'row', marginTop: 6 },
    title: { ...typography['headline-sm'], color: on },
    subtitle: { ...typography['body-sm'], color: muted },
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    scroll: { flexShrink: 1 },
    scrollBody: { paddingBottom: 8 },
    metrics: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: border,
    },
    metric: { flex: 1, paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
    metricDivider: { borderLeftWidth: 1, borderLeftColor: border },
    metricLabel: { ...typography['label-md'], color: muted, textTransform: 'uppercase' },
    metricValue: { ...typography['label-lg'], fontSize: 18, lineHeight: 24, color: on },
    historyHead: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: kua ? kua.surfaceCardHeader : colors.subtleBg,
      borderBottomWidth: 1,
      borderBottomColor: border,
    },
    historyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: border,
    },
    ordinalCol: { width: 40 },
    setsCol: { flex: 1 },
    historyText: { ...typography['label-lg'], color: on },
    historyMuted: { color: muted },
    logAction: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      borderTopWidth: 1,
      borderTopColor: border,
    },
    logActionText: { ...typography['label-lg'], color: kua ? kua.primary : colors.accentText, textTransform: 'uppercase' },
  });
};
