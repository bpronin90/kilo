// `Match exercise names` (#1298): a compact review of one-to-one renames that link
// frozen baseline rows to the names the weeks actually log. Opening, dismissing,
// and closing never write; only a per-pair Confirm calls `onMatch`, which
// re-validates authoritatively. The parent keys the card by block id, so
// switching blocks resets this state.

import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { planBaselineNameMatches } from '../../lib/data/recoveryBaselineNames';
import { createStyles } from './analyticsRecoveryStyles';

export function MatchExerciseNamesAction({ block, weeks, notes, locked = false, onMatch }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const candidates = useMemo(() => planBaselineNameMatches({ block, weeks, notes }), [block, weeks, notes]);
  const signature = candidates.map(c => `${c.from_key}>${c.to_key}`).join('|');
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());

  // Evidence changed underneath the review: drop any stale error.
  useEffect(() => { setError(null); }, [signature]);

  const announce = (m) => { try { AccessibilityInfo.announceForAccessibility(m); } catch (_e) { /* best-effort */ } };
  const visible = candidates.filter(c => !dismissed.has(`${c.from_key}>${c.to_key}`));
  const confirm = async (c) => {
    if (busyKey || locked) return;
    setError(null);
    setBusyKey(`${c.from_key}>${c.to_key}`);
    try {
      const result = await onMatch({ blockId: block.id, fromKey: c.from_key, toKey: c.to_key, toName: c.to_name });
      if (!result || result.ok === false) {
        const message = (result && result.error) || 'Could not match these names.';
        setError(message);
        announce(message);
        return;
      }
      announce(`Matched ${c.from_name} to ${c.to_name}.`);
    } finally {
      setBusyKey(null);
    }
  };

  if (visible.length === 0) return null;
  return (
    <View testID="recovery-match-names" style={styles.reasonEditor}>
      <Pressable
        onPress={() => { setOpen(o => !o); setError(null); }}
        disabled={busyKey !== null}
        style={styles.reasonPressable}
        accessibilityRole="button"
        accessibilityLabel="Match exercise names"
        accessibilityHint="Review renames that link your baseline to the names you log"
        accessibilityState={{ expanded: open, disabled: busyKey !== null }}
      >
        <Text style={styles.reasonEditorSaveText}>{`Match exercise names (${visible.length})`}</Text>
      </Pressable>
      {open && visible.map(c => {
        const key = `${c.from_key}>${c.to_key}`;
        const busy = busyKey === key;
        const disabled = locked || busyKey !== null;
        return (
          <View key={key} testID="recovery-match-pair" style={styles.reasonEditor}>
            <Text style={styles.reasonCaption}>{`${c.from_name} → ${c.to_name}`}</Text>
            <View style={styles.reasonEditorActions}>
              <Pressable
                onPress={() => setDismissed(d => new Set(d).add(key))}
                disabled={busyKey !== null}
                style={styles.reasonEditorButton}
                accessibilityRole="button"
                accessibilityLabel={`Cancel matching ${c.from_name}`}
                accessibilityState={{ disabled: busyKey !== null }}
              >
                <Text style={styles.reasonEditorCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => confirm(c)}
                disabled={disabled}
                style={styles.reasonEditorButton}
                accessibilityRole="button"
                accessibilityLabel={`Match ${c.from_name} to ${c.to_name}`}
                accessibilityState={{ disabled, busy }}
              >
                <Text style={styles.reasonEditorSaveText}>{busy ? 'Matching…' : 'Match'}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      {open ? (
        <View accessibilityLiveRegion="polite">
          {error ? <Text style={styles.reasonErrorText}>{error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
