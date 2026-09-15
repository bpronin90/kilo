import React from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card, Button } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { DELOAD_NOTE_PREFIX } from '../lib/LogScreenHelpers';
import { formatDate } from '../lib/format';
import { WorkoutSyntaxModal } from './WorkoutSyntaxModal';
import { WORKOUT_SEED_EXAMPLE_TEXT } from './WorkoutSyntaxReference';
import { createStyles } from './log/logEditorStyles';
import { useEditorCard } from './log/EditorControls';
import { EditorDeloadNoteInput, EditorSaveActions } from './log/EditorHeader';
import { RoutineAdoptionPrompt, computeSaveStatusLabel, SaveStatusRegion } from './log/EditorStatus';

// #867: the gap between the editor tool row and the problem list that opens
// under it. The list is an overlay, not an in-flow row (see `validationList`
// below), so this is its `top` offset from the bottom of the tool row rather
// than a margin.
const VALIDATION_LIST_TOP_GAP = 8;

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

export { RoutineAdoptionPrompt, computeSaveStatusLabel, SaveStatusRegion };

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
  // #1021: the secondary "Import routine" action rendered near/below Save on
  // the New Routine editor. Opens the existing routine-import preview
  // (`RoutineImportScreen`) — LogScreen owns that surface and this card only
  // triggers it, the same relationship it already has with every other
  // cross-cutting action here (delete, adopt, switch-current).
  onImportRoutine,
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
  const {
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
  } = useEditorCard({
    deloadMode,
    editingNoteId,
    editingText,
    activeEditText,
    handleCurrentTextChange,
    setEditingText,
    currentMode,
    editingEffectiveWeek,
    sessionAlignmentIssue,
    pendingSourceJump,
    onSourceJumpApplied,
  });

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
        <EditorDeloadNoteInput
          value={deloadEditText}
          onChangeText={setDeloadEditText}
          onSave={handleSaveDeload}
          saveSuccess={saveSuccess}
          isSaving={isSaving}
        />
      ) : (
        <>
          <Card>
            {!isEditingDeloadNote && (
              <TextInput
                keyboardAppearance={colors.scheme}
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
                      keyboardAppearance={colors.scheme}
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
                        themeVariant={colors.scheme}
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
                keyboardAppearance={colors.scheme}
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
            <EditorSaveActions
              editingNoteId={editingNoteId}
              currentId={currentId}
              onSave={handleSave}
              onSaveOther={handleSaveOtherNote}
              isSaving={isSaving}
              noteIsSaving={noteIsSaving}
              onImportRoutine={onImportRoutine}
            />
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
