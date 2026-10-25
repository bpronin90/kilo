# R7 (#1606) visual evidence: Log

The reference is the approved Home/Log/More hybrid design in the tracked
[redesign specification](../../../design/app-redesign-v3/README.md), especially
the [Log structure and behavior notes](../../../design/app-redesign-v3/source-notes/hybrid.md).
The first-screen references are
[`log-hard-dark.png`](../../../design/app-redesign-v3/shots/hybrid/log-hard-dark.png)
and
[`log-clay-light.png`](../../../design/app-redesign-v3/shots/hybrid/log-clay-light.png).
Additional state references are listed in the coverage table below. These
tracked references are the review source of truth; the local exploration files
named in issue #1606 were the original design provenance.

## Comparison checklist

- Keep the web back bar and docked five-tab bar where the app shell places them.
  The Log heading starts at the 16 px page inset with Plates and labelled ⋯ on
  its right; the header hairline remains full width.
- The current routine panel spans the 16 px page inset, uses the active 2 px
  theme border, and keeps its title/meta aligned to the same 18 px inner inset.
  The four-day index uses equal-width touch targets directly below the panel
  header. Its pinned position stays under the root header while the selected day
  is visible.
- Keep section and exercise names readable at their existing type scale. Set
  rows align load/bodyweight and reps consistently; older sessions remain muted,
  the newest row stays bold and marked LAST, and long text or warning rows wrap
  without being clipped or folded away.
- Retain the editor's existing title, note text, selection/caret, save/status,
  and danger-zone controls. Routine action, Recovery, and error disclosures
  stay in their production order with usable 44 dp targets.
- Hard-dark and clay-light use their existing KUA palette tokens. No changes to
  tab behavior, parser output, workout values, or persisted records are part of
  these captures.

## Capture provenance

- **New missing-state captures rendered at:**
  `c26876704c6ee2ec3410b0bda96ace3bc706c468` (full product commit SHA).
  Expo web was exported from a clean detached worktree at that commit; the
  manifest recorded by the run confirms the SHA, 390×844 CSS px viewport, 2×
  DPR, both themes, and successful theme-canvas checks for all 24 captures.
- **Existing R7 captures:** ordinary states were rendered at
  `11675b9814e1867ac4f45110da9f31f595fc958b`; Recovery-panel images were
  rendered at `cbdcae5ba999ada59fc47869c3b7cdeeea285247`. Those images remain
  applicable after the main refresh: its additional product changes are in the
  Weight and Analytics screens, Analytics section aliases, and the unrelated
  SessionGauge container. It does not change Log screen composition, the Log
  row renderer, or the shared shell's visible Log layout. The issue-local
  capture/fixture commit and subsequent evidence commit do not change product
  rendering.
- **Clock and viewport:** `2026-10-23T12:00:00.000Z`, UTC, 390×844 CSS px at
  2× DPR. The shared real-app Expo web harness checks each rendered theme's
  canvas color. Each required state is captured in hard-dark and clay-light;
  the Log first screen is also captured in grass-light and clay-dark.

### Reproduction

From the repository root, export the committed product tree and run the
issue-local supplemental states. The `only` argument is an optional,
comma-separated filename-prefix filter; omitting it runs the complete R7
capture matrix.

```sh
git worktree add --detach /tmp/kilo-1606-r7-render c26876704c6ee2ec3410b0bda96ace3bc706c468
ln -s /home/benpronin/projects/kilo/.claude/worktrees/issue-1606/mobile/node_modules /tmp/kilo-1606-r7-render/mobile/node_modules
cd /tmp/kilo-1606-r7-render/mobile
EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
  npx expo export --platform web --output-dir /tmp/kilo-1606-r7-dist-c268
cd /home/benpronin/projects/kilo/.claude/worktrees/issue-1606
KILO_RENDERED_COMMIT=c26876704c6ee2ec3410b0bda96ace3bc706c468 \
  node docs/evidence/app-redesign-v3/r7/capture.cjs \
  /tmp/kilo-1606-r7-dist-c268 /tmp/kilo-review-tools/node_modules \
  /tmp/kilo-1606-r7-rerun-correct \
  log-timed-valid,log-set-line-tap,log-set-line-double-tap-editor,log-editor-syntax-help,log-recovery-active-manage,log-recovery-inactive,log-recovery-completed-history,log-no-current-new-routine,log-adoption-prompt,log-notes-error,log-loading
```

