import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Button, SectionTitle } from '../../components/UI';
import { useThemedStyles } from '../../theme/ThemeContext';
import {
  CONSENT_COPY,
  REVISION_INACTIVE,
  REVISION_MATCH,
  fetchActiveConsentRevision,
  grantConsent,
  matchConsentRevision,
} from '../../storage/cloud/consent';
import { TYPOGRAPHY } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';

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
  const styles = useThemedStyles(createStyles);
  // The affirmation is bound to the catalog revision it was given for, not a bare
  // boolean (issue #1483): if the displayed revision changes, the earlier tick no
  // longer counts and the user must affirm the new one.
  const [affirmedRevision, setAffirmedRevision] = useState(null);
  const [revision, setRevision] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const loadSeqRef = useRef(0);

  // A rejected fetch is a transport failure, not a revision: it leaves acceptance
  // blocked and offers a retry. Only the newest request may update state, so a
  // slow stale fetch cannot overwrite a retry (or land after unmount).
  const loadRevision = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    let active = null;
    let failed = false;
    try {
      active = await fetchActiveConsentRevision();
    } catch {
      active = null;
      failed = true;
    }
    if (!mountedRef.current || seq !== loadSeqRef.current) return;
    setRevision(active);
    setLoadFailed(failed);
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadRevision();
    return () => {
      mountedRef.current = false;
    };
  }, [loadRevision]);

  // Only a revision whose server wording is exactly the copy rendered below may be
  // affirmed or submitted. Loading, failed, and mismatched revisions block grant.
  const match = loading ? null : matchConsentRevision(revision);
  const supported = match === REVISION_MATCH.SUPPORTED;
  const displayedRevision = supported ? revision.catalog_revision : null;
  const affirmed = supported && affirmedRevision === displayedRevision;

  const handleAgree = async () => {
    if (!affirmed || busy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStatus('');
    try {
      let result;
      try {
        result = await grantConsent({
          // The revision that was actually on screen. The server re-resolves the
          // wording from this row, so the app cannot record a grant for copy it
          // never displayed.
          catalogRevision: displayedRevision,
          appVersion,
          platform: Platform.OS,
        });
      } catch {
        // Transport uncertainty is never consent: do not activate. The tick is
        // kept (the displayed revision is unchanged) so the user can retry.
        if (mountedRef.current) {
          setStatus('Cloud Sync was not enabled. Kilo could not reach the server to record your consent. Check your connection and try again. Nothing was uploaded.');
        }
        return;
      }

      if (!result.ok) {
        // Sync stays off and nothing is queued. Saying "enabled" here would be a
        // claim that Kilo has a lawful basis it does not have.
        if (result.code === REVISION_INACTIVE) {
          // The terms changed under us. Drop the affirmation and reload, so any
          // new revision has to be read and affirmed afresh.
          setAffirmedRevision(null);
          setStatus('Cloud Sync was not enabled. The consent terms changed. Nothing was uploaded.');
          await loadRevision();
          return;
        }
        setStatus(
          result.code === 'HEALTH_DATA_DELETION_PENDING'
            ? 'Your cloud health data is still being deleted. Try again once that finishes.'
            : 'Cloud Sync was not enabled. Your consent could not be recorded. Nothing was uploaded.',
        );
        return;
      }
      try {
        await onGranted?.(result);
      } catch {
        // The server confirmed the grant; only turning sync on failed. Do not
        // claim that no consent was recorded.
        if (mountedRef.current) {
          setStatus('Your consent was recorded, but Cloud Sync could not be turned on. Try again.');
        }
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  let revisionNotice = '';
  if (match === REVISION_MATCH.MISSING || match === REVISION_MATCH.MALFORMED) {
    revisionNotice = 'Cloud Sync is unavailable: the consent terms could not be loaded. Nothing was uploaded.';
  } else if (match === REVISION_MATCH.UNSUPPORTED) {
    revisionNotice = 'Cloud Sync is unavailable: the consent terms have changed. Update Kilo to review and accept them. Nothing was uploaded.';
  }

  const policyUrl = supported ? revision.privacy_policy_url : null;

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
        onPress={() => setAffirmedRevision(affirmed ? null : displayedRevision)}
        disabled={!supported}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: affirmed, disabled: !supported }}
        accessibilityLabel={CONSENT_COPY.affirmation}
      >
        <View style={[styles.checkbox, affirmed && styles.checkboxChecked]}>
          {affirmed ? <MaterialIcons name="check" size={16} style={styles.checkmark} accessible={false} /> : null}
        </View>
        <Text style={styles.affirmText}>{CONSENT_COPY.affirmation}</Text>
      </Pressable>

      <Button
        title={CONSENT_COPY.primaryAction}
        loadingTitle="Working…"
        loading={busy}
        disabled={!affirmed || busy}
        onPress={handleAgree}
        accessibilityLabel={CONSENT_COPY.primaryAction}
      />

      <Button
        title={CONSENT_COPY.secondaryAction}
        disabled={busy}
        onPress={() => onDecline?.()}
        accessibilityLabel={CONSENT_COPY.secondaryAction}
      />

      {revisionNotice ? (
        <Text style={styles.status} accessibilityLabel="Consent revision status">
          {revisionNotice}
        </Text>
      ) : null}

      {!loading && (loadFailed || match === REVISION_MATCH.MISSING) ? (
        <Button
          title="Retry"
          disabled={busy}
          onPress={loadRevision}
          accessibilityLabel="Retry loading consent terms"
        />
      ) : null}

      {status ? (
        <Text style={styles.status} accessibilityLabel="Consent status">
          {status}
        </Text>
      ) : null}
    </View>
  );
}

// Under the production KUA gate (`kua` supplied) the disclosure copy, policy
// link, and the affirmative-consent checkbox resolve through the selected court
// palette; outside the gate (`kua` null — isolated consent tests) they keep the
// legacy palette. The unchecked-by-default checkbox and its accessibility state
// are unaffected — only the resting/checked colors move to the court.
export const createStyles = (colors, kua = null) => StyleSheet.create({
  block: {
    gap: 12,
  },
  disclosure: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    color: kua ? kua.onSurface : colors.text,
    lineHeight: 22,
  },
  link: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    color: kua ? kua.primary : colors.accentText,
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
    borderRadius: GEOMETRY['radius-sm'],
    borderWidth: 2,
    borderColor: kua ? kua.onSurfaceVariant : colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    borderColor: kua ? kua.primary : colors.accent,
    backgroundColor: kua ? kua.primary : colors.accent,
  },
  checkmark: {
    color: kua ? kua.onPrimary : colors.onAccent,
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '700',
    lineHeight: 16,
  },
  affirmText: {
    flex: 1,
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    color: kua ? kua.onSurface : colors.text,
    lineHeight: 22,
  },
  status: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 8,
  },
});
