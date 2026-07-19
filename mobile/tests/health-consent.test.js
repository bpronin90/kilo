// Health-data consent: copy fidelity, the affirmative act, and denial handling (#487).
//
// Rendered with react-test-renderer, matching the existing UI suites (this repo
// does not carry @testing-library/react-native).

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { createHash } from 'crypto';

import {
  CONSENT_COPY,
  WITHDRAWAL_COPY,
  CONSENT_PROTOCOL_VERSION,
  DENIAL_CODES,
  canonicalConsentText,
  isConsentDenial,
} from '../storage/cloud/consent';
import {
  CONSENT_PROTOCOL_HEADER,
  CONSENT_PROTOCOL_VERSION as CLIENT_PROTOCOL_VERSION,
} from '../lib/supabaseClient';

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

// The digest the database seeded for catalog revision 1, from
// supabase/migrations/20260714120001_consent_schema.sql.
const SEEDED_COPY_SHA256 =
  '4a4eb51eea8df80e1eec7355f3c44a1dd06705583a64841061aa24d5788396fa';

const ACTIVE_REVISION = {
  catalog_revision: 1,
  material_version: 1,
  privacy_policy_url: 'https://bpronin90.github.io/kilo/privacy.html',
};

// Find a rendered node by accessibilityLabel.
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

beforeEach(() => {
  jest.clearAllMocks();
  fetchActiveConsentRevision.mockResolvedValue(ACTIVE_REVISION);
  grantConsent.mockResolvedValue({ ok: true, status: 'granted' });
});

describe('consent copy is a legal artifact, not UI copy', () => {
  // The most important test in this file. Every grant records the digest of this
  // text as the evidence of what the user agreed to. If someone "improves" the
  // wording in the app without minting a new catalog revision, the stored evidence
  // would describe copy that was never shown, and Kilo's Art. 7(1) record would be
  // a record of the wrong thing. This fails the moment the two drift apart.
  it('renders text that hashes to the digest recorded in the consent catalog', () => {
    const digest = createHash('sha256').update(canonicalConsentText(), 'utf8').digest('hex');
    expect(digest).toBe(SEEDED_COPY_SHA256);
  });

  it('uses the exact approved title, actions, and US / SCC / retention disclosure', () => {
    expect(CONSENT_COPY.title).toBe('Store health data in the cloud?');
    expect(CONSENT_COPY.primaryAction).toBe('Agree and enable Cloud Sync');
    expect(CONSENT_COPY.secondaryAction).toBe('Not now');

    expect(CONSENT_COPY.disclosure).toContain('United States');
    expect(CONSENT_COPY.disclosure).toContain('EU Standard Contractual Clauses');
    expect(CONSENT_COPY.disclosure).toContain('six years after account deletion');
    expect(CONSENT_COPY.disclosure).toContain('no health entries, notes, or measurements');

    expect(CONSENT_COPY.disclosure).toContain('body-weight entries');
    expect(CONSENT_COPY.disclosure).toContain('current and archived weight goals');
    expect(CONSENT_COPY.disclosure).toContain('tracked lifts and workout notes');
    expect(CONSENT_COPY.disclosure).toContain('deload notes and history, and fatigue-tracking data');
  });

  it('uses the exact approved withdrawal copy', () => {
    expect(WITHDRAWAL_COPY.title).toBe('Withdraw cloud health-data consent?');
    expect(WITHDRAWAL_COPY.primaryAction).toBe('Withdraw consent and delete cloud data');
    expect(WITHDRAWAL_COPY.secondaryAction).toBe('Keep Cloud Sync on');
    // The control must promise deletion, not a pause, and must promise the local
    // copy survives.
    expect(WITHDRAWAL_COPY.body).toContain('delete');
    expect(WITHDRAWAL_COPY.body).toContain('Your on-device data and Kilo account will remain');
  });
});

