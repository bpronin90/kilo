// Export delivery (#1563): hands an export's text to the share sheet, or, on
// web, saves it as a real file when sharing is unavailable or fails.
//
// react-native-web's Share rejects outright when `navigator.share` is absent
// (most desktop browsers), and Web Share itself can reject a large payload or
// an expired user activation — after which a user holding a valid export would
// be left with nothing. On web, any share failure other than the user's own
// cancellation falls back to a Blob download. Native keeps Share.share exactly
// as before; Android's folder-picker route stays with BackupActions.
import { Platform, Share } from 'react-native';

export const EXPORT_DELIVERY = Object.freeze({
  SHARED: 'shared',
  DOWNLOADED: 'downloaded',
  // Neutral: the user dismissed the share sheet. No banner, no download.
  CANCELLED: 'cancelled',
});

const FORMATS = Object.freeze({
  json: { extension: 'json', mimeType: 'application/json' },
  csv: { extension: 'csv', mimeType: 'text/csv' },
});

// The browser reads the blob asynchronously after click(); revoking the URL
// in the same tick can cancel the download, so release it well afterwards.
export const REVOKE_DELAY_MS = 30000;

// `kilo-<name>-YYYY-MM-DD.<ext>`, matching BackupActions' SAF file names.
export function exportFileName(name, format, now = new Date()) {
  return `kilo-${name}-${now.toISOString().slice(0, 10)}.${FORMATS[format].extension}`;
}

// Saves `text` as a file through a temporary download anchor. Throws when the
// browser cannot do it, so the caller can report a truthful failure.
export function downloadTextFile(text, fileName, mimeType) {
  const doc = globalThis.document;
  const urlApi = globalThis.URL;
  if (!doc?.body || typeof Blob === 'undefined' || typeof urlApi?.createObjectURL !== 'function') {
    throw new Error('File download is not supported in this browser.');
  }
  const url = urlApi.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }));
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  doc.body.appendChild(anchor);
  let dispatched = false;
  try {
    anchor.click();
    dispatched = true;
  } finally {
    doc.body.removeChild(anchor);
    if (dispatched) setTimeout(() => urlApi.revokeObjectURL(url), REVOKE_DELAY_MS);
    else urlApi.revokeObjectURL(url);
  }
}

// Web Share reports a user dismissal as an AbortError DOMException.
function isShareCancellation(error) {
  return error?.name === 'AbortError';
}

// Delivers one export artifact and resolves to an EXPORT_DELIVERY outcome.
// Rejects only when no route could deliver it (or, on native, when the share
// sheet itself fails, as before).
export async function deliverTextExport(text, { name, format }) {
  if (Platform.OS !== 'web') {
    const result = await Share.share({ message: text });
    return result?.action === Share.dismissedAction ? EXPORT_DELIVERY.CANCELLED : EXPORT_DELIVERY.SHARED;
  }
  if (typeof globalThis.navigator?.share === 'function') {
    try {
      await Share.share({ message: text });
      return EXPORT_DELIVERY.SHARED;
    } catch (error) {
      if (isShareCancellation(error)) return EXPORT_DELIVERY.CANCELLED;
      // Any other rejection (payload too large, activation expired, share
      // target failed) still owes the user a file: fall through.
    }
  }
  downloadTextFile(text, exportFileName(name, format), FORMATS[format].mimeType);
  return EXPORT_DELIVERY.DOWNLOADED;
}
