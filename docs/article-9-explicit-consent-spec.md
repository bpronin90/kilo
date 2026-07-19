# Article 9 Explicit Consent for Cloud Health Data

Status: revised after review; implementation remains blocked until this artifact
is reviewed and committed to the issue branch

Decision date: 2026-07-13

Policy dependency: issue #477

This is a product and engineering specification, not legal advice. It applies
privacy-by-design principles to the current Kilo scope and should be revisited
if the controller, processing purpose, health-data categories, cloud processor,
or supported jurisdictions change.

## Decision

Kilo will obtain GDPR Article 9(2)(a) explicit consent in a dedicated step when
an authenticated user first asks to enable Cloud Sync, before any health data
is uploaded or downloaded.

Account creation and health-data consent remain separate:

- A user may create and keep an account without consenting to cloud storage of
  health data.
- Refusing consent leaves all local features available and Cloud Sync off.
- Sign-in does not itself request or imply health-data consent.
- Consent is requested only when the user asks to enable Cloud Sync, or when an
  existing sync user must re-consent to the required material version.
- No health-data network operation may occur unless the backend confirms an
  active grant for the required material version.

This design binds the affirmative act to the processing it authorizes, avoids
adding friction to ordinary sign-up, and preserves Kilo's offline-first model.

## Legal and platform constraints used

- GDPR Article 7 requires Kilo to demonstrate consent, distinguish the request
  from other matters, and make withdrawal as easy as giving consent.
- GDPR Article 9(2)(a) requires explicit consent for one or more specified
  purposes before processing health data on that basis.
- Withdrawal ends the consent-based processing. If no other legal ground
  applies, Article 17 requires erasure without undue delay.
- GDPR Article 13(1)(f) requires disclosure of a third-country transfer and the
  safeguards used for it. Kilo's Supabase project is hosted in `us-west-2`; the
  consent surface and privacy policy therefore disclose storage in the United
  States and Supabase's EU Standard Contractual Clauses.
- The EDPB describes explicit consent as an express statement and says silence,
  inactivity, and pre-ticked boxes are insufficient. It also says consent is not
  freely given when refusal causes detriment.
- Supabase is Kilo's processor and Kilo remains the controller responsible for
  the lawful basis and data-subject response. The consent is given to Kilo, not
  to Supabase and not to the Supabase DPA.