The export uses only the harness's mock Supabase endpoint; the harness blocks
other non-local requests. The README and PNGs are evidence-only changes after
the rendered commit, so the screenshots remain valid for the final evidence
head.

## State and theme coverage

All PNGs are under [`after/`](after/). For the entries marked **both**, the
matching `-hard-dark.png` and `-clay-light.png` files exist and were checked in
the 24-capture run manifest. The original four-theme first-screen set includes
hard-dark, clay-light, grass-light, and clay-dark.

| State | Hard-dark | Clay-light | Result |
|---|---|---|---|
| First screen: Log header, Plates, ⋯, routine, day index, inline history | [after](after/log-first-hard-dark.png) | [after](after/log-first-clay-light.png) | Pass; matches the approved structure with the issue deviations below. |
| First screen extra palettes | [clay-dark](after/log-first-clay-dark.png) | [grass-light](after/log-first-grass-light.png) | Pass; both are additional first-screen theme checks. |
| Deload mode off (default production gating) | [after](after/log-first-deload-off-hard-dark.png) | [after](after/log-first-deload-off-clay-light.png) | Pass. |
| Week A/B routine | [after](after/log-routine-ab-hard-dark.png) | [after](after/log-routine-ab-clay-light.png) | Pass. |
| Sticky Tuesday day index | [after](after/log-day-tuesday-hard-dark.png) | [after](after/log-day-tuesday-clay-light.png) | Pass. |
| Earlier exercise sessions expanded in place | [after](after/log-history-expanded-hard-dark.png) | [after](after/log-history-expanded-clay-light.png) | Pass; all sessions remain in note order. |
| Routine actions, including edit entry | [after](after/log-actions-sheet-hard-dark.png) | [after](after/log-actions-sheet-clay-light.png) | Pass. Existing Edit, Skip week, plate, copy/share/image and More Routines actions remain visible. |
| Existing plate calculator | [after](after/log-plates-hard-dark.png) | [after](after/log-plates-clay-light.png) | Pass; the production modal is retained. |
| Existing editor open / Done / Revert / Delete | [after](after/log-editor-open-hard-dark.png) | [after](after/log-editor-open-clay-light.png) | Pass; the editor remains unchanged by R7. |
| Syntax help from the existing editor | [after](after/log-editor-syntax-help-hard-dark.png) | [after](after/log-editor-syntax-help-clay-light.png) | Pass; captured in the current clean export. |
| More routines at the end of Log | [after](after/log-more-routines-hard-dark.png) | [after](after/log-more-routines-clay-light.png) | Pass. |
| Active Deload panel | [after](after/log-deload-hard-dark.png) | [after](after/log-deload-clay-light.png) | Pass; generated using the production action. |
| Active Recovery panel | [after](after/log-recovery-hard-dark.png) | [after](after/log-recovery-clay-light.png) | Pass. |
| Active Recovery management opened | [after](after/log-recovery-active-manage-hard-dark.png) | [after](after/log-recovery-active-manage-clay-light.png) | Pass; the active block's Manage controls are open. |
| Inactive Recovery management entry | [after](after/log-recovery-inactive-hard-dark.png) | [after](after/log-recovery-inactive-clay-light.png) | Pass; completed history is reachable without an active block. |
| Completed Recovery history expanded and block selected | [after](after/log-recovery-completed-history-hard-dark.png) | [after](after/log-recovery-completed-history-clay-light.png) | Pass; selected completed block and canonical summary are visible with its Manage disclosure available. |
| One set-line tap | [after](after/log-set-line-tap-hard-dark.png) | [after](after/log-set-line-tap-clay-light.png) | Pass; the read view stays open. |
| Exercise double-tap enters existing editor | [after](after/log-set-line-double-tap-editor-hard-dark.png) | [after](after/log-set-line-double-tap-editor-clay-light.png) | Pass; the note editor opens with a focused text caret. |
| Empty account / no current routine | [after](after/log-empty-hard-dark.png) | [after](after/log-empty-clay-light.png) | Pass; first-routine entry remains available. |
| No-current New Routine editor | [after](after/log-no-current-new-routine-hard-dark.png) | [after](after/log-no-current-new-routine-clay-light.png) | Pass; title, note, Save routine, and existing Done affordance remain reachable. |
| Saved routine adoption choice | [after](after/log-adoption-prompt-hard-dark.png) | [after](after/log-adoption-prompt-clay-light.png) | Pass; both Use as current and Not now are visible. |
| Workout notes first-load state | [startup overlay](after/log-loading-overlay-hard-dark.png), [Log skeleton](after/log-loading-hard-dark.png) | [startup overlay](after/log-loading-overlay-clay-light.png), [Log skeleton](after/log-loading-clay-light.png) | Pass; the runner holds the real web storage read. The second image temporarily hides only the startup overlay to show Log's underlying skeleton. |
| Workout notes read error and retry | [after](after/log-notes-error-hard-dark.png) | [after](after/log-notes-error-clay-light.png) | Pass; seeded unreadable storage produces the visible error and Retry control. |
| Skipped, warning/unparsed, bodyweight, kg-converted and annotation rows | [after](after/log-edge-rows-hard-dark.png), [lower](after/log-edge-rows-lower-hard-dark.png) | [after](after/log-edge-rows-clay-light.png), [lower](after/log-edge-rows-lower-clay-light.png) | Pass; warning rows remain visible and never fold. |
| Valid timed rows plus bodyweight sessions | [after](after/log-timed-valid-hard-dark.png) | [after](after/log-timed-valid-clay-light.png) | Pass; `-Plank 3x30 sec` declares duration under production grammar and visibly renders `30s`, `30s`, `45s`; Pull Up remains BW. |

