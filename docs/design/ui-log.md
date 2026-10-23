# Log UI Contract

For maintainers changing routine editing, action hierarchy, and Recovery note interaction. Preserve the documented style lock and explicit exceptions. Analytics Recovery evidence and Manage-block ownership are in [Recovery UI](ui-recovery.md).

## Log Screen

Source: `mobile/screens/LogScreen.js`, and the extracted
`mobile/components/LogActiveRoutineCard.js`, `LogPreviousRoutines.js`, and
`LogScreenEditorCard.js`. The Log style lock spans all of these, not
`LogScreen.js` alone.

Style lock header at lines 1-46 (`mobile/screens/LogScreen.js`): do not change
Log styling unless the repo owner explicitly asks. The authorized layout
exceptions for #710 and #711 are enumerated in that same header block. #843
is a further owner-authorized exception (the Recovery/Routine redesign
below), scoped to `styles.tabToggle` in `LogScreen.js` plus
`LogRecoverySection.js`, `RecoveryBlockEndModal.js` (new), and
`LogPreviousRoutines.js`. #847 is a further owner-authorized exception,
scoped to `LogPreviousRoutines.js` alone, that removes #843's enclosing More
Routines panel and restores individually rounded non-current routine cards
(see Consequences below). #918 is a further owner-authorized exception,
scoped to text `color` values ONLY, that moves every string the user reads off
the `accent` mark value onto `accentText` / `chipAccentText` across the Log
tab, `RecoveryBlockEndModal.js`, and `WorkoutSubheading` in `UI.js`. #921 is a
further owner-authorized exception, scoped to the effective target geometry of
exactly two controls in `LogRecoverySection.js` — `Edit note` and the A/B
segment — and to nothing else: no color, type, spacing, rail, or row-height
value in the Recovery card changes with it. #1321 (a Log-tab cleanup the repo
owner requested, which asked that the surrounding experience improve while the
locked current-routine presentation stays as is) changes action presence and
order only: Skip week's visibility on the current card (no style value changes),
the Deload card's action order and retired hint, the previous-routine body's
action order (`Set as current routine` becomes its one filled button), and tab
roles on the view switcher. It is not a general exception to the style lock.

The Current routine card remains locked. #843 and #847 do not authorize
touching it at all; #918 reaches exactly one property on it —
`currentNoteTitle`'s ink — and nothing else about that card. No exception to
date changes any size, weight, spacing, layout, fill, or border value on it.

### Redesign v3 Log (#1606, owner-approved R7)

#1606 is the owner-approved app-wide redesign exception for the Log read view;
it supersedes the locks above for the files it lists. The editor is unchanged.

- **Root header:** title `Log`, an outlined `Plates` button and a labelled `⋯`
  (`Routine actions`). They appear only while a current routine is readable.
  Both open the one plate calculator and the one Routine actions sheet
  (`components/log/LogRoutineActionSheet.js`, owned by
  `screens/log/LogRoutineReadView.js`). The sheet keeps its items, labels and
  order. The card renders its own copy only when mounted standalone.
- **Routine panel:** title (collapse target), identity line, and `Week A`/`Week B`
  as a radio group. There is no week number, because production has no
  week-number concept.
- **Sticky day index** (`screens/log/LogDayIndex.js`): one chip per parsed day
  group with a heading, in note order, keyed by group index. Tapping a chip
  scrolls to that group. A pinned copy sits under the header while the card's
  own index is scrolled away. Offsets reset on note, A/B slice or text change.
- **Exercises** (`WorkoutContentRenderer` `presentation="log"` →
  `components/log/LogExerciseRows.js`):
  - Each exercise shows its newest 3 sessions: older ones muted, the latest bold
    with `LAST`.
  - `N earlier sessions` expands the rest in place. Folded rows stay mounted
    but hidden.
  - Skips, annotations and kg/BW/timed lines render as before. Unparsed or
    warning rows are never folded.
  - Fold state is keyed by note + slice + text + occurrence.
  - Deload lines render bold without `LAST` or `Track`. Other callers keep the
    default presentation.
