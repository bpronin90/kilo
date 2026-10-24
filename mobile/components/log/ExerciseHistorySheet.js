// Redesign v3 per-exercise history sheet (#1607, docs/design/app-redesign-v3
// "History icon → per-exercise history sheet"). A dismissible bottom sheet
// over ONE exercise occurrence's already-parsed set lines: a top-set load by
// session line (x = session index; non-numeric sessions omitted, never zero)
// with a text equivalent, then every session newest-first with the same set
// ink, units, marks and annotations as the inline Log rows. No dates are
// invented, nothing is merged across occurrences, and nothing is persisted.
import React from 'react';
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { MODAL_SUPPORTED_ORIENTATIONS } from '../adaptiveLayout';
import { useWeightUnit } from '../../lib/unitPreference';
import { formatLiftWeightValue } from '../../lib/units';
import { AnnotationNote, UnparsedRow } from '../UI';
import { LogSetLine } from './LogExerciseRows';
import { buildExerciseHistory, describeLoadPoints } from './exerciseHistoryPresentation';

const CHART_H = 96;
const LABEL_W = 48;

function LoadChart({ points, width, unit, kua, colors, typography }) {
  const fmt = (v) => formatLiftWeightValue(v, unit);
  const label = describeLoadPoints(points, unit, fmt);
  if (points.length === 0) {
    return <Text style={[typography['body-sm'], { color: kua.onSurfaceVariant, paddingVertical: 12 }]} accessibilityLabel={label}>No numeric load to chart — bodyweight, timed, skipped or unparsed sessions only.</Text>;
  }
  const loads = points.map(p => p.load);
  const min = Math.min(...loads);
  const max = Math.max(...loads);
  const maxIndex = points[points.length - 1].index;
  const minIndex = points[0].index;
  const plotW = Math.max(40, width - LABEL_W);
  const pad = 6;
  const x = (i) => (maxIndex === minIndex ? plotW / 2 : pad + ((i - minIndex) / (maxIndex - minIndex)) * (plotW - pad * 2));
  const y = (v) => (max === min ? CHART_H / 2 : pad + (1 - (v - min) / (max - min)) * (CHART_H - pad * 2));
  const line = colors.chartSeries1 || kua.primary;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} testID="exercise-history-chart">
      <View style={{ flexDirection: 'row' }}>
        <Svg width={plotW} height={CHART_H}>
          <Line x1={0} x2={plotW} y1={y(max)} y2={y(max)} stroke={kua.surfaceBorder} strokeWidth={1} />
          {max !== min ? <Line x1={0} x2={plotW} y1={y(min)} y2={y(min)} stroke={kua.surfaceBorder} strokeWidth={1} /> : null}
          {points.length > 1 ? <Polyline points={points.map(p => `${x(p.index)},${y(p.load)}`).join(' ')} fill="none" stroke={line} strokeWidth={2.5} /> : null}
          {points.map((p, i) => <Circle key={p.index} cx={x(p.index)} cy={y(p.load)} r={i === points.length - 1 ? 4.5 : 3} fill={line} />)}
        </Svg>
        <View style={{ width: LABEL_W, height: CHART_H }}>
          <Text style={[typography['label-md'], { position: 'absolute', top: y(max) - 9, left: 6, color: kua.onSurfaceVariant }]}>{fmt(max)}</Text>
          {max !== min ? <Text style={[typography['label-md'], { position: 'absolute', top: y(min) - 9, left: 6, color: kua.onSurfaceVariant }]}>{fmt(min)}</Text> : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: plotW, paddingTop: 6 }}>
        <Text style={[typography['label-md'], { color: kua.onSurfaceVariant, letterSpacing: 1.2 }]}>{`SESSION ${minIndex}`}</Text>
        <Text style={[typography['label-md'], { color: kua.onSurfaceVariant, letterSpacing: 1.2 }]}>{maxIndex === minIndex ? '' : 'LATEST'}</Text>
      </View>
    </View>
  );
}

