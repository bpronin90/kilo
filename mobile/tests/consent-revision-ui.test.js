// Consent revision ↔ displayed copy binding (issue #1483).
//
// The surface renders bundled CONSENT_COPY and submits a catalog revision fetched
// from the server. A grant is only valid evidence if that revision's stored
// wording is exactly what was on screen, so any revision this build cannot
// display — missing, malformed, or with different wording — must block acceptance,
// and a change of revision must invalidate an earlier affirmation.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import {
  CONSENT_COPY,
  REVISION_INACTIVE,
  REVISION_MATCH,
  matchConsentRevision,
} from '../storage/cloud/consent';

jest.mock('../storage/cloud/consent', () => {
  const actual = jest.requireActual('../storage/cloud/consent');
  return {
    ...actual,
    fetchActiveConsentRevision: jest.fn(),
    grantConsent: jest.fn(),
  };
});

const { fetchActiveConsentRevision, grantConsent } = require('../storage/cloud/consent');
const { HealthDataConsent } = require('../screens/more/HealthDataConsent');

const revisionFor = (n, overrides = {}) => ({
  catalog_revision: n,
  material_version: 1,
  consent_title: CONSENT_COPY.title,
  disclosure_copy: CONSENT_COPY.disclosure,
  affirmation_copy: CONSENT_COPY.affirmation,
  privacy_policy_url: 'https://bpronin90.github.io/kilo/privacy.html',
  ...overrides,
});

const CHANGED_COPY = revisionFor(2, {
  disclosure_copy: `${CONSENT_COPY.disclosure}\n\nKilo now also stores sleep data.`,
});

function byLabel(tree, label) {
  return tree.root.findAll(
    (n) => n.props && n.props.accessibilityLabel === label,
    { deep: true },
  )[0];
}

async function renderConsent(props = {}) {
  let tree;
  await act(async () => {
    tree = renderer.create(<HealthDataConsent {...props} />);
  });
  return tree;
}

