// Import a shared routine from pasted text (#955, Stage 2 of #581's design).
//
// The whole screen is a preview: paste text, see exactly what Kilo read from
// it, then — and only then — press one explicit action that creates a NEW
// routine. There is no merge, no overwrite, no "update the routine with this
// title", and no adoption. `onCreateRoutine` is wired in App.js straight to the
// note store's `add`, which creates a note and never touches the current-routine
// pointer, so importing can neither replace what you are training on nor edit a
// routine you already have. The one id it may reuse is this screen's OWN
// unfinished create, correlated by the durable attempt token below (#997), so a
// retry finishes that import instead of duplicating it. A user with no current
// routine still adopts through
// the existing post-save prompt on the Log tab (#748) — this screen deliberately
// offers no shortcut around it.
//
// Parsing/validation lives in lib/interoperability/routineShare.js
// (`analyzeRoutineImportText`); this file only renders that verdict.

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  ensureWorkoutNoteCreationAttempt,
  loadWorkoutNoteCreationAttempt,
  clearWorkoutNoteCreationAttempt,
} from '../storage/entries/workoutNoteCreationAttempts';

// This screen's caller context in the durable creation-attempt store (#997).
// Importing has exactly one create path, so one slot covers it, and the token
// it holds outlives an app restart.
const IMPORT_CREATE_ATTEMPT_KEY = 'import';

// Still does NOT claim nothing was written: `add` performs a local write and
// then enqueues the cloud sync, and only the second half can fail on its own,
// so a failure here genuinely can leave the routine on the device. What changed
// with #997 is that retrying is now safe — the create carries a durable
// per-attempt token, so pressing the button again finishes THIS import under
// the same routine instead of saving a second copy of it. Editing the title or
// the pasted text first is fine; it is still the same attempt.
const IMPORT_FAILED_MESSAGE =
  'Something went wrong while saving. The routine may already be on this device — '
  + 'press Create new routine again to finish this import. Retrying will not '
  + 'create a duplicate.';

// The unfinished attempt has to be VISIBLE, and ending it has to be the user's
// explicit choice (#997 review, round 2). While an attempt is pending, pressing
// Create finishes THAT import — that is what makes an edited retry safe — so
// without this the next import of a different routine would silently be written
// over the unfinished one. Which of the two the user means cannot be inferred
// from the pasted text: the contract requires an edited retry to stay the same
// attempt, so payload comparison is not allowed to decide it. Asking is.
// A failed release changes nothing, and the honest next step is either action:
// try again, or finish the unfinished import — which is still exactly what
// Create does while its attempt is pending.
const IMPORT_LEAVE_FAILED_MESSAGE =
  'Could not release the unfinished import. Nothing changed — try again, or '
  + 'press Create new routine to finish it.';

const IMPORT_UNFINISHED_MESSAGE =
  'An earlier import was saved on this device but did not finish syncing. '
  + 'Press Create new routine to finish it. To import something else instead, '
  + 'leave it as it is — you will find it under Log › Routines.';

