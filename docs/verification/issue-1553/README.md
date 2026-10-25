# Walkthrough verification

> **Historical images:** completed captures have been removed from the current tree.
> [Browse the preserved image snapshot](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/verification/issue-1553/) at
> `f7cf024e488471136e11e76834570093b140eaec`; image filenames, counts and sizes below describe that snapshot.
> Capture scripts, fixtures and the verification record remain here.

Reference: [issue #1553 and its visual checklist](https://github.com/bpronin90/kilo/issues/1553),
[existing KUA foundation](../../design/kinetic-utilitarian-athletic/foundation.md), and the existing five app screens and floating tab bar.

Rendered commit: `af64a47e397e69b071520fd69ce08a21378e7d23`.
The subsequent evidence/documentation commit changes no app source, tests, assets,
fonts, dependencies, or rendering configuration, so these renders apply to its head too.

Viewport: 390 × 844 CSS pixels, Chromium, clean browser storage, Hard Court light,
reduced motion enabled. This is the real Expo web app, with no mocked app data or
components. No native simulator or physical-device screen-reader session was run.

## Checklist recorded before implementation

- One short tip above its real, measured tab; visible screen behind a restrained scrim.
- At least 16 dp horizontal clearance within the content/safe-area column; no
  overlap with the navigation anchor or screen insets.
- Existing KUA colors, typography, spacing and radius; body text at least 14 sp,
  naturally wrapped without a fixed-height text box.
- Actions at least 44 × 44 dp, wrapping when needed; scrollable tip if constrained.
- Modal focus on title/step; background controls inaccessible; focus restored on
  explicit dismissal, without stealing focus from an interrupting blocking flow.
- Existing screens and tab-bar behavior retained. Wait for valid visible bounds.
  Static transitions respect reduced motion.

## Evidence and comparison

| State | Image | Result |
| --- | --- | --- |
| Home, 1 of 5 | [Home](https://github.com/bpronin90/kilo/blob/f7cf024e488471136e11e76834570093b140eaec/docs/verification/issue-1553/step-1-home.png) | Pass: Home visible; ring exactly matches Home tab. |
| Log, 2 of 5 | [Log](https://github.com/bpronin90/kilo/blob/f7cf024e488471136e11e76834570093b140eaec/docs/verification/issue-1553/step-2-log.png) | Pass: Log and its existing example visible; correct tab. |
| Weight, 3 of 5 | [Weight](https://github.com/bpronin90/kilo/blob/f7cf024e488471136e11e76834570093b140eaec/docs/verification/issue-1553/step-3-weight.png) | Pass: unsaved weight form visible; correct tab. |
| Analytics, 4 of 5 | [Analytics](https://github.com/bpronin90/kilo/blob/f7cf024e488471136e11e76834570093b140eaec/docs/verification/issue-1553/step-4-analytics.png) | Pass: empty analytics visible; correct tab. |
| More, 5 of 5 | [More](https://github.com/bpronin90/kilo/blob/f7cf024e488471136e11e76834570093b140eaec/docs/verification/issue-1553/step-5-more.png) | Pass: More visible; correct tab and Done action. |
| Replay after completion/reload | [Replay](https://github.com/bpronin90/kilo/blob/f7cf024e488471136e11e76834570093b140eaec/docs/verification/issue-1553/replay-home.png) | Pass: starts at Home, 1 of 5. |
| Longest tip, 200% text | [Large text](https://github.com/bpronin90/kilo/blob/f7cf024e488471136e11e76834570093b140eaec/docs/verification/issue-1553/log-large-text.png) | Pass: title, body and action labels wrap without clipping; all actions visible. |

All normal tips have 16 px side clearance, and end at y=777, 12 px above their
anchors at y=789. The 46 px-high highlight bounds equal the actual tab bounds on
all five steps; raw geometry is in [capture-result.json](capture-result.json).
The large-text render doubles computed font sizes and line heights **in the web
tip only**, simulating accessibility text enlargement. It does not claim a native
OS font-scale run. The panel still clears the tab and screen edges.

The capture exercised Next, Back, Done → Home, reload suppression, replay through
More → App Guide (the existing Help screen) → Replay walkthrough, Skip → current
Log screen, and reload suppression again. It asserts that background tabs are
absent from accessible role queries while the modal is open. No page exceptions
occurred. Comparing local storage before and after changed only
`kilo:welcome-walkthrough:v1`; no fitness data or editor drafts were written.
The script and durable screenshots are committed here for independent review.

## Reproduce

From `mobile/`, start the committed app in a fresh server process:

```sh
CI=1 APP_ENV=development EXPO_PUBLIC_APP_ENV=development npm run web -- --port 8093 --clear
```

Restart this process after app source changes: CI mode disables Metro watching.
From the repository root, using an existing Playwright installation and Chromium:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chromium \
node docs/verification/issue-1553/capture.mjs
```

`CAPTURE_URL` can override the localhost URL. The script creates a fresh browser
context and writes the images plus a commit/viewport/geometry report.

Targeted checks: 614 tests passed in the walkthrough, walkthrough-storage, Home,
Help, app-navigation, app-startup-overlay, and theme-rendering suites. These cover preference
failures, write failure, loading/error/populated/empty reads, stale anchors, rapid
taps, navigation, replay, system Back, interruption, cleanup, and startup gating.
The explicit Allowed Files scope check also passed.
