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

// #886: the raw-text editor input's own vertical padding, shared with the
// `input` style below so the source-jump measurement and the rendered box can
// never drift apart.
const EDITOR_INPUT_VERTICAL_PADDING = 14;

// #886: and the horizontal inset of the same box — border included — so the
// measuring mirror below wraps at exactly the width the input wraps at. Both
// are applied to `styles.input` itself (#888), so the mirror's width math and
// the box it describes cannot drift apart.
const EDITOR_INPUT_HORIZONTAL_PADDING = 14;
const EDITOR_INPUT_BORDER_WIDTH = 1;
const EDITOR_INPUT_TEXT_INSET = (EDITOR_INPUT_HORIZONTAL_PADDING + EDITOR_INPUT_BORDER_WIDTH) * 2;

// #867: the gap between the editor tool row and the problem list that opens
// under it. The list is an overlay, not an in-flow row (see `validationList`
// below), so this is its `top` offset from the bottom of the tool row rather
// than a margin.
const VALIDATION_LIST_TOP_GAP = 8;

// #867: how far apart the tool row and the note sit inside `editorStack`.
// Mirrors the surrounding Card's own `gap`, so pulling those two controls into
// their own positioning context changes no spacing.
const EDITOR_STACK_GAP = 10;

// #886: how many frames a source jump will wait for the editor surface to
// finish laying out before giving up on measuring it. The surface is
// `display: none` until the frame the editor opens on, so the first
// measurement can legitimately come back with a zero height.
const SOURCE_JUMP_MEASURE_ATTEMPTS = 5;

// #886: hard ceiling on that same wait. A native measure that never answers
// must not leave the jump un-released, so the placement is abandoned and the
// caller falls back to its deterministic landing.
const SOURCE_JUMP_MEASURE_TIMEOUT_MS = 250;

// #886: splits the note at the START of the line holding `targetOffset`, so
// the two halves can be measured as the "above the target" / "target and
// below" split. The separating newline is dropped: each half is measured as
// its own block, and the block boundary reproduces that line break exactly.
// Returns null when the target is on the first line — there is nothing above
// it to measure, and an empty block does not measure as zero everywhere.
function _splitAtTargetLine(text, targetOffset) {
  const clamped = Math.min(Math.max(0, targetOffset), text.length);
  const breakAt = text.lastIndexOf('\n', Math.max(0, clamped - 1));
  if (breakAt < 0) return null;
  return { above: text.slice(0, breakAt), below: text.slice(breakAt + 1) };
}

// #886: where the target line sits inside the editor's scroll content.
//
// `aboveHeight / (aboveHeight + belowHeight)` comes from mirroring the note's
// own text at the input's own text width (see `sourceJumpMirror` below), so
// the split is by RENDERED rows: a wrapped line counts for every row it
// actually occupies. Counting newline-delimited lines instead would disagree
// with the measured `inputHeight`, which counts wrapped rows, and a cluster of
// long lines anywhere in the note would then throw the landing off by however
// many rows those lines wrapped to (PR #887 review / Codex P1).
//
// That row fraction is then taken as a share of the input's OWN measured text
// height, so the platform's real per-row metric is baked in too and nothing
// here has to guess a line height.
function _sourceJumpContentOffset({ containerY, inputY, inputHeight, aboveHeight, belowHeight }) {
  const textHeight = Math.max(0, inputHeight - EDITOR_INPUT_VERTICAL_PADDING * 2);
  const mirrored = aboveHeight + belowHeight;
  const fraction = mirrored > 0 ? Math.min(1, Math.max(0, aboveHeight / mirrored)) : 0;
  return containerY + inputY + EDITOR_INPUT_VERTICAL_PADDING + textHeight * fraction;
}

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

// Length of the common leading run and common trailing run between two line
// arrays (a minimal single-hunk diff): everything before `prefix` and
// everything from `lines.length - suffix` onward is identical between the
// two versions, and only the run in between actually changed. `prefix` and
// `suffix` never overlap.
function _commonPrefixSuffixLineCounts(oldLines, newLines) {
  const maxLen = Math.min(oldLines.length, newLines.length);
  let prefix = 0;
  while (prefix < maxLen && oldLines[prefix] === newLines[prefix]) prefix++;
  const maxSuffix = maxLen - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++;
  return { prefix, suffix };
}

