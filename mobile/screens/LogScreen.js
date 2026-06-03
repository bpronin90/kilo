// LOG TAB STYLE LOCK — DO NOT TOUCH.
// The fonts, font sizes, colors, spacing, and overall visual style of the Log
// tab are intentionally fixed. Do NOT change any styling here, in the `styles`
// block below, or in the Log-tab typography of `components/UI.js`
// (`WorkoutHeading` / `WorkoutSubheading`). No "creative" or opportunistic
// visual tweaks. Change Log-tab styling ONLY when the repo owner explicitly
// asks for that specific change.

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Alert, Keyboard, Platform, Pressable, BackHandler, StyleSheet, Text, TextInput, View } from 'react-native';
import { LogEmptyState } from '../components/LogEmptyState';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine, SectionTitle, ErrorBanner, SET_ROW_FONT_SIZE } from '../components/UI';
import { Colors } from '../theme/colors';
import { parseWorkoutNote, generateDeloadNote, countWorkoutSessionsFromSections } from '../lib/parser';
import { normalizeLiftName, deriveWorkoutNoteAnalytics, listTrackedLifts, getDefaultTrackedNames, deriveSkipData, getLatestRepDropOff } from '../lib/data';
import { formatRepDropOffNudge } from '../lib/format';
import { useTrackedLifts, useWorkoutNotes, useDeloadNote, useDeloadHistory } from '../hooks/useEntries';

