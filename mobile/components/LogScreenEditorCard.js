import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card, Button } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { DELOAD_NOTE_PREFIX } from '../lib/LogScreenHelpers';
import { formatDate } from '../lib/format';
import { parseWorkoutNote, applyWeekSkipToText } from '../lib/parser';
import { WorkoutSyntaxModal } from './WorkoutSyntaxModal';
import { WORKOUT_SEED_EXAMPLE_TEXT } from './WorkoutSyntaxReference';

// #863: how long to wait after the last keystroke before recomputing the
// problem list. Separate from AUTOSAVE_DEBOUNCE_MS — validation is a pure
// local reparse with no network/storage cost, so it can afford a longer
// delay while still keeping repeated typing on a large note responsive (no
// full reparse on every keystroke). Raised from 400ms (#856) to 1000ms:
// validation never blocks the TextInput (it recomputes off a debounced
// copy), so the longer window only removes any chance of the recompute
// competing with typing on a large note.
const VALIDATION_DEBOUNCE_MS = 1000;

// Offsets of the start/end of `lineNumber` (1-indexed, matching
// parseWorkoutNote's `line`/`header_line` fields) within `text`. Returns null
// for an out-of-range line (e.g. the debounced text is momentarily stale).
function _lineCharRange(text, lineNumber) {
  if (!lineNumber || lineNumber < 1) return null;
  const lines = text.split('\n');
  if (lineNumber > lines.length) return null;
  let start = 0;
  for (let i = 0; i < lineNumber - 1; i++) start += lines[i].length + 1;
  return { start, end: start + lines[lineNumber - 1].length };
}

