// `Tidy names` (#1309): one local, deterministic review that cleans a block's
// linked week exercise headers and its frozen baseline's display names together.
// Opening and cancelling the review write nothing; only the single Confirm calls
// `onTidy`, which re-reads authoritative data under the recovery lock and rejects
// a stale review with zero writes. Undo and the explicit conflict resolution live
// here too. The parent mounts this keyed by block id, so draft/error state is
// scoped to one block; #1307 moves the action into Manage block with its gates.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { planTidyNames } from '../../lib/data/recoveryTidyNames';
import { createStyles } from './analyticsRecoveryStyles';
import { createTidyStyles } from './recoveryTidyStyles';

const TIDY_TYPE = 'tidy_recovery_names';

function announce(message) {
  try { AccessibilityInfo.announceForAccessibility(message); } catch (_e) { /* best-effort */ }
}

function Preview({ plan, styles, tidy }) {
  if (!plan.ok) return <Text style={styles.reasonErrorText}>{plan.error}</Text>;
  if (plan.empty && plan.skipped.length === 0) {
    return <Text style={tidy.noteText}>Names are already tidy. Nothing to change.</Text>;
  }
  return (
    <View style={tidy.preview} testID="recovery-tidy-preview">
      {plan.empty ? <Text style={tidy.noteText}>Nothing can be tidied safely.</Text> : null}
      {plan.occurrences.length ? <Text style={tidy.sectionLabel}>{`Week headers (${plan.occurrences.length})`}</Text> : null}
      {plan.occurrences.map((o) => (
        <View key={`${o.noteId}:${o.headerLine}`} testID="recovery-tidy-occurrence">
          <Text style={tidy.row}>{`Week ${o.weekNumber}: ${o.from} → ${o.to}`}</Text>
          {o.scheme ? <Text style={tidy.meta}>{`Keeps ${o.scheme}`}</Text> : null}
          {o.comment ? <Text style={tidy.meta}>{`Moves to a note: ${o.comment}`}</Text> : null}
        </View>
      ))}
      {plan.baseline.length ? <Text style={tidy.sectionLabel}>{`Baseline names (${plan.baseline.length})`}</Text> : null}
      {plan.baseline.map((c) => (
        <Text key={c.from_key} style={tidy.row} testID="recovery-tidy-baseline">{`${c.from_name} → ${c.to_name}`}</Text>
      ))}
      {plan.unchanged.length ? (
        <Text style={tidy.noteText}>{`Already clean: ${plan.unchanged.map(u => u.name).join(', ')}`}</Text>
      ) : null}
      {plan.skipped.length ? <Text style={tidy.sectionLabel}>{`Skipped (${plan.skipped.length})`}</Text> : null}
      {plan.skipped.map((s) => (
        <Text key={s.name} style={tidy.meta} testID="recovery-tidy-skipped">{`${s.name}: ${s.reason}`}</Text>
      ))}
      {plan.warmups.length ? (
        <Text style={tidy.noteText}>Warmup entries are never changed.</Text>
      ) : null}
      <Text style={tidy.noteText}>Numbers never change. You can undo this afterwards.</Text>
    </View>
  );
}

