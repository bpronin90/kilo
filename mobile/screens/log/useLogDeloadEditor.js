import { useState, useRef, useMemo } from 'react';
import { Alert } from '../../lib/platformAlert';
import { parseWorkoutNote, generateDeloadNote } from '../../lib/parser';
import { captureDeloadWorkingContext } from '../../lib/parser/deloadHistory';
import { buildDayGroups } from './logScreenHelpers';

export function useLogDeloadEditor({
  deloadNote,
  saveDeloadNote,
  workoutNoteText,
  editorScrollRef,
  currentId = null,
}) {
  const [deloadMode, setDeloadMode] = useState('read');
  const [deloadEditText, setDeloadEditText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [originalNoteState, setOriginalNoteState] = useState(null);

  const deloadLastTapRef = useRef(0);

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
    setDeloadEditText(deloadNote?.raw_text || '');
    setDeloadMode('edit');
    requestAnimationFrame(() => {
      editorScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  };

  const exitDeloadEditor = () => {
    setDeloadMode('read');
    setDeloadEditText('');
    setSaveSuccess('');
    setSaveError('');
    setOriginalNoteState(null);
  };

  const handleSaveDeload = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      await saveDeloadNote(deloadEditText);
      setSaveSuccess('Saved!');
      return true;
    } catch {
      setSaveError('Save failed');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

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
            const ok = await handleSaveDeload();
            if (ok) exitDeloadEditor();
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