// `target` = { exercise, context, returnRef } or null. `onClose` clears it.
export function ExerciseHistorySheet({ target, onClose }) {
  const { kuaPalette: kua, colors } = useTheme();
  const typography = useKuaTypography();
  const unit = useWeightUnit();
  const { width, height } = useWindowDimensions();
  const styles = React.useMemo(() => createStyles(kua, colors), [kua, colors]);
  const visible = !!target;
  const history = React.useMemo(() => buildExerciseHistory(target ? target.exercise : null), [target]);
  const lastTarget = React.useRef(null);
  if (target) lastTarget.current = target;
  const close = () => {
    const ref = lastTarget.current && lastTarget.current.returnRef;
    onClose();
    // Return focus to the history button that opened the sheet.
    setTimeout(() => {
      const node = ref && ref.current ? findNodeHandle(ref.current) : null;
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 0);
  };
  const sheetW = Math.min(width, 640);
  const newestFirst = [...history.sessions].reverse();
  const latestLogged = newestFirst.find(s => s.kind === 'logged');
  return (
    <Modal visible={visible} transparent animationType="slide" supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS} onRequestClose={close}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} importantForAccessibility="no" />
        {target ? (
          <View style={[styles.sheet, { width: sheetW, maxHeight: height * 0.82 }]} accessibilityViewIsModal testID="exercise-history-sheet">
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={[typography['headline-sm'], styles.title]} accessibilityRole="header">{target.exercise.name}</Text>
                <Text style={[typography['body-sm'], styles.muted]}>
                  {[...target.context, `${history.sessions.length} ${history.sessions.length === 1 ? 'session' : 'sessions'}`].join(' · ')}
                </Text>
              </View>
              <Pressable onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel={`Close ${target.exercise.name} history`} testID="exercise-history-close">
                <MaterialIcons name="close" size={24} color={kua.onSurfaceVariant} accessible={false} />
              </Pressable>
            </View>
            <ScrollView>
              <View style={styles.chartBlock}>
                <Text style={[typography['label-md'], styles.kicker]}>{`TOP-SET LOAD (${unit.toUpperCase()}) · BY SESSION`}</Text>
                <LoadChart points={history.points} width={sheetW - 40} unit={unit} kua={kua} colors={colors} typography={typography} />
              </View>
              <View style={styles.tableHead}>
                <Text style={[typography['label-md'], styles.kicker, styles.colIndex]}>#</Text>
                <Text style={[typography['label-md'], styles.kicker]}>SESSION</Text>
              </View>
              {newestFirst.length === 0 ? (
                <Text style={[typography['body-sm'], styles.muted, styles.row]}>No logged sessions yet.</Text>
              ) : newestFirst.map((s) => (
                <View key={s.index} style={styles.row} testID={`exercise-history-session-${s.index}`}>
                  <View style={styles.indexCell}><Text style={[typography['label-lg'], s === latestLogged ? styles.strong : styles.muted]}>{s.index}</Text></View>
                  <View style={{ flex: 1 }}>
                    {s.kind === 'skipped' ? <Text style={[typography['label-lg'], styles.muted]}>— Skipped</Text>
                      : s.kind === 'unparsed' ? <UnparsedRow raw={s.raw} muted selectable />
                        : <LogSetLine sets={s.sets} unit={unit} mark={s.mark} tone={s === latestLogged ? 'last' : 'old'} />}
                    {s.tail ? <AnnotationNote text={s.tail} selectable /> : null}
                    {(s.comments || []).map((c, ci) => <AnnotationNote key={ci} text={c} selectable />)}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const createStyles = (kua, colors) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: colors.overlay || 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: kua.surfaceCard, borderTopLeftRadius: GEOMETRY['radius-xl'], borderTopRightRadius: GEOMETRY['radius-xl'],
    borderWidth: 1, borderColor: kua.surfaceBorder, paddingBottom: 24,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: 10, backgroundColor: kua.surfaceBorder },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: kua.surfaceBorder },
  title: { fontSize: 20, lineHeight: 26, color: kua.onSurface },
  muted: { color: kua.onSurfaceVariant },
  strong: { color: kua.onSurface },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  chartBlock: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, gap: 10 },
  kicker: { letterSpacing: 1.2, color: kua.onSurfaceVariant },
  tableHead: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: kua.primaryContainer, borderTopWidth: 1, borderBottomWidth: 1, borderColor: kua.surfaceBorder },
  colIndex: { width: 40 },
  // Matches LogSetLine's 30dp row so the index centres on the set line.
  indexCell: { width: 40, minHeight: 30, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 8, minHeight: 44, borderBottomWidth: 1, borderBottomColor: kua.surfaceBorder },
});
