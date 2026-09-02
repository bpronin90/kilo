import React, { useState, useLayoutEffect, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ScreenShell } from '../components/ScreenShell';
import { SectionTitle } from '../components/UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

import { HelpScreen } from '../components/HelpScreen';
import { AboutScreen } from '../components/AboutScreen';
import { BackupScreen } from '../components/BackupScreen';
import { SettingsScreen } from '../components/SettingsScreen';
import { ProfileScreen } from '../components/ProfileScreen';
import { AccountScreen } from './more/AccountScreen';

export { AccountScreen } from './more/AccountScreen';
export { AccountLifecycle } from './more/AccountLifecycle';

// The sub-view vocabulary a typed `{ kind: 'subview', view }` intent may target
// (#718). This screen owns these names, so it — not the app shell — is the one
// place that validates them: App.js's normalizer checks only that `view` is a
// non-empty string, which keeps the shell out of every destination's internal
// view model. 'menu' is deliberately absent: "navigate to the More menu" is
// just an ordinary More tab press, and accepting it as a target would let a
// stray intent yank the user out of a sub-view they are already using.
const NAV_SUBVIEWS = new Set(['help', 'about', 'backup', 'settings', 'profile', 'account']);

export function MoreScreen({
  isActive = true,
  auth,
  registerBackConsumer,
  onOwnsBackChange,
  onExport,
  onImport,
  fatigueMultiplier,
  onUpdateFatigueMultiplier,
  navSubviewView = null,
  navSubviewAnchor = null,
  navSubviewKey = 0,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [activeView, setActiveView] = useState('menu');

  // Password recovery (#497): when the shell reports an active recovery
  // session or a failed recovery link, open the Account sub-view so the
  // set-new-password surface (rendered by AccountScreen for these states) is
  // shown. App.js makes the matching switch to the More tab, so together the
  // recovery deep link lands the user directly on the reset surface instead
  // of a dead end. This screen stays mounted across tabs, so the switch is
  // safe even when More is not the visible tab yet. Keyed on the recovery
  // signals so it fires once when recovery begins and does not otherwise
  // override the user's own menu navigation.
  useEffect(() => {
    if (auth?.passwordRecovery || auth?.recoveryError) {
      setActiveView('account');
    }
  }, [auth?.passwordRecovery, auth?.recoveryError]);

  // The anchor of the intent currently being served, republished to the
  // sub-view that owns it (#903). Held as state, not a ref, because the
  // sub-screen has to re-render to see it, and carried together with the view
  // it addressed so an anchor minted for one sub-view can never be applied by
  // another. Cleared by every manual navigation below: a consumed intent must
  // not replay when the user walks back into the same sub-view themselves.
  const [subviewIntent, setSubviewIntent] = useState({ view: null, anchor: null, key: 0 });

  // Typed sub-view navigation intent (#718). Keyed so a repeated request for a
  // sub-view the user has since left still re-applies, and consumed exactly
  // once per key so an unrelated re-render never re-opens it. 0 is the shell's
  // initial key, i.e. "no intent has ever been issued".
  const appliedSubviewKeyRef = useRef(0);
  useEffect(() => {
    if (navSubviewKey === appliedSubviewKeyRef.current) return;
    appliedSubviewKeyRef.current = navSubviewKey;
    // An absent target preserves whatever this screen is already showing, and
    // an unknown view name is ignored the same way rather than dumping the user
    // on the menu.
    if (!navSubviewView || !NAV_SUBVIEWS.has(navSubviewView)) return;
    setActiveView(navSubviewView);
    // Published for anchorless intents too: a `null` anchor under a fresh key
    // is what tells the sub-view this arrival is an ordinary one and must not
    // move the viewport.
    setSubviewIntent({ view: navSubviewView, anchor: navSubviewAnchor || null, key: navSubviewKey });
  }, [navSubviewKey, navSubviewView, navSubviewAnchor]);

  // Every navigation the user makes by hand goes through here, so it also
  // retires whatever intent was last served. Without that, a sub-screen the
  // user re-enters from the menu would remount still holding the shell's old
  // intent key and replay its anchored arrival.
  function showView(view) {
    setSubviewIntent({ view: null, anchor: null, key: 0 });
    setActiveView(view);
  }

  const inSubView = activeView !== 'menu';

  // When this tab is active and showing a sub-view, register a back consumer so
  // the app shell's global back handler returns to the menu (instead of Home) and
  // flag that this screen owns its own back so the web "← Home" bar is suppressed
  // (the sub-screen renders its own "← Back"). Gating on isActive prevents
  // consuming back events meant for another tab while a stale More sub-view stays
  // mounted in the background. Props are optional so the screen renders safely
  // when used standalone (e.g. in tests) without the app shell.
  useLayoutEffect(() => {
    if (!isActive || !inSubView) return undefined;

    onOwnsBackChange?.(true);
    const unregister = registerBackConsumer?.(() => {
      showView('menu');
      return true;
    });

    return () => {
      unregister?.();
      onOwnsBackChange?.(false);
    };
  }, [isActive, inSubView, registerBackConsumer, onOwnsBackChange]);

  if (activeView === 'help') {
    return <HelpScreen onBack={() => showView('menu')} />;
  }

  if (activeView === 'about') {
    return <AboutScreen onBack={() => showView('menu')} />;
  }

  if (activeView === 'backup') {
    return (
      <BackupScreen
        onBack={() => showView('menu')}
        onExport={onExport}
        onImport={onImport}
        auth={auth}
        onGoToAccount={() => showView('account')}
        navAnchor={subviewIntent.view === 'backup' ? subviewIntent.anchor : null}
        navAnchorKey={subviewIntent.view === 'backup' ? subviewIntent.key : 0}
      />
    );
  }

  if (activeView === 'settings') {
    return (
      <SettingsScreen
        onBack={() => showView('menu')}
        multiplier={fatigueMultiplier}
        onUpdate={onUpdateFatigueMultiplier}
      />
    );
  }

  if (activeView === 'profile') {
    return <ProfileScreen onBack={() => showView('menu')} />;
  }

  if (activeView === 'account') {
    return <AccountScreen auth={auth} onBack={() => showView('menu')} />;
  }

  return (
    <ScreenShell title="More" subtitle="Settings, help, and your data.">
      <SectionTitle>Preferences</SectionTitle>
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => showView('profile')} accessibilityRole="button" accessibilityLabel="User Profile">
          <Text style={styles.menuItemText}>User Profile</Text>
          <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => showView('settings')} accessibilityRole="button" accessibilityLabel="Settings">
          <Text style={styles.menuItemText}>Settings</Text>
          <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
        </Pressable>
      </View>

      <SectionTitle>Account & Data</SectionTitle>
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => showView('account')} accessibilityRole="button" accessibilityLabel="Account">
          <View style={styles.menuCopy}>
            <Text style={styles.menuItemText}>Account</Text>
            <Text style={styles.menuItemHelp}>Sign-in & cloud account</Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => showView('backup')} accessibilityRole="button" accessibilityLabel="Data and Backup">
          <View style={styles.menuCopy}>
            <Text style={styles.menuItemText}>Data & Backup</Text>
            <Text style={styles.menuItemHelp}>Local & cloud backup</Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
        </Pressable>
      </View>

      <SectionTitle>Help & Support</SectionTitle>
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => showView('help')} accessibilityRole="button" accessibilityLabel="App Guide">
          <Text style={styles.menuItemText}>App Guide</Text>
          <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => showView('about')} accessibilityRole="button" accessibilityLabel="About Kilo">
          <Text style={styles.menuItemText}>About Kilo</Text>
          <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} accessible={false} />
        </Pressable>
      </View>
    </ScreenShell>
  );
}

const createStyles = (colors) => StyleSheet.create({
  list: {
    gap: 12,
  },
  menuItem: {
    flexDirection: 'row',
    minHeight: 44,
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  menuCopy: {
    flex: 1,
    gap: 4,
  },
  menuItemText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  menuItemHelp: {
    fontSize: 13,
    color: colors.textMuted,
  },
});
