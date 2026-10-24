import React, { useState, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Button, ErrorBanner } from './UI';
import { SettingsSection, SettingRow, SegmentedOptions } from './settings/SettingsPanels';
import { switchColors, useTheme } from '../theme/ThemeContext';
import { TYPOGRAPHY, useKuaTypography } from '../theme/typography';
import { useFeatureToggles, useUserProfile } from '../hooks/useEntries';
import {
  hydrateProgressionSuggestionSettings,
  subscribeProgressionSuggestionSettings,
  getProgressionSuggestionSettings,
  saveProgressionSuggestionsEnabled,
} from '../storage/entries/settings';
import { ReminderSettingsCard } from './ReminderSettingsCard';
import { ThemeSelectionControl } from './ThemeSelectionControl';
import { useWeightUnit, setWeightUnitPreference } from '../lib/unitPreference';
import { unitFromUnitSystem, unitSystemFromUnit } from '../lib/units';
import { GEOMETRY } from '../theme/spacing';

// Appearance choices, in the order the segmented control renders them (#689).
const APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Light', a11yLabel: 'Use the light appearance' },
  { value: 'dark', label: 'Dark', a11yLabel: 'Use the dark appearance' },
  { value: 'system', label: 'System', a11yLabel: 'Follow the device appearance' },
];

const UNIT_OPTIONS = [
  { value: 'lb', label: 'lb', a11yLabel: 'Show weights in pounds' },
  { value: 'kg', label: 'kg', a11yLabel: 'Show weights in kilograms' },
];

// The unit whose write failed, held at module scope rather than in screen state
// because MoreScreen unmounts SettingsScreen the moment the user leaves it. The
// in-memory preference outlives that unmount, so the report about it has to as
// well — otherwise returning to Settings shows a tab that silently claims to be
// persisted again (#909).
//
// It deliberately does NOT survive an app restart: hydration re-reads
// unit_system from the profile on launch, so the preference and the stored
// value already agree by then.
let lastFailedUnitSave = null;

// Test-only reset for the module-scoped failure above, mirroring
// unitPreference's __resetWeightUnitForTests.
export function __resetUnitSaveStateForTests() {
  lastFailedUnitSave = null;
}

