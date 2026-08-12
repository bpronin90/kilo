# Documentation

This directory contains Kilo's current product, engineering, privacy, operations,
and testing documentation. Each living document owns one topic; follow its links
instead of copying the same contract into several files.

## Start Here

| Document | Owns |
|----------|------|
| [Current State](current-state.md) | Concise shipped-product state and externally unverified release boundaries. |
| [Architecture](architecture.md) | Runtime boundaries, data flows, persistence, sync, and analytics ownership. |
| [Repo Structure](repo-structure.md) | Maintainable directory-level ownership map. |
| [Testing and QA](testing-and-qa.md) | Test commands, CI gates, coverage inventory, and manual verification. |

## Product and UI Reference

| Document | Owns |
|----------|------|
| [Calculations Reference](calculations-reference.md) | Workout, weight, goal, and recovery calculations in plain language. |
| [UI Design Rules](ui-design-rules.md) | Adopted layout, component, interaction, appearance, and copy rules. |
| [Design System Map](design-system-map.md) | Current visual tokens, shared components, and screen-level implementation map. |

## Backend, Privacy, and Data

| Document | Owns |
|----------|------|
| [Backend Schema](backend-schema.md) | Supabase `kilo` schema ownership, source-of-truth, naming, RLS, and consent boundaries. |
| [Backend Activation](backend-activation.md) | Migration deployment, API exposure, Auth-provider configuration, and operational verification. |
| [Health-Data Consent](health-data-consent.md) | Current consent wording, health-data boundary, enforcement, withdrawal, evidence, and re-consent contract. |
| [Product Measurement](product-measurement.md) | Privacy and deletion constraints for optional product-measurement events. |

## Builds, Testing, and Release Readiness

| Document | Owns |
|----------|------|
| [Phone Runbook](phone-runbook.md) | WSL/Expo development, EAS builds, device installation, and runtime policy. |
| [Play Store Readiness](play-store-readiness.md) | Operator-owned Play Console, closed-testing, listing, and Android release status. |
| [Beta Tester Guide](tester-guide.md) | Non-technical installation, test, and feedback instructions. |

Contributor workflow lives in the root [Contributing guide](../CONTRIBUTING.md).

## Historical Material

[Archive Index](archive/README.md) groups completed roadmaps, superseded
specifications, parser samples, and the retired browser prototype. Archived
files preserve provenance but do not define current product behavior.

## Maintenance Rules

- Put current behavior in the one living document that owns the topic.
- Put delivery chronology in the changelog, GitHub issue, or archive—not in
  `current-state.md`.
- Prefer stable directories, modules, and commands over exhaustive file lists or
  line numbers.
- Link to another document's contract rather than restating it.
- Treat package manifests, migrations, tests, and active code as the final check
  when prose and implementation disagree.
