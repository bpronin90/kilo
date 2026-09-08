# Vulnerability Management and Security Incident Response

This runbook is Kilo's lightweight operating process for vulnerabilities and
security incidents. It complements the [security-critical change review](security-review.md),
[security monitoring](security-monitoring.md), [backend activation](backend-activation.md),
and [phone/release runbook](phone-runbook.md); those documents remain
authoritative for their detailed controls.

## Intake and first response

External researchers and users must use GitHub's private vulnerability report
for this public repository: [Report a vulnerability privately](https://github.com/bpronin90/kilo/security/advisories/new)
(the repository **Security** tab → **Advisories** → **Report a vulnerability**).
GitHub routes the report to the repository owner/maintainers; `bpronin90`, as
the repository owner, is the intake owner responsible for acknowledging it,
assigning the triage owner, and restricting the report to people who need it.
If GitHub private reporting is unavailable, do not accept sensitive details in
a public issue; the owner must restore the private route before asking a
reporter to submit them. Maintainers may use the same private report route for
internally discovered findings.

Do not put credentials, tokens, exploit details, health data, or unredacted
personal data in a public issue, PR, log, or chat. Preserve the original report,
timestamps, affected versions, relevant commit/build IDs, and available logs;
limit access to people who need it.

Intake sources are:

- the PR, weekly, and scheduled dependency checks in `.github/workflows/audit.yml`,
  run by `npm run audit` / `scripts/audit-gate.mjs` for the root and `mobile`
  workspaces;
- the hourly production security-event monitor in
  `.github/workflows/security-event-monitor.yml`, whose thresholds, event
  catalog, and evidence are described in [Security Monitoring](security-monitoring.md);
- Dependabot and GitHub security/dependency reports;
- external researcher, vendor, or user reports; and
- weaknesses found during development, review, monitoring, deployment, or
  post-release testing.

The triage owner records the source, affected component and versions, evidence,
exploitability, exposure window, data or users at risk, and a provisional
severity. If the report may involve an active compromise, restrict disclosure,
preserve evidence, and declare an incident immediately rather than waiting for
all facts.

## Severity, targets, and exceptions

Severity describes impact and realistic exploitability, not the amount of work
needed to fix it. Separately, the triage owner assigns an explicit priority
(P0–P3) to every record, based on urgency, exposure, and the response target;
the owner may raise or lower the default below only with a recorded rationale.
The record must retain both severity and owner-assigned priority. The triage
owner may also raise severity when evidence changes.

| Severity | Typical Kilo impact | Default owner-assigned priority | Acknowledge / triage | Target containment or fix | Escalation |
| --- | --- | --- | --- | --- | --- |
| Critical | Active exploitation, exposed signing/service credential, authentication or authorization bypass, material health-data exposure, or release/update integrity compromise | P0 (owner confirms or records an override) | 4 hours | Contain immediately; remediate or disable the affected path within 24 hours | Owner and security decision-maker immediately; maintain an incident bridge until contained |
| High | Remotely exploitable issue with meaningful user, account, health-data, production-service, or dependency impact, but no confirmed active compromise | P1 (owner confirms or records an override) | 1 business day | 7 calendar days | Escalate if containment is unavailable or the target will slip |
| Medium | Narrowly exploitable or limited-scope weakness with a credible but bounded impact | P2 (owner confirms or records an override) | 3 business days | 30 calendar days | Escalate on repeated deferral or increasing exposure |
| Low | Defense-in-depth, low-likelihood, or non-sensitive impact with no practical abuse path | P3 (owner confirms or records an override) | 5 business days | 90 calendar days or the next planned maintenance window | Re-triage if the threat model changes |

Targets are operating goals, not permission to leave users exposed. The triage
owner records a rationale for any exception, compensating control, new due date,
and approving owner; critical/high exceptions require explicit owner approval.
Recheck every open finding at its due date and whenever a new exploit or impact
fact appears.

For dependency findings, the audit gate blocks unreviewed or expired high and
critical advisories. An entry in `audit-allowlist.json` is a time-bounded,
reviewed exception keyed by GHSA and package, with a reason and `reviewBy` date;
it is not remediation. Stale entries must be removed. Lower-severity findings
still require triage and a recorded disposition even when the gate does not
block them.

## Roles and ownership

- **Triage owner:** receives the report, sets severity and deadlines, maintains
  the finding/incident record, and escalates.
- **Technical owner:** reproduces the issue, chooses containment and remediation,
  and preserves evidence without expanding exposure.
- **Release/verification owner:** confirms tests, review, deployment, rollback,
  and post-release checks; for critical changes, obtains the human security
  sign-off required by `docs/security-review.md`.
- **Communications owner:** decides what to tell affected users, providers,
  reporters, or authorities with the owner; never discloses secrets or
  unverified impact.
- **Closure owner:** confirms residual risk is accepted, actions have owners and
  dates, and the post-incident review is complete.

For Kilo's current size, one person may hold several roles, but the record must
name each role separately and identify an independent human sign-off for a
critical security release. The owner decides whether a report is a vulnerability
or a declared incident and who must be informed.

## What is a security incident?

Declare an incident when there is a suspected or confirmed compromise of
confidentiality, integrity, or availability involving Kilo or its delivery
systems, including:

- authentication, authorization, account recovery, sessions, or RLS bypass;
- unauthorized access to health data, exports, deletion flows, or production
  database/service data;
- a leaked, misused, or unexpectedly exposed Supabase, OAuth, Turnstile, Sentry,
  GitHub, EAS/store, deployment, or signing credential;
- malicious or materially unauthorized dependency, build, deployment, update,
  or release behavior;
- active exploitation, suspicious access, destructive service activity, or a
  material outage caused by a security control failure.

A report that is only a theoretical or contained vulnerability remains a
finding unless evidence shows an incident. When uncertain, use the incident
flow and downgrade after evidence is preserved.

## Incident flow

1. **Identify and preserve.** Record the reporter, UTC timestamps, affected
   versions/builds, indicators, relevant alerts/logs, and a hash or location for
   preserved evidence. Avoid copying secrets or health data into the record.
   Start from the investigation runbook in
   [Security Monitoring](security-monitoring.md): the security-event log is
   retained for 90 days, while Supabase's platform logs are retained for days,
   so pull anything needed from the platform log promptly.
2. **Triage and declare.** Assign severity, roles, affected surfaces, exposure
   window, and a communications decision. Critical/high reports get an explicit
   owner and next update time.
3. **Contain.** Disable or isolate the affected endpoint, job, integration,
   release channel, credential, or account; apply a narrowly scoped block or
   rollback; and preserve evidence before destructive cleanup where practical.
4. **Eradicate and remediate.** Remove the vulnerable code/configuration,
   revoke unauthorized access, rotate affected credentials, patch dependencies,
   and add regression coverage or monitoring that detects recurrence. When the
   failure was not visible to the existing monitors, add or adjust a
   security-event and its threshold in
   [Security Monitoring](security-monitoring.md) as part of the fix.
5. **Recover.** Restore only from a known-good artifact or backup, re-enable
   access in stages, validate authentication/RLS and health-data boundaries, and
   watch logs and error reporting for recurrence.
6. **Verify and communicate.** Complete the release/security checks below,
   document actual impact and uncertainty, and send only owner-approved notices
   to affected users, providers, reporters, or authorities when required.
7. **Close and learn.** Confirm containment, remediation, recovery, notifications,
   residual risk, and action owners; then complete the post-incident review.

## Kilo containment and recovery checklist

Choose only the actions supported by the evidence. Never paste a secret into a
ticket or use a suspected credential to investigate.

- **Supabase/Auth/database:** revoke or rotate affected keys/passwords and
  sessions through the provider, disable compromised users or integrations,
  inspect Auth/RLS/database access, and verify the owned `kilo` data boundary.
- **OAuth and Turnstile:** rotate provider secrets in provider configuration,
  disable the affected client/widget if necessary, and verify redirect origins
  and server-side validation. Follow the secret-handling rules in
  `docs/backend-activation.md`.
- **Sentry/telemetry:** rotate a credential only when evidence requires it,
  preserve event IDs and timestamps, and check that diagnostic payloads contain
  no unexpected sensitive data.
- **Security-event log:** correlate by `subject_digest` and `context.request_id`
  per [Security Monitoring](security-monitoring.md). Never delete rows to clear
  an alert; the log is append-only and is the evidence the investigation runs
  on. Widen a monitor threshold with a recorded rationale instead.
- **GitHub, EAS/store, deployment, and signing:** revoke tokens, rotate keys,
  restrict repository/provider access, stop a compromised workflow or channel,
  invalidate affected artifacts where supported, and rebuild from a known-good
  commit. Treat native signing-key loss as a provider escalation.
- **Sessions and data:** invalidate sessions/tokens when account access may be
  exposed; determine whether health data or deletion/export requests were
  accessed or altered; preserve evidence and follow the owner-approved
  notification decision.
- **Recovery:** record the exact known-good commit/artifact, deploy through the
  normal PR and release path, verify service health and security boundaries,
  monitor for recurrence, and document rollback criteria before re-enabling a
  constrained path.

## Security-fix, release, and verification path

1. Create a focused branch and PR linked to the finding/incident. Describe the
   threat, affected versions, containment, data impact, and remaining risk
   without secret or exploit-sensitive details.
2. Select `security-critical` in the PR security section when the change touches
   auth, RLS, APIs, secrets, health data, abuse controls, update delivery,
   deployment, or another listed boundary. Use the checklist in
   `docs/security-review.md`.
3. Run focused regression tests and the applicable dependency audit,
   database/RLS, deployment, build, and migration checks. Do not treat a green
   check as proof that a human security sign-off is unnecessary.
4. Obtain review and, for a critical change, a human security sign-off tied to
   the full 40-character PR head SHA. Any new commit invalidates that sign-off.
5. Release in the smallest safe stage. Confirm the deployed commit/artifact,
   startup/auth/data-boundary behavior, logs, error reporting, and the intended
   fix. Roll back or re-contain if verification fails or indicators recur.
6. Record release and verification evidence, close or extend the finding with
   an owner-approved residual-risk decision, and schedule the post-incident
   review.

## Post-incident review template

Complete this lightweight record after containment and recovery:

```text
Incident/finding:
Severity and decision owner:
Timeline (UTC):
Affected versions, systems, and users:
Actual impact and health-data/credential exposure:
Root cause and contributing factors:
Containment, remediation, recovery, and release evidence:
What worked / what failed:
Corrective and preventive actions (owner + due date):
Monitoring or regression coverage added:
Notifications and communication decision:
Residual risk and closure approval:
```

The closure owner checks that every action has an owner and date, verifies the
fix or control, links the exact release/build evidence, and reopens the finding
if residual risk changes.