export function SettingsScreen({ onBack, multiplier, onUpdate }) {
  const { colors, kuaPalette: kua, preference: appearance, setPreference: setAppearance } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const { fatigueTrackingEnabled, deloadModeEnabled, setFatigueTrackingEnabled, setDeloadModeEnabled, saveFailures, retryToggleSave } = useFeatureToggles();
  const toggleFailures = saveFailures || {};

  // Progression suggestions (#960). The persisted global flag from #958 is the
  // authority and defaults off. It is read through the settings store's
  // synchronous cache + subscription rather than useFeatureToggles because
  // #960's Allowed Files scope the settings work to this component and the
  // settings module. Toggling it here is immediately visible on the Log and
  // Analytics surfaces, which subscribe to the same store.
  const [progressionSuggestionsEnabled, setProgressionSuggestionsEnabledState] = useState(
    () => getProgressionSuggestionSettings().enabled
  );
  useEffect(() => {
    let active = true;
    hydrateProgressionSuggestionSettings().catch(() => {});
    const unsubscribe = subscribeProgressionSuggestionSettings((next) => {
      if (active) setProgressionSuggestionsEnabledState(next.enabled);
    });
    return () => { active = false; unsubscribe(); };
  }, []);
  const handleToggleProgressionSuggestions = (next) => {
    // Optimistic: the store notifies subscribers on a successful write, but
    // reflect the intent immediately so the switch never lags the tap.
    setProgressionSuggestionsEnabledState(next);
    saveProgressionSuggestionsEnabled(next).catch(() => {
      setProgressionSuggestionsEnabledState(getProgressionSuggestionSettings().enabled);
    });
  };
  const { profile, save: saveProfile, loading: profileLoading } = useUserProfile();
  const weightUnit = useWeightUnit();
  const unitControlsDisabled = !!profileLoading;
  // Seeded from module scope so an unsaved choice is still reported after the
  // user leaves Settings and comes back.
  const [failedUnitSave, setFailedUnitSave] = useState(lastFailedUnitSave);
  const [unitSaving, setUnitSaving] = useState(false);

  // What is actually on disk. `useUserProfile` only advances `profile` on a
  // successful write, and re-reads it from storage on mount, so this stays the
  // durable truth across a remount.
  const persistedUnit = unitFromUnitSystem(profile?.unit_system);

  // Report only a choice that both failed to write AND still differs from what
  // is stored. The mismatch is what makes the "reverts on next launch" claim
  // true: failing to write `lb` when `lb` is already the stored value changes
  // nothing the user needs to know about, so it says nothing (#909 review).
  // Requiring the failure too keeps a sync-pulled unit_system (syncAdapter
  // merges one straight into the profile) from being misreported as a failed
  // save.
  const unitSaveFailed = !profileLoading
    && !unitSaving
    && failedUnitSave === weightUnit
    && weightUnit !== persistedUnit;

  const rememberFailedUnitSave = (unit) => {
    lastFailedUnitSave = unit;
    setFailedUnitSave(unit);
  };

  // Update the in-memory preference first so every surface re-renders
  // immediately, then persist unit_system on the local profile (the cloud
  // bootstrap promotion round-trips it for signed-in users).
  //
  // A failed write is reported in place rather than swallowed (#909). The
  // session preference is deliberately *not* rolled back — every surface has
  // already repainted and the user asked for this unit — but the banner below
  // the control says plainly that the choice is not saved, so the app never
  // claims a durable change it does not have.
  const persistUnit = async (nextUnit) => {
    setUnitSaving(true);
    setWeightUnitPreference(nextUnit);
    try {
      await saveProfile({ ...(profile || {}), unit_system: unitSystemFromUnit(nextUnit) });
      rememberFailedUnitSave(null);
    } catch {
      rememberFailedUnitSave(nextUnit);
    } finally {
      setUnitSaving(false);
    }
  };

  const handleSelectUnit = (nextUnit) => {
    if (unitControlsDisabled || unitSaving) return undefined;
    // Re-tapping the tab that is already selected retries an outstanding
    // failure; with nothing outstanding it stays a no-op.
    if (nextUnit === weightUnit && !unitSaveFailed) return undefined;
    return persistUnit(nextUnit);
  };

  const handleRetryUnitSave = () => {
    if (unitControlsDisabled || unitSaving) return undefined;
    return persistUnit(weightUnit);
  };
  const handleIncrement = () => onUpdate(Math.min(2.0, Math.round((multiplier + 0.01) * 100) / 100));
  const handleDecrement = () => onUpdate(Math.max(1, Math.round((multiplier - 0.01) * 100) / 100));
  const handleReset = () => onUpdate(1.07);

  const switchRow = (label, help, value, onValueChange, divider) => (
    <SettingRow
      label={label}
      help={help}
      divider={divider}
      control={(
        <Switch
          {...switchColors(colors)}
          value={!!value}
          onValueChange={onValueChange}
          accessibilityLabel={label}
          accessibilityRole="switch"
        />
      )}
    />
  );

  // Redesign v3 (#1608): one flat panel per section, rows split by hairlines.
  // Order, labels, controls and every failure banner are production's.
  return (
    <ScreenShell title="Settings" subtitle="App features and preferences." onBack={onBack} style={kua ? { backgroundColor: kua.background } : undefined}>
      <SettingsSection label="FEATURES">
        {switchRow('Fatigue tracking', 'Check-in prompt after each session and fatigue charts in Analytics', fatigueTrackingEnabled, setFatigueTrackingEnabled, false)}
        {toggleFailures.fatigueTrackingEnabled && (
          <View style={styles.bannerBlock}>
            <ErrorBanner
              message={`Couldn't save Fatigue tracking. It is still ${fatigueTrackingEnabled ? 'on' : 'off'} and will stay that way until this saves.`}
              onRetry={() => retryToggleSave('fatigueTrackingEnabled')}
            />
          </View>
        )}
        {switchRow('Deload mode', 'Adds deload generation and history to the Log tab. That surface is hidden while a Recovery block is active, because Recovery controls that workflow instead.', deloadModeEnabled, setDeloadModeEnabled, true)}
        {toggleFailures.deloadModeEnabled && (
          <View style={styles.bannerBlock}>
            <ErrorBanner
              message={`Couldn't save Deload mode. It is still ${deloadModeEnabled ? 'on' : 'off'} and will stay that way until this saves.`}
              onRetry={() => retryToggleSave('deloadModeEnabled')}
            />
          </View>
        )}
        {switchRow('Progression suggestions', 'Shows a prompt on the Log and Analytics tabs when your recent sets suggest adding weight or reps. You apply each one yourself; your workout notes are never changed.', progressionSuggestionsEnabled, handleToggleProgressionSuggestions, true)}
      </SettingsSection>

      <SettingsSection label="REMINDERS">
        <ReminderSettingsCard flat />
      </SettingsSection>

      <SettingsSection label="APPEARANCE">
        <View style={styles.themeBlock}>
          <ThemeSelectionControl flat />
        </View>
        {/* Stacked (label above, control below): Mode's three full words need
            the panel's full inner width at narrow phone widths and large
            accessibility font scales (#1173 review). */}
        <SettingRow
          label="Mode"
          help="Light, dark, or match your device"
          divider
          stacked
          control={<SegmentedOptions options={APPEARANCE_OPTIONS} value={appearance} onSelect={setAppearance} />}
        />
      </SettingsSection>

      <SettingsSection label="UNITS">
        {/* The save-failure banner sits under the control it is about, so the
            failure is read next to the tab that is not yet persisted (#909). */}
        <SettingRow
          label="Weight unit"
          help="Shows body weight and lifts in pounds or kilograms. Your notes and saved data stay in lb."
          control={(
            <SegmentedOptions
              options={UNIT_OPTIONS}
              value={weightUnit}
              onSelect={handleSelectUnit}
              disabled={unitControlsDisabled}
            />
          )}
        >
          {unitSaveFailed && (
            <ErrorBanner
              message={`Couldn't save the weight unit. ${weightUnit} applies for this session, but the app will open in ${persistedUnit} until this saves.`}
              onRetry={handleRetryUnitSave}
            />
          )}
        </SettingRow>
      </SettingsSection>

      <SettingsSection label="ADVANCED">
        <SettingRow
          label="Fatigue multiplier"
          help="Scales your logged-set strength estimates to produce the Kilo Max shown in Analytics. A lower number makes the Kilo Max more conservative. Default 1.07."
          control={(
            <View style={styles.stepper}>
              <Pressable style={styles.stepperButton} onPress={handleDecrement} accessibilityRole="button" accessibilityLabel="Decrease fatigue multiplier">
                <Text style={styles.stepperText} accessible={false}>−</Text>
              </Pressable>
              <View style={styles.stepperValueContainer}>
                <Text style={[styles.stepperValue, typography['label-lg']]}>{multiplier.toFixed(2)}</Text>
              </View>
              <Pressable style={styles.stepperButton} onPress={handleIncrement} accessibilityRole="button" accessibilityLabel="Increase fatigue multiplier">
                <Text style={styles.stepperText} accessible={false}>+</Text>
              </Pressable>
            </View>
          )}
        />
        <View style={styles.resetBlock}>
          <Button
            title="Reset to default (1.07)"
            onPress={handleReset}
            style={styles.resetButton}
            textStyle={styles.resetButtonText}
          />
        </View>
      </SettingsSection>
    </ScreenShell>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  bannerBlock: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  themeBlock: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  resetBlock: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: kua ? kua.surfaceSection : colors.inputBackground,
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    overflow: 'hidden',
  },
  stepperButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
  },
  // `chipAccentText` (#923): the glyphs always sit on `stepperButton`'s
  // `chipBackground` fill, where `accentText` measures 3.54:1 in dark mode.
  // In KUA mode: `primaryOnContainer` on `primaryContainer`.
  stepperText: {
    fontSize: 20,
    fontWeight: '700',
    color: kua ? kua.primaryOnContainer : colors.chipAccentText,
  },
  stepperValueContainer: {
    width: 60,
    alignItems: 'center',
  },
  stepperValue: {
    color: kua ? kua.onSurface : colors.text,
  },
  resetButton: {
    backgroundColor: 'transparent',
    paddingVertical: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  resetButtonText: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