// Character offset immediately after a single exercise's existing entries
// (and any blank lines that trail them), for placing the caret when a
// missing-session problem is selected (#863). Reuses `applyWeekSkipToText`
// (the "Skip week" marker insertion, #855) rather than re-deriving the
// section/exercise-block grammar here: a throwaway copy of `sections` is
// built where only the target exercise looks eligible for a skip marker, so
// exactly one whole line gets inserted, and the first LINE at which the
// transformed text diverges from the original marks the insertion point.
// Diffed line-by-line rather than character-by-character: the inserted
// marker line is itself "-", which shares a leading "-" with a following
// dash-header line (e.g. "-Squat") when the exercise has no trailing blank
// line — a char-by-char common-prefix scan would stop one character short,
// landing the caret inside that next header instead of before it.
// Returns null if the exercise can't be found or nothing was inserted.
function _insertionOffsetAfterExercise(text, sections, sectionIndex, exerciseName, entryCount) {
  const section = sections?.[sectionIndex];
  const exercise = section?.exercises.find(
    e => e.name === exerciseName && e.session_entries.length === entryCount
  ) ?? section?.exercises.find(e => e.name === exerciseName);
  if (!exercise) return null;

  const fakeSections = (sections || []).map(s => ({
    exercises: s.exercises.map(e => ({
      session_entries: e === exercise ? [{ skipped: false }] : [],
    })),
  }));
  const transformed = applyWeekSkipToText(text, fakeSections);
  if (transformed === text) return null;

  const originalLines = text.split('\n');
  const transformedLines = transformed.split('\n');
  let i = 0;
  while (i < originalLines.length && originalLines[i] === transformedLines[i]) i++;
  if (i >= originalLines.length) return text.length;
  return originalLines.slice(0, i).join('\n').length + 1;
}

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
  sessionAlignmentIssue,
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
  currentMode,
  editingEffectiveWeek,
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

  // Which editing "session" is live, for identity purposes (#863): resets
  // the debounce-skip below immediately, and separately clears the selected
  // problem/list (below) on note switch, deload-mode switch, entering/
  // leaving the current-routine editor, or switching A/B week while editing
  // another note. `currentMode`/`editingEffectiveWeek` are read-only signals
  // from the caller's hooks — this card never sets them.
  const editorIdentity = `${editingNoteId}:${deloadMode}:${currentMode}:${editingEffectiveWeek}`;

  // Debounced local validation (#856): syntax/alignment problems can be
  // discovered and reached without leaving edit mode. Recomputed off a
  // debounced copy of the text, not on every keystroke, so retyping a large
  // note stays responsive — the debounce is purely for this problem list;
  // the TextInput itself always reflects `editorText` immediately and no
  // text is ever rewritten or lost.
  //
  // One effect, keyed on identity as well as text, so the "skip the
  // debounce" cases — first mount, and switching to a different editing
  // session (whose text must sync immediately, not lag) — are each hit
  // exactly once and never re-arm themselves. An earlier version re-armed
  // the skip on every identity-effect run, including the initial mount,
  // which silently swallowed the FIRST real keystroke's debounce on every
  // fresh render of this card — a single edit that fixed the last error
  // could leave the problem list stale until a second edit came in.
  const [debouncedEditorText, setDebouncedEditorText] = useState(editorText);
  const validationIdentityRef = useRef(editorIdentity);
  const skipNextValidationDebounceRef = useRef(true);
  useEffect(() => {
    const identityChanged = editorIdentity !== validationIdentityRef.current;
    validationIdentityRef.current = editorIdentity;
    if (identityChanged || skipNextValidationDebounceRef.current) {
      skipNextValidationDebounceRef.current = false;
      setDebouncedEditorText(editorText);
      return undefined;
    }
    const timer = setTimeout(() => setDebouncedEditorText(editorText), VALIDATION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [editorText, editorIdentity]);

  const validationParsed = React.useMemo(
    () => parseWorkoutNote(debouncedEditorText),
    [debouncedEditorText]
  );

  // Syntax problems, given concise human-readable context instead of a
  // visible line number: the exercise they belong to (when known) plus the
  // parser's diagnostic. `id` is the logical identity a selection sticks to
  // (#863 AC8) — line-independent, so editing lines above a selected problem
  // doesn't lose the selection, and fixing the problem (which changes its
  // message or removes it) naturally drops it from the list.
  const syntaxProblems = React.useMemo(() => {
    // Two malformed rows under the same exercise can produce the identical
    // diagnostic text (e.g. the same typo repeated). A base id built from
    // just exerciseName+message would collide for both, so every occurrence
    // beyond the first in source order gets a numeric suffix — stable
    // because problems are always walked in the same top-down parse order.
    const occurrenceCounts = new Map();
    return (validationParsed.problems || []).map(p => {
      const base = `syntax:${p.exerciseName || ''}:${p.message}`;
      const occurrence = occurrenceCounts.get(base) ?? 0;
      occurrenceCounts.set(base, occurrence + 1);
      return {
        kind: 'syntax',
        id: occurrence === 0 ? base : `${base}#${occurrence}`,
        line: p.line ?? Infinity,
        severity: p.severity,
        exerciseName: p.exerciseName,
        label: p.exerciseName ? `${p.exerciseName} — ${p.message}` : p.message,
      };
    });
  }, [validationParsed]);

  // Session-alignment presentation (#863): one row per missing session
  // position for each exercise whose `missingSessionIndexes` is non-empty —
  // exercises whose authored entries already line up are left out entirely.
  // The session-alignment warning itself is already computed live by the
  // caller from the same active-week text this card renders; this is a
  // presentation-layer derivation of its `affectedExercises`, not a change
  // to the detection in deriveSessionAlignmentIssueFromSections.
  const alignmentProblems = React.useMemo(() => {
    const list = [];
    for (const exercise of sessionAlignmentIssue?.affectedExercises || []) {
      if (!exercise.missingSessionIndexes || exercise.missingSessionIndexes.length === 0) continue;
      const section = validationParsed.sections?.[exercise.sectionIndex];
      const parsedExercise = section?.exercises.find(e => e.name === exercise.name);
      for (const position of exercise.missingSessionIndexes) {
        list.push({
          kind: 'alignment',
          id: `alignment:${exercise.sectionIndex}:${exercise.name}:${position}`,
          line: parsedExercise?.header_line ?? Infinity,
          severity: 'warning',
          sectionIndex: exercise.sectionIndex,
          exerciseName: exercise.name,
          entryCount: exercise.entryCount,
          position,
          label: `${exercise.sectionLabel} · ${exercise.name} — session ${position} has no entry`,
        });
      }
    }
    return list;
  }, [sessionAlignmentIssue, validationParsed]);

  const validationProblems = React.useMemo(() => (
    [...syntaxProblems, ...alignmentProblems].sort((a, b) => a.line - b.line)
  ), [syntaxProblems, alignmentProblems]);

  // The badge/list-open affordance (#863): replaces the always-visible
  // active-problem message and standing alignment block with an on-demand
  // list, and a single dismissible bar for whichever one problem was picked.
  const [listOpen, setListOpen] = useState(false);
  const [selectedProblemId, setSelectedProblemId] = useState(null);
  useEffect(() => {
    setListOpen(false);
    setSelectedProblemId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorIdentity]);

  // Resolved from the live list on every recompute rather than cached: this
  // is what makes the bar disappear on its own once the selected problem is
  // fixed (id no longer present) and stay attached to the same logical
  // problem, at its new line, while the user edits lines above it.
  const selectedProblem = selectedProblemId
    ? (validationProblems.find(p => p.id === selectedProblemId) ?? null)
    : null;

  const handleToggleProblemList = () => setListOpen(open => !open);

  const handleSelectProblem = (problem) => {
    setListOpen(false);
    setSelectedProblemId(problem.id);
    // Only move the caret when the debounced copy matches what's on screen —
    // otherwise the line/offset math could point at stale text mid-edit. The
    // problem is still selected/announced either way.
    if (debouncedEditorText !== editorText) return;
    if (problem.kind === 'syntax') {
      const range = _lineCharRange(debouncedEditorText, problem.line);
      if (!range) return;
      setSeedSelection(range);
    } else {
      const offset = _insertionOffsetAfterExercise(
        debouncedEditorText, validationParsed.sections, problem.sectionIndex, problem.exerciseName, problem.entryCount
      );
      if (offset == null) return;
      setSeedSelection({ start: offset, end: offset });
    }
    editorInputRef.current?.focus();
  };

  const handleDismissProblemBar = () => setSelectedProblemId(null);

  const validationErrorCount = validationProblems.filter(p => p.severity === 'error').length;

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
              {validationProblems.length > 0 && (
                <Pressable
                  onPress={handleToggleProblemList}
                  style={styles.validationBadge}
                  accessibilityRole="button"
                  accessibilityLabel={
                    `${validationProblems.length} ${validationProblems.length === 1 ? 'problem' : 'problems'}`
                    + `. ${listOpen ? 'Hide' : 'Show'} problem list.`
                  }
                  accessibilityState={{ expanded: listOpen }}
                  testID="editor-validation-badge"
                >
                  <View
                    style={[
                      styles.validationBadgeCircle,
                      { borderColor: validationErrorCount > 0 ? colors.error : colors.caution },
                    ]}
                  >
                    <Text
                      style={[
                        styles.validationBadgeGlyph,
                        { color: validationErrorCount > 0 ? colors.error : colors.caution },
                      ]}
                    >
                      !
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.validationBadgeCount,
                      { color: validationErrorCount > 0 ? colors.error : colors.caution },
                    ]}
                  >
                    {validationProblems.length}
                  </Text>
                </Pressable>
              )}
            </View>
            {listOpen && validationProblems.length > 0 && (
              <ScrollView
                style={styles.validationList}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                testID="editor-validation-list"
              >
                {validationProblems.map((problem, index) => (
                  <Pressable
                    key={problem.id}
                    onPress={() => handleSelectProblem(problem)}
                    style={[
                      styles.validationListRow,
                      index > 0 && styles.validationListRowDivider,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={problem.label}
                  >
                    <Text
                      style={[
                        styles.validationListRowText,
                        problem.severity === 'error'
                          ? styles.validationListRowTextError
                          : styles.validationListRowTextWarning,
                      ]}
                    >
                      {problem.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
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
            {selectedProblem ? (
              <View
                style={styles.validationBar}
                accessibilityLiveRegion="polite"
                testID="editor-validation-bar"
              >
                <Text
                  style={[
                    styles.validationBarText,
                    selectedProblem.severity === 'error'
                      ? styles.validationBarTextError
                      : styles.validationBarTextWarning,
                  ]}
                >
                  {selectedProblem.label}
                </Text>
                <Pressable
                  onPress={handleDismissProblemBar}
                  style={styles.validationBarDismiss}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss problem message"
                >
                  <Text style={styles.validationBarDismissText}>✕</Text>
                </Pressable>
              </View>
            ) : null}
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
  // #863: help control and badge share one row, space-between so they sit
  // at opposite edges, and a common minHeight (below) so their baselines
  // align at every supported text size.
  editorToolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  syntaxHelpButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  syntaxHelpButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  // Outlined circled "!" + count (#863), replacing the standing bordered
  // warning block and the always-visible active-problem message with a
  // single quiet, on-demand affordance. Outline only, no filled surface
  // behind the glyph — a filled badge would be a new contrast pairing
  // (§13) and read as loud, the thing this replaces.
  validationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    gap: 6,
  },
  validationBadgeCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validationBadgeGlyph: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 13,
  },
  validationBadgeCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Inline, height-limited, internally scrollable problem list (#863),
  // expanded by tapping the badge. Each row is one problem, in source order,
  // labeled with human-readable context rather than a line number.
  validationList: {
    marginTop: 8,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
  },
  validationListRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  validationListRowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  validationListRowText: {
    fontSize: 13,
    lineHeight: 18,
  },
  validationListRowTextError: {
    color: colors.error,
  },
  validationListRowTextWarning: {
    color: colors.caution,
  },
  // The single dismissible bar (#863) for whichever one problem is
  // selected. Renders below the TextInput, not above it, so jumping to a
  // problem deep in a long note never scrolls the message off screen.
  validationBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
  },
  validationBarText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  validationBarTextError: {
    color: colors.error,
  },
  validationBarTextWarning: {
    color: colors.caution,
  },
  validationBarDismiss: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validationBarDismissText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
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
