import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Button, Card, SectionTitle, useInputStyle } from './UI';
import { useTheme, useThemedStyles, useKuaStyle } from '../theme/ThemeContext';
import { copyTextToClipboard } from '../lib/platformClipboard';
import { loadCurrentWorkoutId, loadWorkoutNotes } from '../storage/entries/workoutNotes';
import {
  buildExerciseNameNormalizationPrompt,
  buildKiloRoutineFormatPrompt,
  buildRoutinePlanningPrompt,
} from '../lib/interoperability/routinePrompts';
import { MAX_REPLY_LENGTH, applySelectedChanges, buildNormalizationPreview } from '../lib/interoperability/routineNormalizationImport';
import { canPickTextFile, pickTextFile } from '../lib/platformFilePicker';
import { applyWorkoutNoteTextBatch } from '../hooks/entries/workoutNoteHooks';
import {
  clearNormalizationImportSnapshot,
  loadNormalizationImportSnapshot,
  saveNormalizationImportSnapshot,
} from '../storage/entries/normalizationImportSnapshot';

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

// #1172 return path: paste or pick the external reply, preview every rename
// against the targets captured when the prompt was copied/shared, then apply
// only the approved renames. Invalid or stale targets are listed, never written.
function NormalizationImport({ snapshot, loadNotes, applyBatch, pickFile, canPickFile, onApplied, onPendingRetry, onComplete, onDiscard }) {
  const styles = useThemedStyles(createStyles);
  const inputStyle = useInputStyle();
  const [reply, setReply] = useState('');
  const [preview, setPreview] = useState(null);
  const [offKeys, setOffKeys] = useState(() => new Set());
  const [offTargets, setOffTargets] = useState(() => new Set());
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Only the newest review may publish; an edit or a later review makes any
  // in-flight one obsolete.
  const reviewSeq = useRef(0);

  const review = async (text) => {
    const seq = ++reviewSeq.current;
    setResult(null);
    setMessage('');
    try {
      const loaded = await loadNotes();
      if (seq !== reviewSeq.current) return;
      const next = buildNormalizationPreview(text, snapshot, loaded);
      setPreview(next);
      setOffKeys(new Set());
      setOffTargets(new Set());
    } catch {
      if (seq !== reviewSeq.current) return;
      setPreview(null);
      setMessage('Couldn’t read routines from this device. Nothing changed.');
    }
  };
  const handlePick = async () => {
    try {
      const text = await pickFile();
      if (text == null) return;
      setReply(text);
      await review(text);
    } catch (error) {
      setMessage(error?.message || 'Couldn’t read that file. Nothing changed.');
    }
  };
  const discardSnapshot = async () => {
    setMessage('');
    try {
      await onDiscard();
    } catch {
      setMessage('Couldn’t discard the saved prompt. It is still available to import.');
    }
  };

  const valid = preview ? preview.entries.filter(entry => entry.changes) : [];
  const invalid = preview ? preview.entries.filter(entry => entry.problems) : [];
  const selectedKeys = new Set((preview?.mappings || []).map(m => m.key).filter(key => !offKeys.has(key)));
  const planned = valid
    .filter(entry => !offTargets.has(entry.id))
    .map(entry => ({ entry, next: applySelectedChanges(entry, selectedKeys) }))
    .filter(item => item.next != null);

  // Retry re-runs only the failed items; earlier outcomes stay reported.
  // One storage batch (#1172): the authority check and every target write
  // happen under one notebook lock. Retry re-submits only the failed items;
  // the authority may already hold text this import wrote (it was a target).
  const apply = async (items, previous = null) => {
    setBusy(true);
    setMessage('');
    const authorityId = snapshot.authority.id;
    const accepted = [...(previous?.saved || []), ...items].filter(item => item.entry.id === authorityId).map(item => item.next);
    let response;
    try {
      response = await applyBatch({
        authority: { id: authorityId, expected_raw_text: snapshot.authority.raw_text, accepted_raw_texts: accepted },
        items: items.map(item => ({ id: item.entry.id, expected_raw_text: item.entry.snapshot, next_raw_text: item.next })),
      });
    } catch {
      response = { authority: 'unchanged', saved: [], skipped: [], failed: items.map(item => ({ id: item.entry.id })) };
    }
    setBusy(false);
    if (response.authority !== 'unchanged') {
      setMessage('The authoritative routine changed after the prompt was generated. Nothing was written. Generate a fresh prompt.');
      return;
    }
    const byId = new Map(items.map(item => [item.entry.id, item]));
    const pick = list => (list || []).map(row => byId.get(row.id)).filter(Boolean);
    const outcome = {
      saved: [...(previous?.saved || []), ...pick(response.saved)],
      skipped: [...(previous?.skipped || []), ...pick(response.skipped)],
      failed: pick(response.failed),
    };
    setResult(outcome);
    onPendingRetry(outcome.failed.length > 0);
    if (!outcome.failed.length && (outcome.saved.length || outcome.skipped.length)) {
      try {
        await onComplete();
      } catch {
        setMessage('Changes were applied, but the saved prompt could not be cleared. It remains available to import.');
      }
    }
    // A failed item whose local text landed (enqueue failed) still changed the
    // notebook, so refresh for it too.
    if (response.saved.length || (response.failed || []).some(row => row.landed)) onApplied();
  };


  const toggle = (setter, key) => setter(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // While failed saves await Retry the reply is frozen, so editing or
  // re-reviewing can never discard the only Retry action.
  const retryPending = Boolean(result?.failed.length);
  const label = item => `Target routine ${item.entry.number}: ${item.entry.title}`;

  return (
    <>
      <SectionTitle>Import normalized routines</SectionTitle>
      <Card>
        <Text style={styles.muted}>Paste the LLM’s complete reply{canPickFile ? ' or choose a text file' : ''}. Kilo checks that only exercise names changed before anything is written.</Text>
      </Card>
      <TextInput
        style={[inputStyle, styles.replyInput]}
        multiline
        value={reply}
        editable={!retryPending}
        onChangeText={(text) => {
          if (retryPending) return;
          // Never hold an oversized paste in state or render it.
          if (text.length > MAX_REPLY_LENGTH) { setMessage('That reply is too large to be routine results. Nothing changed.'); return; }
          reviewSeq.current += 1; setReply(text); setPreview(null); setResult(null); }}
        placeholder="Paste the normalized routines here"
        accessibilityLabel="Normalized routines reply"
        testID="normalization-reply-input"
      />
      <View style={styles.actions}>
        <Button title="Review changes" onPress={() => review(reply)} disabled={!reply.trim() || retryPending} accessibilityLabel="Review normalized routines" />
        {canPickFile ? <Button title="Choose text file" onPress={handlePick} disabled={retryPending} accessibilityLabel="Choose normalized routines file" /> : null}
        {!retryPending ? <Button title="Discard saved prompt" onPress={discardSnapshot} accessibilityLabel="Discard saved normalization prompt" /> : null}
      </View>
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {preview?.tooLarge ? <Text style={styles.error}>That reply is too large to be routine results. Nothing changed.</Text> : null}
      {preview?.authorityStale ? (
        <Text style={styles.error}>The authoritative routine changed after the prompt was generated. Nothing can be applied. Generate a fresh prompt.</Text>
      ) : null}
      {preview && !preview.authorityStale && !preview.tooLarge ? <>
        {preview.mappings.length ? <>
          <SectionTitle>Name changes</SectionTitle>
          <View style={styles.choiceList}>
            {preview.mappings.map(m => {
              const checked = !offKeys.has(m.key);
              return <Pressable key={m.key} style={styles.choice} onPress={() => toggle(setOffKeys, m.key)} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={`Rename ${m.oldName} to ${m.newName}`}>
                <Text style={styles.choiceTitle}>{checked ? '✓ ' : ''}{m.oldName} → {m.newName}</Text>
                <Text style={styles.muted}>{m.noteCount} {m.noteCount === 1 ? 'routine' : 'routines'}</Text>
              </Pressable>;
            })}
          </View>
        </> : <Text style={styles.muted}>No exercise names changed in the valid results.</Text>}
        {valid.length ? <>
          <SectionTitle>Routines to update</SectionTitle>
          <View style={styles.choiceList}>
            {valid.map(entry => {
              const checked = !offTargets.has(entry.id);
              const next = applySelectedChanges(entry, selectedKeys);
              return <Pressable key={entry.id} style={styles.choice} onPress={() => toggle(setOffTargets, entry.id)} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={`Update Target routine ${entry.number}: ${entry.title}`}>
                <Text style={styles.choiceTitle}>{checked ? '✓ ' : ''}Target routine {entry.number}: {entry.title}</Text>
                <Text selectable style={styles.prompt} testID={`normalization-preview-${entry.number}`}>{entry.changes.length === 0 ? 'No proposed change. This routine is returned unchanged.' : (next ?? 'No selected changes.')}</Text>
              </Pressable>;
            })}
          </View>
        </> : null}
        {invalid.length || preview.unknown.length ? <>
          <SectionTitle>Not applied</SectionTitle>
          <Card>
            {invalid.map(entry => <Text key={entry.id} style={styles.error}>Target routine {entry.number}: {entry.title} — {entry.problems.join(' ')}</Text>)}
            {preview.unknown.map(number => <Text key={`u${number}`} style={styles.error}>Target routine {number} was not in the prompt and was ignored.</Text>)}
          </Card>
        </> : null}
        {!result ? (
          <Button title={`Apply to ${planned.length} ${planned.length === 1 ? 'routine' : 'routines'}`} loading={busy} disabled={busy || planned.length === 0} onPress={() => apply(planned)} accessibilityLabel="Apply normalized names" />
        ) : null}
      </> : null}
      {result ? (
        <Card>
          {result.saved.map(item => <Text key={`s${item.entry.id}`} style={styles.notice}>Updated {label(item)}.</Text>)}
          {result.skipped.map(item => <Text key={`k${item.entry.id}`} style={styles.error}>Not updated {label(item)}: it was edited or removed after the prompt was generated.</Text>)}
          {result.failed.map(item => <Text key={`f${item.entry.id}`} style={styles.error}>Couldn’t save {label(item)}.</Text>)}
          {!result.saved.length && !result.skipped.length && !result.failed.length ? <Text style={styles.notice}>Nothing was written.</Text> : null}
          {result.failed.length ? <Button title="Retry failed" loading={busy} disabled={busy} onPress={() => apply(result.failed, result)} accessibilityLabel="Retry failed routines" /> : null}
        </Card>
      ) : null}
    </>
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
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const styles = useThemedStyles(createStyles);
  const [notes, setNotes] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tool, setTool] = useState(initialTool);
  const [authorityId, setAuthorityId] = useState(null);
  const [targetIds, setTargetIds] = useState([]);
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
        setAuthorityId(defaultAuthority?.id || null);
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

  const authority = useMemo(() => notes.find(note => note.id === authorityId) || null, [notes, authorityId]);
  const targets = useMemo(() => notes.filter(note => targetIds.includes(note.id)), [notes, targetIds]);
  const prompt = useMemo(() => {
    if ((loadFailed || refreshing) && tool !== 'format') return '';
    if (tool === 'plan') return authority ? buildRoutinePlanningPrompt(authority) : '';
    if (tool === 'normalize') return authority && targets.length ? buildExerciseNameNormalizationPrompt({ authority, targets }) : '';
    if (tool === 'format') return buildKiloRoutineFormatPrompt();
    return '';
  }, [tool, authority, targets, loadFailed, refreshing]);

  const openTool = (nextTool) => {
    setNotice('');
    setTool(nextTool);
  };
  const toggleTarget = (id) => setTargetIds(previous => (
    previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]
  ));
  // Freeze the exact authority/targets the prompt was built from, in prompt
  // order, so the return path validates against what the LLM actually saw.
  const captureSnapshot = async () => {
    if (tool !== 'normalize' || !authority || !targets.length) return;
    const pick = note => ({ id: note.id, title: note.title, raw_text: note.raw_text });
    // Every capture gets a fresh identity so the import panel remounts and
    // never applies a preview built from an earlier snapshot.
    const next = { version: (snapshot?.version || 0) + 1, authority: pick(authority), targets: targets.map(pick) };
    await saveNormalizationImportSnapshot(next);
    setSnapshot(next);
  };
  const blockedByRetry = () => {
    if (tool === 'normalize' && pendingRetry) {
      setNotice('Retry or resolve the routines that couldn’t be saved before making a new prompt.');
      return true;
    }
    return false;
  };
  const handleCopy = async () => {
    if (blockedByRetry()) return;
    try {
      await copy(prompt);
    } catch {
      setNotice('Couldn’t copy the prompt. Nothing else changed.');
      return;
    }
    try {
      await captureSnapshot();
      setNotice('Prompt copied. Paste it into the LLM you choose.');
    } catch {
      setNotice('Prompt copied, but it could not be saved for later import. Keep the prompt open and try copying again.');
    }
  };
  const handleShare = async () => {
    if (blockedByRetry()) return;
    try {
      await (share || Share.share.bind(Share))({ message: prompt });
    } catch {
      setNotice('Couldn’t open sharing. Nothing else changed.');
      return;
    }
    try {
      await captureSnapshot();
    } catch {
      setNotice('Shared prompt could not be saved for later import. Keep this screen open and try sharing again.');
    }
  };

  if (tool) {
    const isNormalize = tool === 'normalize';
    return (
      <ScreenShell title="Prompt tools" subtitle="Copy a local template into the LLM you choose." onBack={() => {
        // Leaving would discard the only Retry for saves that failed (#1172).
        if (pendingRetry) { setNotice('Retry or resolve the routines that couldn’t be saved before leaving.'); return; }
        setTool(null);
        setNotice('');
      }}>
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
                return <Pressable key={note.id || `${index}`} onPress={() => { setAuthorityId(note.id); setNotice(''); }} style={[styles.choice, selected && { borderColor: kua ? kua.primary : colors.accent }]} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`Use ${titleFor(note, index, notes)} as ${isNormalize ? 'the authoritative routine' : 'the routine to plan'}`}>
                  <Text style={styles.choiceTitle}>{titleFor(note, index, notes)}{note.id === currentId ? ' · Current' : ''}</Text>
                </Pressable>;
              })}
            </View>
            {isNormalize ? <>
              <SectionTitle>Targets</SectionTitle>
              <View style={styles.choiceList}>
                {notes.map((note, index) => {
                  const selected = targetIds.includes(note.id);
                  return <Pressable key={note.id || `${index}`} onPress={() => { toggleTarget(note.id); setNotice(''); }} style={[styles.choice, selected && { borderColor: kua ? kua.primary : colors.accent }]} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`Normalize ${titleFor(note, index, notes)}`}>
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
        {isNormalize && snapshot ? (
          <NormalizationImport key={snapshot.version} snapshot={snapshot} loadNotes={loadNotes} applyBatch={applyBatch} pickFile={pickFile} canPickFile={canPickFile} onApplied={refreshNotes} onPendingRetry={setPendingRetry} onComplete={clearNormalizationImportSnapshot} onDiscard={async () => { await clearNormalizationImportSnapshot(); setSnapshot(null); }} />
        ) : null}
        {isNormalize && !snapshot ? <Card><Text style={styles.muted}>No saved normalization prompt is available. Choose an authoritative routine and targets, then copy the prompt to begin.</Text></Card> : null}
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

// Under the production KUA gate (`kua` supplied) the tool/choice cards and ink
// resolve through the selected court palette; outside the gate (`kua` null)
// they keep the legacy palette.
const createStyles = (colors, kua = null) => StyleSheet.create({
  toolList: { gap: 12 },
  toolCard: { backgroundColor: kua ? kua.surfaceCard : colors.card, borderColor: kua ? kua.surfaceBorder : colors.cardBorder, borderWidth: 1, borderRadius: 24, minHeight: 76, padding: 18, justifyContent: 'center' },
  toolCopy: { gap: 4 },
  toolTitle: { color: kua ? kua.onSurface : colors.text, fontSize: 17, fontWeight: '600' },
  muted: { color: kua ? kua.onSurfaceVariant : colors.textMuted, fontSize: 14, lineHeight: 20 },
  choiceList: { gap: 8 },
  choice: { backgroundColor: kua ? kua.surfaceCard : colors.card, borderColor: kua ? kua.surfaceBorder : colors.cardBorder, borderWidth: 1, borderRadius: 16, minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 },
  choiceTitle: { color: kua ? kua.onSurface : colors.text, fontSize: 15, fontWeight: '600' },
  prompt: { color: kua ? kua.onSurface : colors.text, fontSize: 14, lineHeight: 20 },
  actions: { gap: 10 },
  notice: { color: kua ? kua.onSurfaceVariant : colors.textMuted, fontSize: 14, lineHeight: 20 },
  replyInput: { minHeight: 140, textAlignVertical: 'top' },
  error: { color: kua ? kua.errorText : colors.error, fontSize: 14, lineHeight: 20 },
});
