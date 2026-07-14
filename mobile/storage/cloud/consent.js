// Client side of the Art. 9(2)(a) explicit-consent flow (issue #487).
//
// Nothing in this file is the authorization boundary. The backend gate
// (kilo.health_gate_ok) decides what a request may touch, and it decides the same
// way whether or not the app ever calls preflight. What lives here is the part the
// backend cannot do: render the exact approved wording, capture the affirmative
// act, tell the server which revision was on screen, and turn a server denial into
// something a person can act on.
//
// The client deliberately does NOT submit wording, digests, timestamps, purposes,
// or material versions. It submits the catalog revision it rendered, and the
// server resolves everything else from its own immutable catalog. A tampered
// client therefore cannot record a grant that claims something different from what
// it actually displayed.

import { getSupabaseClient, CONSENT_PROTOCOL_VERSION } from '../../lib/supabaseClient';

// Re-exported so consent callers have one import. It is DECLARED in supabaseClient
// because that is where the header is actually attached to every request, and the
// client factory must not depend on this module (which depends on it).
export { CONSENT_PROTOCOL_VERSION };

// Server denial codes. Each maps to a distinct user-facing outcome, which is the
// point: "update your app", "you have not consented", "the terms changed", and
// "your data is being deleted" are four different situations, and collapsing them
// into one generic "sync failed" is how users end up unable to tell whether their
// data still exists.
export const DENIAL_CODES = Object.freeze({
  CLIENT_UPDATE_REQUIRED: 'CLIENT_UPDATE_REQUIRED',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  CONSENT_VERSION_STALE: 'CONSENT_VERSION_STALE',
  HEALTH_DATA_DELETION_PENDING: 'HEALTH_DATA_DELETION_PENDING',
  HEALTH_SYNC_PAUSED: 'HEALTH_SYNC_PAUSED',
});

// The exact approved copy from docs/article-9-explicit-consent-spec.md. It is
// reproduced verbatim, not paraphrased: the catalog stores the sha256 of
// `title \n\n disclosure \n\n affirmation`, every grant records that digest as
// evidence, and health-consent.test.js asserts this text still hashes to the value
// the database seeded. Reword any of it and that test fails — which is the intent.
// The wording is a legal artifact, not UI copy to be tuned.
export const CONSENT_COPY = Object.freeze({
  title: 'Store health data in the cloud?',

  disclosure: [
    "Cloud Sync stores the following health and fitness data in Kilo's Supabase-hosted cloud database in the United States so Kilo can sync it across your devices:",
    '',
    '- body-weight entries',
    '- current and archived weight goals',
    '- tracked lifts and workout notes',
    '- deload notes and history, and fatigue-tracking data',
    '',
    'You can keep using Kilo locally if you do not consent. You can withdraw at any time by turning off Cloud Sync. Kilo will then stop cloud processing and delete the cloud copy while keeping your on-device data. Supabase processes the data for Kilo under EU Standard Contractual Clauses. Kilo keeps a minimal pseudonymized record of your consent choices for six years after account deletion to demonstrate compliance; that record contains no health entries, notes, or measurements.',
  ].join('\n'),

  affirmation:
    'I explicitly consent to Kilo storing the health and fitness data listed above in its United States cloud database for cross-device sync.',

  primaryAction: 'Agree and enable Cloud Sync',
  secondaryAction: 'Not now',
  privacyPolicyLabel: 'Privacy Policy',
});

// The withdrawal confirmation. The control must say what it does: a generic "sync
// paused" that leaves the cloud copy intact is not a withdrawal, and telling a user
// their data is gone when it is not would be the more serious lie.
export const WITHDRAWAL_COPY = Object.freeze({
  title: 'Withdraw cloud health-data consent?',
  body: 'Kilo will stop syncing and delete your body-weight entries, current and archived weight goals, tracked lifts and workout notes, deload notes and history, and fatigue-tracking data from the cloud. Your on-device data and Kilo account will remain.',
  primaryAction: 'Withdraw consent and delete cloud data',
  secondaryAction: 'Keep Cloud Sync on',
});

// Exactly the string the server digests. Kept as a function so the test and any
// future verification hash the same bytes the surface renders.
export function canonicalConsentText(copy = CONSENT_COPY) {
  return [copy.title, copy.disclosure, copy.affirmation].join('\n\n');
}

const SCHEMA = 'kilo';