async function tickAndAgree(tree) {
  await act(async () => {
    byLabel(tree, CONSENT_COPY.affirmation).props.onPress();
  });
  await act(async () => {
    await byLabel(tree, CONSENT_COPY.primaryAction).props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  grantConsent.mockResolvedValue({ ok: true, status: 'granted' });
});

describe('matchConsentRevision', () => {
  it.each([
    ['matching', revisionFor(1), REVISION_MATCH.SUPPORTED],
    ['a later revision with identical wording', revisionFor(7), REVISION_MATCH.SUPPORTED],
    ['missing', null, REVISION_MATCH.MISSING],
    ['undefined', undefined, REVISION_MATCH.MISSING],
    ['a non-object', 'rev-1', REVISION_MATCH.MALFORMED],
    ['a string revision number', revisionFor('1'), REVISION_MATCH.MALFORMED],
    ['a zero revision number', revisionFor(0), REVISION_MATCH.MALFORMED],
    ['a fractional revision number', revisionFor(1.5), REVISION_MATCH.MALFORMED],
    ['no copy fields', { catalog_revision: 1 }, REVISION_MATCH.MALFORMED],
    ['a null affirmation', revisionFor(1, { affirmation_copy: null }), REVISION_MATCH.MALFORMED],
    ['changed disclosure', CHANGED_COPY, REVISION_MATCH.UNSUPPORTED],
    ['changed title', revisionFor(2, { consent_title: 'Sync?' }), REVISION_MATCH.UNSUPPORTED],
    ['whitespace-only drift', revisionFor(1, { affirmation_copy: `${CONSENT_COPY.affirmation} ` }), REVISION_MATCH.UNSUPPORTED],
  ])('%s → %s', (_label, revision, expected) => {
    expect(matchConsentRevision(revision)).toBe(expected);
  });
});

describe('a revision this build cannot display blocks acceptance', () => {
  it.each([
    ['unknown wording', CHANGED_COPY, 'Update Kilo'],
    ['missing', null, 'could not be loaded'],
    ['malformed', { catalog_revision: 'x' }, 'could not be loaded'],
  ])('%s: never grants and never calls onGranted', async (_label, fetched, notice) => {
    fetchActiveConsentRevision.mockResolvedValue(fetched);
    const onGranted = jest.fn();
    const tree = await renderConsent({ onGranted });

    // Approved copy still renders verbatim; nothing is invented.
    expect(byLabel(tree, 'Health data disclosure').props.children).toBe(CONSENT_COPY.disclosure);
    expect(byLabel(tree, 'Consent revision status').props.children).toContain(notice);
    expect(byLabel(tree, CONSENT_COPY.affirmation).props.disabled).toBe(true);

    await tickAndAgree(tree);

    expect(byLabel(tree, CONSENT_COPY.affirmation).props.accessibilityState.checked).toBe(false);
    expect(byLabel(tree, CONSENT_COPY.primaryAction).props.disabled).toBe(true);
    expect(grantConsent).not.toHaveBeenCalled();
    expect(onGranted).not.toHaveBeenCalled();
    // No policy link for terms we are not presenting.
    expect(byLabel(tree, CONSENT_COPY.privacyPolicyLabel)).toBeUndefined();
  });

  it('treats a failed fetch as a block, not permission', async () => {
    fetchActiveConsentRevision.mockRejectedValue(new Error('network down'));
    const onGranted = jest.fn();
    const tree = await renderConsent({ onGranted });

    await tickAndAgree(tree);

    expect(grantConsent).not.toHaveBeenCalled();
    expect(onGranted).not.toHaveBeenCalled();
    expect(byLabel(tree, 'Consent revision status').props.children).toContain('could not be loaded');
  });

  it('blocks acceptance while the revision is still loading', async () => {
    let resolveFetch;
    fetchActiveConsentRevision.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    const onGranted = jest.fn();
    const tree = await renderConsent({ onGranted });

    await tickAndAgree(tree);
    expect(grantConsent).not.toHaveBeenCalled();
    expect(byLabel(tree, CONSENT_COPY.affirmation).props.accessibilityState.checked).toBe(false);

    // Once loaded, the earlier tap does not carry over: still unchecked.
    await act(async () => {
      resolveFetch(revisionFor(1));
    });
    expect(byLabel(tree, CONSENT_COPY.affirmation).props.accessibilityState.checked).toBe(false);
    expect(byLabel(tree, CONSENT_COPY.primaryAction).props.disabled).toBe(true);
    expect(onGranted).not.toHaveBeenCalled();
  });

  it('keeps decline local-only for an unsupported revision', async () => {
    fetchActiveConsentRevision.mockResolvedValue(CHANGED_COPY);
    const onDecline = jest.fn();
    const tree = await renderConsent({ onDecline });

    await act(async () => {
      byLabel(tree, CONSENT_COPY.secondaryAction).props.onPress();
    });
    expect(onDecline).toHaveBeenCalled();
    expect(grantConsent).not.toHaveBeenCalled();
  });
});

describe('a supported revision', () => {
  it('submits exactly the displayed revision after an explicit affirmation', async () => {
    fetchActiveConsentRevision.mockResolvedValue(revisionFor(3));
    const onGranted = jest.fn();
    const tree = await renderConsent({ onGranted });

    expect(byLabel(tree, 'Consent revision status')).toBeUndefined();
    expect(byLabel(tree, CONSENT_COPY.affirmation).props.accessibilityState.checked).toBe(false);

    await tickAndAgree(tree);

    expect(grantConsent).toHaveBeenCalledTimes(1);
    expect(grantConsent.mock.calls[0][0].catalogRevision).toBe(3);
    expect(onGranted).toHaveBeenCalledTimes(1);
  });
});

describe('a server rejection of a stale revision', () => {
  it('stays a failure and requires fresh affirmation of the new revision', async () => {
    fetchActiveConsentRevision
      .mockResolvedValueOnce(revisionFor(1))
      .mockResolvedValueOnce(revisionFor(2));
    grantConsent.mockResolvedValueOnce({ ok: false, code: REVISION_INACTIVE });
    const onGranted = jest.fn();
    const tree = await renderConsent({ onGranted });

    await tickAndAgree(tree);

    expect(onGranted).not.toHaveBeenCalled();
    expect(byLabel(tree, 'Consent status').props.children).toContain('consent terms changed');
    expect(fetchActiveConsentRevision).toHaveBeenCalledTimes(2);
    // The earlier tick was for revision 1; revision 2 must be affirmed afresh.
    expect(byLabel(tree, CONSENT_COPY.affirmation).props.accessibilityState.checked).toBe(false);
    expect(byLabel(tree, CONSENT_COPY.primaryAction).props.disabled).toBe(true);

    await tickAndAgree(tree);
    expect(grantConsent).toHaveBeenCalledTimes(2);
    expect(grantConsent.mock.calls[1][0].catalogRevision).toBe(2);
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it('blocks acceptance if the reloaded revision carries wording this build lacks', async () => {
    fetchActiveConsentRevision
      .mockResolvedValueOnce(revisionFor(1))
      .mockResolvedValueOnce(CHANGED_COPY);
    grantConsent.mockResolvedValueOnce({ ok: false, code: REVISION_INACTIVE });
    const onGranted = jest.fn();
    const tree = await renderConsent({ onGranted });

    await tickAndAgree(tree);
    await tickAndAgree(tree);

    expect(grantConsent).toHaveBeenCalledTimes(1);
    expect(onGranted).not.toHaveBeenCalled();
    expect(byLabel(tree, 'Consent revision status').props.children).toContain('Update Kilo');
  });
});
