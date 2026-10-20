import React from 'react';
import render from 'react-test-renderer';

jest.mock('../lib/platformAlert', () => ({ Alert: { alert: jest.fn() } }));

// ── Dedicated deload Done persists the latest draft (#1481) ──────────────────
describe('deload editor Done persists trailing edits (#1481)', () => {
  const { useLogDeloadEditor } = require('../screens/log/useLogDeloadEditor');
  const { Alert } = require('../lib/platformAlert');
  const BASE = 'Monday\n+Lifting\n-Bench Press\n100 5';
  let tree;
  let api;

  function deferred() {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }
  const flush = () => render.act(async () => {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  });

  function mount(save) {
    function Harness() {
      api = useLogDeloadEditor({
        deloadNote: { raw_text: BASE },
        saveDeloadNote: save,
        workoutNoteText: '',
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      return null;
    }
    global.requestAnimationFrame = global.requestAnimationFrame || ((fn) => fn());
    render.act(() => { tree = render.create(<Harness />); });
    render.act(() => { api.enterDeloadEditor(); });
  }
  const type = (t) => render.act(() => { api.setDeloadEditText(t); });
  const pressDoneSave = async () => {
    Alert.alert.mockClear();
    render.act(() => { api.handleDoneDeload(); });
    const save = Alert.alert.mock.calls[0][2].find((b) => b.text === 'Save');
    let p;
    render.act(() => { p = save.onPress(); });
    return p;
  };

  afterEach(() => { if (tree) render.act(() => tree.unmount()); tree = null; });

  test('trailing edits typed while Done-save is pending are persisted before close', async () => {
    const g = [deferred(), deferred()];
    const queue = [...g];
    const save = jest.fn(() => queue.shift().promise);
    mount(save);
    type(`${BASE}1`);
    const p = pressDoneSave();
    await flush();
    type(`${BASE}12`);
    type(`${BASE}123`);
    await render.act(async () => { g[0].resolve(); });
    await flush();
    expect(api.deloadMode).toBe('edit');
    expect(save.mock.calls.map((c) => c[0])).toEqual([`${BASE}1`, `${BASE}123`]);
    await render.act(async () => { g[1].resolve(); await p; });
    expect(api.deloadMode).toBe('read');
  });

  test('Done while an explicit Save is pending waits for it and saves later text', async () => {
    const g1 = deferred(); const g2 = deferred();
    const gates = [g1, g2];
    const save = jest.fn(() => gates.shift().promise);
    mount(save);
    type(`${BASE}1`);
    render.act(() => { api.handleSaveDeload(); });
    type(`${BASE}12`);
    const p = pressDoneSave();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(api.deloadMode).toBe('edit');
    await render.act(async () => { g1.resolve(); });
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toBe(`${BASE}12`);
    expect(api.deloadMode).toBe('edit');
    await render.act(async () => { g2.resolve(); });
    await p;
    expect(api.deloadMode).toBe('read');
  });

  test('a rejected initial write keeps the draft, shows the error, and allows retry', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({});
    mount(save);
    type(`${BASE}1`);
    await render.act(async () => { await pressDoneSave(); });
    expect(api.deloadMode).toBe('edit');
    expect(api.deloadEditText).toBe(`${BASE}1`);
    expect(api.saveError).toBe('Save failed');
    await render.act(async () => { await pressDoneSave(); });
    expect(api.deloadMode).toBe('read');
  });

  test('a rejected trailing write keeps the latest draft open', async () => {
    const g1 = deferred();
    const save = jest.fn()
      .mockImplementationOnce(() => g1.promise)
      .mockRejectedValueOnce(new Error('x'));
    mount(save);
    type(`${BASE}1`);
    const p = pressDoneSave();
    await flush();
    type(`${BASE}12`);
    await render.act(async () => { g1.resolve(); await p; });
    expect(api.deloadMode).toBe('edit');
    expect(api.deloadEditText).toBe(`${BASE}12`);
    expect(api.saveError).toBe('Save failed');
  });

  test('Discard still exits without saving', () => {
    const save = jest.fn();
    mount(save);
    type(`${BASE}1`);
    Alert.alert.mockClear();
    render.act(() => { api.handleDoneDeload(); });
    const discard = Alert.alert.mock.calls[0][2].find((b) => b.text === 'Discard');
    render.act(() => { discard.onPress(); });
    expect(save).not.toHaveBeenCalled();
    expect(api.deloadMode).toBe('read');
  });
});
