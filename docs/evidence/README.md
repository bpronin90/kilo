# Visual evidence

This directory keeps capture harnesses, synthetic fixtures and verification notes.
Approved design references live in [the design index](../design-system-map.md).
Nonvisual verification results live in `docs/verification/`.

## Retention

- Keep runtime assets and approved design references in the current tree.
- Keep evidence for active work accessible at the reviewed commit, with viewport,
  state, rendered SHA, capture steps and a concise comparison. An ignored local
  screenshot path is not sufficient for handoff or review.
- Capture only the states needed to verify the change. Store scratch output
  outside tracked evidence until the useful captures are selected.
- After work is completed and its captures are no longer needed as current
  references, keep the evidence note and link its images to a full, existing Git
  commit before removing image bulk. Retain capture scripts and fixtures for
  reproduction; the historical snapshot preserves the original rendered pixels.
- When reading an archived report, its counts, filenames and pass/fail statements
  describe the recorded run, not the current app. A capture rerun needs fresh
  provenance and comparison before being used as evidence for a new change.

## Current images retained

- [Approved app redesign references](../design/app-redesign-v3/reference-index.md)
  and the original court-theme source exports referenced by the
  [KUA specification](../design/kinetic-utilitarian-athletic/README.md).
- [Training Breakdown reference package](1588-training-breakdown-dashboard/reference/).
- [MCP authorization evidence](mcp-authorization/README.md) and
  [integration browser captures](../verification/mcp-mvp/README.md#visual-evidence-1626),
  which still support the MVP verification and its recorded limitations.
- Production app images and the logo/wordmark used by the retired browser prototype.

## Historical image index

The following completed captures and retired experiments were removed from the
current tree: **738 images, 75,650,678 bytes (72.15 MiB)**. They remain available
in the existing snapshot below; no Git history was rewritten. Individual image
links in the evidence notes are pinned to that commit, and each report links its
original directory for filenames that were recorded as plain text.

Snapshot: `f7cf024e488471136e11e76834570093b140eaec`.

| Historical package | Images removed | Preserved snapshot |
|---|---:|---|
| App redesign v3 | 570 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/app-redesign-v3/) |
| Training Breakdown dashboard captures | 31 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/1588-training-breakdown-dashboard/) |
| Training Breakdown polish | 58 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/1593-training-breakdown-polish/) |
| Training Breakdown session windows | 9 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/1597-training-breakdown-session-windows/) |
| Account auth feedback | 10 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/account-auth-feedback/) |
| Auth error fallback | 3 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/auth-error-fallback/) |
| Public web launch | 15 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/public-web-launch/) |
| Sign-out failure copy | 3 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/sign-out-failure-copy/) |
| Sign-out session failure | 3 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/sign-out-session-failure/) |
| Web Edge Function CORS | 6 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/web-edge-cors/) |
| Web export download | 8 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/web-export-download/) |
| Original walkthrough | 7 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/verification/issue-1553/) |
| Retired Analog Iron design | 9 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/design/analog-iron-v0.125/) |
| Unused browser-prototype experiments | 6 | [Browse](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/archive/browser-prototype/src/assets/brand/) |
