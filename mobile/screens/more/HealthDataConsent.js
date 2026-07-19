import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, SectionTitle } from '../../components/UI';
import { Colors } from '../../theme/colors';
import { CONSENT_COPY, fetchActiveConsentRevision, grantConsent } from '../../storage/cloud/consent';

// The dedicated Art. 9(2)(a) explicit-consent surface (issue #487).
//
// This is a separate, deliberate step — not part of sign-up, not part of sign-in,
// and not something continued use can imply. The EDPB is explicit that silence,
// inactivity, and pre-ticked boxes are not consent, so:
//
//   * the checkbox starts UNCHECKED and is the affirmative act;
//   * the primary action is disabled until it is checked;
//   * closing the surface or choosing "Not now" records nothing and leaves Cloud
//     Sync off, with every local feature still working.
//
// The wording is reproduced verbatim from the approved catalog revision and must
// not be reworded here. The server records the digest of exactly this text as the
// evidence of what the user agreed to; health-consent.test.js fails if the two
// drift apart.
//
// Cloud Sync is enabled by the CALLER, and only after the server confirms the
// grant. A client-side "yes" that was never recorded is not a lawful basis, so a
// failed grant must leave sync off rather than optimistically queueing an upload.
export function HealthDataConsent({ onGranted, onDecline, appVersion }) {
  const [affirmed, setAffirmed] = useState(false);
  const [revision, setRevision] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const active = await fetchActiveConsentRevision();
      if (!cancelled) setRevision(active);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAgree = async () => {
    if (!affirmed || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await grantConsent({
        // The revision that was actually on screen. The server re-resolves the
        // wording from this row, so the app cannot record a grant for copy it
        // never displayed.
        catalogRevision: revision?.catalog_revision,
        appVersion,
        platform: Platform.OS,
      });

      if (!result.ok) {
        // Sync stays off and nothing is queued. Saying "enabled" here would be a
        // claim that Kilo has a lawful basis it does not have.
        setStatus(
          result.code === 'HEALTH_DATA_DELETION_PENDING'
            ? 'Your cloud health data is still being deleted. Try again once that finishes.'
            : 'Cloud Sync was not enabled — your consent could not be recorded. Nothing was uploaded.',
        );
        return;
      }
      await onGranted?.(result);
    } finally {
      setBusy(false);
    }
  };

  const policyUrl = revision?.privacy_policy_url;

  return (
    <View style={styles.block}>
      <SectionTitle>{CONSENT_COPY.title}</SectionTitle>

      <Text style={styles.disclosure} accessibilityLabel="Health data disclosure">
        {CONSENT_COPY.disclosure}
      </Text>

      {policyUrl ? (
        <Text
          style={styles.link}
          accessibilityRole="link"
          accessibilityLabel={CONSENT_COPY.privacyPolicyLabel}
          onPress={() => Linking.openURL(policyUrl)}
        >
          {CONSENT_COPY.privacyPolicyLabel}
        </Text>
      ) : null}

      {/* Unchecked by default. This tap is the affirmative act. */}
      <Pressable
        style={styles.affirmRow}
        onPress={() => setAffirmed((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: affirmed }}
        accessibilityLabel={CONSENT_COPY.affirmation}
      >
        <View style={[styles.checkbox, affirmed && styles.checkboxChecked]}>
          {affirmed ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <Text style={styles.affirmText}>{CONSENT_COPY.affirmation}</Text>
      </Pressable>

      <Button
        title={CONSENT_COPY.primaryAction}
        loadingTitle="Working…"
        loading={busy}
        disabled={!affirmed || busy || !revision}
        onPress={handleAgree}
        accessibilityLabel={CONSENT_COPY.primaryAction}
      />

      <Button
        title={CONSENT_COPY.secondaryAction}
        disabled={busy}
        onPress={() => onDecline?.()}
        accessibilityLabel={CONSENT_COPY.secondaryAction}
      />

      {status ? (
        <Text style={styles.status} accessibilityLabel="Consent status">
          {status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 12,
  },
  disclosure: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
  },
  link: {
    fontSize: 15,
    color: Colors.accent,
    textDecorationLine: 'underline',
  },
  affirmRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent,
  },
  checkmark: {
    color: Colors.background,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  affirmText: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
  },
  status: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 8,
  },
});
