// Export delivery (#1563): share sheet on native, share-or-download on web.
//
// The jest-expo environment has no DOM, so each web test installs a minimal
// document whose anchor records how it was used, and spies on
// URL.createObjectURL so the actual Blob bytes can be read back.

import { Platform, Share } from 'react-native';
import {
  EXPORT_DELIVERY,
  REVOKE_DELAY_MS,
  deliverTextExport,
  downloadTextFile,
  exportFileName,
} from '../lib/exportDelivery';

const originalOS = Platform.OS;
const hadDocument = 'document' in globalThis;
const originalDocument = globalThis.document;
const originalNavigatorShare = globalThis.navigator?.share;

let anchors;
let body;
let blobs;

function installDocument({ clickThrows = false } = {}) {
  anchors = [];
  body = { children: [], appendChild: jest.fn((n) => body.children.push(n)), removeChild: jest.fn((n) => { body.children = body.children.filter((c) => c !== n); }) };
  globalThis.document = {
    body,
    createElement: jest.fn(() => {
      const anchor = { style: {}, click: jest.fn(() => { if (clickThrows) throw new Error('click blocked'); anchor.attachedOnClick = body.children.includes(anchor); }) };
      anchors.push(anchor);
      return anchor;
    }),
  };
}

function setNavigatorShare(fn) {
  if (fn) globalThis.navigator.share = fn;
  else delete globalThis.navigator.share;
}

beforeEach(() => {
  jest.useFakeTimers();
  blobs = [];
  jest.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { blobs.push(blob); return `blob:kilo/${blobs.length}`; });
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  installDocument();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  Platform.OS = originalOS;
  setNavigatorShare(originalNavigatorShare);
  if (hadDocument) globalThis.document = originalDocument;
  else delete globalThis.document;
});

describe('exportFileName', () => {
  test('builds dated, extension-bearing names', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(exportFileName('backup', 'json', now)).toBe('kilo-backup-2026-10-21.json');
    expect(exportFileName('weight', 'csv', now)).toBe('kilo-weight-2026-10-21.csv');
  });
});

describe('downloadTextFile', () => {
  test('downloads the exact UTF-8 bytes, removes the anchor, and revokes the URL only later', async () => {
    const text = '{"note":"Squat — 100 kg ✓ 筋トレ"}';
    downloadTextFile(text, 'kilo-backup-2026-10-21.json', 'application/json');

    const [anchor] = anchors;
    expect(anchor.download).toBe('kilo-backup-2026-10-21.json');
    expect(anchor.href).toBe('blob:kilo/1');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.attachedOnClick).toBe(true);
    expect(body.children).toEqual([]);
    expect(blobs[0].type).toBe('application/json;charset=utf-8');
    expect(await blobs[0].text()).toBe(text);
    expect(Buffer.from(await blobs[0].arrayBuffer()).equals(Buffer.from(text, 'utf8'))).toBe(true);

    // Not revoked at dispatch, which could cancel the download.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:kilo/1');
  });

  test('a failed click cleans up immediately and rethrows', () => {
    installDocument({ clickThrows: true });
    expect(() => downloadTextFile('x', 'a.csv', 'text/csv')).toThrow('click blocked');
    expect(body.children).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:kilo/1');
  });

  test('throws a truthful error when the browser has no document', () => {
    delete globalThis.document;
    expect(() => downloadTextFile('x', 'a.json', 'application/json')).toThrow('File download is not supported in this browser.');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('deliverTextExport on web', () => {
  beforeEach(() => { Platform.OS = 'web'; });

  test('downloads directly when Web Share is absent', async () => {
    setNavigatorShare(null);
    const share = jest.spyOn(Share, 'share');
    await expect(deliverTextExport('a,b\n1,2\n', { name: 'workouts', format: 'csv' })).resolves.toBe(EXPORT_DELIVERY.DOWNLOADED);
    expect(share).not.toHaveBeenCalled();
    expect(anchors[0].download).toMatch(/^kilo-workouts-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(blobs[0].type).toBe('text/csv;charset=utf-8');
    expect(await blobs[0].text()).toBe('a,b\n1,2\n');
  });

  test('a successful share is kept and nothing is downloaded', async () => {
    setNavigatorShare(jest.fn());
    jest.spyOn(Share, 'share').mockResolvedValue(undefined);
    await expect(deliverTextExport('{}', { name: 'backup', format: 'json' })).resolves.toBe(EXPORT_DELIVERY.SHARED);
    expect(Share.share).toHaveBeenCalledWith({ message: '{}' });
    expect(anchors).toEqual([]);
  });

  test('a cancelled share (AbortError) is neutral: no download, no rejection', async () => {
    setNavigatorShare(jest.fn());
    jest.spyOn(Share, 'share').mockRejectedValue(Object.assign(new Error('Share canceled'), { name: 'AbortError' }));
    await expect(deliverTextExport('{}', { name: 'backup', format: 'json' })).resolves.toBe(EXPORT_DELIVERY.CANCELLED);
    expect(anchors).toEqual([]);
  });

  test('any other share rejection falls back to a download', async () => {
    setNavigatorShare(jest.fn());
    jest.spyOn(Share, 'share').mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await expect(deliverTextExport('{"a":1}', { name: 'account-export', format: 'json' })).resolves.toBe(EXPORT_DELIVERY.DOWNLOADED);
    expect(anchors[0].download).toMatch(/^kilo-account-export-.*\.json$/);
    expect(await blobs[0].text()).toBe('{"a":1}');
  });

  test('rejects when share fails and the download cannot run either', async () => {
    setNavigatorShare(jest.fn());
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('share failed'));
    installDocument({ clickThrows: true });
    await expect(deliverTextExport('{}', { name: 'backup', format: 'json' })).rejects.toThrow('click blocked');
  });
});

describe('deliverTextExport on native', () => {
  test.each(['ios', 'android'])('%s shares the text and never touches the DOM', async (os) => {
    Platform.OS = os;
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    await expect(deliverTextExport('{}', { name: 'backup', format: 'json' })).resolves.toBe(EXPORT_DELIVERY.SHARED);
    expect(Share.share).toHaveBeenCalledWith({ message: '{}' });
    expect(anchors).toEqual([]);
  });

  test('an iOS dismissed share sheet is neutral', async () => {
    Platform.OS = 'ios';
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
    await expect(deliverTextExport('{}', { name: 'backup', format: 'json' })).resolves.toBe(EXPORT_DELIVERY.CANCELLED);
  });

  test('a native share failure still rejects (no web fallback)', async () => {
    Platform.OS = 'ios';
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('Sharing unavailable'));
    await expect(deliverTextExport('{}', { name: 'backup', format: 'json' })).rejects.toThrow('Sharing unavailable');
    expect(anchors).toEqual([]);
  });
});