export function RoutineImportScreen({ onBack, onCreateRoutine }) {
  const styles = useThemedStyles(createStyles);
  const inputStyle = useInputStyle();
  const [pasted, setPasted] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  // Releasing an unfinished attempt is a separate durable write, and it must be
  // mutually exclusive with creating (#997 review, round 3): while the release
  // is awaiting storage the attempt is still pending, so a Create started in
  // that window would capture the very token being retired and could complete —
  // and overwrite — the routine the user just chose to leave alone.
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState('');
  const [savedTitle, setSavedTitle] = useState('');

  const [previewWeek, setPreviewWeek] = useState('A');
  // Live mirror of `pasted` so the save resolution can compare against what is
  // on screen NOW without re-entering a state updater to find out.
  const pastedRef = useRef(pasted);
  pastedRef.current = pasted;

  // Durable creation-attempt token for this import (#997). Minted before the
  // create, retained when the create fails, restored on mount so a retry after
  // an app restart completes the original routine, and cleared only once the
  // create has fully succeeded — which is what makes the next import of an
  // identically titled, byte-identical routine a genuinely new routine.
  const createAttemptTokenRef = useRef(null);
  // Rendered mirror of the ref, so the pending attempt is shown rather than
  // silently steering the next press.
  const [pendingAttempt, setPendingAttempt] = useState(null);
  const rememberAttempt = (token) => {
    createAttemptTokenRef.current = token;
    setPendingAttempt(token);
  };
  useEffect(() => {
    let cancelled = false;
    loadWorkoutNoteCreationAttempt(IMPORT_CREATE_ATTEMPT_KEY)
      .then((token) => {
        // The restore is asynchronous; never overwrite a token this session
        // already minted.
        if (!cancelled && token && !createAttemptTokenRef.current) {
          rememberAttempt(token);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // The explicit abandonment boundary. It retires the attempt only — the
  // routine it created stays on the device, which is what the message says —
  // so the next press is a genuinely new import with its own note id.
  const handleLeaveUnfinishedImport = async () => {
    const token = createAttemptTokenRef.current;
    if (!token || saving || releasing) return;
    setError('');
    setReleasing(true);
    try {
      // The live token is dropped only after the durable record is gone, so a
      // failed release leaves the attempt exactly as pending as it was.
      await clearWorkoutNoteCreationAttempt(IMPORT_CREATE_ATTEMPT_KEY, token);
      rememberAttempt(null);
    } catch (e) {
      console.warn('[RoutineImportScreen] could not release the unfinished import', e);
      setError(IMPORT_LEAVE_FAILED_MESSAGE);
    } finally {
      setReleasing(false);
    }
  };

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
    if (!analysis.canImport || saving || releasing) return;
    const pastedAtPress = pasted;
    setError('');
    setSaving(true);
    try {
      // The BODY, not the pasted text: the envelope is transport, never
      // routine content, so it must not end up inside the saved note.
      const savedBody = analysis.body;
      const saved = title.trim();
      // Neither attempt-store write is swallowed: both are inside this
      // function's try/catch, so a rejection lands on IMPORT_FAILED_MESSAGE
      // instead of quietly weakening the guarantee. Importing without a durable
      // token would be an uncorrelated create (the duplicate this exists to
      // prevent), and leaving a completed attempt in the store would let the
      // NEXT import adopt this routine's note id and overwrite it. Either way
      // the honest outcome is the failure message, whose instruction — press
      // Create again — re-enters the same attempt and cannot duplicate.
      const attemptToken = createAttemptTokenRef.current
        || await ensureWorkoutNoteCreationAttempt(IMPORT_CREATE_ATTEMPT_KEY);
      rememberAttempt(attemptToken);
      await onCreateRoutine?.(saved, savedBody, { attemptToken });
      // Only a fully successful create retires the attempt. A throw above skips
      // this and leaves the token durable for the retry.
      await clearWorkoutNoteCreationAttempt(IMPORT_CREATE_ATTEMPT_KEY, attemptToken);
      rememberAttempt(null);
      setSavedTitle(saved || 'Untitled Routine');
      // The fields stay editable during an awaited save, so a user who pasted
      // the NEXT routine while this one was in flight must not have those
      // edits wiped by its completion. The PASTE alone decides that — it is
      // the identity of what is on screen — and both fields are then cleared
      // or both kept together. Deciding per field would clear a new routine's
      // title just because it happens to match the one just saved (PR #971
      // review, round 2).
      if (pastedRef.current === pastedAtPress) {
        setPasted('');
        setTitle('');
      }
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

      {pendingAttempt ? (
        <Card>
          <Text style={styles.mutedText} testID="routine-import-unfinished">
            {IMPORT_UNFINISHED_MESSAGE}
          </Text>
          <Button
            onPress={handleLeaveUnfinishedImport}
            title="Leave it and start fresh"
            loadingTitle="Leaving…"
            loading={releasing}
            disabled={saving || releasing}
            accessibilityLabel="Leave the unfinished import as it is and start a new import"
            style={styles.leaveButton}
          />
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
        disabled={!analysis.canImport || saving || releasing}
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
  leaveButton: {
    marginTop: 12,
  },
  footnote: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
