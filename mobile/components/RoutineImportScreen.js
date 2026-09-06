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
import { StyleSheet, Text, TextInput } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Button, Card, SectionTitle, useInputStyle } from './UI';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';
import { useThemedStyles } from '../theme/ThemeContext';
import { buildDayGroups } from '../screens/log/logScreenHelpers';
import {
  ROUTINE_IMPORT_EMPTY_MESSAGE,
  analyzeRoutineImportText,
} from '../lib/interoperability/routineShare';

const IMPORT_FAILED_MESSAGE =
  'Could not save the imported routine. Nothing was changed — try again.';

export function RoutineImportScreen({ onBack, onCreateRoutine }) {
  const styles = useThemedStyles(createStyles);
  const inputStyle = useInputStyle();
  const [pasted, setPasted] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedTitle, setSavedTitle] = useState('');

  const analysis = useMemo(() => analyzeRoutineImportText(pasted), [pasted]);
  const dayGroups = useMemo(() => buildDayGroups(analysis.sections), [analysis.sections]);

  // The title field follows the envelope's `#title:` line. Keyed on the
  // envelope title itself, so it re-seeds when a different routine is pasted
  // and stays put — including when the user has renamed it — while they keep
  // editing the same paste. An envelope with no title never clears a name the
  // user typed.
  useEffect(() => {
    if (analysis.envelopeTitle) setTitle(analysis.envelopeTitle);
  }, [analysis.envelopeTitle]);

  const handlePasteChange = (next) => {
    setSavedTitle('');
    setError('');
    setPasted(next);
  };

  const handleImport = async () => {
    if (!analysis.canImport || saving) return;
    setError('');
    setSaving(true);
    try {
      // The BODY, not the pasted text: the envelope is transport, never
      // routine content, so it must not end up inside the saved note.
      await onCreateRoutine?.(title.trim(), analysis.body);
      setSavedTitle(title.trim() || 'Untitled Routine');
      setPasted('');
      setTitle('');
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
  footnote: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
