import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/UI';
import { Alert } from '../../lib/platformAlert';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { listConnections, revokeConnection } from '../../lib/mcpAuthorization';
import { useThemedStyles } from '../../theme/ThemeContext';
import { TYPOGRAPHY } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { CONNECTIONS_COPY as COPY } from './mcpCopy';

// Account -> Connected AI clients (#1626). Lists the signed-in user's OAuth
// grants and revokes exactly the selected client after an explicit confirmation.
// Success is shown only after Auth confirms; a failure keeps the row. Everything
// is bound to the current user id: a user change or unmount drops any response
// still in flight, so one account's clients never render under another.
//
// With no grants and no load error the section renders nothing, so accounts that
// never used the feature (and builds whose Auth project has no OAuth server) see
// no change in Account.
export function McpConnectedClients({ userId, getClient = getSupabaseClient }) {
  const styles = useThemedStyles(createStyles);
  const [loadState, setLoadState] = useState('loading');
  const [connections, setConnections] = useState([]);
  const [pendingId, setPendingId] = useState(null);
  const [notice, setNotice] = useState('');
  const seqRef = useRef(0);
  const userRef = useRef(userId);
  userRef.current = userId;

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    const forUser = userRef.current;
    setLoadState('loading');
    const result = await listConnections(getClient());
    if (seq !== seqRef.current || userRef.current !== forUser) return;
    if (result.ok) {
      setConnections(result.connections);
      setLoadState('ready');
    } else {
      setConnections([]);
      setLoadState('failed');
    }
  }, [getClient]);

  useEffect(() => {
    setConnections([]);
    setPendingId(null);
    setNotice('');
    if (!userId) {
      seqRef.current += 1;
      return undefined;
    }
    load();
    return () => { seqRef.current += 1; };
  }, [userId, load]);

  const disconnect = useCallback(async (connection) => {
    const seq = ++seqRef.current;
    const forUser = userRef.current;
    setPendingId(connection.clientId);
    setNotice('');
    const result = await revokeConnection(getClient(), connection.clientId);
    if (seq !== seqRef.current || userRef.current !== forUser) return;
    setPendingId(null);
    if (!result.ok) {
      setNotice(COPY.revokeFailed(connection.name));
      return;
    }
    // Only now, after the server confirmed, does the row leave the list.
    setConnections((prev) => prev.filter((item) => item.clientId !== connection.clientId));
    setNotice(COPY.revoked(connection.name));
  }, [getClient]);

  const confirmDisconnect = (connection) => {
    Alert.alert(COPY.confirmTitle, COPY.confirmBody(connection.name), [
      { text: COPY.cancel, style: 'cancel' },
      { text: COPY.disconnect, style: 'destructive', onPress: () => disconnect(connection) },
    ]);
  };

  if (!userId) return null;
  if (loadState === 'loading' && connections.length === 0 && !notice) return null;
  if (loadState === 'ready' && connections.length === 0 && !notice) return null;

  return (
    <View style={styles.block} testID="mcp-connected-clients">
      <Text style={styles.heading} accessibilityRole="header">{COPY.title}</Text>
      <Text style={styles.note}>{COPY.note}</Text>
      {loadState === 'failed' ? (
        <>
          <Text style={styles.note}>{COPY.loadFailed}</Text>
          <Button title={COPY.retry} onPress={load} accessibilityLabel="Retry loading connected AI clients" />
        </>
      ) : null}
      {connections.map((connection) => (
        <View key={connection.clientId} style={styles.row} testID={`mcp-connection-${connection.clientId}`}>
          <View style={styles.rowText}>
            <Text style={styles.name} selectable>{connection.name}</Text>
            {connection.grantedAt ? (
              <Text style={styles.meta}>Connected {connection.grantedAt.slice(0, 10)}</Text>
            ) : null}
          </View>
          <Button
            title={COPY.disconnect}
            loadingTitle={COPY.working}
            loading={pendingId === connection.clientId}
            disabled={pendingId !== null}
            onPress={() => confirmDisconnect(connection)}
            tone="danger"
            accessibilityLabel={`Disconnect ${connection.name}`}
          />
        </View>
      ))}
      {notice ? <Text style={styles.note} accessibilityLiveRegion="polite" testID="mcp-connection-notice">{notice}</Text> : null}
    </View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  block: {
    gap: 10,
    marginTop: 16,
  },
  heading: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '500',
    textTransform: 'uppercase',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  note: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    lineHeight: 22,
    color: kua ? kua.onSurface : colors.text,
  },
  row: {
    gap: 8,
    padding: 12,
    borderRadius: GEOMETRY['radius-sm'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  rowText: {
    gap: 2,
  },
  name: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
    flexShrink: 1,
  },
  meta: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
});
