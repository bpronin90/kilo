import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card, Button } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { DELOAD_NOTE_PREFIX } from '../lib/LogScreenHelpers';
import { formatDate } from '../lib/format';
import { WorkoutSyntaxModal } from './WorkoutSyntaxModal';
import { WORKOUT_SEED_EXAMPLE_TEXT } from './WorkoutSyntaxReference';

// Post-save adoption prompt (#748; #745 Part 4 §A1). Lightweight, non-modal,
// and dismissible by design — an `Alert` would interrupt a user who saved a
// backlog routine and intends to walk away. `Use as current` is the visually
// primary action so the common answer is one obvious tap, but the question is
// never removed: saving a routine does not adopt it.
// Exported because the same prompt state has two render locations: below the
// editor's save control, and on the Log root when a routine was saved from the
// guided sheet and no editor is open. One state, one rule, two places it can be
// seen — never two different adoption behaviors.
export function RoutineAdoptionPrompt({ prompt, error, busy, hasCurrentRoutine, onAdopt, onDismiss }) {
  const styles = useThemedStyles(createStyles);
  const title = prompt?.title || 'Untitled Routine';

  // Announced politely on appearance so a screen-reader user learns the routine
  // saved and that a choice is waiting, without stealing focus.
  useEffect(() => {
    if (!prompt) return;
    AccessibilityInfo.announceForAccessibility?.(
      `Routine saved. Use "${title}" as your current routine?`
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.id]);

  if (!prompt) return null;

  return (
    <View
      style={styles.adoptionPrompt}
      accessibilityLiveRegion="polite"
      testID="routine-adoption-prompt"
    >
      <Text style={styles.adoptionTitle} accessibilityRole="header">Routine saved.</Text>
      <Text style={styles.adoptionBody}>
        {hasCurrentRoutine
          ? `Use "${title}" as your current routine instead of the one you have now?`
          : `Use "${title}" as your current routine?`}
      </Text>
      {error ? <Text style={styles.adoptionError}>{error}</Text> : null}
      <View style={styles.adoptionActions}>
        <Button
          onPress={onAdopt}
          title={error ? 'Try again' : 'Use as current'}
          disabled={busy}
          loading={busy}
          loadingTitle="Setting…"
          style={styles.adoptionPrimary}
          accessibilityLabel={
            error
              ? `Try again — use ${title} as your current routine`
              : `Use ${title} as your current routine`
          }
        />
        <Button
          onPress={onDismiss}
          title="Not now"
          style={styles.adoptionSecondary}
          textStyle={styles.adoptionSecondaryText}
          accessibilityLabel={`Not now — keep ${title} saved without making it current`}
        />
      </View>
    </View>
  );
}

function localDateToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Web-safe date input. The native @react-native-community/datetimepicker has no
// usable rendering on web, so on web we render a real DOM <input type="date">
// (react-native-web passes lowercase string element types through to the DOM).
// It writes the YYYY-MM-DD value straight back via onChangeDate, mirroring the
// native onChange path which also normalizes to a YYYY-MM-DD string. Capped at
// today via max, matching the native maximumDate.
function WebDateInput({ value, onChangeDate, accessibilityLabel }) {
  const { colors } = useTheme();
  return React.createElement('input', {
    type: 'date',
    value: value || '',
    max: localDateToday(),
    'aria-label': accessibilityLabel,
    onChange: (e) => {
      const next = e?.target?.value;
      if (next) onChangeDate(next);
    },
    style: {
      backgroundColor: colors.inputBackground,
      borderRadius: 16,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: colors.inputBorder,
      padding: 14,
      fontSize: 16,
      colorScheme: colors.scheme,
      color: colors.text,
      fontFamily: 'inherit',
      width: '100%',
      boxSizing: 'border-box',
    },
  });
}

export function LogScreenEditorCard({
  deloadMode,
  deloadEditText,
  setDeloadEditText,
  handleSaveDeload,
  isSaving,
  saveSuccess,
  saveError,
  editingNoteId,
  isEditingDeloadNote,
  editingTitle,
  setEditingTitle,
  workoutNoteTitle,
  setWorkoutNoteTitle,
  editingDeloadHasLinkedRecord,
  setShowDeloadDatePicker,
  deloadEditDate,
  deloadEditOrdinal,
  setDeloadEditOrdinal,
  showDeloadDatePicker,
  editingNote,
  setDeloadEditDate,
  editingText,
  setEditingText,
  activeEditText,
  handleCurrentTextChange,
  handleSaveOtherNote,
  handleSave,
  noteIsSaving,
  handleSwitchCurrent,
  handleDeleteDeloadNoteFromEditor,
  handleDeleteRoutine,
  currentId,
  adoptionPrompt,
  adoptionError,
  adoptionBusy,
  onAdoptPromptedRoutine,
  onDismissAdoptionPrompt,
  handleRevertEdit,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [syntaxHelpVisible, setSyntaxHelpVisible] = useState(false);
  // Reveal state for the compact "Date · <value>" secondary row (#764),
  // replacing the removed Settings "Edit deload dates" toggle. Collapses
  // whenever a different note is opened so it never carries a stale reveal
  // into an unrelated editor session.
  const [dateFieldOpen, setDateFieldOpen] = useState(false);
  useEffect(() => {
    setDateFieldOpen(false);
  }, [editingNoteId]);

  // Empty-note seed example (#785, R6b-1). One tap inserts the constant
  // verbatim and moves the caret to its end. `seedSelection` is deliberately
  // a one-shot forced value, not a persistent controlled selection: this card
  // stays mounted (inside a hidden ScreenShell) across editor switches, so a
  // selection left controlled indefinitely would carry into another note and
  // could re-pin the caret after the user taps elsewhere but before typing.
  // The effect below clears it the render after it's applied, and switching
  // which note/mode is being edited clears it immediately too.
  const editorInputRef = useRef(null);
  const [seedSelection, setSeedSelection] = useState(null);
  useEffect(() => {
    if (!seedSelection) return undefined;
    const timer = setTimeout(() => setSeedSelection(null), 0);
    return () => clearTimeout(timer);
  }, [seedSelection]);
  useEffect(() => {
    setSeedSelection(null);
  }, [editingNoteId, deloadMode]);
  const editorText = editingNoteId ? editingText : activeEditText;
  const setEditorText = editingNoteId ? setEditingText : handleCurrentTextChange;
  const handleInsertSeedExample = () => {
    setEditorText(WORKOUT_SEED_EXAMPLE_TEXT);
    setSeedSelection({ start: WORKOUT_SEED_EXAMPLE_TEXT.length, end: WORKOUT_SEED_EXAMPLE_TEXT.length });
    editorInputRef.current?.focus();
  };

  return (
    <View style={styles.editContainer}>
      <WorkoutSyntaxModal
        visible={syntaxHelpVisible}
        onClose={() => setSyntaxHelpVisible(false)}
      />
      {deloadMode === 'edit' ? (
        <Card>
          <TextInput
            value={deloadEditText}
            onChangeText={setDeloadEditText}
            placeholder="Deload note…"
            placeholderTextColor={colors.textMuted}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            style={[styles.input, styles.editorInput]}
          />
          <Button
            onPress={handleSaveDeload}
            title={saveSuccess ? 'Saved!' : 'Save changes'}
            disabled={isSaving}
            style={styles.saveButton}
          />
        </Card>
      ) : (
        <>
          <Card>
            {!isEditingDeloadNote && (
              <TextInput
                value={editingNoteId ? editingTitle : workoutNoteTitle}
                onChangeText={editingNoteId ? setEditingTitle : setWorkoutNoteTitle}
                placeholder="Routine Name (e.g. Push Day)"
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
                style={[styles.input, styles.titleInput]}
              />
            )}
            {isEditingDeloadNote && (
              <>
                {/* Compact, discoverable "Date · <value>" secondary row (#764),
                    replacing the removed Settings "Edit deload dates" toggle.
                    The linked-record safety boundary is preserved: when there
                    is no linked history record the row is shown but disabled,
                    never removed, so its accessible state still communicates
                    why the date can't be changed. */}
                <Pressable
                  style={styles.dateDisclosureRow}
                  onPress={editingDeloadHasLinkedRecord ? () => setDateFieldOpen(o => !o) : undefined}
                  accessibilityRole="button"
                  accessibilityLabel={`Date, ${deloadEditDate ? formatDate(deloadEditDate) : '—'}${editingDeloadHasLinkedRecord ? '' : '. Unavailable for this record'}`}
                  accessibilityState={{ disabled: !editingDeloadHasLinkedRecord, expanded: dateFieldOpen }}
                >
                  <Text style={styles.dateDisclosureText}>
                    {`Date · ${deloadEditDate ? formatDate(deloadEditDate) : '—'}`}
                  </Text>
                </Pressable>
                {editingDeloadHasLinkedRecord && dateFieldOpen && (
                  <>
                    <Text style={styles.inputLabel}>Date</Text>
                    {Platform.OS === 'web' ? (
                      <View style={styles.dateInputWebWrap}>
                        <WebDateInput
                          value={deloadEditDate}
                          onChangeDate={(newDateStr) => {
                            setDeloadEditDate(newDateStr);
                            setEditingTitle(DELOAD_NOTE_PREFIX + newDateStr);
                          }}
                          accessibilityLabel="Deload date"
                        />
                      </View>
                    ) : (
                      <Pressable
                        style={[styles.input, styles.dateInput]}
                        onPress={() => setShowDeloadDatePicker(true)}
                        accessibilityLabel="Deload date"
                        accessibilityRole="button"
                      >
                        <Text style={styles.dateInputText}>{deloadEditDate || '—'}</Text>
                      </Pressable>
                    )}
                    <Text style={styles.inputLabel}>Session #</Text>
                    <TextInput
                      style={styles.input}
                      value={deloadEditOrdinal}
                      onChangeText={v => setDeloadEditOrdinal(v.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      placeholder="Session number"
                      placeholderTextColor={colors.textMuted}
                      autoCorrect={false}
                      autoCapitalize="none"
                      spellCheck={false}
                      accessibilityLabel="Deload session number"
                    />
                    <Pressable
                      onPress={() => setDateFieldOpen(false)}
                      accessibilityRole="button"
                      accessibilityLabel="Done changing deload date"
                    >
                      <Text style={styles.dateDisclosureDoneText}>Done</Text>
                    </Pressable>
                    {showDeloadDatePicker && (
                      <DateTimePicker
                        value={(() => {
                          if (deloadEditDate) {
                            const [y, m, d] = deloadEditDate.split('-').map(Number);
                            return new Date(y, m - 1, d);
                          }
                          return new Date();
                        })()}
                        mode="date"
                        display="default"
                        maximumDate={new Date()}
                        onChange={(event, selectedDate) => {
                          setShowDeloadDatePicker(false);
                          if (selectedDate) {
                            const y = selectedDate.getFullYear();
                            const mo = String(selectedDate.getMonth() + 1).padStart(2, '0');
                            const dy = String(selectedDate.getDate()).padStart(2, '0');
                            const newDateStr = `${y}-${mo}-${dy}`;
                            setDeloadEditDate(newDateStr);
                            setEditingTitle(DELOAD_NOTE_PREFIX + newDateStr);
                          }
                        }}
                        onDismiss={() => setShowDeloadDatePicker(false)}
                      />
                    )}
                  </>
                )}
              </>
            )}
            <View style={styles.editorToolRow}>
              <Pressable
                onPress={() => setSyntaxHelpVisible(true)}
                style={styles.syntaxHelpButton}
                accessibilityRole="button"
                accessibilityLabel="Workout syntax help"
              >
                <Text style={styles.syntaxHelpButtonText}>Workout syntax help</Text>
              </Pressable>
            </View>
            <TextInput
              ref={editorInputRef}
              value={editorText}
              onChangeText={(next) => {
                setSeedSelection(null);
                setEditorText(next);
              }}
              selection={seedSelection ?? undefined}
              placeholder="e.g.&#10;Monday&#10;+Lifting&#10;-Bench&#10;135 5,5,5"
              placeholderTextColor={colors.textMuted}
              multiline
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              style={[styles.input, styles.editorInput]}
            />
            {editorText.trim() === '' && (
              <Pressable
                onPress={handleInsertSeedExample}
                style={styles.seedBlock}
                accessibilityRole="button"
                accessibilityLabel="Insert example workout note"
              >
                <Text style={styles.seedHint}>Tap to try this example:</Text>
                {WORKOUT_SEED_EXAMPLE_TEXT.split('\n').map((line, idx) => (
                  <Text key={idx} style={styles.seedLineText}>{line}</Text>
                ))}
              </Pressable>
            )}
            {(editingNoteId === 'new' || (!editingNoteId && !currentId)) ? (
              <Button
                onPress={editingNoteId ? handleSaveOtherNote : handleSave}
                title="Save"
                disabled={editingNoteId ? noteIsSaving : isSaving}
                style={styles.saveButton}
              />
            ) : saveSuccess ? (
              <Text style={styles.autosaveIndicator} accessibilityLiveRegion="polite">{saveSuccess}</Text>
            ) : null}
            {/* A failed write must be visible where the write was asked for.
                Without this the `Save & Switch` save-failure path (#745 Part 6
                P6) was silent, which reads as a cancelled adoption rather than
                as the app failing. */}
            {saveError ? (
              <Text style={styles.saveErrorText} accessibilityLiveRegion="polite">{saveError}</Text>
            ) : null}
            <RoutineAdoptionPrompt
              prompt={adoptionPrompt}
              error={adoptionError}
              busy={adoptionBusy}
              hasCurrentRoutine={!!currentId}
              onAdopt={onAdoptPromptedRoutine}
              onDismiss={onDismissAdoptionPrompt}
            />
          </Card>
          {/* Never rendered for an unsaved routine (#745 Part 3 §2.3). The
              sentinel `'new'` has no note to switch to, so this control was a
              right-looking, reachable, inert affordance — the worst available
              failure mode. Adoption for a brand-new routine is offered by the
              post-save prompt above instead. */}
          {editingNoteId && editingNoteId !== 'new' && !isEditingDeloadNote && (
            <Button
              onPress={() => handleSwitchCurrent(editingNoteId)}
              title="Set as current routine"
              style={styles.switchButton}
              textStyle={styles.switchButtonText}
            />
          )}
          <View style={styles.dangerZone}>
            <View style={styles.dangerZoneHeading}>
              <Text style={styles.dangerZoneHeadingText}>⚠ Danger Zone</Text>
            </View>
            <Button
              onPress={handleRevertEdit}
              title={(editingNoteId === 'new' || (!editingNoteId && !currentId)) ? 'Clear draft' : 'Revert this edit'}
              tone="danger"
            />
            <Button
              onPress={() => {
                if (editingNoteId) {
                  if (isEditingDeloadNote) {
                    handleDeleteDeloadNoteFromEditor();
                  } else {
                    handleDeleteRoutine(editingNoteId, editingTitle || 'Untitled Routine', false);
                  }
                } else {
                  handleDeleteRoutine(currentId, workoutNoteTitle || 'Untitled Routine', true);
                }
              }}
              title={isEditingDeloadNote ? 'Delete deload record' : 'Delete routine'}
              tone="danger"
            />
          </View>
        </>
      )}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  editContainer: {
    gap: 16,
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  titleInput: {
    marginBottom: 12,
    fontWeight: '700',
  },
  editorInput: {
    minHeight: 250,
    textAlignVertical: 'top',
  },
  saveButton: {
    marginTop: 12,
  },
  // Empty-note seed example (#785). A tinted block matching the syntax-help
  // code block styling (§4: no nested Card), tappable at minHeight 44.
  seedBlock: {
    marginTop: 8,
    backgroundColor: colors.inputBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 10,
    minHeight: 44,
    justifyContent: 'center',
    gap: 2,
  },
  seedHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  seedLineText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: colors.text,
  },
  editorToolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
  },
  syntaxHelpButton: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  syntaxHelpButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  switchButtonText: {
    color: colors.accent,
  },
  // Irreversible-action container (#823, ui-design-rules.md §14): groups
  // Delete apart from the routine-management Buttons above it, matching
  // BackupScreen's "Wipe Device Data" reference implementation.
  dangerZone: {
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  dangerZoneHeading: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerZoneHeadingText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.error,
  },
  autosaveIndicator: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: 8,
  },
  saveErrorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.error,
    marginTop: 8,
  },
  // A tinted block, not a nested Card (§4): ordinary `text`/`textMuted` ink on
  // the shared subtle surface, so it introduces no new filled surface + label
  // pairing and needs no new contrast entry (§13).
  adoptionPrompt: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.subtleBg,
    gap: 6,
  },
  adoptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  adoptionBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  adoptionError: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.error,
  },
  // Stacks vertically at large text rather than squeezing two pills onto one
  // line; no fixed heights, so every label wraps instead of truncating.
  adoptionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  adoptionPrimary: {
    flexGrow: 1,
    flexBasis: 160,
    minHeight: 44,
    justifyContent: 'center',
  },
  adoptionSecondary: {
    flexGrow: 1,
    flexBasis: 120,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  adoptionSecondaryText: {
    color: colors.textMuted,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 4,
  },
  dateInput: {
    justifyContent: 'center',
    marginBottom: 12,
  },
  dateInputWebWrap: {
    marginBottom: 12,
  },
  dateInputText: {
    fontSize: 16,
    color: colors.text,
  },
  // Compact secondary "Date · <value>" disclosure row (#764), replacing the
  // removed Settings "Edit deload dates" toggle. minHeight 44 for the touch
  // target; disabled styling communicates the linked-record safety boundary
  // without removing the row (accessibilityState carries the same fact for
  // screen readers).
  dateDisclosureRow: {
    minHeight: 44,
    justifyContent: 'center',
    marginBottom: 4,
  },
  dateDisclosureText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  dateDisclosureDoneText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
    marginBottom: 8,
  },
});
