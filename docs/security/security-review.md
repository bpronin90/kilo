# Security-critical change review

This policy adds an explicit security lens to the existing pull-request and
release workflow. It does not require a security review for every change and
does not replace automated checks or ordinary code review.

## When this applies

Mark a pull request as **security-critical** when it changes or could weaken
any of these boundaries:

- authentication, authorization, identity, account recovery, or account
  deletion/export;
- Supabase schema, grants, RLS, policies, Edge Functions, server APIs, or
  other trust boundaries;
- secrets, credentials, signing keys, encryption, storage, backups, or data
  retention;
- health-data collection, consent, synchronization, exposure, or deletion;
- CAPTCHA, rate limiting, abuse prevention, update delivery, build
  provenance, deployment, or production security controls.

When the impact is uncertain, treat the change as security-critical until a
human reviewer records why it is not. Routine UI, calculations, and local-only
changes remain on the ordinary review path unless they cross one of the
boundaries above.

## Pull-request checklist

The author records the security impact in the PR template. For a
security-critical change, the author and human security reviewer should cover:

1. **Authorization boundary:** who can perform each new or changed action,
   and how is ownership enforced?
2. **Input and trust boundary:** which inputs, identities, tokens, webhooks,
   clients, or external services are trusted, and where are they validated?
3. **Sensitive data:** what data can be read, written, logged, exported,
   cached, backed up, or deleted, and is exposure minimized?
4. **Abuse cases:** what replay, enumeration, privilege-escalation, scraping,
   denial-of-service, or misconfiguration paths were considered?
5. **Failure behavior:** does a timeout, partial failure, stale credential,
   denied request, or deployment rollback fail closed and preserve data
   boundaries?
6. **Verification:** which focused tests, database/RLS checks, dependency or
   deployment checks, and manual checks support the conclusion?

The reviewer records assumptions, findings, accepted residual risk, reviewer
identity, review date, and the full 40-character PR head SHA in the PR. A
finding must be fixed, explicitly accepted by an authorized owner, or block
release; silence is not sign-off.

## Sign-off and release

The PR's ordinary review remains the system of record. A security-critical PR
must have an explicit human security sign-off recorded in its security section
before it is eligible for release. The sign-off is valid only when its
reviewed head SHA exactly matches the current full PR head SHA. Any subsequent
push invalidates the prior security sign-off; the author must mark it pending
and obtain a renewed sign-off for the new head. This is additional to required
CI, database-security, dependency-audit, migration-drift, and ordinary review
checks; a passing automated check cannot substitute for the human review.

The release operator verifies that sign-off is present for every
security-critical PR included in the release, that the impact field contains
an explicit choice, and that the recorded reviewed head SHA equals the exact
current head. If the PR identifies accepted risk, the release record must
retain that decision and its owner. Changes with material uncertainty, novel
cryptography, credential/signing-key custody, external exposure, or a
high-impact privacy/security failure mode should also receive specialist or
external review before release.

## Keeping the process lightweight

The author marks one impact choice in the PR template. Non-critical changes
need no additional checklist. Critical changes use the same PR, review,
status-check, and release records already required by the repository; no new
parallel ticket or approval system is introduced.
