import React, { useState, useLayoutEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Button, SectionTitle } from '../components/UI';
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
  registerBackConsumer,
  onOwnsBackChange,
  onNavigate,
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
    return <AccountScreen onBack={() => setActiveView('menu')} />;
  }

  return (
    <ScreenShell title="More" subtitle="Settings, help, and your data.">
      <SectionTitle>You</SectionTitle>
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('profile')} accessibilityRole="button" accessibilityLabel="User Profile">
          <Text style={styles.menuItemText}>User Profile</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('settings')} accessibilityRole="button" accessibilityLabel="Settings">
          <Text style={styles.menuItemText}>Settings</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
      </View>

      <SectionTitle>Data & Account</SectionTitle>
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('account')} accessibilityRole="button" accessibilityLabel="Account">
          <Text style={styles.menuItemText}>Account</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('backup')} accessibilityRole="button" accessibilityLabel="Data and Backup">
          <Text style={styles.menuItemText}>Data & Backup</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
      </View>

      <SectionTitle>About & Support</SectionTitle>
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

      <SectionTitle>Quick Actions</SectionTitle>
      <View style={styles.grid}>
        <Button title="Log Workout" onPress={() => onNavigate('Log')} style={{ flex: 1 }} />
        <Button title="Log Weight" onPress={() => onNavigate('Weight')} style={{ flex: 1 }} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
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
