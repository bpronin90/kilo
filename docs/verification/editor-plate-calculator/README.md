# Editor plate calculator — issue #1650

The owner asked that Plates **not** sit beside the rest timer in the editor tool row (shared with the timer, syntax help and the problem badge), so it is a labelled 44dp **Plates** button in the editor header, beside Done. It opens the existing editable-target calculator; one modal is hosted by `LogScreen` in both modes (`RoutinePlateCalculator`), so it no longer unmounts with the read-view header.

Layout checklist: header shows `[Plates] [Done]` on one row at 320 and 390; target >= 44x44dp, inside the viewport; no horizontal overflow at doubled text; tool row, note, syntax help and validation controls unchanged; calculator opens as the existing modal; the unsaved draft is byte-identical after close and typing continues.

Rendered revision: `27558ee6245dd1d5b223e27764277bd4f495846a` (`mobile/` content identical to every later commit on this PR; later commits change only this directory). Captures: Chromium with mobile/touch emulation, 320 and 390 x 844, light and dark, React Native Web — **not native screenshots**. "Before" is the current main editor, which has no Plates control; the tool row (timer, syntax help) is unchanged in the after captures.

| Viewport | Editor | Calculator open |
| --- | --- | --- |
| 320 light | [editor](after-editor-320-light.png) | [open](after-calculator-320-light.png) |
| 320 dark | [editor](after-editor-320-dark.png) | [open](after-calculator-320-dark.png) |
| 390 light | [editor](after-editor-390-light.png) | [open](after-calculator-390-light.png) |
| 390 dark | [editor](after-editor-390-dark.png) | [open](after-calculator-390-dark.png) |

Enlarged text (header text doubled, web has no OS scale): [320 dark](after-editor-320-dark-enlarged.png), no horizontal overflow ([measurements](after-results.json)). **Pass.** At 320 the title truncates to a stem — the existing, documented behaviour of the editor header (#905); the full name is in the name field below.

Timer, selection and keyboard-size state (all four ordinary captures above are taken in it): each run types an unsaved change, starts a real 3:00 rest timer from the tool row, selects characters 5-9 of the note, and shrinks the viewport to 500dp tall to reproduce the space a software keyboard leaves (desktop Chromium cannot raise one). After open/close the script asserts the draft is byte-identical, the selection is still 5-9, there is still exactly one timer control, and the timer's remaining time moved by the elapsed wall-clock time (drift 352-374ms across the four runs, i.e. the original end time is kept) — [measurements](after-results.json). Typing then continues. **Pass.** Not verified: a native software keyboard, native selection handles, or backgrounding.

Reproduce: `cd mobile && APP_ENV=development EXPO_PUBLIC_APP_ENV=development npx expo start --web --port 8097`, then from the repo root `PHASE=after node docs/verification/editor-plate-calculator/capture.mjs` (optional `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, `CAPTURE_URL`).