### Loading and error setup

The loading runner patches only the web `Storage.prototype.getItem` read for
`kilo_workout_notes` to return a pending thenable, using the same verified
AsyncStorage shim technique as the R2/R3 evidence runners. It records the real
startup overlay first, then hides that overlay only in the capture page to show
the underlying Log skeleton while the read is still held. The read is released
before the browser session ends. The notes-error overlay instead seeds invalid
JSON in the local fixture and verifies the production error banner and Retry
button. Neither setup changes app code or shared harness files.

### Platform-dialog limits

This is an Expo **web** render. It shows the app before/after states and the
actual web-rendered UI, but cannot reproduce iOS/Android native date pickers,
system share sheets, or OS alert chrome. No screenshot is presented as proof
that those native dialogs themselves were rendered. Deload/Recovery panels and
the Log editor surfaces around them are captured above.

## Deliberate deviations

- Production has no week-number concept, so the routine identity remains
  `Current routine` / `Baseline routine · paused` rather than inventing
  “Week N.”
- The history sheet and timer presentation are delivered by R8 (#1607); R7 does
  not introduce an inert history button or restyle the editor timer.
- Progression suggestions remain below routine content.
- Recovery's production copy, week table, action zone, and `surfaceSection`
  state fill are retained; R7 changes only the panel border and kicker/headline
  type.
- Plates continues to open the existing centered `PlateCalculatorModal`.
- The web-only `← Home` bar is from the R1 shell and stays above the Log root
  header in these captures.
