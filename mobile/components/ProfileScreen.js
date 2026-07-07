import React, { useState, useEffect, useCallback } from 'react';
import { Alert, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle, Button, InputStyle } from './UI';
import { Colors } from '../theme/colors';
import { useUserProfile } from '../hooks/useEntries';
import { setWeightUnitPreference } from '../lib/unitPreference';

export function ProfileScreen({ onBack }) {
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
        // Clearing the profile removes unit_system, so the display preference
        // falls back to the lb default (#441).
        setWeightUnitPreference('lb');
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

  const formatDob = (selectedDate) => {
    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const d = String(selectedDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const handleDobChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      updateField('date_of_birth', formatDob(selectedDate));
    }
  };

  const todayDobMax = formatDob(new Date());

  const heightCm = localProfile?.height_cm || null;
  const totalInches = heightCm ? heightCm / 2.54 : 0;
  const roundedInches = Math.round(totalInches);
  const feet = heightCm ? Math.floor(roundedInches / 12) : '';
  const inches = heightCm ? roundedInches % 12 : '';

  const handleHeightChange = (val, type) => {
    if (type === 'cm') {
      updateField('height_cm', val ? parseFloat(val) : null);
    } else if (type === 'ft') {
      if (!val && !inches) {
        updateField('height_cm', null);
      } else {
        const f = parseFloat(val) || 0;
        const i = parseFloat(inches) || 0;
        updateField('height_cm', (f * 12 + i) * 2.54);
      }
    } else if (type === 'in') {
      if (!val && !feet) {
        updateField('height_cm', null);
      } else {
        const f = parseFloat(feet) || 0;
        const i = parseFloat(val) || 0;
        updateField('height_cm', (f * 12 + i) * 2.54);
      }
    }
  };

  const activityLevels = [
    { id: 'sedentary', label: 'Sedentary', desc: 'Little or no exercise, desk job' },
    { id: 'lightly_active', label: 'Lightly active', desc: 'Light exercise 1–3 days/week' },
    { id: 'moderately_active', label: 'Moderately active', desc: 'Moderate exercise 3–5 days/week' },
    { id: 'very_active', label: 'Very active', desc: 'Hard exercise 6–7 days/week' },
    { id: 'extra_active', label: 'Extra active', desc: 'Very hard exercise, physical job, or training twice/day' },
  ];

  const headerRight = (
    <Pressable onPress={handleClearProfile}>
      <Text style={{ color: Colors.error, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' }}>Clear All</Text>
    </Pressable>
  );

  if (loading && !localProfile) {
    return (
      <ScreenShell title="User Profile" subtitle="Loading..." onBack={onBack} />
    );
  }

  return (
    <ScreenShell
      title="User Profile"
      subtitle="Used to estimate your daily calorie target on the Weight tab."
      onBack={onBack}
      headerRight={headerRight}
    >

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
        {Platform.OS === 'web' ? (
          <input
            type="date"
            value={localProfile?.date_of_birth || ''}
            max={todayDobMax}
            onChange={(e) => {
              const val = e.target.value;
              if (!val || val > todayDobMax) return;
              updateField('date_of_birth', val);
            }}
            style={webDateInputStyle}
          />
        ) : (
          <>
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
                onDismiss={() => setShowDatePicker(false)}
                maximumDate={new Date()}
              />
            )}
          </>
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

// Plain DOM style object for the web-only <input type="date"> (react-native-web
// renders this as a real HTML element, so it takes CSS, not an RN StyleSheet).
const webDateInputStyle = {
  backgroundColor: Colors.inputBackground,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: Colors.cardBorder,
  borderRadius: 12,
  padding: 16,
  fontSize: 16,
  fontWeight: '700',
  color: Colors.text,
  width: '100%',
  boxSizing: 'border-box',
};

const styles = StyleSheet.create({
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
    ...InputStyle,
    fontWeight: '700',
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