// Ask the server what this user may do. Returns { allowed, code, ... }.
//
// A failure to reach the server is NOT permission. It returns a denial, because a
// client that cannot confirm an active grant must behave exactly like a client that
// was told it does not have one.
export async function fetchConsentStatus(client = getSupabaseClient()) {
  if (!client) {
    return { allowed: false, code: 'CLOUD_NOT_CONFIGURED' };
  }
  const { data, error } = await client.schema(SCHEMA).rpc('health_sync_preflight');
  if (error) {
    return { allowed: false, code: 'PREFLIGHT_FAILED', error: error.message };
  }
  return data || { allowed: false, code: 'PREFLIGHT_FAILED' };
}

// The active catalog revision to render and cite. The app never invents this: the
// revision it displays is the revision it reports, and the server re-resolves the
// wording from that same row.
export async function fetchActiveConsentRevision(client = getSupabaseClient()) {
  if (!client) return null;
  const { data, error } = await client
    .schema(SCHEMA)
    .from('consent_revision')
    .select('catalog_revision, material_version, consent_title, disclosure_copy, affirmation_copy, privacy_policy_url, privacy_policy_revision')
    .eq('status', 'active')
    .order('catalog_revision', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// Record the grant. Cloud Sync must not turn on until this returns ok: an
// unrecorded client-side "yes" is not consent, and queuing health data behind one
// would upload under a lawful basis that does not exist yet.
export async function grantConsent(
  { catalogRevision, appVersion, platform },
  client = getSupabaseClient(),
) {
  if (!client) return { ok: false, error: 'Cloud is not configured.' };
  if (!catalogRevision) return { ok: false, error: 'No active consent revision.' };

  const { data, error } = await client.schema(SCHEMA).rpc('consent_grant', {
    p_catalog_revision: catalogRevision,
    p_app_version: appVersion ?? null,
    p_platform: platform ?? null,
  });

  if (error) {
    return { ok: false, error: error.message, code: mapPostgrestError(error) };
  }
  return { ok: true, ...data };
}

// Withdraw. The server blocks access and queues the purge atomically; this call
// returns once the user is in deletion_pending, not once the data is gone.
export async function withdrawConsent(client = getSupabaseClient()) {
  if (!client) return { ok: false, error: 'Cloud is not configured.' };

  const { data, error } = await client.schema(SCHEMA).rpc('consent_withdraw');
  if (error) {
    return { ok: false, error: error.message, code: mapPostgrestError(error) };
  }
  return { ok: true, ...data };
}

// Kick the purge worker so an ordinary withdrawal is erased now rather than at the
// next cron tick. Best-effort by design: the durable job is already queued, so a
// failure here delays the purge, it does not lose it.
export async function requestHealthDataDeletion(client = getSupabaseClient()) {
  if (!client) return { ok: false, error: 'Cloud is not configured.' };

  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return { ok: false, error: 'Not signed in.' };

  const { supabaseUrl } = getFunctionsBase(client);
  if (!supabaseUrl) return { ok: false, error: 'Cloud is not configured.' };

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/health-data-delete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    // 202 means the purge is still running and will be retried; that is a normal
    // outcome, not a failure the user should be asked to do anything about.
    if (res.status === 202) return { ok: true, pending: true, ...body };
    if (!res.ok) return { ok: false, error: body?.error || 'Deletion request failed.' };
    return { ok: true, ...body };
  } catch (e) {
    return { ok: false, error: e?.message || 'Deletion request failed.' };
  }
}

function getFunctionsBase(client) {
  // supabase-js does not expose the project URL directly; the REST url it was
  // constructed with is the same origin the Edge Functions live on.
  const restUrl = client?.rest?.url || client?.restUrl || '';
  const supabaseUrl = String(restUrl).replace(/\/rest\/v1\/?$/, '');
  return { supabaseUrl };
}

// PostgREST surfaces a RAISE from a SECURITY DEFINER function with the message and
// detail intact. The server puts the machine-readable code in `detail`, so the app
// keeps the distinct outcomes rather than flattening everything into one error.
function mapPostgrestError(error) {
  const detail = error?.details || error?.detail || '';
  for (const code of Object.keys(DENIAL_CODES)) {
    if (detail.includes(code) || (error?.message || '').includes(code)) return code;
  }
  return null;
}

// Is this denial one the user can resolve by consenting?
export function isConsentDenial(code) {
  return code === DENIAL_CODES.CONSENT_REQUIRED || code === DENIAL_CODES.CONSENT_VERSION_STALE;
}
