import React, { useState, useEffect, useCallback } from 'react';
import { Alert, Image, Keyboard, Platform, Pressable, BackHandler, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenShell } from '../components/ScreenShell';
import { Card, SectionTitle, Button } from '../components/UI';
import { Colors } from '../theme/colors';
import { useUserProfile, useFeatureToggles } from '../hooks/useEntries';
import pkg from '../package.json';

const LOGO = require('../assets/brand/logo.png');

export function MoreScreen({ onNavigate, onExport, onImport, fatigueMultiplier, onUpdateFatigueMultiplier, weightDateEditEnabled, onUpdateWeightDateEditEnabled, deloadDateEditEnabled, onUpdateDeloadDateEditEnabled }) {
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

  return (
    <ScreenShell title="More" subtitle="Settings, help, and your data.">
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('help')} accessibilityRole="button" accessibilityLabel="App Guide">
          <Text style={styles.menuItemText}>App Guide</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('profile')} accessibilityRole="button" accessibilityLabel="User Profile">
          <Text style={styles.menuItemText}>User Profile</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('settings')} accessibilityRole="button" accessibilityLabel="Settings and Algorithm">
          <Text style={styles.menuItemText}>Settings & Algorithm</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
      </View>

      <SectionTitle>Data</SectionTitle>
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('backup')} accessibilityRole="button" accessibilityLabel="Data and Backup">
          <Text style={styles.menuItemText}>Data & Backup</Text>
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

