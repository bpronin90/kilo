import React, { useState, useLayoutEffect, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { SectionTitle } from '../components/UI';
import { Colors } from '../theme/colors';

import { HelpScreen } from '../components/HelpScreen';
import { AboutScreen } from '../components/AboutScreen';
import { BackupScreen } from '../components/BackupScreen';
import { SettingsScreen } from '../components/SettingsScreen';
import { ProfileScreen } from '../components/ProfileScreen';
import { AccountScreen } from './more/AccountScreen';

export { AccountScreen } from './more/AccountScreen';
export { AccountLifecycle } from './more/AccountLifecycle';

export function MoreScreen({
  isActive = true,
  auth,
  registerBackConsumer,
  onOwnsBackChange,
  onExport,
  onImport,
  fatigueMultiplier,
  onUpdateFatigueMultiplier,
  weightDateEditEnabled,
  onUpdateWeightDateEditEnabled,
  deloadDateEditEnabled,
  onUpdateDeloadDateEditEnabled,
}) {
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
      setActiveView('menu');
      return true;
    });

    return () => {
      unregister?.();
      onOwnsBackChange?.(false);
    };
  }, [isActive, inSubView, registerBackConsumer, onOwnsBackChange]);

  if (activeView === 'help') {
    return <HelpScreen onBack={() => setActiveView('menu')} />;
  }

  if (activeView === 'about') {
    return <AboutScreen onBack={() => setActiveView('menu')} />;
  }

  if (activeView === 'backup') {
    return (
      <BackupScreen
        onBack={() => setActiveView('menu')}
        onExport={onExport}
        onImport={onImport}
      />
    );
  }

  if (activeView === 'settings') {
    return (
      <SettingsScreen
        onBack={() => setActiveView('menu')}
        multiplier={fatigueMultiplier}
        onUpdate={onUpdateFatigueMultiplier}
        weightDateEditEnabled={weightDateEditEnabled}
        onUpdateWeightDateEditEnabled={onUpdateWeightDateEditEnabled}
        deloadDateEditEnabled={deloadDateEditEnabled}
        onUpdateDeloadDateEditEnabled={onUpdateDeloadDateEditEnabled}
      />
    );
  }

  if (activeView === 'profile') {
    return <ProfileScreen onBack={() => setActiveView('menu')} />;
  }

  if (activeView === 'account') {
    return <AccountScreen auth={auth} onBack={() => setActiveView('menu')} />;
  }

  return (
    <ScreenShell title="More" subtitle="Settings, help, and your data.">
      <SectionTitle>Profile & Account</SectionTitle>
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('profile')} accessibilityRole="button" accessibilityLabel="User Profile">
          <Text style={styles.menuItemText}>User Profile</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('account')} accessibilityRole="button" accessibilityLabel="Account">
          <Text style={styles.menuItemText}>Account</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
      </View>

      <SectionTitle>Settings & Data</SectionTitle>
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('settings')} accessibilityRole="button" accessibilityLabel="Settings">
          <Text style={styles.menuItemText}>Settings</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('backup')} accessibilityRole="button" accessibilityLabel="Data and Backup">
          <Text style={styles.menuItemText}>Data & Backup</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
      </View>

      <SectionTitle>Help & Support</SectionTitle>
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('help')} accessibilityRole="button" accessibilityLabel="App Guide">
          <Text style={styles.menuItemText}>App Guide</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('about')} accessibilityRole="button" accessibilityLabel="About Kilo">
          <Text style={styles.menuItemText}>About Kilo</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.card,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  menuItemText: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },
  menuItemChevron: {
    fontSize: 18,
    color: Colors.textMuted,
    fontWeight: '700',
  },
});
