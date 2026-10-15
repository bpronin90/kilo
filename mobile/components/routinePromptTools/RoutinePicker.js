import React, { useContext, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Button } from '../UI';
import { FieldLabel } from '../FieldLabel';
import { MODAL_SUPPORTED_ORIENTATIONS, dialogWidthStyle } from '../adaptiveLayout';
import { useTheme, useThemedStyles, useKuaStyle } from '../../theme/ThemeContext';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { formatDate } from '../../lib/format';
import { parseWorkoutNote } from '../../lib/parser';
import { TYPOGRAPHY } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';

const SHEET_BOTTOM_PADDING = 16;

export function routineTitle(note) {
  return String(note?.title || 'Untitled Routine');
}

// Parsed exercise count, or null when the text cannot be parsed.
export function countExercises(note) {
  const parsed = parseWorkoutNote(note?.raw_text || '');
  if (!parsed || parsed.ok === false) return null;
  return parsed.sections.reduce((sum, section) => sum + (section.exercises?.length || 0), 0);
}

// Secondary line that tells same-titled routines apart without touching
// storage: "Current · edited 10-15-2026 · 7 exercises". Missing metadata and
// unparseable text get a truthful fallback instead of a guess.
export function routineDetail(note, currentId) {
  const count = countExercises(note);
  const exercises = count == null ? 'exercises unavailable' : count === 0 ? 'no exercises' : `${count} ${count === 1 ? 'exercise' : 'exercises'}`;
  const edited = formatDate(note?.updated_at);
  return [note?.id && note.id === currentId ? 'Current' : null, edited ? `edited ${edited}` : 'edit date unknown', exercises].filter(Boolean).join(' · ');
}

// One summary row that opens a bottom sheet list; single or multi select. The
// sheet keeps Done reachable below a scrollable list and clears the home
// indicator. Selection identity is the note id, never the title.
export function RoutinePicker({ pickerKey, label, mode, notes, currentId, value, onChange, summary, sheetTitle, quickActions = [], summaryDetail = null }) {
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const styles = useThemedStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  const { bottom: bottomInset = 0 } = useContext(SafeAreaInsetsContext) || {};
  const [open, setOpen] = useState(false);
  const multi = mode === 'multi';
  const isSelected = id => (multi ? value.includes(id) : value === id);
  const choose = id => onChange(multi ? (isSelected(id) ? value.filter(v => v !== id) : [...value, id]) : id);
  const ink = kua ? kua.onSurface : colors.text;
  const accent = kua ? kua.primary : colors.accent;

  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <Pressable
        style={styles.summaryRow}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${summary}. Choose`}
        accessibilityState={{ expanded: open }}
        testID={`routine-picker-${pickerKey}`}
      >
        <View style={styles.summaryCopy}>
          <Text style={styles.rowTitle}>{summary}</Text>
          {summaryDetail ? <Text style={styles.detail}>{summaryDetail}</Text> : null}
        </View>
        <MaterialIcons name="chevron-right" size={20} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setOpen(false)}
        testID={`routine-picker-${pickerKey}-modal`}
      >
        <View style={styles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessible={false} importantForAccessibility="no" />
          <View style={[styles.sheet, dialogWidthStyle, { maxHeight: height * 0.85, paddingBottom: SHEET_BOTTOM_PADDING + bottomInset }]} testID={`routine-picker-${pickerKey}-sheet`}>
            <Text style={styles.sheetTitle} accessibilityRole="header">{sheetTitle}</Text>
            {quickActions.length ? (
              <View style={styles.quickRow}>
                {quickActions.map(action => (
                  <Pressable key={action.label} style={styles.quick} onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} testID={`routine-picker-${pickerKey}-${action.id}`}>
                    <Text style={styles.quickText}>{action.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {notes.map((note, index) => {
                const selected = isSelected(note.id);
                const detail = routineDetail(note, currentId);
                return (
                  <Pressable
                    key={note.id || `${index}`}
                    style={[styles.option, selected && { borderColor: accent }]}
                    onPress={() => choose(note.id)}
                    accessibilityRole={multi ? 'checkbox' : 'radio'}
                    accessibilityState={multi ? { checked: selected } : { selected }}
                    accessibilityLabel={`${routineTitle(note)}, ${detail}`}
                    testID={`routine-picker-${pickerKey}-option-${note.id}`}
                  >
                    <View style={styles.optionCopy}>
                      <Text style={styles.rowTitle}>{routineTitle(note)}</Text>
                      <Text style={styles.detail}>{detail}</Text>
                    </View>
                    {selected ? <MaterialIcons name="check" size={18} color={ink} accessible={false} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button title="Done" onPress={() => setOpen(false)} accessibilityLabel={`Done choosing ${label.toLowerCase()}`} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors, kua = null) => {
  const card = kua ? kua.surfaceCard : colors.card;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  const ink = kua ? kua.onSurface : colors.text;
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  return StyleSheet.create({
    summaryRow: { backgroundColor: card, borderColor: border, borderWidth: 1, borderRadius: GEOMETRY['radius-2xl'], minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
    summaryCopy: { flex: 1, gap: 2 },
    rowTitle: { color: ink, fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '600' },
    detail: { color: muted, fontSize: TYPOGRAPHY['body-sm'].fontSize, lineHeight: 18 },
    scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
    sheet: { paddingTop: 16, paddingHorizontal: 16, gap: 12, borderTopLeftRadius: GEOMETRY['radius-2xl'], borderTopRightRadius: GEOMETRY['radius-2xl'], backgroundColor: card },
    sheetTitle: { color: ink, fontSize: TYPOGRAPHY['body-lg'].fontSize, fontWeight: '600' },
    quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    quick: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: border, borderRadius: GEOMETRY['radius-lg'] },
    quickText: { color: ink, fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600' },
    list: { flexGrow: 0, flexShrink: 1 },
    listContent: { gap: 8 },
    option: { borderColor: border, borderWidth: 1, borderRadius: GEOMETRY['radius-2xl'], minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
    optionCopy: { flex: 1, gap: 2 },
  });
};
