import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle, Button } from './UI';
import { Colors } from '../theme/colors';
import { useFeatureToggles } from '../hooks/useEntries';

export function SettingsScreen({ onBack, multiplier, onUpdate, weightDateEditEnabled, onUpdateWeightDateEditEnabled, deloadDateEditEnabled, onUpdateDeloadDateEditEnabled }) {
  const { fatigueTrackingEnabled, deloadModeEnabled, setFatigueTrackingEnabled, setDeloadModeEnabled } = useFeatureToggles();
  const handleIncrement = () => onUpdate(Math.round((multiplier + 0.01) * 100) / 100);
  const handleDecrement = () => onUpdate(Math.max(1, Math.round((multiplier - 0.01) * 100) / 100));
  const handleReset = () => onUpdate(1.07);

  return (
    <ScreenShell title="Settings" subtitle="App features and preferences." onBack={onBack}>

      <SectionTitle>Features</SectionTitle>
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Fatigue tracking</Text>
            <Text style={styles.settingHelp}>Check-in prompt after each session and fatigue charts in Analytics</Text>
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
            <Text style={styles.settingHelp}>Enables deload generation and history in the Log tab</Text>
          </View>
          <Switch
            value={!!deloadModeEnabled}
            onValueChange={setDeloadModeEnabled}
            accessibilityLabel="Deload mode"
            accessibilityRole="switch"
          />
        </View>
      </Card>

      <SectionTitle>Date Editing</SectionTitle>
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Edit weigh-in dates</Text>
            <Text style={styles.settingHelp}>Choose a custom date when logging or editing weight entries</Text>
          </View>
          <Switch
            value={!!weightDateEditEnabled}
            onValueChange={onUpdateWeightDateEditEnabled}
            accessibilityLabel="Edit weigh-in dates"
            accessibilityRole="switch"
          />
        </View>
        <View style={[styles.settingRow, { marginBottom: 0 }]}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Edit deload dates</Text>
            <Text style={styles.settingHelp}>Change the date on past deload records</Text>
          </View>
          <Switch
            value={!!deloadDateEditEnabled}
            onValueChange={onUpdateDeloadDateEditEnabled}
            accessibilityLabel="Edit deload dates"
            accessibilityRole="switch"
          />
        </View>
      </Card>

      <SectionTitle>Advanced</SectionTitle>
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Fatigue multiplier</Text>
            <Text style={styles.settingHelp}>Scales your Est. Max to produce the Kilo Max. Lower = more conservative. Default: 1.07.</Text>
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
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
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
