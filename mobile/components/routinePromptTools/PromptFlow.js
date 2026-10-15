import React, { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Button, Card } from '../UI';
import { useThemedStyles } from '../../theme/ThemeContext';
import { RoutinePicker, routineDetail, routineTitle } from './RoutinePicker';
import { PromptDisclosureBody, PromptDisclosureToggle } from './PromptDisclosure';
import { TYPOGRAPHY } from '../../theme/typography';

// The one compact flow all three prompt tools render (#1385):
// Choose -> summary + Copy/Share -> (optional) import section -> reference
// prompt. A tool only supplies `config` (pickers, intro), the built `prompt`,
// its `summary` line and an optional `importSlot`; layout, gating and the
// Copy/Share implementation are shared. `onCaptured` runs after a successful
// Copy/Share (normalization snapshot capture) and `blockedNotice` refuses a
// new capture while a pending Retry must stay reachable. `blockedMessage`
// explains a selection that has nothing safe to share (no prompt is built).
export function PromptFlow({
  config, status, notes, currentId, picks, onPick, prompt, summary, notice, setNotice,
  copy, share, onCaptured, blockedNotice = null, blockedMessage = null, importSlot = null,
}) {
  const styles = useThemedStyles(createStyles);
  const [expanded, setExpanded] = useState(false);
  const blocked = () => {
    if (!blockedNotice) return false;
    setNotice(blockedNotice);
    return true;
  };
  const capture = async () => { if (onCaptured) await onCaptured(); };
  const handleCopy = async () => {
    if (blocked()) return;
    try {
      await copy(prompt);
    } catch {
      setNotice('Couldn’t copy the prompt. Nothing else changed.');
      return;
    }
    try {
      await capture();
      setNotice('Prompt copied. Paste it into the LLM you choose.');
    } catch {
      setNotice('Prompt copied, but it could not be saved for later import. Keep the prompt open and try copying again.');
    }
  };
  const handleShare = async () => {
    if (blocked()) return;
    try {
      await (share || Share.share.bind(Share))({ message: prompt });
    } catch {
      setNotice('Couldn’t open sharing. Nothing else changed.');
      return;
    }
    try {
      await capture();
    } catch {
      setNotice('Shared prompt could not be saved for later import. Keep this screen open and try sharing again.');
    }
  };

  const needsRoutines = config.pickers.length > 0;
  const selectedNote = id => notes.find(note => note.id === id) || null;
  const renderPicker = (picker) => {
    const multi = picker.mode === 'multi';
    const value = picks[picker.key];
    const note = multi ? null : selectedNote(value);
    // Authority changes never touch targets; "All except authority" reads the
    // authority as currently chosen.
    const quickActions = multi ? [
      { id: 'all', label: 'Select all', onPress: () => onPick(picker.key, notes.map(n => n.id)) },
      { id: 'except', label: 'All except authority', onPress: () => onPick(picker.key, notes.filter(n => n.id !== picks.authority).map(n => n.id)) },
      { id: 'clear', label: 'Clear', onPress: () => onPick(picker.key, []) },
    ] : [];
    return (
      <RoutinePicker
        key={picker.key}
        pickerKey={picker.key}
        label={picker.label}
        mode={picker.mode}
        notes={notes}
        currentId={currentId}
        value={value}
        onChange={next => { onPick(picker.key, next); setNotice(''); }}
        summary={multi ? (value.length ? `${value.length} ${value.length === 1 ? 'routine' : 'routines'} selected` : 'Choose routines') : (note ? routineTitle(note) : 'Choose a routine')}
        summaryDetail={note ? routineDetail(note, currentId) : null}
        sheetTitle={picker.sheetTitle}
        quickActions={quickActions}
      />
    );
  };

  return (
    <>
      {!needsRoutines ? (
        <Card><Text style={styles.muted}>{config.intro}</Text></Card>
      ) : status === 'loading' ? (
        <Card><Text style={styles.muted}>Loading your local routines…</Text></Card>
      ) : status === 'failed' ? (
        <Card><Text style={styles.error}>Couldn’t read routines from this device. Nothing was shared.</Text></Card>
      ) : status === 'empty' ? (
        <Card><Text style={styles.muted}>Create a routine first, then return here to make a routine-specific prompt.</Text></Card>
      ) : config.pickers.map(renderPicker)}
      {!prompt && blockedMessage ? <Card><Text style={styles.error}>{blockedMessage}</Text></Card> : null}
      {prompt ? <>
        <Card><Text style={styles.summary} testID="prompt-summary">{summary}</Text></Card>
        {notice ? <Text style={styles.muted}>{notice}</Text> : null}
        <View style={styles.actions}>
          <Button title="Copy prompt" onPress={handleCopy} accessibilityLabel="Copy prompt" />
          <Button title="Share prompt" onPress={handleShare} accessibilityLabel="Share prompt" />
        </View>
        <PromptDisclosureToggle expanded={expanded} onToggle={() => setExpanded(value => !value)} />
      </> : null}
      {importSlot}
      <PromptDisclosureBody expanded={expanded} text={prompt} />
    </>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  muted: { color: kua ? kua.onSurfaceVariant : colors.textMuted, fontSize: TYPOGRAPHY['body-md'].fontSize, lineHeight: 20 },
  summary: { color: kua ? kua.onSurface : colors.text, fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '600', lineHeight: 20 },
  actions: { gap: 10 },
  error: { color: kua ? kua.errorText : colors.error, fontSize: TYPOGRAPHY['body-md'].fontSize, lineHeight: 20 },
});
