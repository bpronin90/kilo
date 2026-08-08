import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card, Button } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { DELOAD_NOTE_PREFIX } from '../lib/LogScreenHelpers';
import { WorkoutSyntaxModal } from './WorkoutSyntaxModal';
import { SessionAutofillSheet } from './SessionAutofillSheet';

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
  deloadDateEditEnabled,
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
  showSessionAutofill = false,
  onApplySessionAutofill,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [syntaxHelpVisible, setSyntaxHelpVisible] = useState(false);
  const [autofillVisible, setAutofillVisible] = useState(false);

  return (
    <View style={styles.editContainer}>
      <WorkoutSyntaxModal
        visible={syntaxHelpVisible}
        onClose={() => setSyntaxHelpVisible(false)}
      />
      <SessionAutofillSheet
        visible={autofillVisible}
        activeText={activeEditText}
        onClose={() => setAutofillVisible(false)}
        onApply={(nextText) => {
          setAutofillVisible(false);
          onApplySessionAutofill?.(nextText);
        }}
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
            {isEditingDeloadNote && deloadDateEditEnabled && (
              <>
                <Text style={styles.inputLabel}>Date</Text>
                {Platform.OS === 'web' && editingDeloadHasLinkedRecord ? (
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
                    onPress={editingDeloadHasLinkedRecord ? () => setShowDeloadDatePicker(true) : undefined}
                    accessibilityLabel="Deload date"
                    accessibilityRole={editingDeloadHasLinkedRecord ? 'button' : 'text'}
                  >
                    <Text style={styles.dateInputText}>{deloadEditDate || '—'}</Text>
                  </Pressable>
                )}
                {editingDeloadHasLinkedRecord && (
                  <>
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
                  </>
                )}
                {editingDeloadHasLinkedRecord && showDeloadDatePicker && (
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
            <View style={styles.editorToolRow}>
              <Pressable
                onPress={() => setSyntaxHelpVisible(true)}
                style={styles.syntaxHelpButton}
                accessibilityRole="button"
                accessibilityLabel="Workout syntax help"
              >
                <Text style={styles.syntaxHelpButtonText}>Workout syntax help</Text>
              </Pressable>
              {/* Session autofill (#745 Part 3 §3.2): a plain control, never a
                  prompt, never a modal on open, never a nag. It appears only in
                  the current-routine editor once the routine has a logged
                  session, so returning users get the benefit without being
                  taught anything. */}
              {showSessionAutofill && (
                <Pressable
                  onPress={() => setAutofillVisible(true)}
                  style={styles.syntaxHelpButton}
                  accessibilityRole="button"
                  accessibilityLabel="Copy last session into this routine"
                >
                  <Text style={styles.syntaxHelpButtonText}>Copy last session</Text>
                </Pressable>
              )}
            </View>
            <TextInput
              value={editingNoteId ? editingText : activeEditText}
              onChangeText={editingNoteId ? setEditingText : handleCurrentTextChange}
              placeholder="e.g.&#10;Monday&#10;+Lifting&#10;-Bench&#10;135 5,5,5"
              placeholderTextColor={colors.textMuted}
              multiline
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              style={[styles.input, styles.editorInput]}
            />
            {(editingNoteId === 'new' || (!editingNoteId && !currentId)) ? (
              <Button
                onPress={editingNoteId ? handleSaveOtherNote : handleSave}
                title="Save"
                disabled={editingNoteId ? noteIsSaving : isSaving}
                style={styles.saveButton}
              />
            ) : saveSuccess ? (
              <Text style={styles.autosaveIndicator}>{saveSuccess}</Text>
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
            style={styles.deleteButton}
            textStyle={styles.deleteButtonText}
          />
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
  deleteButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.error,
  },
  deleteButtonText: {
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
});
