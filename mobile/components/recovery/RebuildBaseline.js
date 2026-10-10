// On-demand baseline rebuild (#1227, #1305): the `Rebuild baseline` action on an
// Analytics Recovery evidence card for a snapshot without strength data (v1, or v2
// without best-set pairs), its read-only preview, and the explicit confirm.
// The preview comes from `planBaselineRebuild` (the exact v2 capture); nothing is
// written until Confirm, and the write re-validates authoritatively in the hook.

import React, { useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { RECOVERY_BASELINE_BASIS, isLiveRecord, planBaselineRebuild } from '../../lib/data/recoveryBlocks';
import { baselineLacksStrengthData } from '../../lib/data/recoveryStrengthBaseline';
import { displayWeight, formatLiftWeightValue } from '../../lib/units';
import { createStyles } from './analyticsRecoveryStyles';

const BASIS_LABELS = {
  [RECOVERY_BASELINE_BASIS.COMPLETE]: 'latest complete session',
  [RECOVERY_BASELINE_BASIS.NO_DECLARATION]: 'latest session (no set target declared)',
  [RECOVERY_BASELINE_BASIS.AMRAP]: 'latest AMRAP session',
  [RECOVERY_BASELINE_BASIS.NEVER_COMPLETE]: 'latest session (target never completed)',
};
const WARNING = 'This routine was edited after Recovery began, so the rebuilt values may include recovery-period work.';

const _n = (v) => Number(v).toLocaleString();
function _metrics(row, unit) {
  if (!row) return 'not in the old baseline';
  if (row.exercise_class === 'weighted') {
    const best = row.best_e1rm_weight > 0 ? `, best set ${formatLiftWeightValue(row.best_e1rm_weight, unit)} × ${row.best_e1rm_reps}` : '';
    return `${formatLiftWeightValue(row.top_weight, unit)} ${unit} top, ${_n(Math.round(displayWeight(row.volume, unit)))} ${unit} volume${best}`;
  }
  if (row.exercise_class === 'reps_only') return `${_n(row.best_set_reps)} best, ${_n(row.total_reps)} reps`;
  return `${_n(row.best_hold_seconds)}s best, ${_n(row.total_seconds)}s total`;
}

export function RebuildBaselineAction({ block, weeks = null, notes, unit = 'lb', locked = false, onRebuild }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const note = useMemo(() => (notes || []).find(n => n.id === block.baseline_note_id), [notes, block.baseline_note_id]);
  const plan = useMemo(() => planBaselineRebuild(block, note, { weeks, notes }), [block, note, weeks, notes]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [doneMessage, setDoneMessage] = useState(null);

  const rows = useMemo(() => {
    if (!plan.eligible) return [];
    const old = new Map(plan.previous.map(r => [r.key, r]));
    // #1305: a frozen name never logged in any recovery week takes the routine's
    // current (clean) name; the preview names both.
    const renamedTo = new Map((plan.renamed || []).map(x => [x.to_key, x]));
    const next = plan.baseline.exercises.map(r => {
      const rn = renamedTo.get(r.key);
      const name = rn ? `${rn.from_name} → ${r.name}` : r.name;
      const prev = rn ? old.get(rn.from_key) : old.get(r.key);
      return { key: r.key, text: `${r.routine_order + 1}. ${name}: ${_metrics(prev, unit)} → ${_metrics(r, unit)} (${BASIS_LABELS[r.basis] || r.basis})` };
    });
    const kept = new Set([...plan.baseline.exercises.map(r => r.key), ...(plan.renamed || []).map(x => x.from_key)]);
    const dropped = plan.previous.filter(r => !kept.has(r.key))
      .map(r => ({ key: `old-${r.key}`, text: `${r.name}: ${_metrics(r, unit)} → removed (not in the routine)` }));
    return [...next, ...dropped];
  }, [plan, unit]);

  const announce = (message) => { try { AccessibilityInfo.announceForAccessibility(message); } catch (_e) { /* best-effort */ } };
  const close = () => { setOpen(false); setError(null); };
  const confirm = async () => {
    if (busy || locked) return;
    setError(null);
    setBusy(true);
    try {
      const result = await onRebuild({ blockId: block.id, expectedBaseline: plan.baseline });
      if (!result || result.ok === false) {
        const message = (result && result.error) || 'Could not rebuild this baseline.';
        setError(message);
        announce(message);
        return;
      }
      const message = 'Baseline rebuilt from the routine.';
      setDoneMessage(message);
      setOpen(false);
      announce(message);
    } finally {
      setBusy(false);
    }
  };

  // A baseline that still lacks strength data but cannot be rebuilt says why
  // (#1305), so "Rebuild the baseline below" never points at nothing.
  if (!plan.eligible && !doneMessage) {
    if (!baselineLacksStrengthData(block.baseline) || !isLiveRecord(block)) return null;
    return (
      <View testID="recovery-rebuild-refused" style={styles.reasonEditor} accessible accessibilityLabel={`Baseline can’t be rebuilt: ${plan.message}`}>
        <Text style={styles.reasonCaption}>{plan.message}</Text>
      </View>
    );
  }
  const disabled = locked || busy;
  return (
    <View testID="recovery-rebuild-baseline" style={styles.reasonEditor}>
      <View accessibilityLiveRegion="polite">
        {doneMessage ? <Text style={styles.reasonCaption}>{doneMessage}</Text> : null}
      </View>
      {plan.eligible && !open && (
        <Pressable
          onPress={() => setOpen(true)}
          disabled={locked}
          style={styles.reasonPressable}
          accessibilityRole="button"
          accessibilityLabel="Rebuild baseline"
          accessibilityHint="Previews new baseline values before changing anything"
          accessibilityState={{ disabled: locked }}
        >
          <Text style={styles.reasonEditorSaveText}>Rebuild baseline</Text>
        </Pressable>
      )}
      {plan.eligible && open && (
        <View testID="recovery-rebuild-preview" style={styles.reasonEditor}>
          <Text style={styles.reasonCaption}>
            This replaces the frozen baseline with values read from your routine as it is now (latest complete session, routine order), adding the best set strength scores use. Matched exercise names are kept. Old → new:
          </Text>
          {rows.map(r => <Text key={r.key} style={styles.reasonCaption}>{r.text}</Text>)}
          {plan.editedAfterStart ? (
            <Text testID="recovery-rebuild-warning" accessibilityRole="alert" style={styles.reasonErrorText}>{WARNING}</Text>
          ) : null}
          <View accessibilityLiveRegion="polite">
            {error ? <Text style={styles.reasonErrorText}>{error}</Text> : null}
          </View>
          <View style={styles.reasonEditorActions}>
            <Pressable
              onPress={close}
              disabled={busy}
              style={styles.reasonEditorButton}
              accessibilityRole="button"
              accessibilityLabel="Cancel rebuilding the baseline"
              accessibilityState={{ disabled: busy }}
            >
              <Text style={styles.reasonEditorCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={confirm}
              disabled={disabled}
              style={styles.reasonEditorButton}
              accessibilityRole="button"
              accessibilityLabel="Confirm rebuilding the baseline"
              accessibilityState={{ disabled, busy }}
            >
              <Text style={styles.reasonEditorSaveText}>{busy ? 'Rebuilding…' : 'Confirm rebuild'}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
