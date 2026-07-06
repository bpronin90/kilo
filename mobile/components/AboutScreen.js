import React, { useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle, Button } from './UI';
import { Colors } from '../theme/colors';
import pkg from '../package.json';

export function AboutScreen({ onBack }) {
  const { currentlyRunning, isUpdateAvailable, isUpdatePending, isChecking } = useUpdates();
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const handleCheckForUpdate = async () => {
    setChecking(true);
    setCheckResult(null);
    setDownloaded(false);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setCheckResult('Downloading update...');
        const fetchResult = await Updates.fetchUpdateAsync();
        if (fetchResult.isNew) {
          setDownloaded(true);
          setCheckResult('Update downloaded — restart to apply.');
        } else {
          setCheckResult('Already up to date.');
        }
      } else {
        setCheckResult('Already up to date.');
      }
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
    <ScreenShell title="About" subtitle="App information and attribution." onBack={onBack}>

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
        {isUpdateAvailable && !isUpdatePending ? (
          <View style={[styles.diagRow, styles.diagAlert]}>
            <Text style={styles.diagAlertText}>Update available.</Text>
          </View>
        ) : null}
        {downloaded && !isUpdatePending ? (
          <Button
            title="Restart to Apply"
            onPress={() => Updates.reloadAsync()}
            style={styles.diagButton}
          />
        ) : !isUpdatePending ? (
          <Button
            title="Check for Update"
            loadingTitle="Checking…"
            onPress={handleCheckForUpdate}
            disabled={checking}
            style={styles.diagButton}
          />
        ) : null}
        {checkResult ? (
          <Text style={styles.diagCheckResult}>{checkResult}</Text>
        ) : null}
      </Card>

      <View style={styles.legalLinks}>
        <Text
          style={styles.legalLink}
          onPress={() => Linking.openURL('https://bpronin90.github.io/privacy.html')}
          accessibilityLabel="Privacy Policy"
          accessibilityRole="link"
        >
          Privacy Policy
        </Text>
        <Text style={styles.legalSep}>·</Text>
        <Text
          style={styles.legalLink}
          onPress={() => Linking.openURL('https://bpronin90.github.io/terms.html')}
          accessibilityLabel="Terms of Service"
          accessibilityRole="link"
        >
          Terms of Service
        </Text>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
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
  helpText: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
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
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  legalLink: {
    fontSize: 13,
    color: Colors.textMuted,
    textDecorationLine: 'underline',
  },
  legalSep: {
    fontSize: 13,
    color: Colors.textMuted,
  },
});
