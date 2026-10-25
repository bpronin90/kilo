// Account -> Connected AI clients (#1626): list, explicit-confirm revoke, truthful
// pending/failure states, and per-user binding against stale async completion.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../lib/platformAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const { Alert } = require('../lib/platformAlert');
const { McpConnectedClients } = require('../screens/mcp/McpConnectedClients');
const { revokeConnection, listConnections } = require('../lib/mcpAuthorization');

const GRANTS = [
  { client: { id: 'c1', name: 'Claude Code' }, scopes: ['openid'], granted_at: '2026-10-24T10:00:00Z' },
  { client: { id: 'c2', name: 'Other Client' }, scopes: ['openid'], granted_at: '2026-10-25T10:00:00Z' },
];

function makeClient(grants = GRANTS) {
  return {
    auth: {
      oauth: {
        listGrants: jest.fn().mockResolvedValue({ data: grants, error: null }),
        revokeGrant: jest.fn().mockResolvedValue({ data: null, error: null }),
      },
    },
  };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function textOf(node) {
  if (typeof node === 'string') return node;
  if (!node || !node.children) return '';
  return node.children.map(textOf).join('');
}

async function mount(client, userId = 'user-a') {
  let tree;
  await act(async () => { tree = renderer.create(<McpConnectedClients userId={userId} client={client} />); });
  await flush();
  return tree;
}

// Presses Disconnect on a row and confirms the dialog.
async function disconnect(tree, name) {
  act(() => { tree.root.findByProps({ accessibilityLabel: `Disconnect ${name}` }).props.onPress(); });
  const buttons = Alert.alert.mock.calls.at(-1)[2];
  await act(async () => { buttons.find((b) => b.text === 'Disconnect').onPress(); });
  await flush();
}

beforeEach(() => Alert.alert.mockClear());

describe('lib wrappers', () => {
  test('listConnections returns display fields only; failures are not success', async () => {
    const ok = await listConnections(makeClient());
    expect(ok).toEqual({ ok: true, connections: [
      { clientId: 'c1', name: 'Claude Code', grantedAt: '2026-10-24T10:00:00Z' },
      { clientId: 'c2', name: 'Other Client', grantedAt: '2026-10-25T10:00:00Z' },
    ] });
    const failing = makeClient();
    failing.auth.oauth.listGrants.mockResolvedValue({ data: null, error: { message: 'x' } });
    expect(await listConnections(failing)).toEqual({ ok: false });
    failing.auth.oauth.listGrants.mockRejectedValue(new Error('net'));
    expect(await listConnections(failing)).toEqual({ ok: false });
    expect(await listConnections(null)).toEqual({ ok: false });
  });

  test('revokeConnection succeeds only without an error and always names one client', async () => {
    const client = makeClient();
    expect(await revokeConnection(client, 'c1')).toEqual({ ok: true });
    expect(client.auth.oauth.revokeGrant).toHaveBeenCalledWith({ clientId: 'c1' });
    client.auth.oauth.revokeGrant.mockResolvedValue({ data: null, error: { message: 'x' } });
    expect(await revokeConnection(client, 'c1')).toEqual({ ok: false });
    client.auth.oauth.revokeGrant.mockRejectedValue(new Error('net'));
    expect(await revokeConnection(client, 'c1')).toEqual({ ok: false });
    expect(await revokeConnection(client, '')).toEqual({ ok: false });
  });
});

describe('McpConnectedClients', () => {
  test('lists the signed-in user\'s grants and separates sign-out from disconnect', async () => {
    const tree = await mount(makeClient());
    const text = textOf(tree.toJSON());
    expect(text).toContain('Connected AI clients');
    expect(text).toContain('Claude Code');
    expect(text).toContain('Other Client');
    expect(text).toMatch(/Signing out of Kilo is separate/);
    act(() => tree.unmount());
  });

  test('renders nothing when there are no grants or no user', async () => {
    const empty = await mount(makeClient([]));
    expect(empty.toJSON()).toBeNull();
    act(() => empty.unmount());
    const anon = await mount(makeClient(), null);
    expect(anon.toJSON()).toBeNull();
    act(() => anon.unmount());
  });

  test('a load failure is shown with a retry that recovers', async () => {
    const client = makeClient();
    client.auth.oauth.listGrants.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    const tree = await mount(client);
    expect(textOf(tree.toJSON())).toContain('Couldn’t load connected clients');
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Retry loading connected AI clients' }).props.onPress(); });
    await flush();
    expect(textOf(tree.toJSON())).toContain('Claude Code');
    act(() => tree.unmount());
  });

  test('revoke needs an explicit confirmation and Cancel revokes nothing', async () => {
    const client = makeClient();
    const tree = await mount(client);
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Disconnect Claude Code' }).props.onPress(); });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(client.auth.oauth.revokeGrant).not.toHaveBeenCalled();
    const buttons = Alert.alert.mock.calls[0][2];
    act(() => { buttons.find((b) => b.text === 'Cancel').onPress?.(); });
    expect(client.auth.oauth.revokeGrant).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  test('confirmed revoke targets only the selected client; success shows after the server confirms', async () => {
    const client = makeClient();
    let resolveRevoke;
    client.auth.oauth.revokeGrant.mockReturnValue(new Promise((resolve) => { resolveRevoke = resolve; }));
    const tree = await mount(client);
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Disconnect Claude Code' }).props.onPress(); });
    const buttons = Alert.alert.mock.calls[0][2];
    await act(async () => { buttons.find((b) => b.text === 'Disconnect').onPress(); });
    // Pending: the row is still listed and no success claim exists yet.
    expect(client.auth.oauth.revokeGrant).toHaveBeenCalledWith({ clientId: 'c1' });
    expect(textOf(tree.toJSON())).toContain('Claude Code');
    expect(textOf(tree.toJSON())).not.toContain('was disconnected');
    expect(textOf(tree.toJSON())).toContain('Disconnecting…');
    await act(async () => { resolveRevoke({ data: null, error: null }); });
    await flush();
    const after = textOf(tree.toJSON());
    expect(after).toContain('Claude Code was disconnected.');
    expect(tree.root.findAllByProps({ testID: 'mcp-connection-c1' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'mcp-connection-c2' }).length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  test('a failed revoke keeps the row and says it is still connected', async () => {
    const client = makeClient();
    client.auth.oauth.revokeGrant.mockResolvedValue({ data: null, error: { message: 'x' } });
    const tree = await mount(client);
    await disconnect(tree, 'Claude Code');
    const text = textOf(tree.toJSON());
    expect(text).toContain('It is still connected');
    expect(text).not.toContain('was disconnected');
    expect(tree.root.findAllByProps({ testID: 'mcp-connection-c1' }).length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  test('a revoke resolving after an account switch is dropped and User A\'s list never shows for User B', async () => {
    const client = makeClient();
    let resolveRevoke;
    client.auth.oauth.revokeGrant.mockReturnValue(new Promise((resolve) => { resolveRevoke = resolve; }));
    const tree = await mount(client, 'user-a');
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Disconnect Claude Code' }).props.onPress(); });
    await act(async () => { Alert.alert.mock.calls[0][2].find((b) => b.text === 'Disconnect').onPress(); });
    client.auth.oauth.listGrants.mockResolvedValue({ data: [], error: null });
    await act(async () => { tree.update(<McpConnectedClients userId="user-b" client={client} />); });
    await flush();
    await act(async () => { resolveRevoke({ data: null, error: null }); });
    await flush();
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
  });

  test('a list response arriving after unmount does not throw or update', async () => {
    const client = makeClient();
    let resolveList;
    client.auth.oauth.listGrants.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    const tree = await mount(client);
    act(() => tree.unmount());
    await act(async () => { resolveList({ data: GRANTS, error: null }); });
  });
});
