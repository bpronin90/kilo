import fs from 'fs';
import path from 'path';
import React from 'react';
import render from 'react-test-renderer';
import { Platform, Alert as RNAlert } from 'react-native';
import { Alert } from '../lib/platformAlert';
import { WebAlertHost } from '../components/WebAlertHost';

// react-native-web has no native dialog behind Alert.alert, so multi-button
// confirmations silently no-op there: no dialog, no callback, the action
// dropped (#721). These tests pin the three things that keep that fixed —
// native still delegates, web actually renders and invokes the callback, and
// no source file quietly reintroduces the broken import.

const MOBILE_ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'tests', '.expo', 'web-build', 'android', 'ios']);

function collectSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('platformAlert', () => {
  const realOS = Platform.OS;
  afterEach(() => { Platform.OS = realOS; });

  test('native delegates to the real RN Alert with the caller-supplied arity', () => {
      Platform.OS = 'ios';
      const spy = jest.spyOn(RNAlert, 'alert').mockImplementation(() => {});

      const buttons = [{ text: 'Cancel' }, { text: 'OK' }];
      Alert.alert('Title', 'Message', buttons);
      expect(spy).toHaveBeenCalledWith('Title', 'Message', buttons);

      // Trailing undefineds would break existing two-arg assertions.
      Alert.alert('Only title');
      expect(spy).toHaveBeenLastCalledWith('Only title');
      spy.mockRestore();
  });

  test('web renders a real dialog and confirm reaches the caller callback', () => {
      Platform.OS = 'web';

      let tree;
      render.act(() => {
        tree = render.create(React.createElement(WebAlertHost));
      });

      const onConfirm = jest.fn();
      const onCancel = jest.fn();
      render.act(() => {
        Alert.alert('Set as current routine', 'Are you sure?', [
          { text: 'Cancel', style: 'cancel', onPress: onCancel },
          { text: 'Set as current routine', onPress: onConfirm },
        ]);
      });

      // findAll matches host and composite nodes carrying the same props, so
      // dedupe to the distinct buttons the user actually sees.
      const labels = [...new Set(
        tree.root
          .findAll((n) => n.props?.accessibilityRole === 'button')
          .map((n) => n.props.accessibilityLabel)
      )];
      expect(labels).toEqual(['Cancel', 'Set as current routine']);

      const confirm = tree.root.find(
        (n) => n.props?.accessibilityLabel === 'Set as current routine' && n.props?.onPress
      );
      render.act(() => { confirm.props.onPress(); });

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
      // Dialog dismisses itself so a second confirmation can open.
      expect(tree.root.findAll((n) => n.props?.accessibilityRole === 'button')).toHaveLength(0);
  });

  test('cancel invokes only the cancel callback', () => {
      Platform.OS = 'web';

      let tree;
      render.act(() => { tree = render.create(React.createElement(WebAlertHost)); });

      const onConfirm = jest.fn();
      const onCancel = jest.fn();
      render.act(() => {
        Alert.alert('Title', 'Message', [
          { text: 'Cancel', style: 'cancel', onPress: onCancel },
          { text: 'Confirm', onPress: onConfirm },
        ]);
      });

      const cancel = tree.root.find(
        (n) => n.props?.accessibilityLabel === 'Cancel' && n.props?.onPress
      );
      render.act(() => { cancel.props.onPress(); });

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
  });

  test('unmounting clears the handler so stale hosts cannot capture alerts', () => {
      Platform.OS = 'web';

      let tree;
      render.act(() => { tree = render.create(React.createElement(WebAlertHost)); });
      render.act(() => { tree.unmount(); });

      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      render.act(() => { Alert.alert('Dropped', 'No host', [{ text: 'OK' }]); });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
  });

  // The regression guard. Any `import { Alert } from 'react-native'` in app
  // source is dead on web, which is exactly how #721 shipped.
  test('no app source imports Alert directly from react-native', () => {
    const offenders = [];
    for (const file of collectSourceFiles(MOBILE_ROOT)) {
      if (file.endsWith(path.join('lib', 'platformAlert.js'))) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/import \{([^}]*)\} from ['"]react-native['"]/g)) {
        const names = match[1].split(',').map((n) => n.trim());
        if (names.includes('Alert')) offenders.push(path.relative(MOBILE_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
