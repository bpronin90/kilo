// Session autofill — "Copy last session" (#748; #745 Part 3 §3.2).
//
// Persistence boundary, the important one: confirming writes into the EDITOR
// DRAFT via the caller's `onApply`, which routes through
// `handleCurrentTextChange` on the active-slice text. A/B splicing stays owned
// by `useLogCurrentRoutineEditor` and persistence follows the existing debounced
// autosave. This sheet performs no storage write of its own and introduces no
// new save path — the inserted rows are ordinary editable text the instant they
// land, so there is no "undo autofill" state to maintain.
//
// Composition never carries forward `*` marks or inline prose tails: each row is
// re-emitted canonically from the source entry's PARSED sets, so a claim about a
// past session cannot be re-asserted by the app.

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
import {
  buildSessionAutofillSuggestion,
  listAutofillDayGroups,
  pickDefaultDayGroup,
} from '../lib/guidedEntry';

// A routine may legitimately hold two exercises with the same name, so both the
// selection identity and the React key are the exercise's occurrence index, not
// its name. Keying on the name tied duplicate rows to one checkbox.
export function SessionAutofillSheet({ visible, activeText, onClose, onApply }) {
  const styles = useThemedStyles(createStyles);
  const [dayGroupIndex, setDayGroupIndex] = useState(null);
  const [excludedOccurrences, setExcludedOccurrences] = useState([]);
  const [applyError, setApplyError] = useState(null);

  const dayGroups = useMemo(
    () => (visible ? listAutofillDayGroups(activeText) : []),
    [visible, activeText]
  );

  // Pre-selection rule: a single day group is used with no picker; otherwise
  // today's weekday heading is pre-selected when it matches case-insensitively,
  // and nothing is pre-selected when it does not — the app never guesses which
  // day a user is training.
  useEffect(() => {
    if (!visible) return;
    setExcludedOccurrences([]);
    setApplyError(null);
    setDayGroupIndex(pickDefaultDayGroup(dayGroups));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const suggestion = useMemo(() => {
    if (!visible || dayGroupIndex == null) return null;
    // Built with every candidate included so the preview can list exclusions
    // even while the user has unchecked something.
    return buildSessionAutofillSuggestion({ activeText, dayGroupIndex, excludedOccurrences: [] });
  }, [visible, activeText, dayGroupIndex]);

  if (!visible) return null;

  const included = suggestion?.ok ? suggestion.included : [];
  const excluded = suggestion?.excluded || [];
  const selected = included.filter(item => !excludedOccurrences.includes(item.occurrence));

  const toggleExcluded = (occurrence) => {
    setApplyError(null);
    setExcludedOccurrences(prev => (
      prev.includes(occurrence) ? prev.filter(o => o !== occurrence) : [...prev, occurrence]
    ));
  };

  const handleApply = () => {
    setApplyError(null);
    const result = buildSessionAutofillSuggestion({ activeText, dayGroupIndex, excludedOccurrences });
    if (!result.ok) {
      // Withheld entirely — never partially applied, and the draft is untouched.
      setApplyError(result.reason || 'Could not build a suggestion from this note.');
      return;
    }
    onApply?.(result.nextText);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close copy last session" />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Copy last session</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close copy last session"
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {dayGroups.length > 1 && (
              <>
                <Text style={styles.label}>Day</Text>
                <View style={styles.chipRow}>
                  {dayGroups.map((group) => {
                    const isSelected = group.index === dayGroupIndex;
                    return (
                      <Pressable
                        key={group.index}
                        onPress={() => {
                          setExcludedNames([]);
                          setApplyError(null);
                          setDayGroupIndex(group.index);
                        }}
                        style={[styles.chip, isSelected ? styles.chipSelected : null]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        accessibilityLabel={`Copy from ${group.label}`}
                      >
                        <Text style={[styles.chipText, isSelected ? styles.chipTextSelected : null]}>
                          {group.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {dayGroupIndex == null ? (
              <Text style={styles.notice}>Choose which day to copy forward.</Text>
            ) : !suggestion?.ok ? (
              <Text style={styles.notice}>{suggestion?.reason || 'Nothing to copy from this day yet.'}</Text>
            ) : (
              <>
                <Text style={styles.label}>Lines to add</Text>
                {included.map((item) => {
                  const isIncluded = !excludedOccurrences.includes(item.occurrence);
                  // The chosen row is not always the immediately preceding
                  // session — a skipped or unreadable one is walked past. Say so
                  // rather than letting an older row pass for the last one.
                  const provenance = item.sessionsAgo > 0
                    ? `from ${item.sessionsAgo} session${item.sessionsAgo === 1 ? '' : 's'} ago`
                    : null;
                  return (
                    <Pressable
                      key={item.occurrence}
                      onPress={() => toggleExcluded(item.occurrence)}
                      style={styles.previewRow}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isIncluded }}
                      accessibilityLabel={
                        `Include ${item.name}, ${item.line.replace(/,/g, ' ')}${provenance ? `, ${provenance}` : ''}`
                      }
                    >
                      <View style={[styles.checkbox, isIncluded ? styles.checkboxChecked : null]}>
                        <Text style={styles.checkboxMark}>{isIncluded ? '✓' : ''}</Text>
                      </View>
                      <View style={styles.previewTextWrap}>
                        <Text style={styles.previewName}>{item.name}</Text>
                        <Text style={styles.previewLine}>{item.line}</Text>
                        {provenance ? <Text style={styles.previewProvenance}>{provenance}</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}

            {excluded.length > 0 && (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>Not included</Text>
                {/* Every exclusion states its reason in text; no meaning is
                    carried by color alone. */}
                {excluded.map((item) => (
                  <View key={item.name} style={styles.excludedRow}>
                    <Text style={styles.excludedName}>{item.name}</Text>
                    <Text style={styles.excludedReason}>{item.reason}</Text>
                  </View>
                ))}
              </>
            )}

            {applyError ? <Text style={styles.errorText}>{applyError}</Text> : null}

            <Button
              onPress={handleApply}
              title={selected.length === 1 ? 'Add 1 line' : `Add ${selected.length} lines`}
              disabled={selected.length === 0}
              style={styles.primary}
              accessibilityLabel={
                selected.length === 1
                  ? 'Add 1 line to the editor'
                  : `Add ${selected.length} lines to the editor`
              }
            />
            <Button
              onPress={onClose}
              title="Cancel"
              style={styles.tertiary}
              textStyle={styles.tertiaryText}
              accessibilityLabel="Cancel and leave the editor unchanged"
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 40,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    maxWidth: 420,
    maxHeight: '100%',
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingTop: 16,
    paddingBottom: 24,
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  labelSpaced: {
    marginTop: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: colors.chipBackground,
    borderColor: colors.chipBackground,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  chipTextSelected: {
    color: colors.chipText,
  },
  notice: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 44,
    paddingVertical: 4,
  },
  checkbox: {
    width: 24,
    height: 24,
    marginTop: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.chipBackground,
    borderColor: colors.chipBackground,
  },
  checkboxMark: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.chipText,
  },
  previewTextWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  previewName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  previewLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  previewProvenance: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  excludedRow: {
    gap: 2,
    paddingVertical: 4,
  },
  excludedName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  excludedReason: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.error,
  },
  primary: {
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  tertiary: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  tertiaryText: {
    color: colors.textMuted,
  },
});
