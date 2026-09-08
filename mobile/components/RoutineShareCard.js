import React, { useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
import { LightColors } from '../theme/colors';
import { buildRoutineShareSummary, shareRoutineImage } from '../lib/interoperability/routineShare';

// A timed hold declares seconds, not reps. Collapse an equal lo/hi to a single
// value so `2x60s` reads "60s hold", not "60-60s hold".
function formatHold({ lo, hi }) {
  return lo === hi ? `${lo}s hold` : `${lo}-${hi}s hold`;
}

// This view accepts only the allowlisted image model. In particular, it never
// receives raw_text, annotations, check-ins, Recovery state or analytics.
export const RoutineShareCard = React.forwardRef(function RoutineShareCard({ summary, onLayout }, ref) {
  const styles = useThemedStyles(createStyles);
  return (
    <View ref={ref} collapsable={false} onLayout={onLayout} style={styles.card} testID="routine-share-card">
      <Text style={styles.brand}>KILO · ROUTINE</Text>
      <Text style={styles.title} accessibilityRole="header">{summary.title}</Text>
      {summary.sections.map((section, index) => (
        <View key={index} style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">
            {[section.week ? `Week ${section.week}` : null, section.heading, section.subheading].filter(Boolean).join(' · ') || 'Exercises'}
          </Text>
          {section.exercises.map((exercise, exerciseIndex) => (
            <View key={exerciseIndex} style={styles.exercise}>
              <Text style={styles.name}>{exercise.name}</Text>
              <Text style={styles.detail}>
                {exercise.setCount == null ? 'Sets not specified' : `${exercise.setCount} ${exercise.setCount === 1 ? 'set' : 'sets'}`}
                {exercise.repRange ? ` · ${exercise.repRange.lo}-${exercise.repRange.hi} reps` : ''}
                {exercise.holdRange ? ` · ${formatHold(exercise.holdRange)}` : ''}
              </Text>
              {exercise.latestSets?.length > 0 && (
                <Text style={styles.detail}>
                  {'Latest: ' + exercise.latestSets.map(set => [
                    set.weight != null ? `${set.weight} ${set.unit || 'lb'}` : null,
                    set.reps != null ? `${set.reps} reps` : null,
                    set.holdSeconds != null ? `${set.holdSeconds}s hold` : null,
                  ].filter(Boolean).join(' × ')).join('; ')}
                </Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
});

// Mount once per share attempt. The caller snapshots title/body on opening,
// and unmounts on close, so numeric consent cannot carry to another share.
export function RoutineShareModal({ title, rawText, onClose, shareImage = shareRoutineImage }) {
  const styles = useThemedStyles(createStyles);
  const [includeNumbers, setIncludeNumbers] = useState(false);
  const [laidOut, setLaidOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const cardRef = useRef(null);
  const summary = useMemo(() => buildRoutineShareSummary({ title, rawText, includeNumbers }), [title, rawText, includeNumbers]);
  const canShare = summary.sections.length > 0 && laidOut === includeNumbers && !busy;
  const close = () => { if (!inFlight.current) onClose(); };
  const handleShare = async () => {
    if (!canShare || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await shareImage(cardRef);
      // Resolving a share sheet can also mean dismissal, so show no delivery claim.
    } catch {
      setError('Could not share this image. Try again, or close this preview to share as text.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text style={styles.dialogTitle} accessibilityRole="header">Share as Image</Text>
          <Text style={styles.description}>Review the image before sharing. Comments and marks are excluded. Check your title and exercise names for anything private.</Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Include weights and reps for this share"
            accessibilityState={{ checked: includeNumbers, disabled: busy }}
            disabled={busy}
            onPress={() => { setLaidOut(null); setIncludeNumbers(value => !value); }}
            style={styles.option}
          >
            <Text style={styles.optionText}>{includeNumbers ? '☑' : '☐'} Include weights and reps for this share</Text>
          </Pressable>
          <ScrollView style={styles.preview} contentContainerStyle={styles.previewContent}>
            <RoutineShareCard
              key={includeNumbers ? 'numbers' : 'redacted'}
              ref={cardRef}
              summary={summary}
              onLayout={() => setLaidOut(includeNumbers)}
            />
          </ScrollView>
          {summary.sections.length === 0 && <Text style={styles.description}>No exercises to share. Check the routine text.</Text>}
          {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
          <View style={styles.actions}>
            <Button title="Close" onPress={close} disabled={busy} style={styles.action} />
            <Button title={Platform.OS === 'web' ? 'Save image' : 'Share image'} accessibilityLabel="Confirm routine image" onPress={handleShare} disabled={!canShare} loading={busy} loadingTitle="Preparing image…" style={styles.action} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = colors => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 16 },
  dialog: { backgroundColor: colors.background, borderRadius: 24, padding: 18, gap: 16, maxHeight: '90%', width: '100%', maxWidth: 560, alignSelf: 'center' },
  dialogTitle: { color: colors.text, fontSize: 22, fontWeight: '700' },
  description: { color: colors.textMuted, fontSize: 14 },
  option: { minHeight: 44, justifyContent: 'center' },
  optionText: { color: colors.text, fontSize: 15 },
  preview: { flexShrink: 1 },
  previewContent: { flexGrow: 1 },
  // Fixed export colors are intentional: the image is a portable document.
  card: { backgroundColor: LightColors.card, padding: 20, gap: 16, width: '100%' },
  brand: { color: LightColors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  title: { color: LightColors.text, fontSize: 26, fontWeight: '700', flexShrink: 1 },
  section: { gap: 12 },
  heading: { color: LightColors.accentText, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  exercise: { gap: 4 },
  name: { color: LightColors.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  detail: { color: LightColors.textMuted, fontSize: 14, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  action: { flexGrow: 1, flexBasis: 120 },
  error: { color: colors.error, fontSize: 14 },
});
