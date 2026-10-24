import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import * as entryHooks from '../../hooks/useEntries';
import { useWeightUnit } from '../../lib/unitPreference';
import { MonoLabel } from '../../components/ui/RedesignPrimitives';
import { Icon } from '../../components/Icon';
import pkg from '../../package.json';

// Redesign v3 More menu (#1608; docs/design/app-redesign-v3 "More"): an account
// summary row, then three flat grouped panels of icon rows. Every destination
// the menu had before keeps its view name and its accessible name, so the
// shell's back handling, typed sub-view intents and existing callers that find
// rows by label are unaffected.
//
// Rows are local Pressables rather than the shared HairlineRow: the #920 menu
// contract (interaction-target-a11y) reads each row's static style for the 44dp
// floor and the neutral 1px cardBorder. Each row therefore carries its own 1px
// border, and adjacent rows overlap by that 1px so the panel reads as one card
// split by single hairlines.

// The shell-published sync summary (#737); null outside the shell. Resolved
// once at module load: a module double that omits the hook reads as "no
// summary", the same honest standalone state, rather than a crash.
const useCloudSyncSummary = entryHooks.useCloudSyncSummary || (() => null);

const COURT_NAMES = { 'hard-court': 'Hard', 'clay-court': 'Clay', 'grass-court': 'Grass' };
const MODE_NAMES = { light: 'Light', dark: 'Dark', system: 'System' };

// What the account row says. Only states the existing auth/sync hooks already
// report are shown; nothing is inferred (no "synced" without a recorded
// successful pass, no sync line at all without the shell's summary).
export function accountSummary(auth, cloudSync) {
  if (!auth || !auth.configured) {
    return { title: 'Cloud account', status: 'Not available in this build · data stays on this device', tone: 'muted', icon: 'cloud-off' };
  }
  if (auth.signedIn) {
    const summary = cloudSync?.summary || null;
    const email = auth.user?.email || 'Signed in';
    if (!summary) return { title: email, status: 'Signed in', tone: 'muted', icon: 'cloud-queue', initial: email };
    let tone = 'muted';
    let icon = 'cloud-queue';
    if (summary.isRunning) icon = 'sync';
    else if (summary.hasFailed) { tone = 'error'; icon = 'sync-problem'; }
    else if (summary.hasDirty) { tone = 'warning'; icon = 'cloud-upload'; }
    else if (summary.hasLastSuccess) { tone = 'done'; icon = 'cloud-done'; }
    return { title: email, status: `Signed in · ${summary.statusLabel}`, tone, icon, initial: email };
  }
  if (auth.loading) return { title: 'Account', status: 'Checking sign-in…', tone: 'muted', icon: 'cloud-queue' };
  return { title: 'Not signed in', status: 'Optional · sign in to sync to the cloud', tone: 'muted', icon: 'cloud-off' };
}

function MenuRow({ icon, title, subtitle, onPress, a11yLabel, first, last, leading = null, statusIcon = null, statusStyle = null, testID }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { colors, kuaPalette: kua } = useTheme();
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const rowStyle = [styles.row, first ? styles.rowFirst : styles.rowFollowing, last ? styles.rowLast : null];
  return (
    <Pressable testID={testID} style={rowStyle} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11yLabel}>
      {({ pressed }) => (
        <View style={[styles.rowBody, pressed ? styles.pressed : null]}>
          {leading || <Icon name={icon} size={22} color={kua ? kua.primary : colors.accent} />}
          <View style={styles.rowText}>
            <Text style={[styles.title, { fontFamily: typography['headline-sm'].fontFamily }]} numberOfLines={1}>{title}</Text>
            <View style={styles.subtitleLine}>
              {statusIcon ? <Icon name={statusIcon} size={16} color={StyleSheet.flatten(statusStyle)?.color || muted} /> : null}
              <Text style={[typography['body-sm'], styles.subtitle, statusStyle]} numberOfLines={1}>{subtitle}</Text>
            </View>
          </View>
          <Icon name="chevron-right" size={22} color={muted} />
        </View>
      )}
    </Pressable>
  );
}

function MenuGroup({ label, rows }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.group}>
      <MonoLabel style={styles.groupLabel} accessibilityRole="header">{label}</MonoLabel>
      <View>
        {rows.map((row, i) => (
          <MenuRow key={row.title} {...row} first={i === 0} last={i === rows.length - 1} />
        ))}
      </View>
    </View>
  );
}

