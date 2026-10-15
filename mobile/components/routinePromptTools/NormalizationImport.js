import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Button, Card, SectionTitle, useInputStyle } from '../UI';
import { useThemedStyles } from '../../theme/ThemeContext';
import { MAX_REPLY_LENGTH, applySelectedChanges, buildNormalizationPreview } from '../../lib/interoperability/routineNormalizationImport';
import { TYPOGRAPHY } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { FieldLabel } from '../FieldLabel';

// #1172 return path: paste or pick the external reply, preview every rename
// against the targets captured when the prompt was copied/shared, then apply
// only the approved renames. Invalid or stale targets are listed, never written.
export function NormalizationImport({ snapshot, loadNotes, applyBatch, pickFile, canPickFile, onApplied, onPendingRetry, onComplete, onDiscard }) {
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
    <View style={styles.section} testID="normalization-import-section">
      <SectionTitle>Import normalized routines</SectionTitle>
      <Card>
        <Text style={styles.muted}>Paste the LLM’s complete reply{canPickFile ? ' or choose a text file' : ''}. Kilo checks that only exercise names changed before anything is written.</Text>
      </Card>
      <FieldLabel>Normalized routines reply</FieldLabel>
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
                <Text style={styles.choiceTitle}>{checked ? <><MaterialIcons name="check" size={16} accessible={false} />{' '}</> : null}{m.oldName} → {m.newName}</Text>
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
                <Text style={styles.choiceTitle}>{checked ? <><MaterialIcons name="check" size={16} accessible={false} />{' '}</> : null}Target routine {entry.number}: {entry.title}</Text>
                <Text selectable style={styles.prompt} testID={`normalization-preview-${entry.number}`}>{entry.changes.length === 0 ? 'No proposed change. This routine is returned unchanged.' : (next ?? 'No selected changes.')}</Text>
              </Pressable>;
            })}
          </View>
        </> : null}
        {invalid.length || preview.unknown.length ? <>
          <SectionTitle>Not applied</SectionTitle>
          <Card>
            {invalid.map(entry => <Text key={entry.id} style={styles.error}>Target routine {entry.number}: {entry.title} has a problem. {entry.problems.join(' ')}</Text>)}
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
    </View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  muted: { color: kua ? kua.onSurfaceVariant : colors.textMuted, fontSize: TYPOGRAPHY['body-md'].fontSize, lineHeight: 20 },
  section: { gap: 16 },
  choiceList: { gap: 8 },
  choice: { backgroundColor: kua ? kua.surfaceCard : colors.card, borderColor: kua ? kua.surfaceBorder : colors.cardBorder, borderWidth: 1, borderRadius: GEOMETRY['radius-2xl'], minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 },
  choiceTitle: { color: kua ? kua.onSurface : colors.text, fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '600' },
  prompt: { color: kua ? kua.onSurface : colors.text, fontSize: TYPOGRAPHY['body-md'].fontSize, lineHeight: 20 },
  actions: { gap: 10 },
  notice: { color: kua ? kua.onSurfaceVariant : colors.textMuted, fontSize: TYPOGRAPHY['body-md'].fontSize, lineHeight: 20 },
  replyInput: { minHeight: 140, textAlignVertical: 'top' },
  error: { color: kua ? kua.errorText : colors.error, fontSize: TYPOGRAPHY['body-md'].fontSize, lineHeight: 20 },
});
