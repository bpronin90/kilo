import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Button, Card, SectionTitle } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { copyTextToClipboard } from '../lib/platformClipboard';
import { loadCurrentWorkoutId, loadWorkoutNotes } from '../storage/entries/workoutNotes';
import {
  buildExerciseNameNormalizationPrompt,
  buildKiloRoutineFormatPrompt,
  buildRoutinePlanningPrompt,
} from '../lib/interoperability/routinePrompts';

function titleFor(routine, index, notes) {
  const title = String(routine?.title || 'Untitled Routine');
  const duplicateNumber = notes.slice(0, index + 1).filter(note => String(note?.title || 'Untitled Routine') === title).length;
  const duplicateCount = notes.filter(note => String(note?.title || 'Untitled Routine') === title).length;
  return duplicateCount > 1 ? `${title} (${duplicateNumber})` : title;
}

function ToolCard({ title, detail, onPress, label, testID }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable style={styles.toolCard} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      <View style={styles.toolCopy}>
        <Text style={styles.toolTitle}>{title}</Text>
        <Text style={styles.muted}>{detail}</Text>
      </View>
    </Pressable>
  );
}

export function RoutinePromptToolsScreen({
  onBack,
  loadNotes = loadWorkoutNotes,
  loadCurrentId = loadCurrentWorkoutId,
  copy = copyTextToClipboard,
  share = null,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [notes, setNotes] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tool, setTool] = useState(null);
  const [authorityId, setAuthorityId] = useState(null);
  const [targetIds, setTargetIds] = useState([]);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadNotes(), loadCurrentId()])
      .then(([loadedNotes, loadedCurrentId]) => {
        if (cancelled) return;
        const safeNotes = Array.isArray(loadedNotes) ? loadedNotes.filter(note => note && typeof note.raw_text === 'string') : [];
        setNotes(safeNotes);
        setCurrentId(loadedCurrentId || null);
        const defaultAuthority = safeNotes.find(note => note.id === loadedCurrentId) || safeNotes[0] || null;
        setAuthorityId(defaultAuthority?.id || null);
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadNotes, loadCurrentId]);

  const authority = useMemo(() => notes.find(note => note.id === authorityId) || null, [notes, authorityId]);
  const targets = useMemo(() => notes.filter(note => targetIds.includes(note.id)), [notes, targetIds]);
  const prompt = useMemo(() => {
    if (tool === 'plan') return authority ? buildRoutinePlanningPrompt(authority) : '';
    if (tool === 'normalize') return authority && targets.length ? buildExerciseNameNormalizationPrompt({ authority, targets }) : '';
    if (tool === 'format') return buildKiloRoutineFormatPrompt();
    return '';
  }, [tool, authority, targets]);

  const openTool = (nextTool) => {
    setNotice('');
    setTool(nextTool);
  };
  const toggleTarget = (id) => setTargetIds(previous => (
    previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]
  ));
  const handleCopy = async () => {
    try {
      await copy(prompt);
      setNotice('Prompt copied. Paste it into the LLM you choose.');
    } catch {
      setNotice('Couldn’t copy the prompt. Nothing else changed.');
    }
  };
  const handleShare = async () => {
    try {
      await (share || Share.share.bind(Share))({ message: prompt });
    } catch {
      setNotice('Couldn’t open sharing. Nothing else changed.');
    }
  };

  if (tool) {
    const isNormalize = tool === 'normalize';
    return (
      <ScreenShell title="Prompt tools" subtitle="Copy a local template into the LLM you choose." onBack={() => { setTool(null); setNotice(''); }}>
        {tool === 'format' ? (
          <Card><Text style={styles.muted}>This template contains no routine data. It explains Kilo’s importable format.</Text></Card>
        ) : loading ? (
          <Card><Text style={styles.muted}>Loading your local routines…</Text></Card>
        ) : loadFailed ? (
          <Card><Text style={styles.error}>Couldn’t read routines from this device. Nothing was shared.</Text></Card>
        ) : notes.length === 0 ? (
          <Card><Text style={styles.muted}>Create a routine first, then return here to make a routine-specific prompt.</Text></Card>
        ) : (
          <>
            <SectionTitle>{isNormalize ? 'Authoritative routine' : 'Routine'}</SectionTitle>
            <View style={styles.choiceList}>
              {notes.map((note, index) => {
                const selected = note.id === authorityId;
                return <Pressable key={note.id || `${index}`} onPress={() => { setAuthorityId(note.id); setNotice(''); }} style={[styles.choice, selected && { borderColor: colors.accent }]} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`Use ${titleFor(note, index, notes)} as ${isNormalize ? 'the authoritative routine' : 'the routine to plan'}`}>
                  <Text style={styles.choiceTitle}>{titleFor(note, index, notes)}{note.id === currentId ? ' · Current' : ''}</Text>
                </Pressable>;
              })}
            </View>
            {isNormalize ? <>
              <SectionTitle>Targets</SectionTitle>
              <View style={styles.choiceList}>
                {notes.map((note, index) => {
                  const selected = targetIds.includes(note.id);
                  return <Pressable key={note.id || `${index}`} onPress={() => { toggleTarget(note.id); setNotice(''); }} style={[styles.choice, selected && { borderColor: colors.accent }]} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`Normalize ${titleFor(note, index, notes)}`}>
                    <Text style={styles.choiceTitle}>{selected ? '✓ ' : ''}{titleFor(note, index, notes)}</Text>
                  </Pressable>;
                })}
              </View>
            </> : null}
          </>
        )}
        {prompt ? <>
          <SectionTitle>Generated prompt</SectionTitle>
          <Card><Text selectable style={styles.prompt} testID="routine-prompt-output">{prompt}</Text></Card>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <View style={styles.actions}>
            <Button title="Copy prompt" onPress={handleCopy} accessibilityLabel="Copy prompt" />
            <Button title="Share prompt" onPress={handleShare} accessibilityLabel="Share prompt" />
          </View>
        </> : null}
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Prompt tools" subtitle="Create local templates for an external LLM." onBack={onBack}>
      <Card><Text style={styles.muted}>Kilo does not connect to an LLM or upload your data. Copy or share a prompt only when you choose.</Text></Card>
      <SectionTitle>Tools</SectionTitle>
      <View style={styles.toolList}>
        <ToolCard title="Plan or update routine" detail="Discuss goals first, then ask for Kilo-ready text." onPress={() => openTool('plan')} label="Plan or update routine" testID="routine-prompt-plan" />
        <ToolCard title="Normalize exercise names" detail="Use one routine as authority and select the routines to update." onPress={() => openTool('normalize')} label="Normalize exercise names" testID="routine-prompt-normalize" />
        <ToolCard title="Kilo routine format" detail="Explain the generic text format for a new routine." onPress={() => openTool('format')} label="Kilo routine format" testID="routine-prompt-format" />
      </View>
    </ScreenShell>
  );
}

const createStyles = (colors) => StyleSheet.create({
  toolList: { gap: 12 },
  toolCard: { backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 24, minHeight: 76, padding: 18, justifyContent: 'center' },
  toolCopy: { gap: 4 },
  toolTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  choiceList: { gap: 8 },
  choice: { backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 16, minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 },
  choiceTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  prompt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  actions: { gap: 10 },
  notice: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.error, fontSize: 14, lineHeight: 20 },
});
