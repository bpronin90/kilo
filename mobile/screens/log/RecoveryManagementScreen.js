// Inactive Recovery navigation (#1423). With no active or pending Recovery the
// Log screen has no Recovery tab: it offers one compact `Recovery ›` entry under
// the current routine, which opens this management screen inside the Log flow
// (Back returns to Routine). Completed history alone never earns a tab. Nothing
// here writes — Start, Reopen and maintenance stay the existing lifecycle
// handlers, reached through the same LogRecoverySection the active view uses.

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { GEOMETRY } from '../../theme/spacing';
import { TYPOGRAPHY } from '../../theme/typography';
import { getRecoverySnapshot, compactRecoverySummary } from '../../lib/data/recoverySnapshot';
import { withLiveWeek } from '../../components/recovery/LogRecoveryHistory';

const createStyles = (colors, kua) => {
  const ink = kua ? kua.onSurface : colors.text;
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  const accent = kua ? kua.primary : colors.accentText;
  const row = { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 };
  return StyleSheet.create({
    entry: { ...row, paddingHorizontal: 14, paddingVertical: 8, borderRadius: GEOMETRY['radius-xl'], borderWidth: 1, borderColor: border },
    entryText: { flex: 1, flexShrink: 1 },
    entryTitle: { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: ink },
    entryMeta: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: muted },
    screen: { gap: 12 },
    back: { ...row, justifyContent: 'flex-start', alignSelf: 'flex-start' },
    backText: { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '600', color: accent },
    start: { ...row, paddingHorizontal: 14, borderRadius: GEOMETRY['radius-xl'], borderWidth: 1, borderColor: border },
    startText: { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: accent },
    empty: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: muted },
  });
};

// The newest completed block's canonical summary (never a substitute metric). No
// notes ever read means nothing truthful to score, so the entry stays bare.
function entrySummary({ block, weeks, notes, notesError }) {
  if (!block || (notesError && notes.length === 0)) return null;
  return withLiveWeek(compactRecoverySummary(getRecoverySnapshot({ block, weeks, notes, stale: !!notesError })), weeks, block);
}

export function RecoveryEntryRow({ newestCompleted, weeks, notes, notesError, onOpen }) {
  const { colors, kuaPalette: kua } = useTheme();
  const st = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const summary = useMemo(
    () => entrySummary({ block: newestCompleted, weeks, notes, notesError }),
    [newestCompleted, weeks, notes, notesError]
  );
  return (
    <Pressable
      testID="log-recovery-entry" onPress={onOpen} style={st.entry} accessibilityRole="button"
      accessibilityLabel={`Recovery${summary ? `. Last block ${summary.a11y}` : ''}`}
    >
      <View style={st.entryText}>
        <Text style={st.entryTitle}>Recovery</Text>
        {summary ? <Text testID="log-recovery-entry-summary" style={st.entryMeta}>{summary.text}</Text> : null}
      </View>
      <MaterialIcons name="chevron-right" size={18} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
    </Pressable>
  );
}

// Back / Start / the empty-history line above the Recovery section. The section
// itself stays in RecoverySurface so it is never remounted by navigation.
function RecoveryManagementHeader({ onBack, showStart, onStart, hasCompleted }) {
  const { colors, kuaPalette: kua } = useTheme();
  const st = useMemo(() => createStyles(colors, kua), [colors, kua]);
  return (
    <View testID="log-recovery-management" style={st.screen}>
      <Pressable testID="log-recovery-management-back" onPress={onBack} style={st.back} accessibilityRole="button" accessibilityLabel="Back to routine">
        <MaterialIcons name="chevron-left" size={18} color={kua ? kua.primary : colors.accentText} accessible={false} />
        <Text style={st.backText}>Routine</Text>
      </Pressable>
      {showStart ? (
        <Pressable onPress={onStart} style={st.start} accessibilityRole="button" accessibilityLabel="Start recovery block">
          <Text style={st.startText}>Start recovery block</Text>
          <MaterialIcons name="chevron-right" size={18} color={kua ? kua.primary : colors.accentText} accessible={false} />
        </Pressable>
      ) : null}
      {hasCompleted ? null : <Text style={st.empty}>No completed recovery blocks yet.</Text>}
    </View>
  );
}

// One wrapper for every mode, so the Recovery section keeps its block-scoped
// drafts and errors through Back and re-entry: 'hidden' only sets display:none.
export function RecoverySurface({ mode, children, ...props }) {
  return (
    <View style={mode === 'hidden' ? { display: 'none' } : undefined}>
      {mode === 'manage' ? <RecoveryManagementHeader {...props} /> : null}
      {children}
    </View>
  );
}