function ProfileScreen({ onBack }) {
  const { profile, save, loading, clear: clearAll } = useUserProfile();
  const [localProfile, setLocalProfile] = useState(null);
  const [heightUnit, setHeightUnit] = useState('ft'); // 'ft' or 'cm'
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimeoutRef = React.useRef(null);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (profile && !localProfile) {
      setLocalProfile(profile);
    }
  }, [profile, localProfile]);

  const updateField = useCallback((field, value) => {
    setLocalProfile(prev => ({ ...(prev || {}), [field]: value }));
    setSaveSuccess(false);
  }, []);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveSuccess(false);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    try {
      Keyboard.dismiss();
      await save(localProfile);
      setSaveSuccess(true);
      saveTimeoutRef.current = setTimeout(() => {
        setSaveSuccess(false);
        saveTimeoutRef.current = null;
      }, 3000);
    } catch (e) {
      Alert.alert('Error', 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleClearProfile = () => {
    Alert.alert('Clear Profile', 'Are you sure you want to clear all profile data?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear All', style: 'destructive', onPress: async () => {
        await clearAll();
        setLocalProfile({});
        setSaveSuccess(false);
      }}
    ]);
  };

  const toggleSex = (val) => {
    if (localProfile?.sex === val) {
      updateField('sex', null);
    } else {
      updateField('sex', val);
    }
  };

  const toggleActivity = (id) => {
    if (localProfile?.activity_level === id) {
      updateField('activity_level', null);
    } else {
      updateField('activity_level', id);
    }
  };

  const getDobDate = () => {
    if (localProfile?.date_of_birth) {
      const [y, m, d] = localProfile.date_of_birth.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date(1990, 0, 1);
  };

  const handleDobChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      updateField('date_of_birth', `${y}-${m}-${d}`);
    }
  };

  const heightCm = localProfile?.height_cm || null;
  const totalInches = heightCm ? heightCm / 2.54 : 0;
  const roundedInches = Math.round(totalInches);
  const feet = heightCm ? Math.floor(roundedInches / 12) : '';
  const inches = heightCm ? roundedInches % 12 : '';

  const handleHeightChange = (val, type) => {
    if (type === 'cm') {
      updateField('height_cm', val ? parseFloat(val) : null);
    } else if (type === 'ft') {
      const f = parseFloat(val) || 0;
      const i = parseFloat(inches) || 0;
      updateField('height_cm', (f * 12 + i) * 2.54);
    } else if (type === 'in') {
      const f = parseFloat(feet) || 0;
      const i = parseFloat(val) || 0;
      updateField('height_cm', (f * 12 + i) * 2.54);
    }
  };

  const activityLevels = [
    { id: 'sedentary', label: 'Sedentary', desc: 'Little or no exercise, desk job' },
    { id: 'lightly_active', label: 'Lightly active', desc: 'Light exercise 1–3 days/week' },
    { id: 'moderately_active', label: 'Moderately active', desc: 'Moderate exercise 3–5 days/week' },
    { id: 'very_active', label: 'Very active', desc: 'Hard exercise 6–7 days/week' },
    { id: 'extra_active', label: 'Extra active', desc: 'Very hard exercise, physical job, or training twice/day' },
  ];

  if (loading && !localProfile) {
    return (
      <ScreenShell title="User Profile" subtitle="Loading...">
        <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="User Profile" subtitle="Personal details for calorie estimation.">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />
        <Pressable onPress={handleClearProfile}>
          <Text style={{ color: Colors.error, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' }}>Clear All</Text>
        </Pressable>
      </View>

      <SectionTitle>Biometrics</SectionTitle>
      <Card>
        <Text style={styles.inputLabel}>Biological Sex</Text>
        <View style={styles.toggleRow}>
          <Pressable
            style={[styles.toggleButton, localProfile?.sex === 'male' && styles.toggleButtonActive]}
            onPress={() => toggleSex('male')}
          >
            <Text style={[styles.toggleButtonText, localProfile?.sex === 'male' && styles.toggleButtonTextActive]}>Male</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleButton, localProfile?.sex === 'female' && styles.toggleButtonActive]}
            onPress={() => toggleSex('female')}
          >
            <Text style={[styles.toggleButtonText, localProfile?.sex === 'female' && styles.toggleButtonTextActive]}>Female</Text>
          </Pressable>
        </View>

        <View style={{ height: 16 }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.inputLabel}>Height</Text>
          <View style={styles.unitToggle}>
            <Pressable onPress={() => setHeightUnit('ft')} style={[styles.unitTab, heightUnit === 'ft' && styles.unitTabActive]}>
              <Text style={[styles.unitTabText, heightUnit === 'ft' && styles.unitTabTextActive]}>ft/in</Text>
            </Pressable>
            <Pressable onPress={() => setHeightUnit('cm')} style={[styles.unitTab, heightUnit === 'cm' && styles.unitTabActive]}>
              <Text style={[styles.unitTabText, heightUnit === 'cm' && styles.unitTabTextActive]}>cm</Text>
            </Pressable>
          </View>
        </View>

        {heightUnit === 'ft' ? (
          <View style={styles.heightRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <TextInput
                style={styles.profileInput}
                placeholder="ft"
                keyboardType="numeric"
                value={feet ? String(feet) : ''}
                onChangeText={(v) => handleHeightChange(v, 'ft')}
              />
              <Text style={styles.inputSublabel}>Feet</Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <TextInput
                style={styles.profileInput}
                placeholder="in"
                keyboardType="numeric"
                value={inches ? String(inches) : ''}
                onChangeText={(v) => handleHeightChange(v, 'in')}
              />
              <Text style={styles.inputSublabel}>Inches</Text>
            </View>
          </View>
        ) : (
          <View style={{ gap: 4 }}>
            <TextInput
              style={styles.profileInput}
              placeholder="cm"
              keyboardType="numeric"
              value={heightCm ? String(heightCm) : ''}
              onChangeText={(v) => handleHeightChange(v, 'cm')}
            />
            <Text style={styles.inputSublabel}>Centimeters</Text>
          </View>
        )}

        <View style={{ height: 16 }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={styles.inputLabel}>Date of Birth</Text>
          {localProfile?.date_of_birth && (
            <Pressable onPress={() => updateField('date_of_birth', null)}>
              <Text style={{ color: Colors.error, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>Clear</Text>
            </Pressable>
          )}
        </View>
        <Pressable style={styles.datePickerButton} onPress={() => setShowDatePicker(true)}>
          <Text style={[styles.datePickerText, !localProfile?.date_of_birth && { color: Colors.textMuted }]}>
            {localProfile?.date_of_birth || 'Select Date'}
          </Text>
        </Pressable>
        {showDatePicker && (
          <DateTimePicker
            value={getDobDate()}
            mode="date"
            display="default"
            onValueChange={handleDobChange}
            onDismiss={() => setShowDatePicker(false)}
            maximumDate={new Date()}
          />
        )}
      </Card>

      <SectionTitle>Activity Level</SectionTitle>
      <View style={{ gap: 12, marginTop: 8 }}>
        {activityLevels.map(level => (
          <Pressable
            key={level.id}
            style={[styles.activityCard, localProfile?.activity_level === level.id && styles.activityCardActive]}
            onPress={() => toggleActivity(level.id)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.activityLabel, localProfile?.activity_level === level.id && styles.activityLabelActive]}>
                {level.label}
              </Text>
              <Text style={[styles.activityDesc, localProfile?.activity_level === level.id && styles.activityDescActive]}>
                {level.desc}
              </Text>
            </View>
            {localProfile?.activity_level === level.id && (
              <View style={styles.checkCircle}>
                <Text style={styles.checkText} accessible={false}>✓</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>

      <View style={{ marginTop: 24, marginBottom: 40, gap: 12 }}>
        <Button
          title="Save Profile"
          onPress={handleSave}
          disabled={saving}
        />
        {saveSuccess && (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: Colors.success, fontWeight: '700' }}>Profile saved successfully!</Text>
          </View>
        )}
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

function SettingsScreen({ onBack, multiplier, onUpdate, weightDateEditEnabled, onUpdateWeightDateEditEnabled, deloadDateEditEnabled, onUpdateDeloadDateEditEnabled }) {
  const { fatigueTrackingEnabled, deloadModeEnabled, setFatigueTrackingEnabled, setDeloadModeEnabled } = useFeatureToggles();
  const handleIncrement = () => onUpdate(Math.round((multiplier + 0.01) * 100) / 100);
  const handleDecrement = () => onUpdate(Math.max(1, Math.round((multiplier - 0.01) * 100) / 100));
  const handleReset = () => onUpdate(1.07);

  return (
    <ScreenShell title="Settings" subtitle="Algorithm and calculation defaults.">
      <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />

      <SectionTitle>Training Features</SectionTitle>
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Fatigue tracking</Text>
            <Text style={styles.settingHelp}>Session check-in prompts and Fatigue analytics</Text>
          </View>
          <Switch
            value={!!fatigueTrackingEnabled}
            onValueChange={setFatigueTrackingEnabled}
            accessibilityLabel="Fatigue tracking"
            accessibilityRole="switch"
          />
        </View>
        <View style={[styles.settingRow, { marginBottom: 0 }]}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Deload mode</Text>
            <Text style={styles.settingHelp}>Deload tab, generation, and past deload records</Text>
          </View>
          <Switch
            value={!!deloadModeEnabled}
            onValueChange={setDeloadModeEnabled}
            accessibilityLabel="Deload mode"
            accessibilityRole="switch"
          />
        </View>
      </Card>

      <SectionTitle>Algorithm</SectionTitle>
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Fatigue Multiplier</Text>
            <Text style={styles.settingHelp}>Applied to epley 1RM for Kilo max</Text>
          </View>
          <View style={styles.stepper}>
            <Pressable style={styles.stepperButton} onPress={handleDecrement} accessibilityRole="button" accessibilityLabel="Decrease fatigue multiplier">
              <Text style={styles.stepperText} accessible={false}>−</Text>
            </Pressable>
            <View style={styles.stepperValueContainer}>
              <Text style={styles.stepperValue}>{multiplier.toFixed(2)}</Text>
            </View>
            <Pressable style={styles.stepperButton} onPress={handleIncrement} accessibilityRole="button" accessibilityLabel="Increase fatigue multiplier">
              <Text style={styles.stepperText} accessible={false}>+</Text>
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

      <SectionTitle>Weight Logging</SectionTitle>
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Edit weigh-in dates</Text>
            <Text style={styles.settingHelp}>Allow setting date on new and existing entries</Text>
          </View>
          <Switch
            value={!!weightDateEditEnabled}
            onValueChange={onUpdateWeightDateEditEnabled}
            accessibilityLabel="Edit weigh-in dates"
            accessibilityRole="switch"
          />
        </View>
      </Card>

      <SectionTitle>Workout Notes</SectionTitle>
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Edit deload dates</Text>
            <Text style={styles.settingHelp}>Allow changing the logged date on past deload records</Text>
          </View>
          <Switch
            value={!!deloadDateEditEnabled}
            onValueChange={onUpdateDeloadDateEditEnabled}
            accessibilityLabel="Edit deload dates"
            accessibilityRole="switch"
          />
        </View>
      </Card>
    </ScreenShell>
  );
}

function HelpScreen({ onBack }) {
  return (
    <ScreenShell title="App Guide" subtitle="What Kilo is and how to use it.">
      <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />

      <View style={styles.logoContainer}>
        <Image source={LOGO} style={styles.logo} />
      </View>

      <Card>
        <Text style={styles.helpHeading}>What is Kilo?</Text>
        <Text style={styles.helpText}>
          Kilo is a minimalist training log built for speed. Write your workout in plain text — Kilo parses it into structured data, tracks your progress, and surfaces analytics without extra steps.
        </Text>
      </Card>

      <SectionTitle>Your Tabs</SectionTitle>

      <Card>
        <View style={styles.tabRow}>
          <Text style={styles.tabName}>Home</Text>
          <Text style={styles.tabDesc}>Your training dashboard. Shows current week number, latest body weight, a 7-day rolling weight average, and a breakdown of your tracked exercises by progress status (Progressing, Steady, Regressing). Also displays your active weight goal and 1K milestone progress.</Text>
        </View>
        <View style={styles.tabRow}>
          <Text style={styles.tabName}>Log</Text>
          <Text style={styles.tabDesc}>Write your workouts as free-form text notes. Kilo parses exercises, sets, reps, and weight automatically. Tap any parsed exercise to see details or mark it as tracked. Also contains Deload: when deload mode is enabled in Settings, you can log and review planned deload weeks from within the Log tab.</Text>
        </View>
        <View style={styles.tabRow}>
          <Text style={styles.tabName}>Weight</Text>
          <Text style={styles.tabDesc}>Log your daily body weight. Kilo tracks your trend over time, computes a rolling average, and flags if your rate of change is outside a healthy range. Supports an optional weight goal with target and weekly pace tracking.</Text>
        </View>
        <View style={styles.tabRow}>
          <Text style={styles.tabName}>Analytics</Text>
          <Text style={styles.tabDesc}>Progress charts for exercises you've marked as tracked. Shows estimated 1-rep max and Kilo Max over time, session volume, and fatigue check-in data if fatigue tracking is enabled.</Text>
        </View>
        <View style={[styles.tabRow, { marginBottom: 0 }]}>
          <Text style={styles.tabName}>More</Text>
          <Text style={styles.tabDesc}>App settings, your user profile (used for calorie estimation), data backup and restore, and this guide.</Text>
        </View>
      </Card>

      <SectionTitle>Logging Workouts</SectionTitle>

      <Card>
        <Text style={styles.helpText}>
          In the Log tab, tap a date to open the note editor. Enter exercises in plain text — one exercise per line or comma-separated sets.{"\n\n"}
          Examples:{"\n"}
          {"  "}Squat 225x5x5{"\n"}
          {"  "}Bench 185x8, 185x7, 185x6{"\n"}
          {"  "}Deadlift 315x3{"\n\n"}
          Format: Exercise Name + weight × reps × sets. Kilo handles most common variations.
        </Text>
      </Card>

      <Card>
        <Text style={styles.helpHeading}>Tracking an Exercise</Text>
        <Text style={styles.helpText}>
          After logging, tap an exercise in your note to see parsed details. Tap "Track" to mark it for progress monitoring. Tracked exercises appear in Analytics with charts and progression history.
        </Text>
      </Card>

      <SectionTitle>Terminology</SectionTitle>

      <Card>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Est. Max</Text>
          <Text style={styles.termDesc}>Estimated 1-Rep Max. Calculated from your best logged sets using the Epley formula.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Kilo Max</Text>
          <Text style={styles.termDesc}>Est. Max adjusted by the fatigue multiplier. Reflects real-world performance accounting for accumulated fatigue.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Fatigue</Text>
          <Text style={styles.termDesc}>A session check-in metric that tracks how tired or recovered you feel. Used in Analytics to correlate training load with performance.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Pace Flag</Text>
          <Text style={styles.termDesc}>A warning when body weight is changing faster than ~1.5% per week, which may indicate an unsustainable rate of gain or loss.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Sets</Text>
          <Text style={styles.termDesc}>The total number of work sets logged for a specific exercise in a session.</Text>
        </View>
        <View style={[styles.termRow, { marginBottom: 0 }]}>
          <Text style={styles.termLabel}>Deload</Text>
          <Text style={styles.termDesc}>A planned period of reduced training volume or intensity used to recover from accumulated fatigue.</Text>
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
        <Text style={styles.aboutValue}>{`v${pkg.version}`}</Text>

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
  tabRow: {
    marginBottom: 16,
  },
  tabName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 3,
  },
  tabDesc: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
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
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  inputSublabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    backgroundColor: Colors.inputBackground,
  },
  toggleButtonActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  toggleButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  toggleButtonTextActive: {
    color: Colors.textLight,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.inputBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  unitTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  unitTabActive: {
    backgroundColor: Colors.accent,
  },
  unitTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  unitTabTextActive: {
    color: Colors.textLight,
  },
  heightRow: {
    flexDirection: 'row',
    gap: 12,
  },
  profileInput: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  datePickerButton: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  datePickerText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 12,
  },
  activityCardActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.card,
  },
  activityLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  activityLabelActive: {
    color: Colors.accent,
  },
  activityDesc: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  activityDescActive: {
    color: Colors.text,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkText: {
    color: Colors.textLight,
    fontSize: 14,
    fontWeight: '800',
  },
});
