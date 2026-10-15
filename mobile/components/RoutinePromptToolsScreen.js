import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
import { copyTextToClipboard } from '../lib/platformClipboard';
import { loadCurrentWorkoutId, loadWorkoutNotes } from '../storage/entries/workoutNotes';
import {
  buildExerciseNameNormalizationPrompt,
  buildKiloRoutineFormatPrompt,
  buildRoutinePlanningPrompt,
} from '../lib/interoperability/routinePrompts';
import { canPickTextFile, pickTextFile } from '../lib/platformFilePicker';
import { applyWorkoutNoteTextBatch } from '../hooks/entries/workoutNoteHooks';
import {
  clearNormalizationImportSnapshot,
  loadNormalizationImportSnapshot,
  saveNormalizationImportSnapshot,
} from '../storage/entries/normalizationImportSnapshot';
import { TYPOGRAPHY } from '../theme/typography';
import { GEOMETRY } from '../theme/spacing';
import { PromptFlow } from './routinePromptTools/PromptFlow';
import { LegacyNormalizationNotice, NormalizationImport } from './routinePromptTools/NormalizationImport';
import { routineTitle } from './routinePromptTools/RoutinePicker';
import { NORMALIZATION_PROTOCOL, buildHeaderCatalog, toStoredCatalog } from '../lib/interoperability/normalizationHeaderCatalog';