// Follows one specific 0-based line index from `oldLines` across a single
// edit into `newLines` (#863 review): a selected syntax problem must stay
// attached to its own physical row when lines shift above it — including
// when another row elsewhere happens to hold byte-identical text (two
// identical typos in the same exercise) — and must correctly detach only
// when that specific row's own text actually changed or was removed.
// Line-number- or offset-based ids can't tell "moved" from "a duplicate
// sibling moved into the old slot" apart; this instead uses the standard
// common-prefix/common-suffix single-hunk diff: a line inside the
// untouched prefix or suffix maps straight across (by index, or by offset
// from the end), and a line inside the changed middle region maps only if
// its exact text still appears verbatim somewhere in the new middle
// segment (the row merely moved) — otherwise there's no correspondence
// (the row itself was edited or deleted) and null is returned.
function _mapLineIndexAcrossEdit(oldLines, newLines, oldIndex) {
  const { prefix, suffix } = _commonPrefixSuffixLineCounts(oldLines, newLines);
  if (oldIndex < prefix) return oldIndex;
  if (oldIndex >= oldLines.length - suffix) return newLines.length - (oldLines.length - oldIndex);
  const newMiddleEnd = newLines.length - suffix;
  const target = oldLines[oldIndex];
  for (let i = prefix; i < newMiddleEnd; i++) {
    if (newLines[i] === target) return i;
  }
  return null;
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

// #867: hand a JS-driven selection straight to the native input, returning
// whether the command actually went out.
//
// The controlled `selection` prop cannot carry a problem jump reliably. RN
// 0.81's `useTextInputStateSynchronization` forwards a selection to native
// ONLY when the requested range differs from `lastNativeSelection` — the last
// range it pushed or that native reported back. So a range native already
// holds but no longer SHOWS (focus moved, a relayout collapsed the highlight,
// the same problem is picked twice) produces no native command at all, and the
// malformed line is never highlighted (#867 acceptance 1/5/6). Holding the
// prop instead of releasing it has the opposite failure: every later render
// re-pushes the range, which is the caret/scroll pinning #865 had to unwind
// with a timer.
//
// The imperative command has neither property. It always reaches native —
// `TextInput`'s `setSelection` calls `setTextAndSelection` unconditionally,
// with a null text so the note itself is untouched — and it leaves nothing in
// React state for a later render to reapply, so opening or closing the problem
// list cannot move the caret (#867 acceptance 3/4).
//
// Renderers that expose no such command fall back to the one-shot controlled
// prop: react-native-web hands back the DOM `<textarea>` (which does the same
// job through `setSelectionRange`), and react-test-renderer hands back nothing
// at all unless a node mock is supplied.
function _applyNativeSelection(input, range) {
  if (!input) return false;
  if (typeof input.setSelection === 'function') {
    input.setSelection(range.start, range.end);
    return true;
  }
  if (typeof input.setSelectionRange === 'function') {
    input.setSelectionRange(range.start, range.end);
    return true;
  }
  return false;
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

// Shared visual status for the full-screen and Recovery editors. The hooks
// compute `status` only while the live {title, raw_text} still matches the
// snapshot described by it. Rendering is immediate; only the accessibility
// announcement is debounced. Delaying the visible label would leave a stale
// "Saved" claim on screen after the user typed, violating the exact-snapshot
// contract.
const SAVE_STATUS_ANNOUNCE_DEBOUNCE_MS = 220;

export function computeSaveStatusLabel({ status, savedLabel = 'Saved on device' }) {
  if (status === 'saving') return 'Saving…';
  if (status === 'saved') return savedLabel;
  if (status === 'pending') return 'Saved on device · Not yet synced';
  return '';
}

export function SaveStatusRegion({ status, savedLabel, style, testID }) {
  const styles = useThemedStyles(createStyles);
  const label = computeSaveStatusLabel({ status, savedLabel });
  const timerRef = useRef(null);
  const mountedRef = useRef(false);
  const previousLabelRef = useRef(label);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      previousLabelRef.current = label;
      return undefined;
    }
    if (label === previousLabelRef.current) return undefined;
    previousLabelRef.current = label;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!label) return undefined;
    // Capture the native function while the effect is active. Besides making
    // the callback independent of later module teardown, this avoids touching
    // React Native's lazy export getter from a delayed callback.
    const announce = AccessibilityInfo.announceForAccessibility;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      announce?.(label);
    }, SAVE_STATUS_ANNOUNCE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [label]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <View style={[styles.saveStatusRegion, style]} testID={testID}>
      <Text
        style={styles.autosaveIndicator}
        accessibilityLiveRegion="none"
        accessible={!!label}
        accessibilityLabel={label || undefined}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label || '\u00a0'}
      </Text>
    </View>
  );
}

