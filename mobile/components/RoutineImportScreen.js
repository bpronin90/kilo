// Import a shared routine from pasted text (#955, Stage 2 of #581's design).
//
// The whole screen is a preview: paste text, see exactly what Kilo read from
// it, then — and only then — press one explicit action that creates a NEW
// routine. There is no merge, no overwrite, no "update the routine with this
// title", and no adoption. `onCreateRoutine` is wired in App.js straight to the
// note store's `add`, which mints a fresh id and never touches the current-routine
// pointer, so importing can neither replace what you are training on nor edit a
// routine you already have. A user with no current routine still adopts through
// the existing post-save prompt on the Log tab (#748) — this screen deliberately
// offers no shortcut around it.
//
// Parsing/validation lives in lib/interoperability/routineShare.js
// (`analyzeRoutineImportText`); this file only renders that verdict.

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Button, Card, SectionTitle, useInputStyle } from './UI';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';
import { useThemedStyles } from '../theme/ThemeContext';
import { buildDayGroups } from '../screens/log/logScreenHelpers';
import {
  ROUTINE_IMPORT_EMPTY_MESSAGE,
  analyzeRoutineImportText,
} from '../lib/interoperability/routineShare';

// Deliberately does NOT claim nothing was written. `add` performs a local write
// and then enqueues the cloud sync, and only the second half can fail on its
// own, so a failure here genuinely can leave the routine created. Telling the
// user to check before retrying is the honest instruction; a blind retry mints
// a second note id and would duplicate the routine.
const IMPORT_FAILED_MESSAGE =
  'Something went wrong while saving. The routine may still have been created — '
  + 'check Log › Routines before trying again.';

export function RoutineImportScreen({ onBack, onCreateRoutine }) {
  const styles = useThemedStyles(createStyles);
  const inputStyle = useInputStyle();
  const [pasted, setPasted] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedTitle, setSavedTitle] = useState('');

  const [previewWeek, setPreviewWeek] = useState('A');

  const analysis = useMemo(
    () => analyzeRoutineImportText(pasted, previewWeek),
    [pasted, previewWeek],
  );
  const dayGroups = useMemo(() => buildDayGroups(analysis.sections), [analysis.sections]);

  // The title field follows the envelope's `#title:` line. Keyed on the
  // envelope title itself, so it re-seeds only when the pasted routine's title
  // actually changes: a name the user typed survives further edits to the same
  // paste, while replacing a titled envelope with untitled text CLEARS the
  // field rather than saving the new routine under the old one's name.
  useEffect(() => {
    setTitle(analysis.envelopeTitle || '');
  }, [analysis.envelopeTitle]);

  const handlePasteChange = (next) => {
    setSavedTitle('');
    setError('');
    setPasted(next);
    // A fresh paste is a different routine; keep the preview on the week the
    // Routine tab shows a newly saved routine on.
    setPreviewWeek('A');
  };

  const handleImport = async () => {
    if (!analysis.canImport || saving) return;
    const pastedAtPress = pasted;
    const titleAtPress = title;
    setError('');
    setSaving(true);
    try {
      // The BODY, not the pasted text: the envelope is transport, never
      // routine content, so it must not end up inside the saved note.
      const savedBody = analysis.body;
      const saved = title.trim();
      await onCreateRoutine?.(saved, savedBody);
      setSavedTitle(saved || 'Untitled Routine');
      // Clear only what was actually saved. The fields stay editable during an
      // awaited save, so a user who pasted the NEXT routine while this one was
      // in flight must not have those edits wiped by its completion.
      setPasted((current) => (current === pastedAtPress ? '' : current));
      setTitle((current) => (current === titleAtPress ? '' : current));
    } catch (e) {
      console.warn('[RoutineImportScreen] import failed', e);
      setError(IMPORT_FAILED_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenShell
      title="Import Routine"
      subtitle="Paste a shared routine to preview and save it as a new routine."
      onBack={onBack}
      keyboardShouldPersistTaps="handled"
    >
      <SectionTitle>Pasted text</SectionTitle>
      <Card>
        <TextInput
          style={[inputStyle, styles.pasteInput]}
          value={pasted}
          onChangeText={handlePasteChange}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={'#kilo-routine v1\n\nMonday\n-Bench Press\n- 135 5'}
          accessibilityLabel="Pasted routine text"
          testID="routine-import-paste"
        />
      </Card>

      {savedTitle ? (
        <Card>
          <Text style={styles.successText}>
            Saved “{savedTitle}” as a new routine. Find it under Log › Routines.
          </Text>
        </Card>
      ) : null}

      <SectionTitle>Preview</SectionTitle>
      {analysis.isBlank ? (
        <Card>
          <Text style={styles.mutedText}>{ROUTINE_IMPORT_EMPTY_MESSAGE}</Text>
        </Card>
      ) : (
        <>
          {analysis.notices.map((notice) => (
            <Card key={`${notice.severity}:${notice.message}`}>
              <Text
                style={notice.severity === 'error' ? styles.errorText : styles.mutedText}
                testID={`routine-import-notice-${notice.severity}`}
              >
                {notice.message}
              </Text>
            </Card>
          ))}
          <Card>
            <TextInput
              style={inputStyle}
              value={title}
              onChangeText={setTitle}
              placeholder="Routine name"
              accessibilityLabel="Imported routine name"
              testID="routine-import-title"
            />
            {analysis.exportedAt ? (
              <Text style={styles.metaText}>Shared {analysis.exportedAt}</Text>
            ) : null}
          </Card>
          <Card>
            {/* An A/B routine is previewed one week at a time, behind the same
                Week switch the Routine tab uses, because that is how the saved
                routine will be read back. Both weeks are saved either way. */}
            {analysis.hasABWeeks ? (
              <View style={styles.weekRow}>
                <Text style={styles.mutedText}>Week {analysis.effectiveWeek}</Text>
                <Button
                  onPress={() => setPreviewWeek(analysis.effectiveWeek === 'B' ? 'A' : 'B')}
                  title={`Show Week ${analysis.effectiveWeek === 'B' ? 'A' : 'B'}`}
                  style={styles.weekButton}
                  accessibilityLabel={`Preview Week ${analysis.effectiveWeek === 'B' ? 'A' : 'B'}`}
                />
              </View>
            ) : null}
            <WorkoutContentRenderer
              dayGroups={dayGroups}
              emptyText="No exercises to display."
            />
          </Card>
        </>
      )}

      {error ? (
        <Card>
          <Text style={styles.errorText}>{error}</Text>
        </Card>
      ) : null}

      <Button
        onPress={handleImport}
        title="Create new routine"
        loadingTitle="Creating…"
        loading={saving}
        disabled={!analysis.canImport || saving}
        accessibilityLabel="Create new routine from pasted text"
      />
      <Text style={styles.footnote}>
        Importing always creates a new routine. It never changes or replaces a routine you
        already have, and it does not switch your current routine.
      </Text>
    </ScreenShell>
  );
}

const createStyles = (colors) => StyleSheet.create({
  pasteInput: {
    minHeight: 160,
    textAlignVertical: 'top',
  },
  mutedText: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  metaText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 8,
  },
  successText: {
    fontSize: 14,
    color: colors.success,
    lineHeight: 20,
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    lineHeight: 20,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  weekButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  footnote: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
