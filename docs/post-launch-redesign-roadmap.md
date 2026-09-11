# Kilo Post-Launch Redesign Roadmap

**Status: active. This roadmap covers the post-launch Analog Iron redesign.**

This roadmap begins after Kilo's launch; launch work is no longer tracked here.
It starts with the structural work needed to make the visual migration
reviewable, then delivers the approved Analog Iron redesign without changing
product behavior.

> **Redesign the product that shipped. Do not use a visual migration to change
> navigation, state handling, calculations, or data contracts.**

---

## Source of truth

- `docs/design/analog-iron-v0.125/migration-audit.md` — the repo-grounded audit
  and implementation card drafts.
- `docs/design/analog-iron-v0.125/` — the approved visual handoff.
- Existing app behavior and tests are authoritative wherever a document,
  screenshot, or audit claim conflicts with them.

The standing rule for every phase below is that behavior does not change. Any
visual target that requires a behavior change stops and goes to the owner in
writing for explicit approval. A reference image is never authority for a
behavior change.

---

## Phase 1 — Structural preparation

This phase lands before the redesign. Pure file splits are verified by the
existing test suite and do not require device sign-off.

### S1. Split the Log cluster

The current cluster is about 8,500 lines:

- `LogScreen.js` — 1,864 lines
- `LogRecoverySection.js` — 1,650 lines
- `LogScreenEditorCard.js` — 1,668 lines
- `useLogCurrentRoutineEditor.js` — 1,734 lines
- `useLogOtherRoutineEditor.js` — 1,594 lines

Keep the split separate from the restyle. A move-only change is reviewable and
testable; combining file movement with visual changes would obscure behavior
changes and make the Log migration card unnecessarily large.

### S2. Enforce a 600-line limit on app code

The limit applies to app code, not tests, docs, dependencies, or configuration.
It should block new violations while reporting existing files as debt. A
genuinely cohesive exception may carry a short, visible justification.

The threshold remains appropriate: the largest screen and editor modules still
substantially exceed it, while normal app modules are much smaller. Enforcement
lands in the checker owned by redesign card D2.

### S3. Keep sync structural work separate

`syncAdapter.js` and `syncQueue.js` remain outside this program. No redesign card
touches them, and their data-loss risk warrants separately scoped work rather
than opportunistic restructuring during a visual migration.

---

## Phase 2 — Analog Iron redesign

The full contract and card-level Allowed Files live in
`docs/design/analog-iron-v0.125/migration-audit.md`.

The program contains 14 implementation cards plus one zero-file verification
gate. Order: `D0 → D1 → D2 → D3 → D4 → D5`, then the screen
cards, then `D18`.

- **D0** — approve chart tokens and remaining visual decisions, including exact
  light/dark values, accessible marker fills, font assets, and native-control
  treatment.
- **D1** — retint the palettes, bundle fonts, and establish type and geometry
  tokens. Existing native dark-mode wiring is retained rather than rebuilt.
- **D2** — add incremental visual anti-pattern enforcement, including S2's line
  limit.
- **D3–D5** — migrate shared primitives, navigation chrome, charts, and overlays.
- **D6–D16** — migrate Home, Log, Analytics, Weight, secondary surfaces,
  Settings, Account, and Backup according to the audit's ownership boundaries.
- **D18** — perform the read-only completeness verification and own no files.

Every implementation card requires owner device sign-off. Automated checks can
protect behavior and structural rules, but they cannot establish that the visual
result is correct on a physical device.

Two rules bind every card:

- **Native control appearance.** Cards containing `TextInput`, `Switch`, or
  `DateTimePicker` instances preserve the token-driven native appearance contract
  specified by the migration audit. D2 enforces the required props.
- **Behavior-change escalation.** A card that cannot meet its visual target
  without changing behavior stops and requests an explicit owner decision.

---

## Phase 3 — Post-redesign follow-through

- Retake store screenshots and refresh the listing for the redesigned UI.
- Scope `syncAdapter` and `syncQueue` structural work independently if it remains
  a priority after the visual migration.
