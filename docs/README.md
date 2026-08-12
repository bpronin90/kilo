# Documentation

This directory contains Kilo's current product and engineering documentation.
Use this index to find the authoritative document for a topic. Files under
[`archive/`](archive/) are historical delivery records and are not current
implementation guidance.

## Start Here

| Document | Purpose |
|----------|---------|
| [Current State](current-state.md) | Implemented product behavior, known gaps, and launch prerequisites. |
| [Architecture](architecture.md) | Runtime boundaries, data flows, persistence, and analytics ownership. |
| [Repo Structure](repo-structure.md) | Directory and file map for the active codebase. |
| [Testing and QA](testing-and-qa.md) | Test commands, coverage inventory, CI gates, and manual smoke checks. |

## Product and UI Reference

| Document | Purpose |
|----------|---------|
| [Calculations Reference](calculations-reference.md) | Workout, weight, goal, and configuration calculations in plain language. |
| [UI Design Rules](ui-design-rules.md) | Adopted layout, component, interaction, and copy rules. |
| [Design System Map](design-system-map.md) | Current visual tokens, shared components, and screen-level treatments. |

## Backend, Privacy, and Data

| Document | Purpose |
|----------|---------|
| [Backend Schema](backend-schema.md) | Ownership and source-of-truth policy for the Supabase `kilo` schema. |
| [Backend Activation](backend-activation.md) | Migration, configuration, verification, auth, and provider runbook. |
| [Article 9 Explicit Consent](article-9-explicit-consent-spec.md) | Health-data consent boundary and implementation contract. |
| [Product Measurement](product-measurement.md) | Privacy constraints for optional product-measurement events. |

## Builds, Testing, and Release Readiness

| Document | Purpose |
|----------|---------|
| [Phone Runbook](phone-runbook.md) | Expo, EAS, preview-runtime, and device setup procedures. |
| [Play Store Readiness](play-store-readiness.md) | Closed testing, declarations, listing assets, and Android release checks. |
| [Beta Tester Guide](tester-guide.md) | Non-technical installation, test, and feedback instructions. |

Contributor workflow lives in the root [Contributing guide](../CONTRIBUTING.md).

## Historical Material

[`archive/`](archive/) contains completed roadmaps, the original product spec,
the retired browser prototype, and other superseded planning material. Keep
those files for provenance, but verify current behavior in the documents above
and in the active code before relying on an archived statement.
