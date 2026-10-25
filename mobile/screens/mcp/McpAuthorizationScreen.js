import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/UI';
import { AccountScreen } from '../more/AccountScreen';
import { useThemedStyles } from '../../theme/ThemeContext';
import { TYPOGRAPHY } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { DISCLOSURE, STATE_COPY } from './mcpCopy';

// Full-shell surface for an external MCP client's authorization request (#1626).
// Rendered over the mounted tabs so local data and startup keep working beneath
// it. Client metadata is attacker-chosen: it is shown only as plain, truncated
// text, selectable but never interpreted.
function Notice({ styles, copy, children }) {
  return (
    <View style={styles.block} accessibilityLiveRegion="polite">
      <Text style={styles.title} accessibilityRole="header">{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      {children}
    </View>
  );
}

function Disclosure({ styles, details, consentMissing, submitting, failed, onApprove, onDeny }) {
  return (
    <View style={styles.block}>
      <Text style={styles.title} accessibilityRole="header">{DISCLOSURE.title}</Text>
      <View style={styles.panel} testID="mcp-client-identity">
        <Text style={styles.label}>CLIENT</Text>
        <Text style={styles.clientName} selectable testID="mcp-client-name">{details.clientName}</Text>
        {details.redirectHost ? (
          <Text style={styles.host} selectable testID="mcp-client-host">Returns to {details.redirectHost}</Text>
        ) : null}
        <Text style={styles.muted}>{DISCLOSURE.clientNotice}</Text>
      </View>
      {consentMissing ? (
        <Text style={styles.body} testID="mcp-consent-missing">{STATE_COPY.consentMissing.body}</Text>
      ) : (
        <>
          <Text style={styles.body} testID="mcp-disclosure-access">{DISCLOSURE.access}</Text>
          <Text style={styles.body} testID="mcp-disclosure-transmission">{DISCLOSURE.transmission}</Text>
          <Text style={styles.body} testID="mcp-disclosure-disconnect">{DISCLOSURE.disconnect}</Text>
        </>
      )}
      {failed ? <Text style={styles.error} accessibilityLiveRegion="polite">{STATE_COPY.decisionFailed}</Text> : null}
      <View style={styles.actions}>
        {consentMissing ? null : (
          <Button
            title={DISCLOSURE.approve}
            loadingTitle="Working…"
            loading={submitting}
            disabled={submitting}
            onPress={onApprove}
            accessibilityLabel="Approve this AI client"
          />
        )}
        <Button
          title={DISCLOSURE.deny}
          disabled={submitting}
          style={styles.secondaryButton}
          textStyle={styles.secondaryButtonText}
          onPress={onDeny}
          accessibilityLabel="Deny this AI client"
        />
      </View>
    </View>
  );
}

export function McpAuthorizationScreen({ mcp, auth }) {
  const styles = useThemedStyles(createStyles);
  const { phase, details, error } = mcp;
  const close = <Button title="Close" style={styles.secondaryButton} textStyle={styles.secondaryButtonText} onPress={mcp.dismiss} accessibilityLabel="Close this request" />;

  let body;
  if (phase === 'signed_out') {
    // The existing sign-in surface, unchanged. GitHub sign-in returns to the
    // origin root; the hook resumes the stored request from there.
    return (
      <View style={styles.root} testID="mcp-authorization-screen">
        <View style={styles.signInIntro}>
          <Text style={styles.title} accessibilityRole="header">{STATE_COPY.signedOut.title}</Text>
          <Text style={styles.body}>{STATE_COPY.signedOut.body}</Text>
        </View>
        <AccountScreen auth={auth} onBack={mcp.dismiss} />
      </View>
    );
  }
  if (phase === 'ready' || phase === 'consent_missing' || phase === 'submitting') {
    body = (
      <Disclosure
        styles={styles}
        details={details}
        consentMissing={phase === 'consent_missing'}
        submitting={phase === 'submitting'}
        failed={error === 'decision_failed'}
        onApprove={mcp.approve}
        onDeny={mcp.deny}
      />
    );
  } else if (phase === 'error' && error === 'unavailable') {
    body = (
      <Notice styles={styles} copy={STATE_COPY.unavailable}>
        <View style={styles.actions}>
          <Button title="Try again" onPress={mcp.retry} accessibilityLabel="Try the request again" />
          {close}
        </View>
      </Notice>
    );
  } else if (phase === 'error') {
    body = <Notice styles={styles} copy={STATE_COPY.gone}><View style={styles.actions}>{close}</View></Notice>;
  } else if (phase === 'invalid') {
    body = <Notice styles={styles} copy={STATE_COPY.invalid}><View style={styles.actions}>{close}</View></Notice>;
  } else if (phase === 'ended') {
    body = <Notice styles={styles} copy={STATE_COPY.ended}><View style={styles.actions}>{close}</View></Notice>;
  } else if (phase === 'redirecting') {
    body = <Notice styles={styles} copy={STATE_COPY.redirecting} />;
  } else {
    body = <Notice styles={styles} copy={STATE_COPY.loading} />;
  }

  return (
    <View style={styles.root} testID="mcp-authorization-screen">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </View>
  );
}

export const createStyles = (colors, kua = null) => StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: kua ? kua.background : colors.background,
    zIndex: 50,
  },
  scroll: {
    padding: 16,
    paddingTop: 32,
    alignItems: 'center',
  },
  block: {
    width: '100%',
    maxWidth: 560,
    gap: 12,
  },
  signInIntro: {
    paddingHorizontal: 16,
    paddingTop: 24,
    gap: 8,
  },
  title: {
    fontSize: TYPOGRAPHY['headline-md']?.fontSize ?? 22,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  body: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    lineHeight: 22,
    color: kua ? kua.onSurface : colors.text,
  },
  muted: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    lineHeight: 22,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  error: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    lineHeight: 22,
    color: colors.error,
  },
  label: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '500',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  panel: {
    gap: 4,
    padding: 16,
    borderRadius: GEOMETRY['radius-sm'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  clientName: {
    fontSize: 18,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
    // Long unbroken names wrap instead of widening the column.
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  host: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    color: kua ? kua.onSurface : colors.text,
    flexShrink: 1,
  },
  actions: {
    gap: 12,
    marginTop: 4,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: kua ? kua.onSurface : colors.text,
  },
  secondaryButtonText: {
    color: kua ? kua.onSurface : colors.text,
  },
});