export function TidyRecoveryNamesAction({
  block, weeks, notes, locked = false, pending = [], onTidy, onUndo, onLoadUndo, onResolve,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const tidy = useMemo(() => createTidyStyles(colors, kua), [colors, kua]);
  const plan = useMemo(() => planTidyNames({ block, weeks, notes }), [block, weeks, notes]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [undo, setUndo] = useState({ available: false });
  const undoShown = useRef(false);
  const stuck = pending.find(p => p.type === TIDY_TYPE && p.block_id === block.id) || null;

  useEffect(() => {
    if (!onLoadUndo) return undefined;
    let live = true;
    // Only a change in availability re-renders; the common "still none" reload is silent.
    const settle = (r) => {
      const available = !!(r && r.available);
      if (!live || available === undoShown.current) return;
      undoShown.current = available;
      setUndo(available ? r : { available: false });
    };
    Promise.resolve(onLoadUndo({ blockId: block.id, block, notes })).then(settle, () => settle(null));
    return () => { live = false; };
  }, [onLoadUndo, block, notes]);

  if (!block || !block.baseline || block.baseline.version !== 2) return null;

  const run = async (kind, action, success) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (!result || result.ok === false) {
        const message = (result && result.error) || 'That could not be completed.';
        setError(message);
        announce(message);
        return;
      }
      setOpen(false);
      setNotice(success);
      announce(success);
    } finally {
      setBusy(null);
    }
  };
  const disabled = locked || busy !== null;
  const button = (label, onPress, { off = disabled, busyLabel, kindName, cancel = false } = {}) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={off}
      style={styles.reasonEditorButton}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: busy === kindName }}
    >
      <Text style={cancel ? styles.reasonEditorCancelText : styles.reasonEditorSaveText}>
        {busy === kindName && busyLabel ? busyLabel : label}
      </Text>
    </Pressable>
  );

  return (
    <View testID="recovery-tidy-names" style={styles.reasonEditor}>
      {stuck ? (
        <View style={styles.reasonEditor} testID="recovery-tidy-pending">
          <Text style={tidy.sectionLabel}>{stuck.conflict ? 'Tidy names needs your decision' : 'Tidy names is still finishing'}</Text>
          <Text style={tidy.noteText}>
            {stuck.conflict
              ? 'A note or name changed while tidying was being applied, so it stopped without overwriting anything.'
              : 'Your names are being updated together. Tap Retry recovery to finish.'}
          </Text>
          {stuck.conflict ? (
            <View style={styles.reasonEditorActions}>
              {button('Keep current names', () => run('keep', () => onResolve({ operationId: stuck.operationId, choice: 'keep' }), 'Kept the current names.'), { off: busy !== null, kindName: 'keep', busyLabel: 'Keeping…', cancel: true })}
              {button('Restore previous names', () => run('restore', () => onResolve({ operationId: stuck.operationId, choice: 'restore' }), 'Restored the previous names.'), { off: busy !== null, kindName: 'restore', busyLabel: 'Restoring…' })}
            </View>
          ) : null}
        </View>
      ) : null}
      <Pressable
        onPress={() => { setOpen(o => !o); setError(null); setNotice(null); }}
        disabled={busy !== null || !!stuck}
        style={styles.reasonPressable}
        accessibilityRole="button"
        accessibilityLabel="Tidy names"
        accessibilityHint="Review a cleanup of exercise names in your baseline and weeks"
        accessibilityState={{ expanded: open, disabled: busy !== null || !!stuck }}
      >
        <Text style={styles.reasonEditorSaveText}>Tidy names</Text>
      </Pressable>
      {open ? (
        <View style={styles.reasonEditor}>
          <Preview plan={plan} styles={styles} tidy={tidy} />
          <View style={styles.reasonEditorActions}>
            {button(plan.ok && plan.empty ? 'Close' : 'Cancel', () => { setOpen(false); setError(null); }, { off: busy !== null, kindName: 'cancel', cancel: true })}
            {plan.ok && !plan.empty
              ? button('Confirm tidy names', () => run('tidy', () => onTidy({ blockId: block.id, evidence: plan.evidence, signature: plan.signature }), 'Names tidied. You can undo this.'), { kindName: 'tidy', busyLabel: 'Tidying…' })
              : null}
          </View>
        </View>
      ) : null}
      {undo.available && !stuck ? button('Undo tidy names', () => run('undo', () => onUndo({ blockId: block.id }), 'Tidy names undone.'), { kindName: 'undo', busyLabel: 'Undoing…' }) : null}
      {error || notice ? (
        <View accessibilityLiveRegion="polite">
          {error ? <Text style={styles.reasonErrorText}>{error}</Text> : null}
          {notice ? <Text style={tidy.noteText}>{notice}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