export function MoreMenuPanels({ auth, onOpen }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { themeSelection, preference } = useTheme();
  const weightUnit = useWeightUnit();
  const account = accountSummary(auth, useCloudSyncSummary());
  const initial = account.initial ? account.initial.trim().charAt(0).toUpperCase() : null;
  const avatar = (
    <View style={styles.avatar}>
      {initial
        ? <Text style={[styles.avatarText, { fontFamily: typography['headline-sm'].fontFamily }]}>{initial}</Text>
        : <Icon name="person" size={26} color={StyleSheet.flatten(styles.avatarText).color} />}
    </View>
  );
  const settingsSummary = `${COURT_NAMES[themeSelection] || 'Hard'} · ${MODE_NAMES[preference] || 'System'} · ${weightUnit} · reminders`;

  return (
    <>
      <MenuRow
        testID="more-account-summary"
        leading={avatar}
        title={account.title}
        subtitle={account.status}
        statusIcon={account.icon}
        statusStyle={styles[`tone_${account.tone}`]}
        onPress={() => onOpen('account')}
        a11yLabel={`${account.title}. ${account.status}. Open account`}
        first
        last
      />
      <MenuGroup
        label="Preferences"
        rows={[
          { icon: 'tune', title: 'Settings', subtitle: settingsSummary, onPress: () => onOpen('settings'), a11yLabel: 'Settings' },
          { icon: 'person', title: 'User profile', subtitle: 'Sex, date of birth, height', onPress: () => onOpen('profile'), a11yLabel: 'User Profile' },
        ]}
      />
      {/* Routine import (#955) stays beside Data and backup rather than on the
          Log tab: it is a data-entry surface that creates a new routine, not
          part of the routine you are currently running. */}
      <MenuGroup
        label="Account & data"
        rows={[
          { icon: 'account-circle', title: 'Account', subtitle: 'Cloud account and sign-in', onPress: () => onOpen('account'), a11yLabel: 'Account' },
          { icon: 'backup', title: 'Data and backup', subtitle: 'Cloud · export · import', onPress: () => onOpen('backup'), a11yLabel: 'Data and Backup' },
          { icon: 'content-paste', title: 'Import routine', subtitle: 'Paste a shared routine', onPress: () => onOpen('import-routine'), a11yLabel: 'Import Routine' },
        ]}
      />
      <MenuGroup
        label="Tools & help"
        rows={[
          { icon: 'auto-awesome', title: 'Routine prompt tools', subtitle: 'Copy local templates for an external LLM', onPress: () => onOpen('routine-prompts'), a11yLabel: 'Routine prompt tools' },
          // Visible "App Guide" kept: existing Log-tab tests open it by that text.
          { icon: 'help-outline', title: 'App Guide', subtitle: 'Syntax and walkthrough', onPress: () => onOpen('help'), a11yLabel: 'App Guide' },
          { icon: 'info-outline', title: 'About Kilo', subtitle: `Version ${pkg.version}`, onPress: () => onOpen('about'), a11yLabel: 'About Kilo' },
        ]}
      />
    </>
  );
}

export const createStyles = (colors, kua = null) => StyleSheet.create({
  group: {
    gap: 12,
  },
  groupLabel: {
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  row: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.surfaceCard : colors.card,
    overflow: 'hidden',
  },
  rowFirst: {
    borderTopLeftRadius: GEOMETRY['radius-2xl'],
    borderTopRightRadius: GEOMETRY['radius-2xl'],
  },
  // Overlaps the previous row's bottom border, so two rows share one hairline.
  rowFollowing: {
    marginTop: -1,
  },
  rowLast: {
    borderBottomLeftRadius: GEOMETRY['radius-2xl'],
    borderBottomRightRadius: GEOMETRY['radius-2xl'],
  },
  rowBody: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 12,
  },
  // Press feedback lives in the fill, never a whole-control opacity fade.
  pressed: {
    backgroundColor: kua ? kua.surfaceCardHeader : colors.chipBackground,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    color: kua ? kua.onSurface : colors.text,
  },
  subtitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  subtitle: {
    flexShrink: 1,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: kua ? kua.primary : colors.accent,
  },
  avatarText: {
    fontSize: 20,
    lineHeight: 24,
    color: kua ? kua.onPrimary : colors.onAccent,
  },
  tone_muted: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  tone_done: {
    color: kua ? kua.completion : colors.success,
  },
  tone_warning: {
    color: kua ? kua.warning : colors.warning,
  },
  tone_error: {
    color: kua ? kua.errorText : colors.error,
  },
});
