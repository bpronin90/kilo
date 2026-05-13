import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button } from '../components/UI';
import { Colors } from '../theme/colors';

export function WeightScreen({ weightValue, setWeightValue, weightNote, setWeightNote, onSaveWeight }) {
  return (
    <ScreenShell
      title="Weight log"
      subtitle="Track your body weight over time."
    >
      <Card>
        <Text style={styles.inputLabel}>Weight (lb)</Text>
        <TextInput
          value={weightValue}
          onChangeText={setWeightValue}
          placeholder="185.0"
          placeholderTextColor={Colors.textMuted}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <Text style={styles.inputLabel}>Note</Text>
        <TextInput
          value={weightNote}
          onChangeText={setWeightNote}
          placeholder="Morning, fasted"
          placeholderTextColor={Colors.textMuted}
          style={styles.input}
        />
        <Button onPress={onSaveWeight} title="Save weigh-in" />
      </Card>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  input: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
  },
});
