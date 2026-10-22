# Web export download (#1563): verification evidence

Rendered evidence for issue #1563: web exports must produce a file when Web
Share is unavailable or fails.

## Setup (local only)

- Builds: `EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key npx expo export --platform web --output-dir <dir>`
  - **Before:** `1c647540365ec24afee8383e7b589ee7ea610925` (`main` before the fix).
  - **After:** `0e8b1f415a6a8508638cefe4818492ef8bea5faa` (the fix commit, rebased on `b871895c`).
    Commits after it only add this evidence directory, which cannot affect rendering.
- Browser: headless Chromium (playwright-core), viewport **390x844**.
- Driver: [`capture.cjs`](capture.cjs), run as `node capture.cjs <distDir> <before|after> <outDir>`.
  It serves the export on 127.0.0.1, removes `Navigator.prototype.share` (sharing
  unavailable), injects a fake session for the mock project `mockproj`, and
  answers every `mockproj.supabase.co` call with synthetic data. All other
  non-local hosts are aborted. No production project, account, or data was used.
- **The Export Account Data response is mocked.** It is a synthetic payload marked
  `"mocked": "local #1563 evidence, not a server response"`.
- Share rejection and cancellation are covered by Jest fixtures, not by this
  browser run (see Tests below). The browser run shows only the case where sharing is unavailable.

## Layout checklist (from the before render)

1. The status banner keeps its spot at the top of Data & Backup: a full-width card with centered bold text.
2. The account-export status stays a helpText line under the Export Account Data button, inside its card.
3. The Cloud Copy status stays in its existing line under the Cloud Sync controls, above the Danger Zone.
4. Buttons, cards, spacing, font sizes, and section order are unchanged. No new controls.
5. Status text wraps inside its card at 390px. Nothing overflows horizontally.

## Results

| Action | Before | After (download event) |
| --- | --- | --- |
| Export Local Backup | "Export failed: Share is not supported in this browser", no file | `kilo-backup-2026-10-22.json`, 754 bytes, JSON.parse ok, banner "Backup downloaded." |
| Export Workouts CSV | same failure, no file | `kilo-workouts-2026-10-22.csv`, 540 bytes, header `schema_version,record_kind,routine_id,…` |
| Export Weight CSV | same failure, no file | `kilo-weight-2026-10-22.csv`, 79 bytes, header `schema_version,date,logged_at,weight_value_lb,note,…` |
| Export Account Data (mocked 200) | "Export failed.", no file | `kilo-account-export-2026-10-22.json`, 398 bytes, JSON.parse ok, Unicode `Morgenwiegen ✓ 体重` preserved, "Account data exported." |
| Export Cloud Copy | "Cloud export failed.", no file | `kilo-cloud-export-2026-10-22.json`, 852 bytes, JSON.parse ok, "Cloud export ready." |

The CSVs are header-only because the fresh local profile has no entries. The
Jest suites assert CSV content built from synthetic rows.

Screenshots: `before-0N-*.png` and `after-0N-*.png` (01 export section, 02 after
Local Backup, 03 account export, 04 cloud copy).

**Comparison: PASS.** All five actions now produce a readable file, and none shows "Export failed."
Checklist items 1 to 5 hold: in `after-02`, the success banner uses the same card as the
before failure banner, only shorter and green. `after-03` and `after-04` use the same status
slots. No layout changes elsewhere.

## Tests

`mobile/tests/export-delivery.test.js` covers the helper: Blob bytes and MIME type,
anchor cleanup, deferred revoke, click failure, missing DOM, share success, AbortError,
non-cancellation fallback, double failure, and native pass-through.
`mobile/tests/backup-screen.test.js` covers the four BackupScreen entry points plus
hosted Cloud Copy. `mobile/tests/account-lifecycle-ui.test.js` covers CloudSyncRecovery Cloud Copy.
