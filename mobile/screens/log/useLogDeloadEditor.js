import { useState, useRef, useMemo } from 'react';
import { Alert } from '../../lib/platformAlert';
import { parseWorkoutNote, generateDeloadNote } from '../../lib/parser';
import { captureDeloadWorkingContext } from '../../lib/parser/deloadHistory';
import { buildDayGroups } from './logScreenHelpers';
import { runDoneConvergenceLoop } from './useLogEditorSave';

export function useLogDeloadEditor({
  deloadNote,
  saveDeloadNote,
  workoutNoteText,
  editorScrollRef,
  currentId = null,
}) {
  const [deloadMode, setDeloadMode] = useState('read');
  const [deloadEditText, setDeloadEditTextState] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [originalNoteState, setOriginalNoteState] = useState(null);

  const deloadLastTapRef = useRef(0);
  // #1481: the live draft is mirrored synchronously so an async Done/Save can
  // see text typed while a write was pending; the in-flight save and the text it
  // persisted let Done converge on the latest draft before closing.
  const liveTextRef = useRef('');
  const inflightSaveRef = useRef(null);
  const lastSavedTextRef = useRef(null);
  // Bumped on every enter/exit so a Done loop from a closed session never writes.
  const sessionRef = useRef(0);

  const setDeloadEditText = (next) => {
    liveTextRef.current = next;
    setDeloadEditTextState(next);
  };

  const deloadParsed = useMemo(
    () => parseWorkoutNote(deloadNote?.raw_text || ''),
    [deloadNote?.raw_text]
  );

  const deloadDayGroups = useMemo(
    () => buildDayGroups(deloadParsed.sections),
    [deloadParsed.sections]
  );

  const hasUnsavedDeload = useMemo(() => {
    if (deloadMode !== 'edit') return false;
    return deloadEditText !== (deloadNote?.raw_text || '');
  }, [deloadMode, deloadEditText, deloadNote]);

  const enterDeloadEditor = () => {
    setOriginalNoteState({ text: deloadNote?.raw_text || '' });
    lastSavedTextRef.current = null;
    sessionRef.current += 1;
    setDeloadEditText(deloadNote?.raw_text || '');
    setDeloadMode('edit');
    requestAnimationFrame(() => {
      editorScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  };

  const exitDeloadEditor = () => {
    setDeloadMode('read');
    sessionRef.current += 1;
    setDeloadEditText('');
    lastSavedTextRef.current = null;
    setSaveSuccess('');
    setSaveError('');
    setOriginalNoteState(null);
  };

  const startDeloadSave = (text) => {
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
    const run = (async () => {
      await Promise.resolve();
      try {
        await saveDeloadNote(text);
        lastSavedTextRef.current = text;
        setSaveSuccess('Saved!');
        return true;
      } catch {
        setSaveError('Save failed');
        return false;
      } finally {
        if (inflightSaveRef.current === run) inflightSaveRef.current = null;
        setIsSaving(false);
      }
    })();
    inflightSaveRef.current = run;
    return run;
  };

  // A save requested while one is pending coalesces onto it and reports its
  // real outcome rather than an empty result.
  const handleSaveDeload = () => inflightSaveRef.current || startDeloadSave(liveTextRef.current);

  const handleDoneDeload = () => {
    if (!hasUnsavedDeload) {
      exitDeloadEditor();
      return;
    }
    Alert.alert(
      'Unsaved Changes',
      'Do you want to save your changes before leaving?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: exitDeloadEditor },
        {
          text: 'Save',
          onPress: async () => {
            // Close only once the latest live draft is the one that persisted.
            const session = sessionRef.current;
            const ok = await runDoneConvergenceLoop({
              // Once the editor was left (Discard/Cancel/exit), never write again.
              save: async () => (sessionRef.current === session ? handleSaveDeload() : false),
              hasConverged: () => liveTextRef.current === lastSavedTextRef.current,
            });
            if (ok && sessionRef.current === session) exitDeloadEditor();
          },
        },
      ]
    );
  };

  const handleUndoDeload = () => {
    if (originalNoteState) {
      setDeloadEditText(originalNoteState.text);
    }
  };

  const handleGenerateDeload = () => {
    const doGenerate = async () => {
      setIsGenerating(true);
      setSaveError('');
      try {
        const raw = generateDeloadNote(workoutNoteText);
        const formattedRaw = raw.split('\n')
          .filter(Boolean)
          .map((line, idx) => {
            const isExercise = line.includes(': ') && line.includes('lbs');
            if (!isExercise && idx > 0) return `\n${line}\n+Lifting`;
            return line;
          })
          .join('\n');
        // #989: freeze the current routine's working-weight context at the
        // moment its deload is generated, keyed to the stable current-routine
        // id. Regenerating recomputes it; a later manual edit of the generated
        // text does not (saveDeloadNote keeps the existing snapshot when none is
        // passed). No workout note or historical record is touched.
        const workingContext = captureDeloadWorkingContext(
          parseWorkoutNote(workoutNoteText).sections,
          currentId ?? null,
        );
        await saveDeloadNote(formattedRaw, workingContext);
      } catch {
        setSaveError('Generate failed');
      } finally {
        setIsGenerating(false);
      }
    };

    if (deloadNote?.raw_text) {
      Alert.alert(
        'Regenerate deload?',
        'This will overwrite your existing deload note. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Regenerate', style: 'destructive', onPress: doGenerate },
        ]
      );
    } else {
      doGenerate();
    }
  };

  const handleDeloadBodyPress = () => {
    const now = Date.now();
    if (now - deloadLastTapRef.current < 300) {
      enterDeloadEditor();
      deloadLastTapRef.current = 0;
    } else {
      deloadLastTapRef.current = now;
    }
  };

  return {
    deloadMode,
    deloadEditText,
    setDeloadEditText,
    isGenerating,
    isSaving,
    saveError,
    saveSuccess,
    hasUnsavedDeload,
    deloadParsed,
    deloadDayGroups,
    enterDeloadEditor,
    exitDeloadEditor,
    handleSaveDeload,
    handleDoneDeload,
    handleUndoDeload,
    handleGenerateDeload,
    handleDeloadBodyPress,
  };
}