// Each tool is configuration for the one shared PromptFlow (#1385): which
// pickers it needs, how its existing builder is called and its summary line.
const AUTHORITY_PICKER = { key: 'authority', mode: 'single', label: 'Authoritative routine', sheetTitle: 'Choose authoritative routine' };
const TOOLS = {
  plan: {
    pickers: [{ key: 'authority', mode: 'single', label: 'Routine', sheetTitle: 'Choose routine' }],
    build: ({ authority }) => (authority ? buildRoutinePlanningPrompt(authority) : ''),
    summary: ({ authority }) => (authority ? `Plan: ${routineTitle(authority)}` : ''),
  },
  normalize: {
    pickers: [AUTHORITY_PICKER, { key: 'targets', mode: 'multi', label: 'Targets', sheetTitle: 'Choose target routines' }],
    // Normalize shares only exercise names and distinct headers (#1386); the
    // catalog is built once per selection and drives the prompt, the summary
    // and the snapshot captured on Copy/Share.
    build: ({ authority, targets, catalog }) => (authority && targets.length && catalog?.ok ? buildExerciseNameNormalizationPrompt({ authority, targets, catalog }) : ''),
    summary: ({ targets, catalog }) => {
      const routines = `${targets.length} ${targets.length === 1 ? 'routine' : 'routines'}`;
      return `${routines} · ${catalog.headerCount} distinct ${catalog.headerCount === 1 ? 'header' : 'headers'}`;
    },
    hasImport: true,
  },
  format: {
    pickers: [],
    intro: 'This template contains no routine data. It explains Kilo’s importable format.',
    build: () => buildKiloRoutineFormatPrompt(),
    summary: () => 'No routine data',
  },
};

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
  initialTool = null,
  loadNotes = loadWorkoutNotes,
  loadCurrentId = loadCurrentWorkoutId,
  copy = copyTextToClipboard,
  share = null,
  applyBatch = applyWorkoutNoteTextBatch,
  pickFile = pickTextFile,
  canPickFile = canPickTextFile(),
}) {
  const styles = useThemedStyles(createStyles);
  const [notes, setNotes] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tool, setTool] = useState(initialTool);
  // Authority/Routine defaults to Current; Targets start empty and are only
  // ever changed by the user, never as a side effect of an authority change.
  const [picks, setPicks] = useState({ authority: null, targets: [] });
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  // A failed save may have landed locally without its upload intent; keep its
  // Retry reachable by refusing a new prompt capture until it is resolved.
  const [pendingRetry, setPendingRetry] = useState(false);

  // After an import writes, re-read so a new prompt/snapshot uses the saved
  // text instead of the text loaded when the screen mounted.
  const [refreshing, setRefreshing] = useState(false);
  const refreshNotes = () => {
    setRefreshing(true);
    loadNotes()
      .then(loaded => { if (Array.isArray(loaded)) setNotes(loaded.filter(note => note && typeof note.raw_text === 'string')); })
      // A failed re-read must not leave the pre-apply text available for a
      // new prompt/snapshot; show the read failure instead.
      .catch(() => setLoadFailed(true))
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadNotes(), loadCurrentId()])
      .then(([loadedNotes, loadedCurrentId]) => {
        if (cancelled) return;
        const safeNotes = Array.isArray(loadedNotes) ? loadedNotes.filter(note => note && typeof note.raw_text === 'string') : [];
        setNotes(safeNotes);
        setCurrentId(loadedCurrentId || null);
        const defaultAuthority = safeNotes.find(note => note.id === loadedCurrentId) || safeNotes[0] || null;
        setPicks(previous => ({ ...previous, authority: defaultAuthority?.id || null }));
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadNotes, loadCurrentId]);

  useEffect(() => {
    loadNormalizationImportSnapshot().then((stored) => {
      if (stored) setSnapshot(stored);
    }).catch(() => {});
  }, []);

  const authority = useMemo(() => notes.find(note => note.id === picks.authority) || null, [notes, picks.authority]);
  const targets = useMemo(() => notes.filter(note => picks.targets.includes(note.id)), [notes, picks.targets]);
  const config = tool ? TOOLS[tool] : null;
  const catalog = useMemo(() => (config?.hasImport && authority && targets.length ? buildHeaderCatalog(authority, targets) : null), [config, authority, targets]);
  // Withheld while routines are unreadable or refreshing so a stale
  // routine-specific prompt can never be copied or shared.
  const gated = config && config.pickers.length > 0 && (loadFailed || refreshing);
  const prompt = useMemo(() => (config && !gated ? config.build({ authority, targets, catalog }) : ''), [config, gated, authority, targets, catalog]);
  const status = loading ? 'loading' : loadFailed ? 'failed' : notes.length === 0 ? 'empty' : 'ready';

  const openTool = (nextTool) => {
    setNotice('');
    setTool(nextTool);
  };
  // Freeze the exact authority/targets the prompt was built from, in prompt
  // order, so the return path validates against what the LLM actually saw.
  const captureSnapshot = async () => {
    if (!config?.hasImport || !authority || !targets.length || !catalog?.ok) return;
    const pick = note => ({ id: note.id, title: note.title, raw_text: note.raw_text });
    // Every capture gets a fresh identity so the import panel remounts and
    // never applies a preview built from an earlier snapshot. The protocol
    // discriminator and the ref/occurrence catalog persist with the original
    // texts so a remount restores the same refs.
    const next = { version: (snapshot?.version || 0) + 1, protocol: NORMALIZATION_PROTOCOL, authority: pick(authority), targets: targets.map(pick), catalog: toStoredCatalog(catalog) };
    await saveNormalizationImportSnapshot(next);
    setSnapshot(next);
  };

  if (tool) {
    const discard = async () => { await clearNormalizationImportSnapshot(); setSnapshot(null); };
    const importSlot = !config.hasImport ? null : snapshot?.legacy ? (
      <LegacyNormalizationNotice key={snapshot.version} onDiscard={discard} />
    ) : snapshot ? (
      <NormalizationImport key={snapshot.version} snapshot={snapshot} loadNotes={loadNotes} applyBatch={applyBatch} pickFile={pickFile} canPickFile={canPickFile} onApplied={refreshNotes} onPendingRetry={setPendingRetry} onComplete={clearNormalizationImportSnapshot} onDiscard={discard} />
    ) : <Card><Text style={styles.muted}>No saved normalization prompt is available. Choose an authoritative routine and targets, then copy the prompt to begin.</Text></Card>;
    return (
      <ScreenShell title="Prompt tools" subtitle="Copy a local template into the LLM you choose." onBack={() => {
        // Leaving would discard the only Retry for saves that failed (#1172).
        if (pendingRetry) { setNotice('Retry or resolve the routines that couldn’t be saved before leaving.'); return; }
        setTool(null);
        setNotice('');
      }}>
        <PromptFlow
          key={tool}
          config={config}
          status={status}
          notes={notes}
          currentId={currentId}
          picks={picks}
          onPick={(key, value) => setPicks(previous => ({ ...previous, [key]: value }))}
          prompt={prompt}
          summary={prompt ? config.summary({ authority, targets, catalog }) : ''}
          blockedMessage={!gated && catalog && !catalog.ok ? catalog.reason : null}
          notice={notice}
          setNotice={setNotice}
          copy={copy}
          share={share}
          onCaptured={captureSnapshot}
          blockedNotice={config.hasImport && pendingRetry ? 'Retry or resolve the routines that couldn’t be saved before making a new prompt.' : null}
          importSlot={importSlot}
        />
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

// Under the production KUA gate (`kua` supplied) the tool cards and ink
// resolve through the selected court palette; outside the gate (`kua` null)
// they keep the legacy palette.
const createStyles = (colors, kua = null) => StyleSheet.create({
  toolList: { gap: 12 },
  toolCard: { backgroundColor: kua ? kua.surfaceCard : colors.card, borderColor: kua ? kua.surfaceBorder : colors.cardBorder, borderWidth: 1, borderRadius: GEOMETRY['radius-2xl'], minHeight: 76, padding: 18, justifyContent: 'center' },
  toolCopy: { gap: 4 },
  toolTitle: { color: kua ? kua.onSurface : colors.text, fontSize: TYPOGRAPHY['body-lg'].fontSize, fontWeight: '600' },
  muted: { color: kua ? kua.onSurfaceVariant : colors.textMuted, fontSize: TYPOGRAPHY['body-md'].fontSize, lineHeight: 20 },
});
