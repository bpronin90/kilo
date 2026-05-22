import React, { useMemo, useState, useEffect } from 'react';
import { Image, Platform, Pressable, BackHandler, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';
import { ScreenShell } from '../components/ScreenShell';
import { Card, SectionTitle, Chip, StatCard, Button, LineChart } from '../components/UI';
import { formatTimestamp } from '../lib/format';
import { Colors } from '../theme/colors';
import { parseWorkoutNote } from '../lib/parser';
import { 
  computeWeightRollingAverageSeries, 
  derive1kTotal, 
  DEFAULT_1K_EXERCISES,
  computeWeeksIn
} from '../lib/data';
import pkg from '../package.json';

const LOGO = require('../assets/brand/logo.png');

// Home title wordmark. Source artwork: src/assets/brand/home-title.svg
function KiloWordmark({ width = 140, height = 48 }) {
  return (
    <View style={{ width, height, justifyContent: 'center', marginLeft: -8 }}>
      <Svg width="100%" height="100%" viewBox="0 0 303 106">
        {/* K */}
        <Rect x="8" y="9" width="7" height="88" rx="3.5" ry="3.5" fill={Colors.text} />
        <Path d="M 21 52 L 43 52 L 78 12 M 43 52 L 78 92" fill="none" stroke={Colors.text} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        {/* I */}
        <Rect x="102" y="30" width="7" height="66" rx="3.5" ry="3.5" fill={Colors.text} />
        <Rect x="102" y="10" width="7" height="15" rx="3.5" ry="3.5" fill="#FF5C00" />
        {/* L */}
        <Path d="M 136.5 12.5 V 80.5 A 12 12 0 0 0 148.5 92.5 H 178.5" fill="none" stroke={Colors.text} strokeWidth="7" strokeLinecap="round" />
        {/* O (dot) */}
        <Rect x="187" y="89.5" width="16" height="7" rx="3.5" ry="3.5" fill="#FF5C00" />
        {/* O (circle) */}
        <Path d="M 251.5 11.5 C 282.7 11.5 290.5 19.7 290.5 52.5 C 290.5 85.3 282.7 93.5 251.5 93.5 C 220.3 93.5 212.5 85.3 212.5 52.5 C 212.5 19.7 220.3 11.5 251.5 11.5 Z" fill="none" stroke={Colors.text} strokeWidth="7" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

export function HomeScreen({ weightEntries, workoutNote, successMessage, onNavigate }) {
  const dashboardData = useMemo(() => {
    let oneK = null;

    if (workoutNote?.raw_text) {
      const { sections } = parseWorkoutNote(workoutNote.raw_text);
      
      const oneKSelections = {
        ...DEFAULT_1K_EXERCISES,
        ...(workoutNote?.one_k_exercises || {}),
      };
      oneK = derive1kTotal(sections, oneKSelections);
    }

    const weightSeries = computeWeightRollingAverageSeries(weightEntries, 7);
    const latestWeight = weightEntries[0]?.weight_value;
    const weeksIn = computeWeeksIn(workoutNote?.currentSince);

    return { weightSeries, oneK, latestWeight, weeksIn };
  }, [weightEntries, workoutNote]);

  return (
    <ScreenShell
      title={<KiloWordmark />}
      subtitle="Current Routine Progress"
    >
      {successMessage ? (
        <Card style={styles.successCard}>
          <Text style={styles.successText}>{successMessage}</Text>
        </Card>
      ) : null}

      <View style={styles.summaryGrid}>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Latest Weight</Text>
          <Text style={styles.summaryValue}>
            {dashboardData.latestWeight ? `${dashboardData.latestWeight} lb` : '—'}
          </Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Weeks In</Text>
          <Text style={styles.summaryValue}>
            {dashboardData.weeksIn !== null ? dashboardData.weeksIn : '—'}
          </Text>
        </Card>
      </View>

      <SectionTitle>1k Club Progress</SectionTitle>
      <Card style={styles.oneKCard}>
        <View style={styles.oneKTotalTarget}>
          <Text style={styles.oneKValue}>
            {dashboardData.oneK?.total ? `${dashboardData.oneK.total.toFixed(0)}` : '—'}
            <Text style={styles.oneKUnit}> lb</Text>
          </Text>
        </View>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.min(100, ((dashboardData.oneK?.total || 0) / 1000) * 100)}%` }
            ]}
          />
        </View>
        <View style={styles.oneKBreakdown}>
          <Text style={styles.oneKBreakdownText}>
            S: {dashboardData.oneK?.squat?.toFixed(0) || '—'}  ·
            B: {dashboardData.oneK?.bench?.toFixed(0) || '—'}  ·
            D: {dashboardData.oneK?.deadlift?.toFixed(0) || '—'}
          </Text>
        </View>
      </Card>

      <SectionTitle>Weight Trend</SectionTitle>
      <Card style={styles.chartCard}>
        <View>
          <Text style={styles.chartLabel}>7-Day Rolling Average</Text>
          <LineChart
            data={dashboardData.weightSeries}
            color={Colors.success}
            height={100}
          />
        </View>
      </Card>
    </ScreenShell>
  );
}

export function MoreScreen({ onNavigate, onExport, onImport, fatigueMultiplier, onUpdateFatigueMultiplier }) {
  const [activeView, setActiveView] = useState('menu');

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backAction = () => {
      if (activeView !== 'menu') {
        setActiveView('menu');
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );

    return () => backHandler.remove();
  }, [activeView]);

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
      />
    );
  }

  return (
    <ScreenShell title="More" subtitle="Help, about, and application info.">
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('help')}>
          <Text style={styles.menuItemText}>Help & Terminology</Text>
          <Text style={styles.menuItemChevron}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('settings')}>
          <Text style={styles.menuItemText}>Settings & Algorithm</Text>
          <Text style={styles.menuItemChevron}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('backup')}>
          <Text style={styles.menuItemText}>Data & Backup</Text>
          <Text style={styles.menuItemChevron}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('about')}>
          <Text style={styles.menuItemText}>About Kilo</Text>
          <Text style={styles.menuItemChevron}>→</Text>
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

function BackupScreen({ onBack, onExport, onImport }) {
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState(null); // { ok: bool, message: string }
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await onExport();
      if (!result.ok) {
        setStatus({ ok: false, message: result.error || 'Export failed.' });
        return;
      }
      await Share.share({ message: result.json });
    } catch (e) {
      setStatus({ ok: false, message: 'Export failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) {
      setStatus({ ok: false, message: 'Paste your backup JSON first.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      let payload;
      try {
        payload = JSON.parse(importText.trim());
      } catch {
        setStatus({ ok: false, message: 'Invalid JSON — check your backup text.' });
        return;
      }
      const result = await onImport(payload);
      if (result.ok) {
        setImportText('');
        setStatus({ ok: true, message: 'Data restored successfully.' });
      } else {
        setStatus({ ok: false, message: result.error || 'Import failed.' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell title="Data & Backup" subtitle="Export or restore your training data.">
      <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />

      {status ? (
        <Card tone={status.ok ? 'success' : 'error'}>
          <Text style={styles.statusText}>{status.message}</Text>
        </Card>
      ) : null}

      <SectionTitle>Export</SectionTitle>
      <Card>
        <Text style={styles.helpText}>
          Exports all your weight entries and workout notes as a JSON file you can save or share.
        </Text>
        <Button title="Export Data" onPress={handleExport} disabled={busy} style={styles.actionButton} />
      </Card>

      <SectionTitle>Import</SectionTitle>
      <Card>
        <Text style={styles.helpText}>
          Paste a previously exported backup below, then tap Import. This will replace all current data.
        </Text>
        <TextInput
          style={styles.importInput}
          multiline
          numberOfLines={6}
          placeholder="Paste backup JSON here…"
          placeholderTextColor={Colors.textMuted}
          value={importText}
          onChangeText={setImportText}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button title="Import Data" onPress={handleImport} disabled={busy} style={styles.actionButton} />
      </Card>
    </ScreenShell>
  );
}

function SettingsScreen({ onBack, multiplier, onUpdate }) {
  const handleIncrement = () => onUpdate(Math.round((multiplier + 0.01) * 100) / 100);
  const handleDecrement = () => onUpdate(Math.max(1, Math.round((multiplier - 0.01) * 100) / 100));
  const handleReset = () => onUpdate(1.07);

  return (
    <ScreenShell title="Settings" subtitle="Algorithm and calculation defaults.">
      <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />

      <SectionTitle>Algorithm</SectionTitle>
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Fatigue Multiplier</Text>
            <Text style={styles.settingHelp}>Applied to epley 1RM for Kilo max</Text>
          </View>
          <View style={styles.stepper}>
            <Pressable style={styles.stepperButton} onPress={handleDecrement}>
              <Text style={styles.stepperText}>−</Text>
            </Pressable>
            <View style={styles.stepperValueContainer}>
              <Text style={styles.stepperValue}>{multiplier.toFixed(2)}</Text>
            </View>
            <Pressable style={styles.stepperButton} onPress={handleIncrement}>
              <Text style={styles.stepperText}>+</Text>
            </Pressable>
          </View>
        </View>
        <Button 
          title="Reset to default (1.07)" 
          onPress={handleReset} 
          style={styles.resetButton}
          textStyle={styles.resetButtonText}
        />
      </Card>
    </ScreenShell>
  );
}

function HelpScreen({ onBack }) {
  const headerLeft = (
    <Pressable 
      onPress={onBack} 
      style={styles.headerBackButton}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Text style={styles.headerBackButtonText}>←</Text>
    </Pressable>
  );

  return (
    <ScreenShell title="Help" headerLeft={headerLeft}>
      <View style={styles.logoContainer}>
        <Image source={LOGO} style={styles.logo} />
      </View>
      
      <Card>
        <Text style={styles.helpHeading}>What is Kilo?</Text>
        <Text style={styles.helpText}>
          Kilo is a minimalist training log designed for speed. It interprets your natural workout notes into structured data and analytics.
        </Text>
      </Card>

      <Card>
        <Text style={styles.helpHeading}>Workout Notes</Text>
        <Text style={styles.helpText}>
          Enter your exercises followed by weight, reps, and sets.{"\n\n"}
          Example: "Squat 225x5x5" or "Bench 185x8, 185x7, 185x6".
        </Text>
      </Card>

      <Card>
        <Text style={styles.helpHeading}>What is "Tracked"?</Text>
        <Text style={styles.helpText}>
          Tapping "Track" on an exercise in your log tells Kilo to monitor it for progress. These exercises appear in your Analytics tab with progression markers.
        </Text>
      </Card>

      <Card>
        <Text style={styles.helpHeading}>Terminology</Text>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Est. Max</Text>
          <Text style={styles.termDesc}>Estimated 1-Rep Max. A calculation of your maximum strength based on your best sets.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Sets</Text>
          <Text style={styles.termDesc}>The total number of work sets performed for a specific exercise in a session.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Pace Flag</Text>
          <Text style={styles.termDesc}>A warning if your body weight is changing too rapidly (over 1.5% per week).</Text>
        </View>
      </Card>
    </ScreenShell>
  );
}

function AboutScreen({ onBack }) {
  const { currentlyRunning, isUpdateAvailable, isUpdatePending, isChecking } = useUpdates();
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const handleCheckForUpdate = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await Updates.checkForUpdateAsync();
      setCheckResult(result.isAvailable ? 'Update available — restart to apply.' : 'Already up to date.');
    } catch (e) {
      setCheckResult('Check failed (run from a built binary to test OTA).');
    } finally {
      setChecking(false);
    }
  };

  const channel = currentlyRunning?.channel || '—';
  const runtimeVersion = currentlyRunning?.runtimeVersion || pkg.version;
  const updateId = currentlyRunning?.updateId;
  const isEmbedded = currentlyRunning?.isEmbeddedLaunch !== false;
  const updateIdLabel = isEmbedded ? 'embedded bundle' : (updateId ? updateId.slice(0, 8) + '…' : '—');

  return (
    <ScreenShell title="About" subtitle="App information and attribution.">
      <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />

      <Card style={styles.aboutCard}>
        <Text style={styles.aboutLabel}>Created by</Text>
        <Text style={styles.aboutValue}>Benjamin Pronin</Text>

        <Text style={styles.aboutLabel}>Version</Text>
        <Text style={styles.aboutValue}>{`alpha-${pkg.version}`}</Text>

        <Text style={styles.aboutFooter}>
          Copyright © Benjamin Pronin. All rights reserved.
        </Text>
      </Card>

      <Card>
        <Text style={styles.helpText}>
          Kilo is built to be the fastest way to log your training without the friction of traditional tracking apps.
        </Text>
      </Card>

      <SectionTitle>OTA Diagnostics</SectionTitle>
      <Card>
        <View style={styles.diagRow}>
          <Text style={styles.diagLabel}>Channel</Text>
          <Text style={styles.diagValue}>{channel}</Text>
        </View>
        <View style={styles.diagRow}>
          <Text style={styles.diagLabel}>Runtime</Text>
          <Text style={styles.diagValue}>{runtimeVersion}</Text>
        </View>
        <View style={styles.diagRow}>
          <Text style={styles.diagLabel}>Bundle</Text>
          <Text style={styles.diagValue}>{updateIdLabel}</Text>
        </View>
        {isUpdateAvailable || isUpdatePending ? (
          <View style={[styles.diagRow, styles.diagAlert]}>
            <Text style={styles.diagAlertText}>
              {isUpdatePending ? 'Update downloaded — restart to apply.' : 'Update available.'}
            </Text>
          </View>
        ) : null}
        <Button
          title={checking ? 'Checking…' : 'Check for Update'}
          onPress={handleCheckForUpdate}
          disabled={checking}
          style={styles.diagButton}
        />
        {checkResult ? (
          <Text style={styles.diagCheckResult}>{checkResult}</Text>
        ) : null}
      </Card>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  successCard: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
    marginBottom: 12,
  },
  successText: {
    color: Colors.textLight,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 4,
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
  },
  oneKCard: {
    padding: 18,
    gap: 12,
  },
  oneKTotalTarget: {
    alignSelf: 'flex-start',
  },
  oneKValue: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.accent,
  },
  oneKUnit: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  progressBar: {
    height: 6,
    backgroundColor: Colors.cardBorder,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.accent,
  },
  oneKBreakdown: {
    alignItems: 'center',
  },
  oneKBreakdownText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  chartCard: {
    padding: 18,
    gap: 0,
  },
  chartLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: -8,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  entryTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  entryMeta: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  entryBody: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
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
    borderRadius: 20,
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
  headerBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.chipBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -4,
  },
  headerBackButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.accent,
    marginTop: -2, // Optical alignment
  },
  logoContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  logo: {
    width: 64,
    height: 64,
    resizeMode: 'contain',
  },
  backButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
  },
  backButtonText: {
    color: Colors.text,
    fontSize: 14,
  },
  helpHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  helpText: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
  termRow: {
    marginBottom: 12,
  },
  termLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.accent,
    marginBottom: 2,
  },
  termDesc: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
  },
  aboutCard: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  aboutLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
  },
  aboutValue: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
  },
  aboutFooter: {
    marginTop: 32,
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textLight,
    textAlign: 'center',
  },
  actionButton: {
    marginTop: 12,
  },
  importInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    color: Colors.text,
    fontFamily: 'monospace',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  diagLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  diagValue: {
    fontSize: 13,
    color: Colors.text,
    fontFamily: 'monospace',
    flexShrink: 1,
    textAlign: 'right',
  },
  diagAlert: {
    backgroundColor: Colors.chipBackground,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  diagAlertText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.chipText,
  },
  diagButton: {
    marginTop: 12,
  },
  diagCheckResult: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  settingInfo: {
    flex: 1,
    gap: 2,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  settingHelp: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  stepperButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.chipBackground,
  },
  stepperText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.accent,
  },
  stepperValueContainer: {
    width: 60,
    alignItems: 'center',
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.text,
  },
  resetButton: {
    backgroundColor: 'transparent',
    paddingVertical: 4,
    marginTop: 4,
  },
  resetButtonText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
