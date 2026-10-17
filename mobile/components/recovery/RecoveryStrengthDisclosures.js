// The ONE collapsed-by-default disclosure used by every per-exercise Recovery
// list (#1315): lifts, movement groups, not retested, not scored for strength.
// A >=44dp header row with a counted title, an optional caption and a
// MaterialIcons chevron; the body mounts only while open. The caller keys the
// group by block + week so every disclosure resets to collapsed on a change.

import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { LIFT_STATE, NOT_RETESTED, UNSCOREABLE_REASON } from '../../lib/data/recoveryStrength';
import { createStrengthStyles } from './recoveryStrengthStyles';

export function RecoveryDisclosure({ testID, title, caption = null, name, first = false, children, a11yDetail = null }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const [open, setOpen] = useState(false);
  return (
    <View testID={testID} style={[styles.disc, first && styles.discFirst]}>
      <Pressable
        testID={`${testID}-header`}
        onPress={() => setOpen(o => !o)}
        style={styles.discHeader}
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${name}${a11yDetail ? `. ${a11yDetail}` : ''}`}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.discText}>
          <Text style={styles.discTitle}>{title}</Text>
          {caption ? <Text style={styles.infoLine}>{caption}</Text> : null}
        </View>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={18} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
      </Pressable>
      {open ? <View style={styles.discBody}>{children}</View> : null}
    </View>
  );
}

// Group entries sharing one reason into a single line ("Reason: A, B, C") so a
// long inventory states each reason once instead of once per lift (#1442).
function groupByReason(entries, reasonOf) {
  const groups = new Map();
  for (const e of entries) {
    const reason = reasonOf(e);
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason).push(e.name);
  }
  return [...groups].map(([reason, names]) => ({ reason, names }));
}

const NOT_RETESTED_COPY = Object.freeze({
  [NOT_RETESTED.ABSENT_THIS_WEEK]: 'not logged this week',
  [NOT_RETESTED.NEVER_LOGGED]: 'not logged in any week yet',
  [NOT_RETESTED.UNKNOWN]: 'not in any readable week',
});

// Baseline exercises with no completed entry in the selected week.
export function NotRetestedDisclosure({ strength, first = false }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const list = strength.not_retested || [];
  if (list.length === 0) return null;
  return (
    <RecoveryDisclosure testID="recovery-strength-not-retested" title={`${list.length} not retested`} name={`${list.length} not retested lifts`} first={first}>
      {groupByReason(list, n => NOT_RETESTED_COPY[n.kind]).map(g => (
        <Text key={g.reason} style={styles.infoLine}>{`${g.names.join(', ')}: ${g.reason}`}</Text>
      ))}
    </RecoveryDisclosure>
  );
}

// Every identity with no strength score: baseline rows that can never be scored
// plus lifts that are unscoreable in the selected week, de-duplicated by key.
export function notScoredEntries(strength) {
  const seen = new Set();
  const out = [];
  const add = (key, name, reasonKey) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, name, reason: UNSCOREABLE_REASON[reasonKey] || UNSCOREABLE_REASON.no_scoreable_set });
  };
  for (const l of strength.lifts || []) if (l.state === LIFT_STATE.UNSCOREABLE) add(l.key, l.name, l.reason);
  for (const n of strength.not_scored || []) add(n.key, n.name, n.reason);
  return out;
}

export function NotScoredDisclosure({ strength, first = false }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const list = notScoredEntries(strength);
  if (list.length === 0) return null;
  return (
    <RecoveryDisclosure testID="recovery-strength-not-scored" title={`${list.length} not scored for strength`} name={`${list.length} lifts not scored for strength`} first={first}>
      {groupByReason(list, n => n.reason).map(g => (
        <Text key={g.reason} style={styles.infoLine}>{`${g.names.join(', ')}: ${g.reason}`}</Text>
      ))}
    </RecoveryDisclosure>
  );
}