export function LogScreenEditorCard({
  deloadMode,
  deloadEditText,
  setDeloadEditText,
  handleSaveDeload,
  isSaving,
  saveSuccess,
  saveError,
  saveStatus,
  onEditorInteraction,
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
  // #881 (F10a §4/§6): a double-tapped exercise's resolved source jump,
  // reusing this card's existing one-shot `problemSelectionRequest`
  // scaffolding rather than a parallel mechanism. `null` unless the pending
  // jump targets THIS surface (current editor or a non-Recovery other note)
  // — LogScreen filters out a Recovery-sourced jump before it ever reaches
  // this prop, since Recovery applies its own equivalent locally.
  pendingSourceJump = null,
  onSourceJumpApplied,
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
  // Fallback path only (#867). Every problem jump now goes to native through
  // `_applyNativeSelection`; this controlled one-shot is used solely when the
  // renderer exposes no imperative selection command. It applies the range for
  // one render and then releases control so badge/list renders cannot reapply
  // a stale range. iOS does not emit onSelectionChange for JS-driven
  // selections, so the timer is the guaranteed completion path; the handler
  // below releases earlier when native does report any subsequent selection
  // (#865).
  const [problemSelectionRequest, setProblemSelectionRequest] = useState(null);
  useEffect(() => {
    if (!seedSelection) return undefined;
    const timer = setTimeout(() => setSeedSelection(null), 0);
    return () => clearTimeout(timer);
  }, [seedSelection]);
  useEffect(() => {
    if (!problemSelectionRequest) return undefined;
    const timer = setTimeout(() => setProblemSelectionRequest(null), 0);
    return () => clearTimeout(timer);
  }, [problemSelectionRequest]);
  useEffect(() => {
    setSeedSelection(null);
    setProblemSelectionRequest(null);
  }, [editingNoteId, deloadMode]);
  const editorText = editingNoteId ? editingText : activeEditText;
  const setEditorText = editingNoteId ? setEditingText : handleCurrentTextChange;

  // #867: the single way this card moves the note's selection or caret.
  // Focus first — Android's EditText only paints a selection highlight while
  // it holds focus, and `onTakeFocus` can move the caret on its own, so the
  // range has to be applied after the focus command, not before it.
  const requestEditorSelection = (range) => {
    const input = editorInputRef.current;
    input?.focus?.();
    if (_applyNativeSelection(input, range)) {
      // Native owns the selection now and no React state describes it, so
      // nothing a later render does can reapply, release, or fight it.
      setProblemSelectionRequest(null);
      return;
    }
    setProblemSelectionRequest(range);
  };

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
  // parser's diagnostic. `id` here is only for React's list key — it is
  // NOT used to track a selection across edits (see the line-tracking
  // effect below `selectedAnchor`), so it doesn't need to survive a
  // recompute; a line number is always unique within one parse.
  const syntaxProblems = React.useMemo(() => (
    (validationParsed.problems || []).map(p => ({
      kind: 'syntax',
      id: `syntax:${p.line}`,
      line: p.line ?? Infinity,
      severity: p.severity,
      exerciseName: p.exerciseName,
      label: p.exerciseName ? `${p.exerciseName} — ${p.message}` : p.message,
    }))
  ), [validationParsed]);

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
  // The selection itself is `selectedAnchor`, not a problem object: an
  // alignment anchor is its stable position-based id; a syntax anchor is
  // the LINE it currently sits on, kept in sync (below) as edits shift or
  // resolve it, since two identical-text duplicate rows in the same
  // exercise cannot be told apart by content alone.
  const [listOpen, setListOpen] = useState(false);
  const [selectedAnchor, setSelectedAnchor] = useState(null);
  // #867: the tool row's own measured height, which is where the overlaid
  // problem list starts. Measured rather than assumed because the row's
  // controls wrap at large text sizes.
  const [toolRowHeight, setToolRowHeight] = useState(0);
  useEffect(() => {
    setListOpen(false);
    setSelectedAnchor(null);
    setProblemSelectionRequest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorIdentity]);

  // #886 source-jump placement. `editContainerRef`/`editContainerYRef` give
  // the card's own origin inside the editor scroll content (this View is a
  // direct child of ScreenShell's content container, so its layout `y` IS a
  // scroll offset); the input is then measured relative to it, which is what
  // lets the offset be computed without this card ever holding the scroll ref.
  const editContainerRef = useRef(null);
  const editContainerYRef = useRef(0);
  const appliedSourceJumpTokenRef = useRef(null);
  const sourceJumpFrameRef = useRef(null);
  const sourceJumpTimerRef = useRef(null);
  const sourceJumpMirrorRef = useRef(null);
  const mountedRef = useRef(true);
  // Which placement pass owns the surface. A native `measureLayout` callback
  // cannot be recalled once issued, so cancelling is not enough on its own:
  // every callback checks this generation and a superseded one goes inert
  // rather than reporting an offset for an exercise the user has moved on
  // from, or overwriting the live pass's mirror (PR #887 review).
  const sourceJumpPassRef = useRef(0);
  // The invisible mirror of the note's own text, rendered only while a jump
  // is being placed. `null` the rest of the time, so nothing measures or
  // lays out a second copy of a long note during ordinary editing.
  const [sourceJumpMirror, setSourceJumpMirror] = useState(null);
  const cancelSourceJumpMeasure = () => {
    if (sourceJumpFrameRef.current != null) {
      cancelAnimationFrame(sourceJumpFrameRef.current);
      sourceJumpFrameRef.current = null;
    }
    if (sourceJumpTimerRef.current != null) {
      clearTimeout(sourceJumpTimerRef.current);
      sourceJumpTimerRef.current = null;
    }
    sourceJumpMirrorRef.current = null;
    if (mountedRef.current) setSourceJumpMirror(null);
  };
  useEffect(() => () => {
    mountedRef.current = false;
    sourceJumpPassRef.current += 1;
    cancelSourceJumpMeasure();
  }, []);

  // Collects the two mirrored block heights. Only the pass whose token is
  // still current can report, so a superseded jump's late layout event is
  // discarded rather than landing an offset for the wrong exercise.
  const handleSourceJumpMirrorLayout = (half, token, height) => {
    const pass = sourceJumpMirrorRef.current;
    if (!pass || pass.token !== token) return;
    pass[half] = height;
    if (pass.above == null || pass.below == null) return;
    pass.report({
      y: _sourceJumpContentOffset({
        containerY: editContainerYRef.current,
        inputY: pass.inputY,
        inputHeight: pass.inputHeight,
        aboveHeight: pass.above,
        belowHeight: pass.below,
      }),
    });
  };

  // Reports the applied jump exactly once: with a placement as soon as one is
  // measurable, or without one the moment that is provably not going to
  // happen (no measurable surface, a failed or never-answered measure, or a
  // layout that never settles). The caller must always be released, because
  // that release is also what clears `pendingSourceJump`.
  const _reportSourceJumpPlacement = (token, targetOffset, text) => {
    // A newer jump supersedes any measurement still in flight for an older
    // one: what is cancellable is cancelled, and the generation bump makes
    // whatever is already in native's hands inert when it comes back.
    cancelSourceJumpMeasure();
    const pass = (sourceJumpPassRef.current += 1);
    const isCurrent = () => sourceJumpPassRef.current === pass;
    let reported = false;
    const report = (placement) => {
      if (reported || !isCurrent()) return;
      reported = true;
      cancelSourceJumpMeasure();
      onSourceJumpApplied?.(placement);
    };
    const input = editorInputRef.current;
    const container = editContainerRef.current;
    // No measurable surface (web/test renderers, or a ref that never
    // attached): release synchronously so the caller falls back to its
    // deterministic landing rather than sitting on a stale offset.
    if (!input || !container || typeof input.measureLayout !== 'function') {
      report();
      return;
    }
    sourceJumpTimerRef.current = setTimeout(report, SOURCE_JUMP_MEASURE_TIMEOUT_MS);
    const attempt = (n) => {
      sourceJumpFrameRef.current = requestAnimationFrame(() => {
        sourceJumpFrameRef.current = null;
        input.measureLayout(
          container,
          (_x, inputY, inputWidth, inputHeight) => {
            if (!isCurrent()) return;
            if (!(inputHeight > 0) || !(inputWidth > EDITOR_INPUT_TEXT_INSET)) {
              // Layout has not settled yet — the editor surface is
              // `display: none` right up to the frame it opens on.
              if (n + 1 >= SOURCE_JUMP_MEASURE_ATTEMPTS) {
                report();
                return;
              }
              attempt(n + 1);
              return;
            }
            const split = _splitAtTargetLine(text, targetOffset);
            // Nothing above the target line, so no mirror is needed and the
            // landing is the top of the text.
            if (!split) {
              report({
                y: _sourceJumpContentOffset({
                  containerY: editContainerYRef.current,
                  inputY,
                  inputHeight,
                  aboveHeight: 0,
                  belowHeight: 1,
                }),
              });
              return;
            }
            if (!mountedRef.current) return;
            sourceJumpMirrorRef.current = {
              token, inputY, inputHeight, above: null, below: null, report,
            };
            setSourceJumpMirror({
              token,
              width: inputWidth - EDITOR_INPUT_TEXT_INSET,
              above: split.above,
              below: split.below,
            });
          },
          () => { report(); },
        );
      });
    };
    attempt(0);
  };

  // #881 (F10a §4): applies a resolved exercise source jump as a one-shot
  // collapsed caret via the existing `problemSelectionRequest` scaffolding,
  // gated on the editor having actually mounted with the matching session
  // (editingNoteId) and the exact target text loaded — never focusing ahead
  // of that, which is what caused #865's selection race. Declared AFTER the
  // `editorIdentity` reset effect above (PR #883 review): entering the
  // current editor and requesting the jump both land in the same commit —
  // `currentMode` flips 'read'→'edit', which changes `editorIdentity` too —
  // so if this ran first, the identity-reset effect's unconditional
  // `setProblemSelectionRequest(null)` would fire right after and clobber
  // the just-applied selection before it ever painted.
  //
  // #886: the caret alone does not position anything here. This input is
  // `multiline` with no height cap, so it grows to the full height of the
  // note inside ScreenShell's scroll view — nothing native scrolls a caret
  // into view, and the page offset is the only thing that decides what the
  // user actually sees. So the jump also measures where its target line sits
  // in that page and hands the offset back through `onSourceJumpApplied`,
  // which is what the caller scrolls to. Reported exactly once per jump,
  // whether or not a measurement was obtainable; `appliedSourceJumpTokenRef`
  // keeps that one-shot guarantee across the frames the measurement takes.
  useEffect(() => {
    if (!pendingSourceJump) return;
    if (appliedSourceJumpTokenRef.current === pendingSourceJump.token) return;
    if (pendingSourceJump.editingNoteId !== editingNoteId) return;
    if (pendingSourceJump.editingNoteId == null && currentMode !== pendingSourceJump.currentMode) return;
    if (editorText !== pendingSourceJump.expectedText) return;
    appliedSourceJumpTokenRef.current = pendingSourceJump.token;
    requestEditorSelection({ start: pendingSourceJump.start, end: pendingSourceJump.end });
    _reportSourceJumpPlacement(pendingSourceJump.token, pendingSourceJump.start, editorText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSourceJump, editingNoteId, currentMode, editorText]);

  // Follows a selected syntax problem's own physical line across each
  // debounced recompute (#863 review), using `_mapLineIndexAcrossEdit` to
  // tell "this exact row moved because lines shifted above it" apart from
  // "this exact row was edited/removed" — even when a sibling row
  // elsewhere holds byte-identical text, which a content- or offset-only
  // identity can't distinguish. Alignment anchors don't need this: their
  // id is already position-based, not text-based, so it can't collide.
  const prevDebouncedTextForTrackingRef = useRef(debouncedEditorText);
  useEffect(() => {
    const prevText = prevDebouncedTextForTrackingRef.current;
    prevDebouncedTextForTrackingRef.current = debouncedEditorText;
    if (prevText === debouncedEditorText) return;
    setSelectedAnchor(current => {
      if (!current || current.kind !== 'syntax') return current;
      const newIndex = _mapLineIndexAcrossEdit(
        prevText.split('\n'), debouncedEditorText.split('\n'), current.line - 1
      );
      return newIndex == null ? null : { kind: 'syntax', line: newIndex + 1 };
    });
  }, [debouncedEditorText]);

  // Resolved from the live list on every recompute rather than cached: this
  // is what makes the bar disappear on its own once the selected problem is
  // fixed (its anchor no longer resolves to anything) and stay attached to
  // the same logical problem, at its new line, while the user edits lines
  // above it.
  const selectedProblem = React.useMemo(() => {
    if (!selectedAnchor) return null;
    if (selectedAnchor.kind === 'alignment') {
      return alignmentProblems.find(p => p.id === selectedAnchor.id) ?? null;
    }
    return syntaxProblems.find(p => p.line === selectedAnchor.line) ?? null;
  }, [selectedAnchor, syntaxProblems, alignmentProblems]);

  const handleToggleProblemList = () => setListOpen(open => !open);

  const handleSelectProblem = (problem) => {
    setListOpen(false);
    setSelectedAnchor(
      problem.kind === 'alignment' ? { kind: 'alignment', id: problem.id } : { kind: 'syntax', line: problem.line }
    );
    // Only move the caret when the debounced copy matches what's on screen —
    // otherwise the line/offset math could point at stale text mid-edit. The
    // problem is still selected/announced either way.
    if (debouncedEditorText !== editorText) return;
    if (problem.kind === 'syntax') {
      const range = _lineCharRange(debouncedEditorText, problem.line);
      if (!range) return;
      requestEditorSelection(range);
    } else {
      const offset = _insertionOffsetAfterExercise(
        debouncedEditorText, validationParsed.sections, problem.sectionIndex, problem.exerciseName, problem.entryCount
      );
      if (offset == null) return;
      requestEditorSelection({ start: offset, end: offset });
    }
  };

  const handleDismissProblemBar = () => setSelectedAnchor(null);

  const validationErrorCount = validationProblems.filter(p => p.severity === 'error').length;

  return (
    <View
      ref={editContainerRef}
      onLayout={(e) => { editContainerYRef.current = e.nativeEvent.layout.y; }}
      style={styles.editContainer}
      testID="log-editor-surface"
    >
      {/* #886: the source-jump measuring mirror. Absolutely positioned and
          fully transparent, so it takes part in no layout the user can see,
          and hidden from assistive tech so the note is never announced twice.
          Rendered at the input's own text width with the input's own font, so
          it wraps exactly where the input wraps — which is the whole point:
          the split is by rendered rows, not by newlines. Mounted only while a
          jump is being placed, and only ever one copy of the text (the two
          halves are the note, split at the target line). */}
      {sourceJumpMirror ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.sourceJumpMirror, { width: sourceJumpMirror.width }]}
        >
          <Text
            style={styles.sourceJumpMirrorText}
            testID="source-jump-mirror-above"
            onLayout={(e) => handleSourceJumpMirrorLayout(
              'above', sourceJumpMirror.token, e.nativeEvent.layout.height
            )}
          >
            {sourceJumpMirror.above}
          </Text>
          <Text
            style={styles.sourceJumpMirrorText}
            testID="source-jump-mirror-below"
            onLayout={(e) => handleSourceJumpMirrorLayout(
              'below', sourceJumpMirror.token, e.nativeEvent.layout.height
            )}
          >
            {sourceJumpMirror.below}
          </Text>
        </View>
      ) : null}
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
                onChangeText={(next) => {
                  onEditorInteraction?.();
                  (editingNoteId ? setEditingTitle : setWorkoutNoteTitle)(next);
                }}
                onFocus={onEditorInteraction}
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
            {/* #867: the tool row, the note, and the problem list share one
                positioning context, and the list is an overlay inside it
                rather than a row between them. Opening or closing the list
                therefore changes NO layout: the note's position, size, and the
                page's content height are all identical either way.
                As an in-flow row it inserted up to ~228dp above the note, which
                both shifted the note within the page scroll and re-laid out a
                focused multiline input — and Android answers that relayout by
                bringing the caret back on screen, dragging the page back to a
                problem the user had already scrolled away from (#867
                acceptance 3/4). The overlay stays inside this container's own
                bounds (its bottom sits at most `toolRow + 228`, against a
                container at least `toolRow + 260` tall), because on Android a
                child drawn outside its parent's bounds receives no touches. */}
            <View style={styles.editorStack} testID="editor-stack">
              <View
                style={styles.editorToolRow}
                testID="editor-tool-row"
                onLayout={(e) => {
                  const height = e.nativeEvent.layout.height;
                  setToolRowHeight(prev => (prev === height ? prev : height));
                }}
              >
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
              <TextInput
                ref={editorInputRef}
                value={editorText}
                onChangeText={(next) => {
                  onEditorInteraction?.();
                  setSeedSelection(null);
                  setProblemSelectionRequest(null);
                  setEditorText(next);
                }}
                onFocus={onEditorInteraction}
                selection={problemSelectionRequest ?? seedSelection ?? undefined}
                selectionColor={colors.accent}
                onSelectionChange={() => {
                  if (!problemSelectionRequest) return;
                  // Any event after the request means native selection has
                  // moved or been acknowledged. Yield immediately so a user
                  // caret move can never be forced back to the requested range.
                  setProblemSelectionRequest(null);
                }}
                placeholder="e.g.&#10;Monday&#10;+Lifting&#10;-Bench&#10;135 5,5,5"
                placeholderTextColor={colors.textMuted}
                multiline
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
                style={[styles.input, styles.editorInput]}
              />
              {/* Rendered after the note so it draws — and takes touches —
                  above it on both platforms, and offset by the tool row's own
                  measured height so it opens exactly where an in-flow row
                  would have, without being one. */}
              {listOpen && validationProblems.length > 0 && (
                <ScrollView
                  style={[styles.validationList, { top: toolRowHeight + VALIDATION_LIST_TOP_GAP }]}
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
            </View>
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
              // #880 review: a brand-new note's FIRST save is exactly the
              // non-autosaved, longest-running path (full parse + derive +
              // possible cloud enqueue, with nothing cached yet), so it must
              // show the in-flight state too — not just a disabled button
              // with no indication of what it's doing.
              <Button
                onPress={editingNoteId ? handleSaveOtherNote : handleSave}
                title="Save"
                disabled={editingNoteId ? noteIsSaving : isSaving}
                style={styles.saveButton}
              />
            ) : null}
            <SaveStatusRegion status={saveStatus} savedLabel={saveSuccess || undefined} />
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
    borderWidth: EDITOR_INPUT_BORDER_WIDTH,
    borderColor: colors.inputBorder,
    paddingHorizontal: EDITOR_INPUT_HORIZONTAL_PADDING,
    paddingVertical: EDITOR_INPUT_VERTICAL_PADDING,
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
  // #886 measuring mirror. Out of flow and invisible; `left: -10000` keeps it
  // off screen even on a platform that still paints a zero-opacity subtree.
  sourceJumpMirror: {
    position: 'absolute',
    left: -10000,
    top: 0,
    opacity: 0,
  },
  // Matches `input`'s text metrics — anything that changes where the editor
  // wraps has to change here too, or the measured split stops agreeing with
  // the box it is describing. `includeFontPadding: false` (Android) keeps each
  // half's height a clean multiple of its rows, so the ratio between them is
  // the row ratio and nothing else.
  sourceJumpMirrorText: {
    fontSize: 16,
    includeFontPadding: false,
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
  // #867: the tool row + note pair, and the positioning context the problem
  // list overlays them from. `gap` mirrors the surrounding Card's own gap, so
  // pulling these two controls into their own container changes no spacing.
  editorStack: {
    gap: EDITOR_STACK_GAP,
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
    color: colors.accentText,
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
  // Height-limited, internally scrollable problem list (#863), expanded by
  // tapping the badge. Each row is one problem, in source order, labeled with
  // human-readable context rather than a line number.
  //
  // #867: an overlay, not an in-flow row. `top` is supplied at the call site
  // from the tool row's measured height, and the opaque `card` fill (the same
  // surface it already sat on) is what lets it cover the note rather than
  // displace it. Nothing about the note's geometry or the page's content
  // height changes when it opens or closes.
  validationList: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 2,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    backgroundColor: colors.card,
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
    color: colors.cautionText,
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
    color: colors.cautionText,
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
    color: colors.accentText,
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
  // Fixed height regardless of whether a label is showing (#880 revised
  // body, non-interference): 12px font + 8px marginTop from
  // autosaveIndicator above, rounded up — so the region's own height never
  // changes as its text appears, changes, or clears, and nothing below it in
  // the card ever reflows.
  saveStatusRegion: {
    minHeight: 28,
    justifyContent: 'center',
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
    color: colors.accentText,
    marginBottom: 8,
  },
});
