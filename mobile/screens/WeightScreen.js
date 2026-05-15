import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Button } from '../components/UI';
import { Colors } from '../theme/colors';

export function WeightScreen({ weightValue, setWeightValue, weightNote, setWeightNote, onSaveWeight, errorMessage, saving }) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Weight log</Text>
        <Text style={styles.subtitle}>Track your body weight over time.</Text>
      </View>
      <Card>
        {errorMessage ? (
          <Text style={styles.errorText}>{errorMessage}</Text>
        ) : null}
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
        <Button onPress={onSaveWeight} title="Save weigh-in" disabled={saving} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 120,
    gap: 16,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
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