- Google Play classifies health information and fitness information separately.
  Kilo's existing declaration identifies the scoped data as `Health and fitness
  -> Health info`; this flow does not change that classification or authorize a
  new purpose.

Authoritative references:

- [GDPR Articles 7, 9, and 17](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679)
- [EDPB: Consent under GDPR (April 2026)](https://www.edpb.europa.eu/system/files/2026-04/edpb-summary-consent_en.pdf)
- [European Commission: When is consent valid?](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/legal-grounds-processing-data/grounds-processing/when-consent-valid_en)
- [Supabase Data Processing Addendum](https://supabase.com/downloads/docs/Supabase%2BDPA%2B260601.pdf)
- [Google Play Data Safety data types](https://support.google.com/googleplay/android-developer/answer/10787469)

## Consent surface and exact copy

### Entry point

The existing Cloud Sync control remains off until consent exists. Tapping it
opens a dedicated consent surface. The surface is not part of account creation,
is not pre-accepted, and cannot be bypassed by signing in.

Use this exact title:

> Store health data in the cloud?

Use this exact disclosure:

> Cloud Sync stores the following health and fitness data in Kilo's
> Supabase-hosted cloud database in the United States so Kilo can sync it across
> your devices:
>
> - body-weight entries
> - current and archived weight goals
> - tracked lifts and workout notes
> - deload notes and history, and fatigue-tracking data
>
> You can keep using Kilo locally if you do not consent. You can withdraw at any
> time by turning off Cloud Sync. Kilo will then stop cloud processing and
> delete the cloud copy while keeping your on-device data. Supabase processes
> the data for Kilo under EU Standard Contractual Clauses. Kilo keeps a minimal
> pseudonymized record of your consent choices for six years after account
> deletion to demonstrate compliance; that record contains no health entries,
> notes, or measurements.

The surface must link `Privacy Policy` to the policy revision recorded with the
grant.

Use an unchecked checkbox with this exact affirmation:

> I explicitly consent to Kilo storing the health and fitness data listed above
> in its United States cloud database for cross-device sync.

Use these exact actions:

- Primary: `Agree and enable Cloud Sync`
- Secondary: `Not now`

The primary action is disabled until the user checks the affirmation. Closing
the surface or choosing `Not now` records no grant and leaves Cloud Sync off.
The app must not use a pre-checked control, acceptance inferred from continued
use, or an account/sign-in action as the affirmative act.

### Success and failure behavior

The app calls the server grant operation before enabling sync. After the server
returns the current active grant, a same-owner device runs its ordinary sync or
the server-signalled post-purge rebuild in the same session. Cloud Sync reports
that it is on only after that operation succeeds. A device with unclaimed or
foreign-owned local history stays local-only behind the explicit ownership
decision. If the grant cannot be recorded, the app stays local-only and explains
that Cloud Sync was not enabled; it must not queue health data for later upload
under an unrecorded client-side grant. If activation fails after a recorded
grant, local data remains intact and the UI exposes an honest retry state rather
than claiming that the cloud copy is current.

## Authoritative health-data boundary

Consent enforcement and purge operate on health data, not merely on tables
whose names look health-related. The live `kilo.user_profile` table is mixed and
must not remain so: it contains health or training state that would bypass a
table-level gate.

Move these columns out of `kilo.user_profile` into a dedicated consent-gated
`kilo.user_health_profile` table keyed by `user_id` with a
server-authoritative row-level `updated_at`:

- `current_deload_note_raw_text`
- `current_deload_note_saved_at`
- `current_deload_note_updated_at`
- `fatigue_multiplier`
- `tracked_lifts`
- `current_workout_note_id`

This is an expand/contract migration:

1. **Expand before the client rollout.** Create `user_health_profile`, backfill
   and verify all six values, but keep the source columns readable and writable.
   A database compatibility trigger mirrors legacy `user_profile` writes into
   the canonical health table. The new sync path writes the canonical table and,
   while `health_sync_mode=legacy`, mirrors the same values back for old-client
   reads. Reconciliation must report parity before rollout proceeds.
2. **Contract only after enforcement.** First enforce
   `minimum_consent_protocol_version` so clients that depend on the legacy
   columns cannot reach sync. Then verify parity again, drop all six source
   columns and the compatibility trigger/mirroring path, and verify current
   clients use only `user_health_profile`. The contract step is mandatory and
   is what makes “no compatibility copies in `user_profile`” the final state.

Compatibility semantics during expansion are fixed, not implementation choices:

- Both directional compatibility triggers act only when one of the six logical
  health values changed and return without mirroring when
  `pg_trigger_depth() > 1`. A mirror write therefore cannot re-enter the opposite
  trigger and ping-pong back.
- A genuine client write receives one server-authoritative `updated_at` from
  `kilo.set_updated_at()`. In the expand migration, replace only these two
  tables' timestamp triggers with a compatibility-aware wrapper: at trigger
  depth 1 it stamps `now()`, at nested mirror depth it preserves the originating
  `updated_at`, and it also preserves the incoming `updated_at` when the
  privileged reconciliation path signals a stamp suppression. The privileged
  mirror function carries that exact timestamp to the other table. Clients cannot
  invoke the nested mirror path, signal stamp suppression, or supply an
  authoritative timestamp. Mirror activity must never create a later timestamp or
  a phantom user edit; the contract migration restores the normal timestamp
  trigger on canonical `user_health_profile` after mirrors are removed.
- Conflicts use row-level last-write-wins on the preserved originating
  `updated_at`. A strictly later timestamp wins. On equal timestamps,
  `user_health_profile` is authoritative. Reconciliation copies the winning row
  to the losing side without restamping it and reports the conflict and outcome.
  Because reconciliation is a privileged write at trigger depth 1, it must run
  through the mirror path or an equivalent suppression signal that the wrapper
  honors; a plain `UPDATE` would restamp the losing row to `now()` and recreate
  the phantom-edit failure these rules exist to prevent.

Regression tests must prove bounded trigger depth, one mirror per genuine write,
identical timestamps on both copies, no timestamp change from reconciliation,
later-origin wins across old/new clients, and canonical-table wins on a tie.

During the expanded period, the six legacy columns remain health data. The
consent gate, quarantine, withdrawal purge, and account deletion must cover
both the canonical row and those legacy columns once enforcement activates.
The canonical table and the existing `weight_entries`, `weight_goal`,
`archived_weight_goals`, `workout_notes`, `deload_history`, and
`fatigue_checkins` tables form the final consent-gated health-data set.

### Shared health-data scope consumers

Define that final set once in a shared Edge Function module such as
`supabase/functions/_shared/health-data-scope.ts`. Each descriptor identifies
the schema/table, exported columns, deletion key/order, and any temporary legacy
cleanup columns. `account-export`, `account-delete`, and the new
`health-data-delete` function must import this same definition:

- `account-export` exports every canonical gated field, including the complete
  `user_health_profile` row. During expansion it exports the canonical backfill,
  not duplicate legacy fields.
- `health-data-delete` deletes every canonical gated resource and clears the six
  temporary legacy columns if contract has not completed.
- `account-delete` invokes the same gated deletion set before deleting ordinary
  account resources; it must not maintain an independent health-table list.

Contract tests must fail if the three functions resolve different gated sets or
if the shared set omits any of the seven final gated tables. Adding a gated table
or column requires updating this definition, its contract test, and the material
consent version in the same change. This shared definition does not include the
two ungated feature preferences below.

`feature_toggles.fatigue_tracking_enabled` and
`feature_toggles.deload_mode_enabled` remain ungated account preferences. They
may disclose feature use, so Kilo must not treat them as health measurements,
use them for health profiling, or combine them with analytics. Withdrawal does
not delete those two preference flags. Any future cloud column that stores a
measurement, note, goal, lift selection, fatigue/deload state, or link to a
health record must be added to a gated table and a material consent version
before collection begins.

## Demonstrable consent record

Consent evidence must be authoritative, immutable, and server-timestamped. A
client preference or sync flag is not evidence.

### Immutable consent-revision catalog

Create an immutable server-side catalog with one row per rendered consent
revision:

- `catalog_revision`: monotonically increasing integer; initial value `1`
- `material_version`: consent-scope version; initial value `1`
- `requires_reconsent`: true only when this revision introduces a new material
  version
- `status`: `draft`, `active`, or `retired`
- `controller_identity`: `Ben Pronin (Kilo)`
- `purpose`: `Cross-device synchronization of Kilo health data`
- `health_data_categories`: the four categories in the disclosure above
- `processor`: `Supabase`
- `consent_title`, `disclosure_copy`, and `affirmation_copy`: exact rendered
  strings
- `privacy_policy_revision`: stable revision identifier
- `privacy_policy_url`: the URL shown to the user
- `copy_sha256`: digest of the canonical rendered consent content
- `effective_at` and `retired_at`: server timestamps

An active or retired revision must not be updated or deleted. Corrections create
a new catalog revision. Editorial changes retain the same `material_version`;
scope changes increment it and set `requires_reconsent`. This preserves proof
of exactly what an earlier user saw without invalidating grants for editorial
copy changes.

### Append-only consent events

Record grants and withdrawals as append-only events:

- `id`: UUID
- `user_id`: authenticated account UUID
- `event_type`: `granted` or `withdrawn`
- `catalog_revision`: foreign key to the immutable catalog
- `material_version`: copied from that revision
- `copy_sha256`: copied from the catalog at the event time
- `grant_event_id`: set on a withdrawal to identify the grant being withdrawn
- `surface`: stable value such as `cloud_sync_enablement`
- `app_version` and `platform`
- `occurred_at`: database-generated timestamp

The client submits only the requested event and catalog revision. A privileged
server operation resolves the canonical catalog row, writes the event, and
updates current state. The client cannot supply its own wording, digest,
timestamp, controller, purpose, or categories.

### Keyed current state and enforcement

Maintain one keyed current-state row per user so every sync authorization is an
indexed lookup rather than a scan of the event history:

- `user_id`: primary key
- `status`: `granted`, `withdrawn`, `needs_reconsent`, or `deletion_pending`
- `current_catalog_revision`
- `current_material_version`
- `current_grant_event_id`
- `granted_at`, `withdrawn_at`, and `cloud_data_deleted_at`
- `consent_notice_sent_at`, `first_consent_denial_at`,
  `quarantine_started_at`, `quarantine_expires_at`, and `quarantine_trigger`
  (`notice_sent` or `consent_capable_denial`)

Backend authorization, row-level policies, and any sync RPC must deny health
data reads and writes unless the row is `granted` for the server's
`required_material_version`. Client checks improve UX but are never the
enforcement boundary. Grant/event writes are atomic. Withdrawal blocks access
before purge work begins.

Consent rows are themselves sensitive account records. Apply least-privilege
row-level access and exclude their contents from analytics and logs. On account
deletion, replace the account-linked ledger with an evidence-only archive row:

- HMAC-SHA-256 subject key generated with a server-held evidence key, with no
  user UUID or email retained;
- catalog revision, material version, copy digest, event types and timestamps;
- withdrawal, cloud-purge, and account-deletion completion timestamps; and
- no health payload, free text, device identifier, or IP address.

Retain that pseudonymized evidence for six years after the final consent or
account-deletion event, then delete it automatically. Access is service-role and
compliance-only. The linked privacy policy must disclose this retention and its
purpose: demonstrating compliance and the establishment, exercise, or defence
of legal claims under Article 17(3)(e).

The HMAC evidence key is versioned, stored outside the database, and referenced
by `evidence_key_id` on each archive row. The archive remains pseudonymized
personal data while that key exists; it is not anonymized. Routine rotation must
retain old key versions while any unexpired row references them. The retention
worker deletes each archive row at its six-year expiry and destroys a key version
as soon as no unexpired archive or retained backup references it. Key loss before
expiry is an integrity incident because it makes the evidence unverifiable;
monitor key availability and test recovery without logging key material.

## Withdrawal and cloud deletion

Turning off Cloud Sync is the withdrawal mechanism, but the control must say
what it does. A generic sync pause that leaves the cloud copy intact is not
withdrawal.

When a user turns Cloud Sync off, show this exact confirmation:

> Withdraw cloud health-data consent?
>
> Kilo will stop syncing and delete your body-weight entries, current and
> archived weight goals, tracked lifts and workout notes, deload notes and
> history, and fatigue-tracking data from the cloud. Your on-device data and
> Kilo account will remain.

Use these exact actions:

- Destructive primary: `Withdraw consent and delete cloud data`
- Secondary: `Keep Cloud Sync on`

On confirmation, the server must:

1. Atomically transition `granted -> deletion_pending`, append one withdrawal
   event, create a durable deletion job, and deny further cloud health-data
   reads and writes.
2. Invoke a `health-data-delete` Supabase Edge Function using the existing
   `account-delete` orchestration pattern. The function deletes the entire
   gated health-data set and is safe to repeat.
3. Have Supabase Cron retry incomplete `health_data_deletion_jobs` until every
   scoped row is gone. Record only per-table counts and completion status, never
   deleted values.
4. Transition `deletion_pending -> withdrawn` only after verified deletion and
   set `cloud_data_deleted_at`. A new grant is allowed from `withdrawn`, never
   from `deletion_pending`.

If retries wedge, a service-role-only operator action re-enqueues the same
idempotent job and verifies the gated tables. It may complete the transition
only after zero scoped rows remain; it cannot create a grant or bypass the
gate. The user sees deletion pending and a support path, not a restored sync
toggle.

Disabling sync and withdrawing consent therefore remain one discoverable
settings action. Account deletion remains a separate, broader action; it is not
required merely to withdraw health-data consent. Re-enabling sync after
withdrawal requires a new grant event and re-uploads only the local data then
present.

## Existing users and rollout

Existing Cloud Sync users have no demonstrable Article 9 grant. Do not
grandfather them, backfill consent, infer consent from historic sync use, or
describe later consent as curing earlier processing.

Use this deployment sequence:

1. Deploy only the **expand** half of the mixed-table migration: create and
   backfill `user_health_profile`, enable verified bidirectional compatibility,
   and leave all six legacy columns in place. Also deploy the shared health-data
   scope updates to `account-export` and `account-delete`, the consent schema,
   deletion worker, recovery export, and server configuration with
   `health_sync_mode=legacy`. Supported modes are `legacy`, `paused`, and
   `consent_required`.
2. Ship a consent-capable client that sends `client_version` and
   `consent_protocol_version` on every sync request and maps the server codes
   `CLIENT_UPDATE_REQUIRED`, `CONSENT_REQUIRED`, `CONSENT_VERSION_STALE`, and
   `HEALTH_DATA_DELETION_PENDING` to explicit update, consent, or deletion
   screens. Wait a documented 14-day adoption/notice period after store
   availability.
3. At cutover, set a server-owned `minimum_consent_protocol_version`, create
   state rows as `needs_reconsent` without synthetic events, and switch to
   `consent_required`. Deny ordinary reads and writes immediately for stale
   clients and users without a current material grant.
4. Run the mandatory **contract** migration only after the protocol gate is
   effective: verify parity, drop the six legacy columns and compatibility
   paths, and verify current-client reads/writes against `user_health_profile`.
5. Quarantine, rather than immediately destroy, non-granters' existing cloud
   health payloads. Ordinary sync and app access remain blocked. For each
   account, atomically set `quarantine_started_at` at the first successfully
   queued account notice or the first consent-capable client denial/in-app
   notice, whichever occurs first; set `quarantine_expires_at` to exactly 30
   days later and never reset it. The email/in-app notice offers: grant current
   consent and resume; make a user-initiated export through the existing
   `account-export` Edge Function and then delete; or delete immediately.
6. Enqueue the idempotent deletion job per account when its own
   `quarantine_expires_at` passes and it still lacks a current grant. There is no
   global purge date. Retry failed notice delivery and alert on quarantined
   accounts with no start timestamp; do not silently start their clock or purge
   them without a recorded actionable notice. Record remediation and deletion
   as operational events, never as consent.

Each per-account 30-day window is a bounded remediation for Kilo's prior
lawful-basis defect, not grandfathering and not permission for continued sync.
Storage is restricted to security, user-requested export/recovery, re-consent,
and deletion operations. Later consent is prospective and does not cure earlier
processing.

The server configuration is the kill switch. Before cutover it may move between
`legacy` and `paused`; after `consent_required` is activated it may move only to
`paused`, which fails closed by blocking all health sync without deleting data.
Returning to `legacy` after cutover requires a separately approved controller
decision and must not be the operational rollback. Purge activation is a
separate flag so a gate defect can be paused without risking mass deletion.

An existing user who has already granted the required material version may
continue syncing at cutover. That prospective grant does not retroactively
validate processing that occurred before it.

## Consent versioning and re-consent

The backend owns `required_material_version` separately from the latest rendered
`catalog_revision`. A new material version and fresh affirmative grant are
required before processing changes involving any of:

- a new health-data category;
- a new or expanded purpose;
- a controller change;
- a material processor, recipient, international-transfer, retention, or
  withdrawal change; or
- wording changes that alter what the user is agreeing to.

Editorial privacy-policy or consent-copy changes create a new immutable catalog
revision with the same material version and do not invalidate existing grants.
New grants record the latest active revision. Enforcement compares material
versions only.

When re-consent is required, set current state to `needs_reconsent` and block
sync before processing under the changed scope. Never auto-upgrade a prior
grant. Refusal leaves local use available. For a newly added category, no value
from that category may upload under an older grant; Kilo's initial
implementation may conservatively block all Cloud Sync until re-consent rather
than build per-category authorization.

## Required policy wording for issue #477

Once the implemented flow and backend enforcement are live, replace #477's
temporary Article 9 paragraph with this exact text:

> **Health data — special category (Art. 9):** Body-weight entries, current and
> archived weight goals, tracked lifts and workout notes, deload notes and
> history, and fatigue-tracking data are data concerning health, a special
> category of personal data under Article 9 of the GDPR. When you select "Agree
> and enable Cloud Sync" after explicitly accepting Kilo's health-data consent
> statement, Ben Pronin, Kilo's data controller, relies on your explicit consent
> under Article 9(2)(a) to store that data in Kilo's Supabase-hosted cloud
> database in the United States solely to sync it across your devices. Supabase
> processes the data for Kilo under EU Standard Contractual Clauses. You may
> refuse and continue using Kilo locally. You may withdraw consent at any time
> by turning off Cloud Sync; Kilo will stop cloud processing and delete the
> cloud copy while keeping the data on your device. Withdrawal does not affect
> processing that was lawful before withdrawal. After account deletion, Kilo
> retains a pseudonymized record of the consent and withdrawal events, containing
> no health entries, notes, or measurements, for six years to demonstrate
> compliance and establish, exercise, or defend legal claims.

Do not publish this paragraph before the versioned consent record, backend gate,
withdrawal purge, and existing-user cutover are deployed. The policy must link
to or otherwise retain its existing controller contact, data-subject rights,
retention, recipient/transfer, and complaint information; the paragraph above
does not replace those Article 13 disclosures.

## Implementation acceptance criteria

- Account creation and local use work without health-data consent.
- No cloud health-data read or write succeeds without an active grant for the
  required material version, including from an older client.
- The six mixed health/training columns use an expand/contract migration: old
  clients remain functional during expansion, protocol enforcement precedes
  contract, and the mandatory final state removes the source columns and all
  compatibility paths.
- Compatibility mirrors cannot recurse, preserve the genuine write's
  server-authoritative `updated_at`, and resolve cross-version conflicts by
  later-origin wins with canonical-table tie-break; regression tests cover every
  case without phantom timestamp bumps.
- One shared health-data-scope definition drives `account-export`,
  `account-delete`, and `health-data-delete`; all three cover
  `user_health_profile` plus all six named health tables, and contract tests
  prevent divergent hardcoded lists.
- The consent surface renders the exact approved copy, requires the unchecked
  affirmation, and records the canonical revision before enabling sync.
- Grant evidence proves user, catalog revision, material version, exact copy,
  policy revision, purpose, categories, processor, surface, app/platform, and
  server time.
- Turning Cloud Sync off expressly withdraws consent, blocks access immediately,
  purges every scoped cloud payload, and preserves local data and the account.
- Existing users are not grandfathered or synthetically consented; ordinary
  processing stops at enforcement cutover, each account receives its own
  immutable 30-day re-consent/export window from recorded actionable notice,
  and remaining data is then purged per account.
- A material consent-version change blocks sync until a fresh grant.
- Editorial revisions do not invalidate grants for the same material version.
- Deployment tests cover all three server modes, fail-closed rollback, protocol
  denial codes, quarantine/export, and separately armed purge activation.
- Withdrawal tests cover every state transition, durable job retry, operator
  re-enqueue, and the prohibition on re-grant from `deletion_pending`.
- Account deletion creates only the six-year pseudonymized evidence archive and
  removes the account-linked ledger. Versioned evidence keys remain available
  for referenced archives and are destroyed after the last referenced archive
  and retained backup expire.
- Automated tests cover grant failure, refusal, backend denial, withdrawal,
  partial purge retry, re-grant, stale-version denial, and existing-user
  cutover.
- Issue #477 remains blocked until implementation is deployed and the policy
  text above can truthfully be published.
