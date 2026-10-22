# Documentation

Choose the question you need to answer. Each linked guide owns its task; indexes
point to focused contracts instead of repeating them. Active code, manifests,
migrations and executable tests settle implementation facts; unresolved policy
conflicts are called out where the affected contract lives.

## Folder layout

```text
docs/
  architecture/  Runtime, persistence, sync, recovery and schema contracts
  design/        UI rules, screen references and visual specification packages
  operations/    Development, builds, backend activation and release procedures
  privacy/       Health-data consent and optional product measurement
  product/       Current product state and calculation explanations
  security/      Trust boundaries, review, monitoring and incident response
  testing/       Automated tests, coverage, CI gates and manual QA
  archive/       Historical plans, specifications and retired prototype
```

The root keeps this index, the repository map, and the architecture, design-system,
testing and phone-runbook entry pages. Detailed guides live in the folders above.

## Understand or change the app

| Reader task | Authoritative guide |
|---|---|
| What has shipped, and what is externally unverified? | [Current State](product/current-state.md) |
| Where does a module live? | [Repo Structure](repo-structure.md) |
| Which runtime, storage, sync, or security contract applies? | [Architecture index](architecture.md) |
| Which layer produces or persists an analytics field? | [Workout Analytics Ownership](architecture/workout-analytics-ownership.md) |
| How is a displayed number calculated? | [Calculations Reference](product/calculations-reference.md) — cohesive formula/configuration reference |
| What layout, copy, interaction and accessibility rules must a change follow? | [UI Design Rules](design/ui-design-rules.md) |
| Where is a screen or shared visual pattern implemented? | [Design System Map](design-system-map.md) — screen and foundation index |
| What is the approved visual language? | [KUA design package](design/kinetic-utilitarian-athletic/README.md) — foundation, tokens, components and surfaces |
| What redesign work is planned? | [Post-Launch Redesign Roadmap](design/post-launch-redesign-roadmap.md) — planning, not shipped-state authority |

## Verify a change

| Reader task | Authoritative guide |
|---|---|
| Which verification guide do I need? | [Testing and QA index](testing-and-qa.md) |
| Run targeted tests or avoid Jest isolation leaks | [Automated Tests](testing/automated-tests.md) |
| Assess coverage, gaps and measured performance evidence | [Test Coverage](testing/test-coverage.md) |
| Diagnose a required merge check | [CI Gates](testing/ci-gates.md) |
| Check installed native behavior or exported browser boot | [Manual QA](testing/manual-qa.md) |
| Measure the work needed to log a workout | [Logging-Speed Benchmark](testing/logging-speed-benchmark.md) |
| Determine whether a change needs security sign-off | [Security-critical Review](security/security-review.md) |

## Operate builds and services

| Reader task | Authoritative guide |
|---|---|
| Choose device iteration or native distribution | [Phone Runbook index](phone-runbook.md) |
| Connect Kilo Dev to Metro, including WSL troubleshooting | [Expo Development](operations/expo-development.md) |
| Build Android/iOS artifacts or choose update/runtime compatibility | [Mobile Builds](operations/mobile-builds.md) |
| Complete Play Console, listing, closed-testing and release checks | [Play Store Readiness](operations/play-store-readiness.md) |
| Join the beta and send feedback (participants) | [Beta Tester Guide](testing/tester-guide.md) |
| Deploy migrations/functions and expose the owned schema | [Backend Activation](operations/backend-activation.md) — includes the unresolved production deployment instruction |
| Configure public signup, CAPTCHA, SMTP and OAuth | [Auth Activation](operations/auth-activation.md) |
| Publish, verify or roll back the public web app | [Web Deployment](operations/web-deployment.md) |
| Respond to a stuck consent-erasure job | [Health-Deletion Operations](operations/health-deletion-operations.md) |
| Configure security-event monitoring or investigate an alert | [Security Monitoring](security/security-monitoring.md) |
| Triage a vulnerability or manage an incident | [Security Incident Response](security/security-incident-response.md) |

## Protect data and preserve provenance

| Reader task | Authoritative guide |
|---|---|
| Design owned tables, naming and isolation | [Backend Schema](architecture/backend-schema.md) — includes the unresolved authored/derived-field wording |
| Understand cloud health consent, exact wording, evidence and withdrawal | [Health-Data Consent](privacy/health-data-consent.md) |
| Understand optional measurement, allowed payloads and opt-out deletion | [Product Measurement](privacy/product-measurement.md) |
| Find completed roadmaps or retired source/specifications | [Archive Index](archive/README.md) |
| Interpret the retired Analog Iron handoff | [Historical design package](design/analog-iron-v0.125/README.md) — retained URLs and provenance only |

Contributor setup and process live in [CONTRIBUTING.md](../CONTRIBUTING.md).
Delivery chronology belongs in GitHub, the changelog and archives. Update the one
living owner when its truth changes, then repair affected navigation. Keep
compatibility entry URLs when immutable historical material still refers to them.