- **Active panels:** the current routine, the active deload (`Active deload`
  kicker) and the active Recovery block share the 2px primary border. All their
  actions are unchanged.
- **Deferred to R8 (#1607):** the history icon/sheet and the timer presentation.

### Action hierarchy (#711)

Routine-card headers carry identity only (`ui-design-rules.md` §14). Every
action is placed by how often it is used:

| Tier | Actions | Location |
|---|---|---|
| Primary — every session | `Track` a lift, `Edit`, `Week A/B`, `Skip week` | Active card body; `Week A/B` in the one action strip under its header (`LogActiveRoutineCard.js` `actionStrip`); `Edit`, `Skip week` and `Remove skip` lead the Routine actions menu (#1327) |
| Occasional — workout-time tool | `Plate calculator` | A labelled `Plates` button in the Log root header beside the Routine actions `⋯` (#1445, moved by #1606; one tap, no sheet), plus the Routine actions menu entry after the skip actions and before `Copy` (#1375); both open `PlateCalculatorModal` with an empty, typed target. Rendered note weights are plain text with no tap target or dashed cue, so nothing in the note body competes with double-tap-to-edit or text selection. Analytics Strength keeps its prefilled per-lift entry. |
| Secondary — occasional | viewed-card `Week A/B`, `Set as current routine` (the body's one filled action), `Edit routine`, share/copy family, `Delete routine` last | Non-current row's expand-on-tap body (`LogPreviousRoutines.js` `inlineActions`), inside expanded routine management, in that order |
| Quick access — reachable without opening (#756, #836; the per-row quick action retired #843) | `New routine` (icon + visible label, the section's ONE create-routine affordance) | A sibling row of the section title, OUTSIDE the collection disclosure entirely (#843, #847) — present and identical whether the collection is collapsed or expanded (`LogPreviousRoutines.js` `topRow`) |
| Rare — once per training block | `Start recovery block` | A persistent, low-emphasis row directly under the current routine card (`LogScreenContent.js` `recoveryStartRow`), the first row of the one outlined Recovery entry group (`recoveryEntryGroup`, #1325), never nested in a menu or disclosure; absent whenever a block cannot be started (#823, superseding #724's routine-management placement) |
| Rare — reopening the most recently completed block, offered only with no block active (#839) | `Reopen recovery block: {baseline title}` | A second, lower-emphasis row (`LogScreenContent.js` `recoveryReopenRow`) in the same Recovery entry group, below a hairline when `Start recovery block` is present (#1325, replacing two separate outline rows) — same row shape, `textMuted` ink instead of `accent`, so `Start` stays visually primary; computes its own visibility independently and can render alongside `Start`. Since #1315 this row and the Manage block's own Reopen (newest completed block only, no active block) are the only Reopen entry points; Analytics offers none. |
| Recovery — expected next step | `Complete Week {N}` **or** `Add week` (never both), each behind its own confirmation | The active card's action zone, visible by default, full-width/48px, and the card's only accent-filled control, with a muted explanatory caption beneath it (`LogRecoverySection.js`, #789/#804/#836/#843) |
| Recovery — reversal, offered only for the just-completed latest week | `Undo completion` | Beside the primary action, muted (not `error`) ink — a routine correction, not a destructive action (#843; was an `error`-labeled chip) (`LogRecoverySection.js`, #836) |
| Recovery — correction or once-per-block | `Counting in normal analytics`, `Unlink Week {N}'s note`, `End recovery block` | `Manage block`, a sibling card next to the active card (#843, no longer a disclosure INSIDE it), holding three divided list rows; `End recovery block` opens `RecoveryBlockEndModal` instead of `Alert.alert` |
| Routine/Recovery editor — safe exit | `Done` (and Android Back) | Keeps the latest edit, flushing any pending or in-flight autosave before the editor closes (#851) |
| Editor — whole-edit rollback | `Revert this edit` | A danger-zone body action, never an ambiguous header `Undo`; confirmation names the editor-entry snapshot and includes already-autosaved changes. Recovery's scoped inline `Cancel` opens a choice between Keep editing, Done, and the same confirmed rollback (#851) |

Consequences to preserve:

> **Unresolved historical wording:** the inherited #839/#843/#727 bullets below
> still place reopening/inclusion controls on Analytics or hide completed-only
> Log history, but the later #1315/#1331 contract in [Recovery UI](ui-recovery.md)
> places all writes and completed-block management in Log. These statements are
> retained for provenance, not authorization to move controls. Reconcile the
> older clauses with that owner-approved contract before changing behavior.

- **More Routines has no enclosing panel (#847, superseding #843's
  card-equivalent panel with a flat, divided row list).** Each non-current
  routine renders as its own quiet, individually rounded `Card` (`radius 16`,
  1px `cardBorder`, standard card background), separated from its siblings by
  ordinary shell spacing (`LogPreviousRoutines.js` `cardList`, `gap: 12`) —
  not a shared outer surface, a flat divided list, or a tinted collection bar.
  This restores the pre-#843 (`096bf89^`) hierarchy: individual pills,
  restrained borders, the active routine dramatically more prominent by
  comparison. No accent rails, filled accent headers, or "current" badges are
  added to these cards.
- **The count and `New routine` live OUTSIDE the collection disclosure
  entirely (#843, #847, superseding #756/#836's in-header placement).**
  `More Routines · {count}` IS the section's `SectionTitle` now — always
  visible, expanded or collapsed, never repeated or hidden by the
  disclosure's own state — and a sibling 44dp outlined `New routine` control
  (icon + visible label, this section's ONE create-routine affordance) sits
  beside it in the same header row.
- **More Routines is a collapsed-by-default disclosure (#724), and since #847
  the disclosure trigger is a lightweight text-plus-glyph control, not a
  bordered panel header.** It is modeled on Analytics → Progressive
  Overload's bulk expand/collapse control (`AnalyticsScreen.js`
  `collapseAllButton`): compact `Show routines`/`Hide routines` text (muted
  ink, uppercase, letter-spaced) plus a `MaterialIcons` `unfold-more`/
  `unfold-less` glyph (16, `textMuted`), a 44dp touch target, explicit
  `accessibilityRole="button"`, and `accessibilityState={{ expanded }}`. It
  carries no border, background tint, or card radius of its own — unlike
  #843's bordered/tinted panel header, and unlike Progressive Overload's own
  chevron (`unfold-less`/`unfold-more` is reused here deliberately: this
  control also acts on a whole collection at once, not a single panel).
  Collapsed, the routine cards render nowhere. An external request to reveal
  a non-current routine — a typed navigation intent (#718) naming a
  non-current, non-deload routine, and nothing else since #775 — auto-expands
  the disclosure via a monotonic reveal nonce keyed on the REQUEST, not on
  `viewingNoteId`, so a repeat request for the already-selected note reopens
  it while an unchanged nonce respects a user's collapse. A Recovery tap
  reveals nothing: it reads its note in the Recovery card instead (see below).
- **The per-row icon-only `Set as current routine` quick action is retired
  (#843, superseding #756).** Switching the current routine is reachable only
  from a row's own expanded body now, alongside `Edit routine` and `Delete
  routine`; a collapsed row shows only title and an inline `Created {date} ·
  Recovery week {n}` metadata caption (folding the former standalone recovery
  badge into that one line) plus the expand glyph.
- **The disclosure state is owned by `LogScreen`, not by the sections (#775).**
  Routine and Deload are mutually exclusive branches, so `LogPreviousRoutines`
  and `LogDeloadSection` unmount on every view switch; `expanded`,
  `deloadCollapsed`, and the consumed-reveal marker therefore live in
  `LogScreen` and arrive as props. A user's collapse choice survives
  Routine↔Deload↔Routine, and a consumed reveal request is never replayed by the
  remount.
- **A routine row's date is its creation day (#775).** The sub-line and the
  row's `accessibilityLabel` read `Created <date>` from `saved_at`, falling back
  to the creation day encoded in the note id (`wn_YYYY-MM-DD_…`) and then to no
  date at all. `updated_at` is never displayed: it is the sync conflict cursor
  (`docs/architecture/backend-schema.md`), so editing, tapping `Week A/B`, syncing, or
  restoring a backup all moved it. The expanded list sorts by that same
  displayed field, newest first, undated last in notebook order. The viewed
  row keeps its `Week <X> · ` prefix in front of the date.
- **The collapsed header has no `Latest:` line (#836, retiring #775's
  collapsed-summary naming).** Naming one routine out of several implied a
  hierarchy among prior routines that does not exist. Collapsed, the header
  shows only a `{N} more routine(s)` count, at a weight legible as a
  section heading (`15`/`700`, `colors.text`) rather than a small caption;
  expanded, the count is not repeated at all, since the list below it already
  shows every routine.
- **Both skip actions live in the Routine actions menu (#1327, owner request),
  right after `Edit`:** `Skip week` is always offered (skips stack by design) —
  through a save in flight and after a skip; a press during a save answers with
  `Finishing the previous save. Try again.` — and `Remove skip` sits beside it
  only while a trailing skip exists. Both are live menu items, never a dimmed
  pair. Choosing one (or `Copy`) from a collapsed card opens the card first,
  so its result line is visible. The strip under the header now carries `Week A/B` only, so a
  single-week routine renders no strip at all. There is no opacity-dimmed
  disabled variant.
- The `Double-tap to edit` hint is retired in the active card, the non-current
  card body, and the Deload cards (#711, #724); the gesture itself still works.
- The active Deload card keeps `Deload complete` as its one filled action
  (#1329). Beneath it one row holds an outlined `Edit` beside a 44dp
  `More deload actions` trigger, whose bottom sheet (`log/ActionSheetMenu.js`)
  lists `Regenerate deload` (disabled, reading `Generating…`, while a generation
  runs) and `Delete active deload` (danger ink, same confirmation).
- **Prompt tools share one flow (#1385):** `RoutinePromptToolsScreen.js` is
  configuration for `routinePromptTools/PromptFlow.js` (Choose, summary,
  Copy/Share, optional import slot, collapsed `PromptDisclosure`). Routine
  choices use `RoutinePicker.js`, a summary row that opens a bottom sheet with
  single or multi select and a `Done` button; Targets also offers Select all,
  All except authority and Clear. `NormalizationImport.js` holds the
  normalization return path and renders before the expanded prompt text.
  Normalize is the compact exercise-only protocol (#1386): its summary reads
  `N routines · M distinct headers`, a selection with nothing safe to share
  shows a blocked message instead of a prompt, and the return path previews each
  header mapping (`old header → authority name`, the descriptor that moves to a
  note, affected occurrences) with checkbox rows to deselect a mapping, a whole
  routine, or one occurrence. A malformed reply lists its line errors and blocks
  Apply; a snapshot saved by an older version shows a `Discard saved prompt`
  notice instead of the reply field.
- **An expanded non-current routine shows three controls (#1329):** the filled
  `Set as current routine`, then one row with an outlined `Edit routine` beside a
  44dp `More actions for {title}` trigger. Its bottom sheet lists `Copy`, `Share`,
  `Share as Image` and `Delete routine` (danger ink), with the same accessibility
  labels and handlers they had as full buttons. A chosen sheet item runs only once the
  sheet is gone (iOS: the Modal's `onDismiss`, with a 700ms fallback), so its
  alert, share sheet or image preview never opens behind the dismissing sheet. The
  sheet's bottom padding is `24 +` the bottom safe-area inset (#1331), so its
  last item clears the home indicator; the current-routine card's Routine
  actions sheet uses the same padding.
- **More Routines opens on its three newest routines (#1329).** A
  `Show all {N} routines` / `Show fewer` text control (44dp, accent ink) appears
  below the list only when more exist. The viewed routine always renders, so a
  navigation intent never targets a hidden card.
- **An unsaved routine has no `Delete routine` (#1329).** Before the first save,
  `Clear draft` is the Danger Zone's only action. The New Routine button reads
  `Save routine`, captioned `Saves and keeps editing. Done saves and closes.`
- **Rest timer is one docked control.** In current-routine edit the header
  control stays mounted through idle (stopwatch), running (live countdown) and
  done (`Rest over`); one anchored 288dp panel (#1327, clamped to both
  viewport edges on narrow screens) holds a header with
  the state in large type (`Rest timer`, the live countdown, or `Rest over`)
  and a caption, five equal-width presets in one row labelled in the
  countdown's m:ss format (`0:30 1:00 1:30 2:00 3:00`; Start, or Restart while
  running/done), and a full-width outlined Cancel or Dismiss button; a failed background alert shows
  on the closed control as a `notifications-off` glyph. App.js hides the
  app-shell pill only while that control is on screen — once the editor scrolls
  it away (past 12dp) the fixed pill returns and the docked control turns
  invisible and inert in place (no header reflow) — so the countdown never shows twice and is
  never unreachable; the pill shows Cancel (running) or Dismiss (done) directly.
- **Recovery is its own tab, present only while `LogRecoverySection` has
  something to show (#823).** `recoveryTabVisible` (`LogScreen.js`) mirrors
  that component's own early-return contract exactly — not just an active
  block, but also a pending/in-flight recovery operation, a stale snapshot
  with no active block, or a terminal initial-load failure
  (`!recoveryReady && recoveryStateError`, as opposed to still-loading), all
  of which the component already renders a banner/retry for. The
  Routine/Deload pill becomes a three-way
  Routine/Deload/Recovery toggle whenever `deloadModeEnabled` or
  `recoveryTabVisible` is true; Recovery renders first (leftmost) whenever
  it's present, and the tab disappears the instant nothing is left to show —
  `effectiveTabView` falls back to `routine` the same way it already did for
  a since-disabled Deload tab. Recovery is also the DEFAULT landing tab
  whenever it's present: it rendered unconditionally at the top of the
  Routine tab before this redesign, so a one-shot effect
  (`recoveryDefaultAppliedRef`, `LogScreen.js`) selects it the first time
  verified Recovery state resolves with something to show, preserving that
  same effective visibility without fighting a later manual switch to
  Routine/Deload. Confirming `RecoveryBlockStartModal` also navigates there
  (`setTabView('recovery')` in `handleConfirmRecoveryBlock`), so the block
  just created is where the user lands. `LogRecoverySection` itself renders
  unchanged — only which tab hosts it, and when, moved.
- The primary Recovery entry point (`Start recovery block`) is a persistent
  row under the current routine card, not inside routine management or the
  Recovery tab (#823, superseding #724's routine-management placement). It is
  **absent** — not merely disabled — whenever a block cannot be started: it
  renders only when a baseline note is eligible, no block is active, the
  shared Recovery read is verified and not stale, and no Recovery action is
  pending/in-flight with `mutationsAllowed` true. When shown it is always
  live, and opens `RecoveryBlockStartModal` with
  `{ mode: 'routine', note: null }` so the modal's own baseline/Week 1 pickers
  choose the subject; `startRecoveryBlock` rechecks the authoritative
  precondition at confirm.
- **A second, secondary entry point reopens the newest completed block
  (#839).** `Reopen recovery block: {baseline title}` renders directly below
  `Start recovery block` — same row shape, `textMuted` ink rather than
  `accent` so `Start` stays visually primary — whenever no block is active
  and the newest completed block (by `completed_at`) is live. It computes its
  visibility independently of `Start`'s and the two render together whenever
  both qualify; neither gates the other, and both disappear once either
  succeeds and a block becomes active. Tapping it confirms
  (`Reopen this recovery block?`, naming the baseline, stating that every
  week's status is unchanged and that only the most recent completed block
  can be reopened while no other is active) before calling
  `useRecoveryBlockLifecycle().reopenBlock`, which clears only the block's
  `completed_at` — no week's completion state moves. The Analytics evidence
  card (`AnalyticsRecoverySection.js`) offers the identical action, low
  -emphasis and non-destructive, on the newest completed block's own card
  only — never on every collapsed history row, and never on an older
  completed block. `Start` and `reopenBlock`'s writes now run behind the same
  process-wide recovery-operation lock (`runGuardedRecoveryAction`), so the
  two can never both observe "no active block" and create conflicting state.
- **A Recovery week row reads its own note (#775).** Tapping a live week renders
  that note inline in the Recovery card, off the same
  `viewingNoteId`/`viewingNote`/`viewingNoteDayGroups` state the routine and
  deload viewers use; More Routines is not revealed and does not change state,
  and a week linked to the *current* routine is readable like any other rather
  than being an inert press. Because that viewer state projects one half of an
  A/B note, the inline read also carries the non-current card's `Week A/B` pill
  in its existing treatment and with the same role, label, and `selected` state
  — otherwise an A/B recovery week's other week would be unreachable here. The
  inline read also carries an `Edit` button in the same `inlineSwitchButton`
  treatment (#823), opening the shared editor via `handleEditViewedNote`
  (not `handleOpenOtherNote`, deliberately: it reads the currently-selected
  A/B week off shared viewing state, so Edit opens the same half the user was
  just reading) — every other note viewer in this tab (deload record, prior
  routines) already had one; a recovery week's note previously had no path
  back into editing. A week whose `note_id` is null, or names a note
  absent from the notebook, shows `Note unavailable` in place of a title,
  announces `Recovery Week N, note unavailable`, and carries no `onPress`, no
  `chevron-right`, and no
  `accessibilityRole="button"` — the row remains, its `Unlink` remains
  (in the disclosure, see below), and that unlink confirmation drops both the
  quoted title and the "note itself is kept" clause. `Untitled Routine` is
  reserved for notes that exist.
- **The active Recovery card is one grouped, three-zone card (#789, restyled
  #843).** `padding: 0`, clipped at the existing 16px radius/border, holding a
  state zone, a week table, and an action zone, followed by a SIBLING `Manage
  block` card (see below) — the disclosure that used to live inside the
  active card moved out. The state zone (`colors.subtleBg`) leads with a
  `RECOVERY BLOCK` kicker, then a state-derived headline — `Week {N} in
  progress` or `Week {N} complete — add the next week` — then the baseline as
  one de-emphasized `Baseline: <routine>` caption; the headline still
  describes only the CURRENT week. The action zone holds exactly one
  full-width 48px primary action (`Complete Week {N}` while the week is open,
  `Add week` once it completes — mutually exclusive by construction) with a
  muted explanatory caption beneath it; once the current week is complete, a
  muted-ink (not `error`) `Undo completion` control sits beside it (#836) —
  offered only for that just-completed latest week. `Complete Week {N}`
  confirms its consequence before committing (`Complete Week {N}?`, stating
  that it completes the current week, preserves its note, and does not create
  or submit the next week's note, via `Alert.alert`, unchanged); `Undo
  completion` confirms too (`Reopen Week {N}?`).
- **Every live week is its own labeled, distinguishable row (#836, restyled
  #843).** Each row (`minHeight: 56`, 18px horizontal padding, divider lines)
  holds a 26px status dot (a success-at-12%-alpha filled circle with a 16px
  check for completed; an accent-bordered ring for in-progress — no more
  repeated `In progress`/`Completed` text), a fixed 56px `Week {N}` label, a
  one-line note title, and an `expand-more`/`expand-less` glyph — never
  `chevron-right` — for every linked-note row, completed weeks included. The
  current week's row and expanded body share an accent-at-6%-alpha background
  and a 3px accent left rail (padding compensated 18→15). A second tap on an
  already-expanded row collapses it; Back also collapses it. Accessible names
  are unchanged (`View <title>, Recovery Week N` / `Recovery Week N, note
  unavailable`; a completed row's name gains `, completed`). The expanded body
  is inset in a card-colored, 14px-radius bordered surface with an uppercase
  accent kicker on the left and the Recovery `A`/`B` segment (replacing the
  former `Week A/B` pill; a 32px visual centered in a real 44×44dp target box,
  so the header row is 44dp tall — **not** a sub-44dp exception, and **not** a
  `hitSlop`, which #921 removed because `noteSurfaceHeader` clipped it)
  above the content it governs. Note content renders via
  `WorkoutContentRenderer`'s `compact` prop (exercise 14/700; sets
  13/muted/600) — Routine rendering elsewhere stays full-scale. The one
  expanded-note action is a single outlined `Edit note` control
  (`accessibilityLabel="Edit"`, unchanged) at `minHeight: 44` since #921, with
  its 13px label, 1px outline, and 10px radius unchanged, opening the shared
  inline editor (#841) on the exact note and A/B half being viewed. Neither
  this control nor the A/B segment declares a fixed `height`, so both grow
  with the user's text scale (`ui-design-rules.md` §15, which holds the single
  authoritative sub-44dp exception list — this map records none of its own).
- **`Manage block` is a sibling card, not a disclosure inside the active card
  (#843, superseding #789's in-card placement).** Its trigger is **never**
  disabled — a locked user can still open it and see why each row is
  unavailable — and it renders four divided list rows with trailing
  chevrons: `Reason for this block` (#872 — the optional free text, showing
  the stored reason or `Not set. Add why this recovery started.`; tapping it
  swaps the row in place for an inline `TextInput` with `Cancel`/`Save`
  rather than opening a modal, seeded from the stored value so `Cancel` is a
  true discard, and saving empty text clears the field. Collapsing `Manage
  block` closes the editor with it — and note that this is not the only place
  the field is editable; since #1315 the same card also serves a completed
  block selected in Recovery Blocks),
  `Counting in normal analytics` (the row itself IS the
  Log-surface inclusion control now, `accessibilityRole="switch"` — tapping
  it writes `include_in_normal_analytics` directly, live `On`/`Off` stated
  on the row; a trailing `info-outline` help toggle swaps the subtitle for
  the same `RECOVERY_INCLUSION_HELP` copy on demand. The switch Pressable
  and the help Pressable are TRUE siblings under a plain, non-accessible
  wrapper View — not nested inside one another — so VoiceOver never groups
  the help button into the switch's own accessible tree (#843 review).
  `RecoveryInclusionToggle`'s own Switch presentation is unchanged but no
  longer used here — it still hosts Analytics/Home's per-completed-block
  rows), `Unlink Week {N}'s note` (always naming the concrete current week —
  there is no row-level `Unlink`), and error-colored `End recovery block`,
  which opens `RecoveryBlockEndModal` instead of `Alert.alert`.
- **Recovery's expanded-note viewer is a separate state slot from Routine's
  (#836).** `useLogOtherRoutineEditor.js` instantiates its shared
  `viewingNoteId`/`viewingNote`/`viewingNoteDayGroups`/`Week A/B` machinery
  twice — once for the Routine tab (`LogPreviousRoutines`, unchanged prop
  names), once for Recovery (`recoveryViewingNoteId` etc., consumed by
  `LogRecoverySection`) — so an expanded note on one tab can never appear on,
  or be inherited by, the other. Recovery's own note tap
  (`handleViewRecoveryNote`) is now toggling, matching the Routine tab's
  `handleViewOtherNote`, rather than the previous set-only handler.
- `LogRecoverySection` renders only when Recovery affects the current workout
  (active/pending/terminal-error/stale). Completed history and its inclusion
  controls live in Analytics (#727-729), so completed-only users see no Recovery
  section on Log. A cold first read stays neutral (renders nothing) so a
  non-adopter never sees a Recovery card flash; a terminal first-read failure
  still shows the unknown state with `Retry recovery`.
- `RecoveryInclusionToggle` (#843: no longer hosted on Log — see the
  `Manage block` bullet above — no longer hosted by Analytics since #1315; Log's
  inclusion row owns the control for the focused active or completed block, and the
  component's copy constants stay shared) states `Include recovery notes in normal analytics` and
  nothing else by default. The explanation moved behind an
  `info-outline` info button beside the label (#757): a 16dp glyph centered in
  a real `44 x 44` Pressable box — **not** a `hitSlop`, which React Native
  clips at the parent's bounds and which would therefore claim a target this
  one-text-line-tall row never had — plus `accessibilityState={{ expanded }}`
  and an accessible name that names the block so one row's button is distinguishable
  from the next. The disclosed paragraph describes what turning the switch ON
  does, names every surface it changes, and closes the two questions the
  always-visible copy existed to answer (the notes stay in Recovery Analytics,
  and stay editable). Disclosure state is per mounted control and is not
  persisted. Switch behavior, accessible names, and the error banner are
  unchanged.
- Relocated controls keep their existing style objects — the pill
  (`inlineSwitchButton`, `minHeight: 44`) and the shared `Button` variants
  (`switchButton` / `deleteButton`) are unchanged.

| Element | Property | Value | Line |
|---|---|---|---|
| Current note title | fontSize | `24` | `LogActiveRoutineCard.js` |
| | fontWeight | `800` | `LogActiveRoutineCard.js` |
| | color | `colors.accentText` (#918) | `LogActiveRoutineCard.js` |
| Current routine card | borderWidth | `4`, `colors.accent` on all sides | `LogActiveRoutineCard.js` |
| | padding | `0` | `LogActiveRoutineCard.js` |
| Other note title | fontSize | `17` | `LogPreviousRoutines.js:337` |
| | fontWeight | `700` | `LogPreviousRoutines.js:338` |
| Other note subtitle | fontSize | `12` | `LogPreviousRoutines.js:342` |
| | color | `colors.textMuted` | `LogPreviousRoutines.js:343` |
| WorkoutHeading (UI.js) | fontSize | `22` | UI.js:640 |
| | fontWeight | `800` | UI.js:641 |
| | textTransform | `capitalize` | UI.js:645 |
| WorkoutSubheading (UI.js) | fontSize | `14` | UI.js:655 |
| | fontWeight | `700` | UI.js:656 |
| | color | `colors.accentText` (#918) | UI.js:657 |
| | textTransform | `uppercase` | UI.js:658 |
| Exercise name (UI.js) | fontSize | `17` | UI.js:678 |
| | fontWeight | `700` | UI.js:679 |
| Set row font size (UI.js) | fontSize | `14` (`SET_ROW_FONT_SIZE`) | UI.js:8 |
| Mode toggle ("Done") | fontSize | `14` | `LogScreen.js:744` |
| | fontWeight | `700` | `LogScreen.js:745` |
| | color | `colors.chipAccentText` (#918 — sits on the chip fill) | `LogScreen.js:746` |
| | bg | `colors.chipBackground` | `LogScreen.js:741` |
| | borderRadius | `12` | `LogScreen.js:740` |
| Input field | fontSize | `16` | `LogScreenEditorCard.js:626` |
| | borderRadius | `16` | `LogScreenEditorCard.js:621` |

---
