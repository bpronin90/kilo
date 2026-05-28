import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Alert, Image, Keyboard, Platform, Pressable, BackHandler, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenShell } from '../components/ScreenShell';
import { Card, SectionTitle, Button, LineChart } from '../components/UI';
import { Colors } from '../theme/colors';
import { useUserProfile, useWeightGoal, useTrackedLifts } from '../hooks/useEntries';
import { parseWorkoutNote, canonicalizeName } from '../lib/parser';
import {
  deriveWeightGoalAnalytics,
  derive1kTotal,
  DEFAULT_1K_EXERCISES,
  deriveWorkoutNoteAnalytics,
  deriveOverloadCounts,
  computeWeeklySummary,
  normalizeLiftName,
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

const formatGoalDirection = (direction) => {
  if (!direction) return '';
  switch (direction) {
    case 'gain': return '↑ Bulking';
    case 'loss': return '↓ Cutting';
    case 'maintain': return '↔ Maintaining';
    default: return direction;
  }
};

export function HomeScreen({ weightEntries, workoutNote, notes, successMessage, onNavigate }) {
  const { goal: weightGoal } = useWeightGoal();
  const { trackedLifts } = useTrackedLifts();

  const dashboardData = useMemo(() => {
    let oneK = null;
    let sections = null;

    if (workoutNote?.raw_text) {
      ({ sections } = parseWorkoutNote(workoutNote.raw_text));

      const oneKSelections = {
        ...DEFAULT_1K_EXERCISES,
        ...(workoutNote?.one_k_exercises || {}),
      };
      oneK = derive1kTotal(sections, oneKSelections);
    }

    const { rollingSeries: weightSeries, trendSummary: weightTrends, goalInfo } = deriveWeightGoalAnalytics(weightEntries, weightGoal);
    const latestWeight = weightTrends.currentWeight;
    const { weeksIn } = deriveWorkoutNoteAnalytics(sections, []);

    // Mirror StatsScreen: derive signals for tracked exercises visible in the current note only.
    const allSections = (notes || []).flatMap(n => n?.raw_text ? parseWorkoutNote(n.raw_text).sections : []);
    const namesInCurrent = new Set(
      (sections || []).flatMap(s => s.exercises.map(e => normalizeLiftName(canonicalizeName(e.name))))
    );
    const globallyTracked = Object.keys(trackedLifts || {}).filter(k => trackedLifts[k]);
    const visibleTrackedNames = globallyTracked.filter(
      name => namesInCurrent.has(normalizeLiftName(canonicalizeName(name)))
    );
    const { signals, perDaySignals } = deriveWorkoutNoteAnalytics(allSections, visibleTrackedNames);
    const counts = deriveOverloadCounts(sections, signals, perDaySignals);

    if (__DEV__) {
      console.log('[HOME DEBUG] notes:', (notes || []).length, '| allSections:', allSections.length, '| visibleTracked:', visibleTrackedNames.length);
      console.log('[HOME DEBUG] counts:', JSON.stringify(counts));
    }

    const weeklySummary = computeWeeklySummary(sections, workoutNote);
    weeklySummary.classifications = counts;

    return {
      weightSeries,
      oneK,
      latestWeight,
      weeksIn,
      weeklySummary,
      goalInfo: goalInfo ? { ...goalInfo, displayDirection: formatGoalDirection(goalInfo.direction) } : null,
    };
  }, [weightEntries, workoutNote, weightGoal, notes, trackedLifts]);

  return (
    <ScreenShell
      title={<KiloWordmark />}
      subtitle="Current routine progress."
    >
      {/* ══ TIER 1: Weekly Summary ══ */}
      <Card style={styles.weeklyHero}>
        <View style={styles.heroContent}>
          {/* #2 inline week label */}
          <Text style={styles.heroWeekLabel}>
            {dashboardData.weeksIn !== null ? `Week ${dashboardData.weeksIn}` : 'Week —'}
          </Text>

          <Text style={dashboardData.latestWeight ? styles.heroWeightValue : styles.heroWeightPlaceholder}>
            {dashboardData.latestWeight ? dashboardData.latestWeight : '—'}
            {dashboardData.latestWeight ? <Text style={styles.heroWeightUnit}> lb</Text> : null}
          </Text>

          {/* #4 sparkline strip below weight */}
          <View style={styles.heroSparklineStrip}>
            <LineChart
              data={dashboardData.weightSeries}
              color={Colors.textMuted}
              height={32}
              paddingVertical={0}
              paddingHorizontal={0}
              hideHeader
            />
            <Text style={styles.heroSparklineSublabel}>7-day trend</Text>
          </View>

          {/* Classification band */}
          <View style={styles.classifRow}>
            {[
              { label: 'Progressing', count: dashboardData.weeklySummary.classifications?.progressing ?? 0, color: Colors.success },
              { label: 'Steady', count: dashboardData.weeklySummary.classifications?.stalled ?? 0, color: Colors.caution },
              { label: 'Regressing', count: dashboardData.weeklySummary.classifications?.regressing ?? 0, color: Colors.error },
              { label: 'Inconsistent', count: dashboardData.weeklySummary.classifications?.inconsistent ?? 0, color: Colors.textMuted },
            ].map((item, idx) => (
              <View key={idx} style={styles.classifCol}>
                <View style={[styles.classifDot, { backgroundColor: item.color }]} />
                <Text style={styles.classifCount}>{item.count}</Text>
                <Text style={styles.classifLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          {/* #7 quiet CTA */}
          <View style={styles.heroFooter}>
            <Pressable onPress={() => onNavigate('Stats')} style={styles.insightsLink}>
              <Text style={styles.insightsLinkText}>Full history and insights</Text>
              <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={Colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><Path d="M9 5l7 7-7 7" /></Svg>
            </Pressable>
          </View>
        </View>
      </Card>

      {/* ══ TIER 2: Weight Goal ══ */}
      {dashboardData.goalInfo ? (
        <Card style={styles.goalCard}>
          <View style={styles.goalHeader}>
            <Text style={[styles.goalDirectionText, {
              color: dashboardData.goalInfo.direction === 'gain' ? Colors.success
                : dashboardData.goalInfo.direction === 'loss' ? Colors.accent
                : Colors.textMuted
            }]}>
              {dashboardData.goalInfo.direction === 'loss' ? 'Cutting' : dashboardData.goalInfo.direction === 'gain' ? 'Bulking' : 'Maintaining'}
            </Text>
            {/* #8 no chevron — weeks is display only */}
            <Text style={styles.goalWeeksText}>{Math.round(dashboardData.goalInfo.weeks_remaining)} weeks left</Text>
          </View>
          <View style={styles.goalStatsGrid}>
            <View style={styles.goalStatCol}>
              <Text style={styles.goalStatLabel}>Target</Text>
              <View style={styles.goalStatValueRow}>
                <Text style={styles.goalStatValueLarge}>{weightGoal?.target_weight}</Text>
                <Text style={styles.goalStatUnitLabel}>lb</Text>
              </View>
            </View>
            <View style={styles.goalStatCol}>
              <Text style={styles.goalStatLabel}>Pace</Text>
              <View style={styles.goalStatValueRow}>
                <Text style={styles.goalStatValueLarge}>
                  {dashboardData.goalInfo.required_weekly_pace > 0 ? '+' : ''}
                  {dashboardData.goalInfo.required_weekly_pace.toFixed(1)}
                </Text>
                <Text style={styles.goalStatUnitLabel}>lb/wk</Text>
              </View>
            </View>
          </View>
        </Card>
      ) : null}

      {/* ══ TIER 3: 1k Club Progress ══ */}
      <Card style={styles.oneKCard}>
        <View style={styles.oneKHero}>
          <Text style={styles.oneKHeroValue}>
            {dashboardData.oneK?.total ? `${dashboardData.oneK.total.toFixed(0)}` : '—'}
            <Text style={styles.oneKHeroUnit}> lb</Text>
          </Text>
        </View>
        <View style={styles.progressBarLarge}>
          <View
            style={[
              styles.progressFillLarge,
              { width: `${Math.min(100, ((dashboardData.oneK?.total || 0) / 1000) * 100)}%` }
            ]}
          />
        </View>
        <View style={styles.oneKGrid}>
          <View style={styles.oneKGridItem}>
            <Text style={styles.oneKGridValue}>{dashboardData.oneK?.squat?.toFixed(0) || '—'}</Text>
            <Text style={styles.oneKGridLabel}>Squats</Text>
          </View>
          <View style={[styles.oneKGridItem, styles.oneKGridItemBorder]}>
            <Text style={styles.oneKGridValue}>{dashboardData.oneK?.bench?.toFixed(0) || '—'}</Text>
            <Text style={styles.oneKGridLabel}>Bench</Text>
          </View>
          <View style={styles.oneKGridItem}>
            <Text style={styles.oneKGridValue}>{dashboardData.oneK?.deadlift?.toFixed(0) || '—'}</Text>
            <Text style={styles.oneKGridLabel}>Deadlifts</Text>
          </View>
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

  if (activeView === 'profile') {
    return <ProfileScreen onBack={() => setActiveView('menu')} />;
  }

  return (
    <ScreenShell title="More" subtitle="Help, about, and application info.">
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('profile')}>
          <Text style={styles.menuItemText}>User Profile</Text>
          <Text style={styles.menuItemChevron}>→</Text>
        </Pressable>
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
            onChange={handleDobChange}
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
                <Text style={styles.checkText}>✓</Text>
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
  return (
    <ScreenShell title="Help" subtitle="Terminology and usage guide.">
      <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />

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
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
  weeklyHero: {
    padding: 0,
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginTop: 12,
  },
  heroContent: {
    padding: 24,
  },
  heroWeekLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 12,
  },
  heroWeightValue: {
    fontSize: 48,
    fontWeight: '800',
    color: Colors.accent,
    lineHeight: 52,
  },
  heroWeightPlaceholder: {
    fontSize: 48,
    fontWeight: '400',
    color: Colors.textMuted,
    lineHeight: 52,
  },
  heroWeightUnit: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  heroSparklineStrip: {
    marginTop: 8,
    marginBottom: 20,
  },
  heroSparklineSublabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textAlign: 'right',
    marginTop: 2,
  },
  classifRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  classifCol: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  classifDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  classifCount: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.text,
  },
  classifLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 14,
  },
  heroFooter: {
    alignItems: 'center',
    marginTop: 12,
  },
  insightsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  insightsLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  goalCard: {
    padding: 24,
    borderRadius: 24,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  goalDirectionText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  goalWeeksText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  goalStatsGrid: {
    flexDirection: 'row',
    gap: 40,
  },
  goalStatCol: {
    gap: 4,
  },
  goalStatLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  goalStatValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  goalStatValueLarge: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
  },
  goalStatUnitLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  oneKCard: {
    padding: 24,
    borderRadius: 24,
  },
  oneKHero: {
    alignItems: 'center',
    marginBottom: 24,
  },
  oneKHeroValue: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.text,
  },
  oneKHeroUnit: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  progressBarLarge: {
    height: 8,
    backgroundColor: Colors.cardBorder,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 28,
  },
  progressFillLarge: {
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 6,
  },
  oneKGrid: {
    flexDirection: 'row',
  },
  oneKGridItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  oneKGridItemBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Colors.cardBorder,
  },
  oneKGridValue: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.text,
  },
  oneKGridLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  placeholderText: {
    fontSize: 48,
    color: Colors.textMuted,
    fontWeight: '400',
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    fontStyle: 'italic',
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