// Reshape the compact deload generator output into routine-note style:
// blank line between day blocks, +Lifting subheading per day.
// The deload format line "Name: weight lbs SxR" still parses via _DELOAD_RE.
const _DELOAD_EXERCISE_LINE = /^[^:+\d-][^:]*?:\s+\d+(?:\.\d+)?\s+lbs?\s+\d+x\d+\s*$/i;
const _DELOAD_CORE_LINE = /^Core:/i;
function _shapeDeloadText(text) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const isExercise = _DELOAD_EXERCISE_LINE.test(line) || _DELOAD_CORE_LINE.test(line);
    if (!isExercise) {
      if (out.length > 0) out.push('');
      out.push(line);
      out.push('+Lifting');
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

export function LogScreen({
  workoutNoteText,
  setWorkoutNoteText,
  workoutNoteTitle,
  setWorkoutNoteTitle,
  isCollapsed,
  toggleCollapsed,
  onSaveWorkout
}) {
  const { notes, currentId, currentNote, loading: notesLoading, error: notesError, refresh: refreshNotes, selectCurrent, update, add, remove } = useWorkoutNotes();
  const { trackedLifts, toggle: toggleTrackedLift } = useTrackedLifts();
  const { note: deloadNote, loading: deloadLoading, save: saveDeloadNote } = useDeloadNote();
  const { history: deloadHistory, completeDeload } = useDeloadHistory();

  const [mode, setMode] = useState('read');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dismissedNudges, setDismissedNudges] = useState({});

  const [tabView, setTabView] = useState('routine'); // 'routine' | 'deload'
  const [deloadMode, setDeloadMode] = useState('read'); // 'read' | 'edit'
  const [deloadEditText, setDeloadEditText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [deloadCollapsed, setDeloadCollapsed] = useState(false);
  const [expandedDeloads, setExpandedDeloads] = useState(new Set());


  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingText, setEditingText] = useState('');
  const [noteIsSaving, setNoteIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');

  const editorScrollRef = useRef(null);
  const readScrollRef = useRef(null);
  const keyboardVisibleRef = useRef(false);
  const lastTapRef = useRef(0);
  const deloadLastTapRef = useRef(0);
  const readScrollYRef = useRef(0);

  const handleReadScroll = (e) => {
    readScrollYRef.current = e.nativeEvent.contentOffset.y;
  };

  const handleNoteBodyPress = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      enterCurrentEditor();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };
  const keyboardExitTimeoutRef = useRef(null);


  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(''), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      keyboardVisibleRef.current = true;
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardVisibleRef.current = false;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
      if (keyboardExitTimeoutRef.current) {
        clearTimeout(keyboardExitTimeoutRef.current);
      }
    };
  }, []);

  const hasUnsavedCurrent = useMemo(() => {
    if (!currentNote) return workoutNoteTitle.trim() !== '' || workoutNoteText.trim() !== '';
    return workoutNoteTitle !== (currentNote.title || '') || workoutNoteText !== currentNote.raw_text;
  }, [currentNote, workoutNoteTitle, workoutNoteText]);

  const editingNote = useMemo(() => 
    (editingNoteId && editingNoteId !== 'new') ? notes.find(n => n.id === editingNoteId) : null
  , [editingNoteId, notes]);

  const hasUnsavedOther = useMemo(() => {
    if (!editingNoteId) return false;
    if (editingNoteId === 'new') return editingTitle.trim() !== '' || editingText.trim() !== '';
    if (!editingNote) return false;
    return editingTitle !== (editingNote.title || '') || editingText !== editingNote.raw_text;
  }, [editingNoteId, editingNote, editingTitle, editingText]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backAction = () => {
      if (deloadMode === 'edit') {
        handleDoneDeload();
        return true;
      }
      if (editingNoteId) {
        handleDoneOther();
        return true;
      }
      if (mode === 'edit') {
        handleDoneCurrent();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );

    return () => backHandler.remove();
  }, [editingNoteId, mode, deloadMode, workoutNoteText, workoutNoteTitle, editingTitle, editingText]);

  const otherNotes = notes.filter(n => n.id !== currentId);

  const parsed = useMemo(() => parseWorkoutNote(workoutNoteText), [workoutNoteText]);

  const logSessionCount = useMemo(
    () => countWorkoutSessionsFromSections(parsed.sections),
    [parsed.sections]
  );

  // Group consecutive sections that share the same day heading so each day
  // renders exactly one heading, regardless of warmup/lifting splits.
  const dayGroups = useMemo(() => {
    const groups = [];
    for (const section of parsed.sections) {
      const last = groups[groups.length - 1];
      if (last && last.heading === section.heading) {
        last.sections.push(section);
      } else {
        groups.push({ heading: section.heading, sections: [section] });
      }
    }
    return groups;
  }, [parsed.sections]);

  const deloadParsed = useMemo(() => parseWorkoutNote(deloadNote?.raw_text || ''), [deloadNote?.raw_text]);
  const deloadDayGroups = useMemo(() => {
    const groups = [];
    for (const section of deloadParsed.sections) {
      const last = groups[groups.length - 1];
      if (last && last.heading === section.heading) last.sections.push(section);
      else groups.push({ heading: section.heading, sections: [section] });
    }
    return groups;
  }, [deloadParsed.sections]);

  const hasUnsavedDeload = useMemo(() => {
    if (deloadMode !== 'edit') return false;
    return deloadEditText !== (deloadNote?.raw_text || '');
  }, [deloadMode, deloadEditText, deloadNote]);

  const hasContent = workoutNoteText.trim().length > 0;

  const handleSave = async () => {
    if (isSaving) return;
    if (!currentId && !workoutNoteText.trim()) {
      setSaveError('Workout notes are required');
      return;
    }
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      let result = null;
      const titleToSave = workoutNoteTitle || 'Untitled Routine';
      const { sections: savedSections } = parseWorkoutNote(workoutNoteText);
      const explicitTrackedNames = listTrackedLifts(trackedLifts);
      const defaultNames = getDefaultTrackedNames();
      const normalizedDefaults = new Set(defaultNames.map(n => normalizeLiftName(n)));
      const trackedNames = [
        ...defaultNames,
        ...explicitTrackedNames.filter(n => !normalizedDefaults.has(normalizeLiftName(n))),
      ];
      // Aggregate across all notes (same as StatsScreen), substituting current note's
      // text with the unsaved edit so the latest changes are included.
      const allSections = [
        ...notes.flatMap(n => {
          const text = n.id === currentId ? workoutNoteText : n.raw_text;
          return text ? parseWorkoutNote(text).sections : [];
        }),
        ...(currentId ? [] : savedSections),
      ];
      // Cross-note analytics: classifications and rep-drop-off use full session history.
      const { classifications: exercise_classifications, repDropOffFlags: rep_drop_off_flags } =
        deriveWorkoutNoteAnalytics(allSections, trackedNames);
      // Skip tracking: scoped to the current note being saved.
      const { exercise_skips, day_skips, attendance_flags } = deriveSkipData(savedSections);
      const skip_markers = { exercise_skips, day_skips };
      if (currentId) {
        result = await update(currentId, {
          title: titleToSave,
          raw_text: workoutNoteText,
          exercise_classifications,
          skip_markers,
          attendance_flags,
          rep_drop_off_flags,
        });
      } else {
        result = await add(titleToSave, workoutNoteText);
        await selectCurrent(result.id);
        if (result) {
          await update(result.id, { exercise_classifications, skip_markers, attendance_flags, rep_drop_off_flags });
        }
      }

      if (result) {
        setWorkoutNoteTitle(result.title || '');
        setWorkoutNoteText(result.raw_text || '');
        setSaveSuccess('Saved!');
        return true;
      } else {
        setSaveError('Save failed');
        return false;
      }
    } catch {
      setSaveError('Save failed');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const finishExitCurrentEditor = () => {
    readScrollRef.current?.scrollTo({ y: 0, animated: false });
    setMode('read');
  };

  const exitCurrentEditor = () => {
    if (!keyboardVisibleRef.current) {
      finishExitCurrentEditor();
      return;
    }

    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const hideSub = Keyboard.addListener(hideEvent, () => {
      hideSub.remove();
      if (keyboardExitTimeoutRef.current) {
        clearTimeout(keyboardExitTimeoutRef.current);
        keyboardExitTimeoutRef.current = null;
      }
      finishExitCurrentEditor();
    });

    Keyboard.dismiss();

    keyboardExitTimeoutRef.current = setTimeout(() => {
      hideSub.remove();
      keyboardExitTimeoutRef.current = null;
      finishExitCurrentEditor();
    }, Platform.OS === 'ios' ? 250 : 150);
  };

  const enterCurrentEditor = () => {
    const scrollY = readScrollYRef.current;
    setMode('edit');
    requestAnimationFrame(() => {
      editorScrollRef.current?.scrollTo({ y: scrollY, animated: false });
    });
  };

  const handleDoneCurrent = () => {
    if (!hasUnsavedCurrent) {
      exitCurrentEditor();
      return;
    }

    if (!currentId) {
      Alert.alert(
        'Discard changes?',
        'You have not saved this new routine. Are you sure you want to discard it?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Discard', 
            style: 'destructive', 
            onPress: () => {
              exitCurrentEditor();
              setWorkoutNoteText('');
              setWorkoutNoteTitle('');
            } 
          },
        ]
      );
    } else {
      Alert.alert(
        'Unsaved Changes',
        'Do you want to save your changes before leaving?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Discard', 
            style: 'destructive', 
            onPress: () => {
              exitCurrentEditor();
              setWorkoutNoteText(currentNote.raw_text);
              setWorkoutNoteTitle(currentNote.title || '');
            } 
          },
          { 
            text: 'Save', 
            onPress: async () => {
              const ok = await handleSave();
              if (ok) exitCurrentEditor();
            } 
          },
        ]
      );
    }
  };

  const handleDoneOther = () => {
    if (!hasUnsavedOther) {
      setEditingNoteId(null);
      return;
    }

    if (editingNoteId === 'new') {
      Alert.alert(
        'Discard changes?',
        'You have not saved this new routine. Are you sure you want to discard it?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Discard', 
            style: 'destructive', 
            onPress: () => setEditingNoteId(null) 
          },
        ]
      );
    } else {
      Alert.alert(
        'Unsaved Changes',
        'Do you want to save your changes before leaving?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Discard', 
            style: 'destructive', 
            onPress: () => setEditingNoteId(null) 
          },
          { 
            text: 'Save', 
            onPress: async () => {
              const ok = await handleSaveOtherNote();
              if (ok) setEditingNoteId(null);
            } 
          },
        ]
      );
    }
  };

  const handleOpenOtherNote = (other) => {
    setEditingNoteId(other.id);
    setEditingTitle(other.title || '');
    setEditingText(other.raw_text);
    setSaveError('');
    setSaveSuccess('');
  };

  const handleSaveOtherNote = async () => {
    if (noteIsSaving) return;
    setNoteIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      let result;
      const titleToSave = editingTitle || 'Untitled Routine';
      if (editingNoteId === 'new') {
        result = await add(titleToSave, editingText);
        setEditingNoteId(result.id);
      } else {
        result = await update(editingNoteId, { 
          title: titleToSave,
          raw_text: editingText 
        });
      }
      if (!result) {
        setSaveError('Save failed');
        return false;
      } else {
        setEditingTitle(result.title || '');
        setEditingText(result.raw_text || '');
        setSaveSuccess('Saved!');
        return true;
      }
    } catch {
      setSaveError('Save failed');
      return false;
    } finally {
      setNoteIsSaving(false);
    }
  };

  const handleDeleteRoutine = (id, title, isCurrent) => {
    Alert.alert(
      'Delete Routine',
      isCurrent
        ? `"${title}" is your current active routine. Deleting it will affect your analytics. Are you sure?`
        : `Are you sure you want to delete "${title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            await remove(id);
            setEditingNoteId(null);
            if (isCurrent) {
              setMode('edit');
              setWorkoutNoteText('');
              setWorkoutNoteTitle('');
            }
          } 
        },
      ]
    );
  };

  const handleCreateRoutine = () => {
    setEditingNoteId('new');
    setEditingTitle('');
    setEditingText('');
    setSaveError('');
    setSaveSuccess('');
  };

  const handleSwitchCurrent = (id) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    // Check if there are unsaved changes in the editor for ANY routine
    const hasUnsaved = editingNoteId ? hasUnsavedOther : (mode === 'edit' ? hasUnsavedCurrent : false);

    const doSwitch = async () => {
      await selectCurrent(id);
      setEditingNoteId(null);
    };

    const alertTitle = 'Set as current routine';
    let alertMessage = `Switching to "${note.title || 'Untitled Routine'}" will affect your analytics. Are you sure?`;
    
    if (hasUnsaved) {
      alertMessage = `You have unsaved changes that will be lost if you switch. Continue?`;
      Alert.alert(
        alertTitle,
        alertMessage,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Switch Anyway', style: 'destructive', onPress: doSwitch },
          { 
            text: 'Save & Switch', 
            onPress: async () => {
              let ok = false;
              if (editingNoteId) {
                ok = await handleSaveOtherNote();
              } else {
                ok = await handleSave();
              }
              if (ok) await doSwitch();
            } 
          },
        ]
      );
    } else {
      Alert.alert(
        alertTitle,
        alertMessage,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set as current routine', onPress: doSwitch },
        ]
      );
    }
  };

  const handleToggleTrack = async (name) => {
    const key = normalizeLiftName(name);
    await toggleTrackedLift(key);
  };

  const handleDismissNudge = (name) => {
    const key = normalizeLiftName(name);
    setDismissedNudges(prev => ({ ...prev, [key]: true }));
  };

  const enterDeloadEditor = () => {
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

  const handleCompleteDeload = () => {
    Alert.alert(
      'Complete deload?',
      'This will archive your deload note and reset the session clock.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'I have deloaded',
          onPress: async () => {
            await completeDeload({ sessionCount: logSessionCount });
          },
        },
      ]
    );
  };

  const handleGenerateDeload = () => {
    const doGenerate = async () => {
      setIsGenerating(true);
      setSaveError('');
      try {
        const raw = generateDeloadNote(workoutNoteText);
        await saveDeloadNote(_shapeDeloadText(raw));
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

  const headerRight = !editingNoteId && hasContent && mode === 'edit' && (
    <Pressable
      onPress={handleDoneCurrent}
      style={styles.modeToggle}
    >
      <Text style={styles.modeToggleText}>
        Done
      </Text>
    </Pressable>
  );

  const isEmpty = !notesLoading && notes.length === 0;
  const isEditing = !!editingNoteId || mode === 'edit' || deloadMode === 'edit';

  useEffect(() => {
    if (editingNoteId) {
      editorScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [editingNoteId]);

  return (
    <>
      <ScreenShell
        ref={readScrollRef}
        onScroll={handleReadScroll}
        style={isEditing ? { display: 'none' } : { flex: 1 }}
        title="Workout Notes"
        subtitle={isEmpty ? "Track your active training routine." : "Your active training routine. Update it as you go."}
        headerRight={headerRight}
        keyboardShouldPersistTaps="handled"
      >
        {notesError ? (
          <ErrorBanner message="Could not load workout notes." onRetry={refreshNotes} />
        ) : null}
        {isEmpty ? (
          <LogEmptyState onCreateRoutine={handleCreateRoutine} />
        ) : (
          <>
            <View style={styles.tabToggle}>
              <Pressable
                onPress={() => setTabView('routine')}
                style={[styles.tabToggleItem, tabView === 'routine' && styles.tabToggleItemActive]}
              >
                <Text style={[styles.tabToggleText, tabView === 'routine' && styles.tabToggleTextActive]}>Routine</Text>
              </Pressable>
              <Pressable
                onPress={() => setTabView('deload')}
                style={[styles.tabToggleItem, tabView === 'deload' && styles.tabToggleItemActive]}
              >
                <Text style={[styles.tabToggleText, tabView === 'deload' && styles.tabToggleTextActive]}>Deload</Text>
              </Pressable>
            </View>

            {tabView === 'deload' && saveError ? (
              <Card style={styles.errorCard}>
                <Text style={styles.errorText}>{saveError}</Text>
              </Card>
            ) : null}
            {tabView === 'deload' && !deloadLoading && (
              !deloadNote?.raw_text ? (
                <View style={styles.deloadEmpty}>
                  <Text style={styles.deloadEmptyText}>No deload week generated yet.</Text>
                  <Button
                    onPress={handleGenerateDeload}
                    title="Generate deload"
                    disabled={isGenerating || !workoutNoteText.trim()}
                  />
                </View>
              ) : (
                <>
                  <View style={styles.mirrorContainer}>
                    <Card style={styles.currentRoutineCard}>
                      <Pressable onPress={() => setDeloadCollapsed(c => !c)} style={styles.otherNoteHeader}>
                        <View style={styles.otherNoteInfo}>
                          <Text style={styles.currentNoteTitle}>Deload Week</Text>
                        </View>
                        <Pressable
                          onPress={(e) => { e.stopPropagation(); enterDeloadEditor(); }}
                          style={styles.inlineSwitchButton}
                          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                        >
                          <Text style={styles.inlineSwitchButtonText}>Edit</Text>
                        </Pressable>
                      </Pressable>
                      <Pressable
                        onPress={handleDeloadBodyPress}
                        style={[styles.currentNoteContent, deloadCollapsed ? { display: 'none' } : null]}
                      >
                        <Text style={styles.editHint}>Double-tap to edit</Text>
                        {deloadDayGroups.map((group, gi) => (
                          <View key={`deload-day-${gi}`}>
                            {group.heading && (
                              <WorkoutHeading selectable={true} style={gi === 0 ? { marginTop: 0 } : null}>
                                {group.heading}
                              </WorkoutHeading>
                            )}
                            {group.sections.map((section, si) => (
                              <View key={`deload-section-${gi}-${si}`}>
                                {section.subheading && (
                                  <WorkoutSubheading selectable={true}>{section.subheading}</WorkoutSubheading>
                                )}
                                {section.exercises.map((ex, ei) => (
                                  <ExerciseBlock
                                    key={`deload-ex-${gi}-${si}-${ei}`}
                                    name={ex.name}
                                    selectable={true}
                                  >
                                    {ex.rows.map((row, ri) => (
                                      <SetLine key={`deload-row-${gi}-${si}-${ei}-${ri}`} sets={row.sets} selectable={true} />
                                    ))}
                                    {ex.unparsed_rows.map((u, ui) => (
                                      <Text selectable={true} key={`deload-u-${gi}-${si}-${ei}-${ui}`} style={styles.unparsedRowMuted}>{u}</Text>
                                    ))}
                                  </ExerciseBlock>
                                ))}
                              </View>
                            ))}
                          </View>
                        ))}
                        {!deloadDayGroups.length && (
                          <Text selectable={true} style={styles.emptyText}>Deload note is empty.</Text>
                        )}
                      </Pressable>
                    </Card>
                  </View>
                  <View style={styles.previousRoutines}>
                    {deloadMode === 'read' && (
                      <Button
                        onPress={handleCompleteDeload}
                        title="I have deloaded"
                        style={styles.completeDeloadButton}
                        textStyle={styles.completeDeloadButtonText}
                      />
                    )}
                    <Button
                      onPress={handleGenerateDeload}
                      title={isGenerating ? 'Generating…' : 'Regenerate deload'}
                      disabled={isGenerating || !workoutNoteText.trim()}
                      style={styles.saveButton}
                    />
                  </View>
                </>
              )
            )}
            {tabView === 'deload' && !deloadLoading && deloadHistory.length > 0 && (
              <View style={styles.pastDeloads}>
                <SectionTitle>Past deloads</SectionTitle>
                {deloadHistory.slice().sort((a, b) => b.completed_at.localeCompare(a.completed_at)).map(record => {
                  const isExpanded = expandedDeloads.has(record.id);
                  const dateStr = record.completed_at.slice(0, 10);
                  const generatedStr = record.generated_at ? record.generated_at.slice(0, 10) : null;
                  const title = generatedStr && generatedStr !== dateStr
                    ? `Deload ${generatedStr}`
                    : `Deload ${dateStr}`;
                  return (
                    <Card key={record.id} style={styles.otherNoteCard}>
                      <Pressable
                        onPress={() => setExpandedDeloads(prev => {
                          const next = new Set(prev);
                          if (next.has(record.id)) next.delete(record.id); else next.add(record.id);
                          return next;
                        })}
                        style={styles.otherNoteHeader}
                      >
                        <View style={styles.otherNoteInfo}>
                          <Text style={styles.otherNoteTitle}>{title}</Text>
                          <Text style={styles.otherNoteSub}>Completed {dateStr}</Text>
                        </View>
                        <Text style={styles.pastDeloadChevron}>{isExpanded ? '▾' : '▸'}</Text>
                      </Pressable>
                      {isExpanded && (
                        <Text selectable style={styles.pastDeloadContent}>{record.raw_text}</Text>
                      )}
                    </Card>
                  );
                })}
              </View>
            )}

            {tabView === 'routine' && mode === 'read' && hasContent && (
              <View style={styles.mirrorContainer}>
                <Card style={styles.currentRoutineCard}>
                  <Pressable
                    onPress={toggleCollapsed}
                    style={styles.otherNoteHeader}
                  >
                    <View style={styles.otherNoteInfo}>
                      <Text style={styles.currentNoteTitle}>{workoutNoteTitle || 'Untitled Routine'}</Text>
                      <Text style={styles.otherNoteSub}>Current routine</Text>
                    </View>
                    <Pressable
                      onPress={(e) => { e.stopPropagation(); enterCurrentEditor(); }}
                      style={styles.inlineSwitchButton}
                      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                    >
                      <Text style={styles.inlineSwitchButtonText}>Edit</Text>
                    </Pressable>
                  </Pressable>

                  <Pressable 
                    onPress={handleNoteBodyPress}
                    style={[styles.currentNoteContent, isCollapsed ? { display: 'none' } : null]}
                  >
                    <Text style={styles.editHint}>Double-tap to edit</Text>
                    {dayGroups.map((group, gi) => (
                      <View key={`day-${gi}`}>
                        {group.heading && (
                          <WorkoutHeading 
                            selectable={true}
                            style={gi === 0 ? { marginTop: 0 } : null}
                          >
                            {group.heading}
                          </WorkoutHeading>
                        )}
                        {group.sections.map((section, si) => (
                          <View key={`section-${gi}-${si}`}>
                            {section.subheading && (
                              <WorkoutSubheading selectable={true}>{section.subheading}</WorkoutSubheading>
                            )}
                            {section.exercises.map((ex, ei) => {
                              const exNormName = normalizeLiftName(ex.name);
                              const isTracked = !!trackedLifts[exNormName];
                              const dropOffFlag = isTracked
                                ? getLatestRepDropOff(currentNote?.rep_drop_off_flags?.[exNormName])
                                : null;
                              const isDismissed = dismissedNudges[exNormName];
                              const nudgeCopy = (!isDismissed && dropOffFlag) ? formatRepDropOffNudge(dropOffFlag) : null;
                              return (
                              <ExerciseBlock
                                key={`ex-${gi}-${si}-${ei}`}
                                name={ex.name}
                                isTracked={isTracked}
                                onToggleTrack={() => handleToggleTrack(ex.name)}
                                selectable={true}
                              >
                                {(() => {
                                  const items = [];
                                  let loggedIdx = 0;
                                  ex.session_entries.forEach((entry, eni) => {
                                    if (entry.skipped) {
                                      items.push(<Text selectable={true} key={`skip-${gi}-${si}-${ei}-${eni}`} style={styles.skipMarker}>—</Text>);
                                    } else if (!entry.unparsed) {
                                      const row = ex.rows[loggedIdx++];
                                      if (row) items.push(<SetLine key={`row-${gi}-${si}-${ei}-${eni}`} sets={row.sets} selectable={true} />);
                                    }
                                  });
                                  const loggedCount = ex.session_entries.filter(e => !e.skipped && !e.unparsed).length;
                                  ex.rows.slice(loggedCount).forEach((row, ri) => {
                                    items.push(<SetLine key={`plain-${gi}-${si}-${ei}-${ri}`} sets={row.sets} selectable={true} />);
                                  });
                                  return items;
                                })()}
                                {ex.unparsed_rows.map((u, ui) => (
                                  <Text selectable={true} key={`u-${gi}-${si}-${ei}-${ui}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{u}</Text>
                                ))}
                                {nudgeCopy && (
                                  <View style={styles.nudgeChip}>
                                    <Text style={styles.nudgeChipText}>{nudgeCopy}</Text>
                                    <Pressable onPress={(e) => { e?.stopPropagation?.(); handleDismissNudge(ex.name); }} style={styles.nudgeDismiss} hitSlop={{ top: 12, bottom: 12, left: 14, right: 14 }} accessibilityRole="button" accessibilityLabel="Dismiss nudge">
                                      <Text style={styles.nudgeDismissText} accessible={false}>×</Text>
                                    </Pressable>
                                  </View>
                                )}
                              </ExerciseBlock>
                              );
                            })}
                          </View>
                        ))}
                      </View>
                    ))}
                    {!dayGroups.length && (
                      <Text selectable={true} style={styles.emptyText}>Add some exercises to see the formatted view.</Text>
                    )}
                  </Pressable>
                </Card>
              </View>
            )}


            {tabView === 'routine' && (
              <View style={styles.previousRoutines}>
                {otherNotes.length > 0 && (
                  <>
                    <SectionTitle>More Routines</SectionTitle>
                    {otherNotes.map(other => (
                      <Card
                        key={other.id}
                        style={styles.otherNoteCard}
                      >
                        <Pressable
                          onPress={() => handleOpenOtherNote(other)}
                          style={styles.otherNoteHeader}
                        >
                          <View style={styles.otherNoteInfo}>
                            <Text style={styles.otherNoteTitle}>{other.title || 'Untitled Routine'}</Text>
                            {other.updated_at && (
                              <Text style={styles.otherNoteSub}>{new Date(other.updated_at).toLocaleDateString()}</Text>
                            )}
                          </View>
                          <Pressable
                            onPress={(e) => { e.stopPropagation(); handleSwitchCurrent(other.id); }}
                            style={styles.inlineSwitchButton}
                            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                          >
                            <Text style={styles.inlineSwitchButtonText}>Set as current routine</Text>
                          </Pressable>
                        </Pressable>
                      </Card>
                    ))}
                  </>
                )}
                <Button
                  onPress={handleCreateRoutine}
                  title="+ New routine"
                  style={styles.createButton}
                  textStyle={styles.createButtonText}
                />
              </View>
            )}
          </>
        )}
      </ScreenShell>

      <ScreenShell
        ref={editorScrollRef}
        style={isEditing ? { flex: 1 } : { display: 'none' }}
        title={
          deloadMode === 'edit' ? 'Deload Week' :
          editingNoteId ? (editingTitle || 'Untitled Routine') :
          (workoutNoteTitle || 'Untitled Routine')
        }
        subtitle={deloadMode === 'edit' ? 'Edit deload' : 'Edit routine'}
        headerRight={
          <Pressable
            onPress={
              deloadMode === 'edit' ? handleDoneDeload :
              editingNoteId ? handleDoneOther :
              handleDoneCurrent
            }
            style={styles.modeToggle}
          >
            <Text style={styles.modeToggleText}>Done</Text>
          </Pressable>
        }
        keyboardShouldPersistTaps="handled"
      >
        {saveError ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{saveError}</Text>
          </Card>
        ) : null}
        {deloadMode === 'edit' ? (
          <View style={styles.editContainer}>
            <Card>
              <TextInput
                value={deloadEditText}
                onChangeText={setDeloadEditText}
                placeholder="Deload note…"
                placeholderTextColor={Colors.textMuted}
                multiline
                style={[styles.input, styles.editorInput]}
              />
              <Button
                onPress={handleSaveDeload}
                title={saveSuccess ? 'Saved!' : 'Save changes'}
                disabled={isSaving}
                style={styles.saveButton}
              />
            </Card>
          </View>
        ) : (
          <View style={styles.editContainer}>
            <Card>
              <TextInput
                value={editingNoteId ? editingTitle : workoutNoteTitle}
                onChangeText={editingNoteId ? setEditingTitle : setWorkoutNoteTitle}
                placeholder="Routine Name (e.g. Push Day)"
                placeholderTextColor={Colors.textMuted}
                style={[styles.input, styles.titleInput]}
              />
              <TextInput
                value={editingNoteId ? editingText : workoutNoteText}
                onChangeText={editingNoteId ? setEditingText : setWorkoutNoteText}
                placeholder="e.g.&#10;=== Push Day ===&#10;Bench Press 135x5, 135x5, 135x5"
                placeholderTextColor={Colors.textMuted}
                multiline
                style={[styles.input, styles.editorInput]}
              />
              <Button
                onPress={editingNoteId ? handleSaveOtherNote : handleSave}
                title={saveSuccess ? 'Saved!' : 'Save changes'}
                disabled={editingNoteId ? noteIsSaving : isSaving}
                style={styles.saveButton}
              />
            </Card>
            {editingNoteId && (
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
                  handleDeleteRoutine(editingNoteId, editingTitle || 'Untitled Routine', false);
                } else {
                  handleDeleteRoutine(currentId, workoutNoteTitle || 'Untitled Routine', true);
                }
              }}
              title="Delete routine"
              style={styles.deleteButton}
              textStyle={styles.deleteButtonText}
            />
          </View>
        )}
      </ScreenShell>
    </>
  );
}

