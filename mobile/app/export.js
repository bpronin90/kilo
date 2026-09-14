// Pure export-payload helper extracted from App.js (#1047).
//
// Kept separate from the hook-owning shell composition and free of React so
// buildExportPayload can be unit-tested with an injected exportFn (see
// tests/app-export.test.js) and imported by app/AppShell.js without a circular
// dependency. App.js re-exports buildExportPayload so the module's export
// surface is unchanged.

import { buildCloudExport } from '../storage/entries';

// Exported for testing. Encapsulates the ok/error envelope BackupScreen expects
// so the failure path can be exercised without rendering the full App component.
// exportFn defaults to buildCloudExport; tests inject a mock.
//
// buildCloudExport, not exportBackup (#488): the v3 payload omits user_profile,
// tracked_lifts, and feature_toggles. date_of_birth, sex, height_cm, and
// activity_level live only on the device — no cloud table holds them — so a v3
// export cannot survive a reinstall. buildCloudExport is a strict superset and
// stays v3-importable. Account email remains excluded (#350).
export async function buildExportPayload(exportFn = buildCloudExport) {
  try {
    const backup = await exportFn();
    return { ok: true, json: JSON.stringify(backup, null, 2) };
  } catch (e) {
    console.error('[handleExport] export threw unexpectedly:', e);
    return { ok: false, error: e?.message ? `Export failed: ${e.message}` : 'Export failed.' };
  }
}