describe('the affirmative act', () => {
  it('starts unchecked with the primary action disabled', async () => {
    const tree = await renderConsent();

    // A pre-ticked box is not consent (EDPB). It must start unchecked, and the
    // primary action must be unreachable until the user ticks it themselves.
    const checkbox = byLabel(tree, CONSENT_COPY.affirmation);
    expect(checkbox.props.accessibilityState.checked).toBe(false);

    const agree = byLabel(tree, CONSENT_COPY.primaryAction);
    expect(agree.props.disabled).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain(CONSENT_COPY.primaryAction);
    expect(JSON.stringify(tree.toJSON())).not.toContain('Working…');
  });

  it('enables the primary action only after the affirmation is checked', async () => {
    const tree = await renderConsent();

    await act(async () => {
      byLabel(tree, CONSENT_COPY.affirmation).props.onPress();
    });

    expect(byLabel(tree, CONSENT_COPY.affirmation).props.accessibilityState.checked).toBe(true);
    expect(byLabel(tree, CONSENT_COPY.primaryAction).props.disabled).toBe(false);
  });

  it('shows Working… only while an actual grant request is pending', async () => {
    let resolveGrant;
    grantConsent.mockReturnValue(new Promise((resolve) => {
      resolveGrant = resolve;
    }));
    const tree = await renderConsent();

    await act(async () => {
      byLabel(tree, CONSENT_COPY.affirmation).props.onPress();
    });

    let pendingGrant;
    act(() => {
      pendingGrant = byLabel(tree, CONSENT_COPY.primaryAction).props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(JSON.stringify(tree.toJSON())).toContain('Working…');

    await act(async () => {
      resolveGrant({ ok: true, status: 'granted' });
      await pendingGrant;
    });
  });

  it('records no grant when the user declines', async () => {
    const onDecline = jest.fn();
    const tree = await renderConsent({ onDecline });

    await act(async () => {
      byLabel(tree, CONSENT_COPY.secondaryAction).props.onPress();
    });

    expect(grantConsent).not.toHaveBeenCalled();
    expect(onDecline).toHaveBeenCalled();
  });

  it('records the grant against the rendered catalog revision, and nothing else', async () => {
    const onGranted = jest.fn();
    const tree = await renderConsent({ onGranted, appVersion: '9.9.9' });

    await act(async () => {
      byLabel(tree, CONSENT_COPY.affirmation).props.onPress();
    });
    await act(async () => {
      await byLabel(tree, CONSENT_COPY.primaryAction).props.onPress();
    });

    expect(grantConsent).toHaveBeenCalled();

    const submitted = grantConsent.mock.calls[0][0];
    // The client submits the revision it displayed and NOTHING that constitutes
    // evidence — no wording, digest, timestamp, purpose, or material version. The
    // server resolves all of that from its own immutable catalog, so a tampered
    // client cannot record a grant for copy it never showed.
    expect(submitted.catalogRevision).toBe(1);
    expect(submitted).not.toHaveProperty('copy_sha256');
    expect(submitted).not.toHaveProperty('material_version');
    expect(submitted).not.toHaveProperty('occurred_at');
    expect(submitted).not.toHaveProperty('disclosure');

    expect(onGranted).toHaveBeenCalled();
  });

  it('leaves sync off and uploads nothing when the grant cannot be recorded', async () => {
    grantConsent.mockResolvedValue({ ok: false, error: 'network down' });
    const onGranted = jest.fn();
    const tree = await renderConsent({ onGranted });

    await act(async () => {
      byLabel(tree, CONSENT_COPY.affirmation).props.onPress();
    });
    await act(async () => {
      await byLabel(tree, CONSENT_COPY.primaryAction).props.onPress();
    });

    // An unrecorded client-side "yes" is not a lawful basis, so Cloud Sync must not
    // turn on and no health data may be queued behind it.
    expect(onGranted).not.toHaveBeenCalled();
    expect(byLabel(tree, 'Consent status').props.children).toContain('was not enabled');
  });

  it('tells a user whose purge is still running to wait, rather than failing vaguely', async () => {
    grantConsent.mockResolvedValue({
      ok: false,
      code: DENIAL_CODES.HEALTH_DATA_DELETION_PENDING,
    });
    const tree = await renderConsent();

    await act(async () => {
      byLabel(tree, CONSENT_COPY.affirmation).props.onPress();
    });
    await act(async () => {
      await byLabel(tree, CONSENT_COPY.primaryAction).props.onPress();
    });

    expect(byLabel(tree, 'Consent status').props.children).toContain('still being deleted');
  });
});

describe('protocol and denial codes', () => {
  it('advertises the same protocol version the client actually sends', () => {
    expect(CONSENT_PROTOCOL_VERSION).toBe(CLIENT_PROTOCOL_VERSION);
    expect(CONSENT_PROTOCOL_HEADER).toBe('X-Kilo-Consent-Protocol');
  });

  it('keeps the four server denial codes distinct', () => {
    // Collapsing these into one generic "sync failed" is how a user ends up unable
    // to tell "update the app" from "your data is being deleted".
    expect(DENIAL_CODES.CLIENT_UPDATE_REQUIRED).toBe('CLIENT_UPDATE_REQUIRED');
    expect(DENIAL_CODES.CONSENT_REQUIRED).toBe('CONSENT_REQUIRED');
    expect(DENIAL_CODES.CONSENT_VERSION_STALE).toBe('CONSENT_VERSION_STALE');
    expect(DENIAL_CODES.HEALTH_DATA_DELETION_PENDING).toBe('HEALTH_DATA_DELETION_PENDING');

    expect(isConsentDenial(DENIAL_CODES.CONSENT_REQUIRED)).toBe(true);
    expect(isConsentDenial(DENIAL_CODES.CONSENT_VERSION_STALE)).toBe(true);
    // These two are NOT resolvable by consenting, so they must not route the user
    // to the consent surface.
    expect(isConsentDenial(DENIAL_CODES.CLIENT_UPDATE_REQUIRED)).toBe(false);
    expect(isConsentDenial(DENIAL_CODES.HEALTH_DATA_DELETION_PENDING)).toBe(false);
  });
});
