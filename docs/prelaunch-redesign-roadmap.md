# Kilo Prelaunch and Redesign Roadmap

**Status: active. This is the final roadmap before `1.0.0`.**

Label: `roadmap:prelaunch`

Kilo is functionally complete and has finished closed testing. The remaining work
is not new capability. It is: ship `1.0.0`, then repaint the app.

> **Launch the product that exists, then redesign it. Do not block a finished app
> on a months-long visual migration.**

The Analog Iron migration ([#978](https://github.com/bpronin90/kilo/issues/978))
is real, approved and fully planned. It is also 14 implementation cards that each
require the owner to check screens on a physical device. That is the single
largest consumer of owner time in the project, and none of it is required to
release. It is therefore **deferred until after production launch**.

---

## Source of truth

- `docs/design/analog-iron-v0.125/migration-audit.md` — the repo-grounded audit
  and the 14 implementation card drafts. Owner-approved.
- `docs/design/analog-iron-v0.125/` — the approved visual handoff.
- `docs/play-store-readiness.md` — launch checklist. **Partly stale; see P1.**
- Existing app behavior and tests are authoritative wherever a document,
  screenshot or audit claim conflicts with them.

**The standing rule for every phase below:** behavior does not change. Kilo's
current functionality, navigation, state handling and data contracts are the
specification. Anything that requires a behavior change stops and goes to the
owner in writing for explicit approval. A reference image is never authority for
a behavior change.

---

## Phase 1 — Ship `1.0.0`

Unresolved items here are genuine release gates. Nothing here is styling.

### P1. Correct the stale launch checklist — **RESOLVED (2026-09-09)**
`docs/play-store-readiness.md` now records closed testing and production access
as complete while retaining the genuinely outstanding Play Console declarations,
listing assets, release-build checks, and API 36 blocker.

### P2. Home first-paint delay — [#984](https://github.com/bpronin90/kilo/issues/984)
Home waits on four data sources and renders at the speed of the slowest, on every
launch. It is the literal first impression. Previously fixed in #809 and it has
regressed.

**Do not fix it by relaxing the first-paint gate.** One of the four terms is a
correctness guard (#699) preventing Home from showing totals that include work the
user excluded from Recovery. A fast Home showing quietly wrong numbers is worse
than a slow one. Timing instrumentation from #809/#818 already exists; measure
before changing anything.

### P3. Dark mode: wire it or hide it — **RESOLVED (2026-09-07)**
**Owner decision: dark mode ships wired at the native layer in `1.0.0`.**
Implemented in [#985](https://github.com/bpronin90/kilo/issues/985): `app.json`
uses `userInterfaceStyle: "automatic"`, `expo-system-ui` is a pinned dependency,
`ThemeContext` reconciles Light/Dark/System with React Native's `Appearance`,
and every `TextInput`/`Switch`/`DateTimePicker` in the affected screens now
receives `keyboardAppearance`/`trackColor`+`thumbColor`/`themeVariant` from the
resolved theme. iOS-only limitations (Android keyboard appearance, splash and
adaptive-icon backgrounds) are recorded in that issue rather than faked. The
Analog Iron redesign still owns the palette retint; this change carries no new
colours.

Original framing, kept for context: shipping the toggle unwired meant dark
screens with white keyboards and system-default switches — a bug, not a style
complaint. The alternative considered was hiding the toggle and landing dark
during the redesign; the owner chose to wire it now.

### P4. Security advisories — mostly a paperwork exercise
Four open Dependabot alerts, and severity overstates the real exposure:

- **`image-size` (2 × HIGH)** — transitive under
  `expo → @expo/metro → metro`. It runs on the build machine, not in the shipped
  app. Exploiting it requires a hostile image in your own asset folder. **Not a
  launch blocker.** Allowlist with that rationale via the reviewed-advisory
  mechanism from PR #750 and let it clear when Expo bumps Metro.
- **`@xmldom/xmldom` (2 × MEDIUM)** — [#936](https://github.com/bpronin90/kilo/pull/936)
  addresses it but is stuck on a failing check. Confirm whether it is likewise
  build-only before spending real effort.

### P5. Production auth verification — [#333](https://github.com/bpronin90/kilo/issues/333)
Operator checklist for final production signup and authentication. This is a
genuine launch gate and should be completed against the real production project.

### P6. Security process issues — **RESOLVED**
[#975](https://github.com/bpronin90/kilo/issues/975) (monitoring, alerting, audit
trail), [#976](https://github.com/bpronin90/kilo/issues/976) (vulnerability
management and incident response), [#977](https://github.com/bpronin90/kilo/issues/977)
(security review gate) are closed. The documented workflows now exist in
[Security Monitoring](security-monitoring.md), [Security Incident Response](security-incident-response.md),
and [Security-critical change review](security-review.md), respectively. These
documents are the current operational source of truth for detecting and
investigating security events, handling vulnerabilities and incidents, and
reviewing security-critical changes.

### P7. Store listing assets
Icon (512×512), feature graphic (1024×500) and ≥2 phone screenshots.
**Screenshots depict the current UI and will be retaken after the redesign.**
That is the only hard dependency between launch and the redesign, and it is asset
production, not a schedule gate. Closed testing does **not** need repeating —
production access, once granted, survives a UI change.

### P8. Scope freeze — **owner decision required**
- **Frozen feature work:** #956, #957, #960, #961, #962, #969. All touch Log or
  Analytics. #957 and #969 already have finished PRs. They are frozen because the
  redesign would restyle them twice. *Recommendation: ship `1.0.0` without them;
  resume after the redesign's Log cards release those files.*
- **[#578](https://github.com/bpronin90/kilo/issues/578) CSV export and
  interoperability:** still a planning issue. *Recommendation: out of `1.0.0`.*
- **Version bump:** `0.123.2 → 1.0.0` via `chore/release` and
  `npm run release:prepare`. Do not hand-edit synchronized versions.

---

## Phase 2 — Structure

Runs after launch, before the redesign. Verified by the existing test suite
alone — **no device sign-off**, because a pure file split that preserves behavior
is proven by tests passing.

### S1. Split the Log cluster
`LogScreen.js` (1,687), `LogRecoverySection.js` (1,627),
`LogScreenEditorCard.js` (1,624) and the two `useLog*Editor` hooks (~1,550 each).
About 8,000 lines.

Two reasons this comes before the redesign and is not folded into it:

1. **A combined diff cannot be reviewed for behavior change.** Split-only says
   "code moved, nothing else" and the tests prove it. Restyle-only on small files
   produces a readable diff. Together they produce 8,000 lines where code moved
   *and* styling changed, and nobody can tell whether behavior survived.
2. **It fixes the worst defect in the redesign plan.** The Log restyle is
   currently a single 21,000-line card that no one can review or sign off
   honestly. Split first and it becomes three or four tractable cards.

### S2. Enforce a 600-line limit on app code
This rule has existed twice as intent — [#414](https://github.com/bpronin90/kilo/issues/414)
and [#296](https://github.com/bpronin90/kilo/issues/296) — and evaporated both
times because nothing enforced it:

| File | At #414 | Today | Change |
|---|---|---|---|
| `useLogCurrentRoutineEditor.js` | 455 | 1,598 | **+251%** |
| `HomeScreen.js` | 554 | 1,579 | **+185%** |
| `useLogOtherRoutineEditor.js` | 552 | 1,512 | **+174%** |
| `AnalyticsScreen.js` | 510 | 1,091 | +114% |
| `workoutAnalytics.js` | 486 | 883 | +82% |
| `WeightScreen.js` | 709 | 1,093 | +54% |
| `UI.js` | 598 | 894 | +49% |

#296 got `LogScreen.js` from 2,325 down; it is back to 1,687. Today 20 app files
exceed 600 lines and hold 48% of the code.

**600 is correctly calibrated:** median app file is 171 lines and 85% are already
under 561, so it flags outliers rather than constraining normal work. No file
exists between 700 and 880 lines, so the threshold sits in a natural gap.

Scope: **app code only** — not tests, docs, dependency or config files. Long test
files are usually thorough rather than tangled, and a limit there would create
pressure to delete coverage. A genuinely cohesive file may carry a one-line
justification comment as a visible, rare exception.

Enforcement lands in the checker that redesign card **D2** already builds, in
"block new violations, report the existing 20 as debt" mode.

### S3. Explicitly out of scope
`syncAdapter.js` (1,817) and `syncQueue.js` (1,642) are the two largest files in
the app. No redesign card touches them, so splitting them helps this program not
at all, and they are the highest-risk code Kilo has — a subtle break loses workout
data weeks later rather than failing a test. They deserve their own issue on their
own merits, nowhere near a visual migration.

---

## Phase 3 — Analog Iron redesign

Deferred until Kilo is in production. Fully specified in
`docs/design/analog-iron-v0.125/migration-audit.md`; the cards are drafts inside
that document and become GitHub issues when this phase opens.

**14 implementation cards plus one zero-file verification gate**, consolidated
from 19 on owner direction — the six small independent surfaces (Plate
Calculator, More, Profile, Set New Password, App Guide, About) merged into a
single card, collapsing six device passes into one.

Order: `D0 → D1 → D2 → D3 → D4 → D5`, then the screen cards, then `D18`.

- **D0** — chart tokens and remaining visual decisions. *Owner decision already
  recorded: charts use a neutral ink role in both themes; vermilion is never an
  ordinary series colour and appears only for exceptional or execution states;
  multi-series charts distinguish by more than colour.* D0 still owes exact
  light/dark values, AA marker fills, and font/native-control specifics.
- **D1** — palette retint, Space Grotesk bundling, type/geometry tokens, native
  appearance. P3 (dark mode wiring) shipped in `1.0.0` via #985; D1 only
  retints the palettes it established.
- **D2** — the anti-pattern checker, including S2's line limit.
- **D3–D5** — shared primitives, chart, overlays.
- **Screen cards** — Home, Log (post-split), Analytics, Weight, Settings,
  secondary surfaces, Account, Backup.
- **D18** — read-only completeness verification. Owns no files.

Each card carries owner device sign-off as a closing requirement — a deliberate,
scoped exception to the automated-only verification default, because no automated
check can confirm a screen looks correct.

Two rules bind every card, added after review found them missing:

- **Native control appearance.** Any card whose files contain a `TextInput` sets
  `keyboardAppearance`; a `Switch` sets `trackColor`/`thumbColor`; a
  `DateTimePicker` sets `themeVariant` — all from tokens. D2 asserts these are
  *present*, since a forbidden-pattern scan structurally cannot catch an omitted
  prop, and manual device vigilance across six screens and two platforms is not a
  control.
- **Behavior-change escalation.** A card that cannot meet the visual target
  without changing behavior stops and escalates to the owner in writing. It never
  silently picks a compromise in either direction.

---

## Phase 4 — After the redesign

- Retake store screenshots and refresh the listing.
- Resume the frozen feature work: #956, #957, #960, #961, #962, #969.
- #578 CSV export and interoperability.
- `syncAdapter` / `syncQueue` structural work.
- Security workflow maintenance follows the completed #975/#976/#977 documentation;
  no separate roadmap gate remains.

---

## Open owner decisions

| # | Decision | Recommendation |
|---|---|---|
| P3 | Dark mode in `1.0.0`, or hide the toggle? | ~~Hide; land it in D1~~ **Resolved: wired in `1.0.0` (#985)** |
| P6 | Which of #975/#976/#977 are launch blockers? | **Resolved: all three are closed; their documented security workflows now exist.** |
| P8 | Frozen features in `1.0.0`? | No; resume in Phase 4 |
| P8 | #578 in `1.0.0`? | No |

Everything else in Phase 1 is a gate rather than a choice.
