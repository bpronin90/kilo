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

This phase lands before the redesign and is coordinated by
[#1064](https://github.com/bpronin90/kilo/issues/1064). It assigns each of the 20
current production files over 600 lines to exactly one implementation card. The
limit is inclusive: 600 lines passes and 601 fails. Tests, fixtures, generated or
vendor content, and configuration are outside the count.

Every card is a behavior-preserving extraction. It may not change copy, visuals,
navigation, state, persistence, analytics, accessibility, public exports,
serialized data, dependencies, or database contracts. Each touched or created
production file must finish at 600 lines or fewer without compressed formatting
or unrelated deletion. These refactors use targeted tests and ordinary CI; they
do not require visual device sign-off.

### Wave 0 — Establish the ratchet

- [#1046](https://github.com/bpronin90/kilo/issues/1046) adds the incremental
  production-file line guard. It rejects new violations and growth in the
  explicit legacy baseline while allowing later cards to reduce that baseline.

### Wave 1 — Leaf computation and shared foundations

These cards have disjoint production ownership and can proceed after #1046:

- [#1048](https://github.com/bpronin90/kilo/issues/1048) — shared UI primitives.
- [#1053](https://github.com/bpronin90/kilo/issues/1053) — workout analytics
  derivations.
- [#1057](https://github.com/bpronin90/kilo/issues/1057) — workout-note parsing
  and text mutation.
- [#1059](https://github.com/bpronin90/kilo/issues/1059) — Recovery operation
  journal, replay, locking, and corruption handling.
- [#1061](https://github.com/bpronin90/kilo/issues/1061) — sync queue stamping,
  dirty acknowledgements, cursor trust, snapshots, and reconciliation.

### Wave 2 — Screens and stateful consumers

Each card starts from current `main` after its named foundations land:

- [#1047](https://github.com/bpronin90/kilo/issues/1047) — App shell
  orchestration.
- [#1049](https://github.com/bpronin90/kilo/issues/1049) — Home composition and
  first-paint boundaries.
- [#1050](https://github.com/bpronin90/kilo/issues/1050) — Weight entry, goals,
  and history presentation.
- [#1051](https://github.com/bpronin90/kilo/issues/1051) — Analytics screen,
  after #1053.
- [#1052](https://github.com/bpronin90/kilo/issues/1052) — Analytics Recovery
  evidence and state presentation.
- [#1054](https://github.com/bpronin90/kilo/issues/1054) — Log screen and editor
  presentation, after #1048.
- [#1055](https://github.com/bpronin90/kilo/issues/1055) — shared current/other
  Log editor machinery, after #1057 and #1061.
- [#1056](https://github.com/bpronin90/kilo/issues/1056) — Log Recovery
  presentation, after #1059.
- [#1058](https://github.com/bpronin90/kilo/issues/1058) — Recovery read state,
  filtering, eligibility, and mutations, after #1059 and #1061.
- [#1060](https://github.com/bpronin90/kilo/issues/1060) — backup UI, export,
  validation, and restoration, after #1059 and #1061.
- [#1062](https://github.com/bpronin90/kilo/issues/1062) — cloud sync adapter,
  identity gates, table ordering, and rebuild behavior, after #1059 and #1061.

The Recovery, backup, queue, and cloud-adapter cards carry explicit transition
matrices and adversarial fixtures for stale identity, malformed state, partial
writes, retries, and clean restoration. The Supabase cards do not authorize any
schema, RLS, Auth, role, key, migration, or transport-contract change.

### Final gate

[#1063](https://github.com/bpronin90/kilo/issues/1063) is a zero-file,
independent verification after every implementation card merges. It enumerates
production files independently, requires an empty legacy baseline, and approves
Phase 1 only when no production file exceeds 600 lines.

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
- **D2** — add visual anti-pattern enforcement and retain Phase 1's production
  line-limit guard.
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
