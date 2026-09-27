// Pick one local text file and return its contents (#1172). Web uses a
// transient <input type="file">; Android and iOS use expo-document-picker,
// copying the pick into the app cache and reading it locally. Nothing is
// uploaded anywhere.
import { Platform } from 'react-native';

const MAX_BYTES = 1024 * 1024;
const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/*'];

function tooLarge() {
  return new Error('That file is too large to be a routine result.');
}

export function canPickTextFile(deps = {}) {
  const platform = deps.platform ?? Platform.OS;
  if (platform === 'android' || platform === 'ios') return true;
  return platform === 'web' && typeof (deps.document ?? globalThis.document)?.createElement === 'function';
}

function pickWebTextFile(doc) {
  return new Promise((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,text/plain,text/markdown';
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      if (file.size > MAX_BYTES) { reject(tooLarge()); return; }
      file.text().then(resolve, reject);
    });
    input.click();
  });
}

async function pickNativeTextFile(deps) {
  // eslint-disable-next-line global-require
  const picker = deps.documentPicker ?? require('expo-document-picker');
  const result = await picker.getDocumentAsync({ type: TEXT_TYPES, copyToCacheDirectory: true, multiple: false });
  if (!result || result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  if (asset.size != null && asset.size > MAX_BYTES) throw tooLarge();
  const response = await (deps.fetch ?? globalThis.fetch)(asset.uri);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw tooLarge();
  return text;
}

// Resolves with the file text, or null when the user cancels. Rejects on an
// unreadable or oversized file.
export function pickTextFile(deps = {}) {
  const platform = deps.platform ?? Platform.OS;
  if (platform === 'web') return pickWebTextFile(deps.document ?? globalThis.document);
  return pickNativeTextFile(deps);
}
