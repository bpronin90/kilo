import React, { useEffect, useRef, useState } from 'react';
import { parseWorkoutNote } from '../../lib/parser';
import { WORKOUT_SEED_EXAMPLE_TEXT } from '../WorkoutSyntaxReference';
import { EDITOR_INPUT_TEXT_INSET } from './logEditorStyles';
import {
  _splitAtTargetLine,
  _sourceJumpContentOffset,
  _lineCharRange,
  _mapLineIndexAcrossEdit,
  _insertionOffsetAfterExercise,
  _applyNativeSelection,
} from './EditorStatus';

// #863: how long to wait after the last keystroke before recomputing the
// problem list. Separate from AUTOSAVE_DEBOUNCE_MS — validation is a pure
// local reparse with no network/storage cost, so it can afford a longer
// delay while still keeping repeated typing on a large note responsive (no
// full reparse on every keystroke). Raised from 400ms (#856) to 1000ms:
// validation never blocks the TextInput (it recomputes off a debounced
// copy), so the longer window only removes any chance of the recompute
// competing with typing on a large note.
const VALIDATION_DEBOUNCE_MS = 1000;

// #886: how many frames a source jump will wait for the editor surface to
// finish laying out before giving up on measuring it. The surface is
// `display: none` until the frame the editor opens on, so the first
// measurement can legitimately come back with a zero height.
const SOURCE_JUMP_MEASURE_ATTEMPTS = 5;

// #886: hard ceiling on that same wait. A native measure that never answers
// must not leave the jump un-released, so the placement is abandoned and the
// caller falls back to its deterministic landing.
const SOURCE_JUMP_MEASURE_TIMEOUT_MS = 250;

export function useEditorCard({
  deloadMode,
  editingNoteId,
  editingText,
  activeEditText,
  handleCurrentTextChange,
  setEditingText,
  currentMode,
  editingEffectiveWeek,
  sessionAlignmentIssue,
  pendingSourceJump = null,
  onSourceJumpApplied,
}) {
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

  return {
    editContainerRef,
    editContainerYRef,
    sourceJumpMirror,
    handleSourceJumpMirrorLayout,
    syntaxHelpVisible,
    setSyntaxHelpVisible,
    dateFieldOpen,
    setDateFieldOpen,
    editorInputRef,
    editorText,
    setEditorText,
    seedSelection,
    setSeedSelection,
    problemSelectionRequest,
    setProblemSelectionRequest,
    handleInsertSeedExample,
    validationProblems,
    validationErrorCount,
    listOpen,
    handleToggleProblemList,
    handleSelectProblem,
    selectedProblem,
    handleDismissProblemBar,
    toolRowHeight,
    setToolRowHeight,
  };
}
