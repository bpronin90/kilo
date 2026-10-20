// Consent transport failures (issue #1491): rejected revision fetch / grant
// transport / post-grant activation are separate stages, each handled explicitly.
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { CONSENT_COPY } from '../storage/cloud/consent';

jest.mock('../storage/cloud/consent', () => {
  const actual = jest.requireActual('../storage/cloud/consent');
  return { ...actual, fetchActiveConsentRevision: jest.fn(), grantConsent: jest.fn() };
});

const { fetchActiveConsentRevision, grantConsent } = require('../storage/cloud/consent');
const { HealthDataConsent } = require('../screens/more/HealthDataConsent');

const revision = {
  catalog_revision: 1,
  material_version: 1,
  consent_title: CONSENT_COPY.title,
  disclosure_copy: CONSENT_COPY.disclosure,
  affirmation_copy: CONSENT_COPY.affirmation,
  privacy_policy_url: 'https://bpronin90.github.io/kilo/privacy.html',
};

const byLabel = (tree, label) =>
  tree.root.findAll((n) => n.props && n.props.accessibilityLabel === label, { deep: true })[0];
const text = (tree, label) => {
  const n = byLabel(tree, label);
  return n ? [].concat(n.props.children).join('') : '';
};

async function render(props = {}) {
  let tree;
  await act(async () => {
    tree = renderer.create(<HealthDataConsent {...props} />);
  });
  return tree;
}
const tick = (tree) => act(async () => { byLabel(tree, CONSENT_COPY.affirmation).props.onPress(); });
const agree = (tree) => act(async () => { await byLabel(tree, CONSENT_COPY.primaryAction).props.onPress(); });
const checked = (tree) => byLabel(tree, CONSENT_COPY.affirmation).props.accessibilityState.checked;
const primaryDisabled = (tree) => byLabel(tree, CONSENT_COPY.primaryAction).props.disabled;

beforeEach(() => {
  jest.clearAllMocks();
  fetchActiveConsentRevision.mockResolvedValue(revision);
  grantConsent.mockResolvedValue({ ok: true, status: 'granted' });
});

describe('revision fetch rejection', () => {
  it('blocks acceptance, offers retry, and a retry loads the revision', async () => {
    fetchActiveConsentRevision.mockRejectedValueOnce(new Error('network'));
    const tree = await render();
    expect(byLabel(tree, 'Retry loading consent terms')).toBeTruthy();
    expect(primaryDisabled(tree)).toBe(true);
    expect(byLabel(tree, CONSENT_COPY.affirmation).props.disabled).toBe(true);

    await act(async () => { await byLabel(tree, 'Retry loading consent terms').props.onPress(); });
    expect(byLabel(tree, 'Retry loading consent terms')).toBeUndefined();
    await tick(tree);
    expect(primaryDisabled(tree)).toBe(false);
  });

  it('ignores a fetch that completes after unmount', async () => {
    let resolveFirst;
    fetchActiveConsentRevision.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    let tree;
    await act(async () => { tree = renderer.create(<HealthDataConsent />); });
    await act(async () => { tree.unmount(); });
    await act(async () => { resolveFirst(revision); });
  });

  it('does not let a stale rejected fetch overwrite a newer successful load', async () => {
    let rejectSecond;
    fetchActiveConsentRevision
      .mockRejectedValueOnce(new Error('first'))
      .mockImplementationOnce(() => new Promise((_r, rej) => { rejectSecond = rej; }))
      .mockResolvedValueOnce(revision);
    const tree = await render();
    const retry = () => byLabel(tree, 'Retry loading consent terms');
    // Request B (pending) then request C (succeeds); B rejects afterwards.
    await act(async () => { retry().props.onPress(); });
    await act(async () => { retry().props.onPress(); });
    expect(retry()).toBeUndefined();
    await act(async () => { rejectSecond(new Error('stale')); });
    expect(retry()).toBeUndefined();
    await tick(tree);
    expect(primaryDisabled(tree)).toBe(false);
  });
});

describe('grant transport rejection', () => {
  it('clears busy, keeps the tick, shows feedback, never activates, and allows retry', async () => {
    const onGranted = jest.fn();
    grantConsent.mockRejectedValueOnce(new Error('offline'));
    const tree = await render({ onGranted });
    await tick(tree);
    await agree(tree);
    expect(onGranted).not.toHaveBeenCalled();
    expect(text(tree, 'Consent status')).toMatch(/could not reach the server/);
    expect(text(tree, 'Consent status')).toMatch(/Nothing was uploaded/);
    expect(checked(tree)).toBe(true);
    expect(primaryDisabled(tree)).toBe(false);

    await agree(tree);
    expect(grantConsent).toHaveBeenCalledTimes(2);
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it('ignores duplicate presses while a grant is in flight', async () => {
    let resolveGrant;
    grantConsent.mockImplementationOnce(() => new Promise((r) => { resolveGrant = r; }));
    const tree = await render({ onGranted: jest.fn() });
    await tick(tree);
    const press = byLabel(tree, CONSENT_COPY.primaryAction).props.onPress;
    await act(async () => { press(); press(); });
    expect(grantConsent).toHaveBeenCalledTimes(1);
    await act(async () => { resolveGrant({ ok: true }); });
  });
});

describe('post-grant activation rejection', () => {
  it('does not claim no consent was recorded', async () => {
    const onGranted = jest.fn().mockRejectedValue(new Error('activation'));
    const tree = await render({ onGranted });
    await tick(tree);
    await agree(tree);
    const msg = text(tree, 'Consent status');
    expect(msg).toMatch(/consent was recorded/);
    expect(msg).not.toMatch(/not enabled|Nothing was uploaded/);
    expect(primaryDisabled(tree)).toBe(false);
  });
});
