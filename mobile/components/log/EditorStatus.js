import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { Button } from '../UI';
import { useThemedStyles } from '../../theme/ThemeContext';
import { createStyles, EDITOR_INPUT_VERTICAL_PADDING } from './logEditorStyles';
import { applyWeekSkipToText } from '../../lib/parser';

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

// #886: splits the note at the START of the line holding `targetOffset`, so
// the two halves can be measured as the "above the target" / "target and
// below" split. The separating newline is dropped: each half is measured as
// its own block, and the block boundary reproduces that line break exactly.
// Returns null when the target is on the first line — there is nothing above
// it to measure, and an empty block does not measure as zero everywhere.
export function _splitAtTargetLine(text, targetOffset) {
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
export function _sourceJumpContentOffset({ containerY, inputY, inputHeight, aboveHeight, belowHeight }) {
  const textHeight = Math.max(0, inputHeight - EDITOR_INPUT_VERTICAL_PADDING * 2);
  const mirrored = aboveHeight + belowHeight;
  const fraction = mirrored > 0 ? Math.min(1, Math.max(0, aboveHeight / mirrored)) : 0;
  return containerY + inputY + EDITOR_INPUT_VERTICAL_PADDING + textHeight * fraction;
}

// Offsets of the start/end of `lineNumber` (1-indexed, matching
// parseWorkoutNote's `line`/`header_line` fields) within `text`. Returns null
// for an out-of-range line (e.g. the debounced text is momentarily stale).
export function _lineCharRange(text, lineNumber) {
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
export function _mapLineIndexAcrossEdit(oldLines, newLines, oldIndex) {
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
export function _insertionOffsetAfterExercise(text, sections, sectionIndex, exerciseName, entryCount) {
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
export function _applyNativeSelection(input, range) {
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