const styles = StyleSheet.create({
  modeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: Colors.chipBackground,
  },
  modeToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  errorCard: {
    borderColor: Colors.error,
    backgroundColor: '#fff0f0', // Slight red tint
    padding: 12,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
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
  mirrorContainer: {
    paddingBottom: 2,
  },
  currentRoutineCard: {
    padding: 0,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: Colors.cardBorder,
  },
  unparsedRow: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.error,
    paddingLeft: 0,
  },
  unparsedRowMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.text,
    paddingLeft: 0,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 40,
  },
  editButton: {
    marginTop: 32,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  editButtonText: {
    color: Colors.accent,
  },
  skipMarker: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.textMuted,
  },
  editContainer: {
    gap: 16,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  switchButtonText: {
    color: Colors.accent,
  },
  deleteButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.error,
  },
  deleteButtonText: {
    color: Colors.error,
  },
  previousRoutines: {
    marginTop: 4,
    gap: 12,
  },
  otherNoteCard: {
    padding: 0,
    overflow: 'hidden',
  },
  otherNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
    gap: 12,
  },
  otherNoteInfo: {
    flex: 1,
  },
  otherNoteTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  currentNoteTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.accent,
  },
  otherNoteSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  editHint: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 8,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  inlineSwitchButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.chipBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  inlineSwitchButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
  },
  createButton: {
    marginTop: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.accent,
    borderStyle: 'dashed',
  },
  createButtonText: {
    color: Colors.accent,
  },
  nudgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.chipBackground,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
    gap: 6,
  },
  nudgeChipText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: Colors.chipText,
    lineHeight: 15,
  },
  nudgeDismiss: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  nudgeDismissText: {
    fontSize: 14,
    color: Colors.chipText,
    fontWeight: '700',
    lineHeight: 16,
  },
  tabToggle: {
    flexDirection: 'row',
    borderRadius: 12,
    backgroundColor: Colors.chipBackground,
    marginBottom: 12,
    padding: 2,
  },
  tabToggleItem: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabToggleItemActive: {
    backgroundColor: Colors.accent,
  },
  tabToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.chipText,
  },
  tabToggleTextActive: {
    color: '#fff',
  },
  deloadEmpty: {
    marginTop: 40,
    alignItems: 'center',
    gap: 16,
  },
  deloadEmptyText: {
    fontSize: 16,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  completeDeloadButton: {
    backgroundColor: Colors.accent,
  },
  completeDeloadButtonText: {
    color: '#fff',
  },
  pastDeloads: {
    marginTop: 8,
    gap: 8,
  },
  pastDeloadChevron: {
    fontSize: 16,
    color: Colors.textMuted,
  },
  pastDeloadContent: {
    fontSize: 13,
    color: Colors.text,
    fontFamily: 'monospace',
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },

});
