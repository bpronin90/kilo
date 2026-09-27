// Pick one local text file and return its contents (#1172). Web uses a
// transient <input type="file">; native has no document-picker dependency, so
// `canPickTextFile()` is false there and callers offer paste only.
import { Platform } from 'react-native';

const MAX_BYTES = 1024 * 1024;

export function canPickTextFile(deps = {}) {
  const platform = deps.platform ?? Platform.OS;
  return platform === 'web' && typeof (deps.document ?? globalThis.document)?.createElement === 'function';
}

// Resolves with the file text, or null when the user cancels. Rejects on an
// unreadable or oversized file.
export function pickTextFile(deps = {}) {
  const doc = deps.document ?? globalThis.document;
  return new Promise((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,text/plain,text/markdown';
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      if (file.size > MAX_BYTES) { reject(new Error('That file is too large to be a routine result.')); return; }
      file.text().then(resolve, reject);
    });
    input.click();
  });
}
