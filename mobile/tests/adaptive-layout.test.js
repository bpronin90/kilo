// Large-screen rotation and window resizing (#1126): the portrait lock is gone,
// wide windows center a capped content column, side safe-area insets are
// honored, phone portrait keeps its pre-#1126 geometry, and a resize re-lays
// out in place instead of remounting (so drafts and modal state survive).
import React, { useState } from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

let mockWindow = { width: 411, height: 891, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const { centeredColumnInsets, CONTENT_MAX_WIDTH, DIALOG_MAX_WIDTH, MODAL_SUPPORTED_ORIENTATIONS } = require('../components/adaptiveLayout');
const { ScreenShell } = require('../components/ScreenShell');
const { TabBar } = require('../components/TabBar');

const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
const flat = (style) => [].concat(style).flat(Infinity).reduce((acc, s) => Object.assign(acc, s || {}), {});

function withInsets(insets, child) {
  return <SafeAreaInsetsContext.Provider value={insets}>{child}</SafeAreaInsetsContext.Provider>;
}

function tabBarStyle(tree) {
  return flat(tree.root.find((n) => n.props.accessibilityRole === 'tablist' && n.props.style).props.style);
}

function shellContentStyle(tree) {
  return flat(tree.root.find((n) => n.props.contentContainerStyle).props.contentContainerStyle);
}

describe('app config', () => {
  test('app.json no longer requests a portrait-only orientation', () => {
    const appJson = require('../app.json');
    expect(appJson.expo.orientation).toBe('default');
  });

  test('MainActivity handles smallestScreenSize in-process and keeps template tokens', () => {
    const { mergeConfigChanges } = require('../app.config.js');
    const template = 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode';
    expect(mergeConfigChanges(template)).toBe(`${template}|smallestScreenSize`);
    // Idempotent across repeated prebuilds, tolerant of a missing attribute.
    expect(mergeConfigChanges(`${template}|smallestScreenSize`)).toBe(`${template}|smallestScreenSize`);
    expect(mergeConfigChanges(undefined)).toBe('smallestScreenSize');
  });

  test('the config factory registers the Android manifest mod', () => {
    const configFactory = require('../app.config.js');
    const result = configFactory({ config: { plugins: [] } });
    expect(typeof result.mods?.android?.manifest).toBe('function');
    expect(result.plugins).toEqual([]);
  });
});

describe('centeredColumnInsets', () => {
  test('phone portrait keeps the 16px shell gutters', () => {
    expect(centeredColumnInsets(411, ZERO)).toEqual({ left: 16, right: 16 });
    expect(centeredColumnInsets(360, ZERO)).toEqual({ left: 16, right: 16 });
  });

  test('wide windows center a column capped at CONTENT_MAX_WIDTH', () => {
    for (const width of [800, 1024, 1280, 1920]) {
      const { left, right } = centeredColumnInsets(width, ZERO);
      expect(left).toBe(right);
      expect(width - left - right).toBe(CONTENT_MAX_WIDTH - 32);
    }
  });

  test('side insets (landscape cutout or navigation bar) are always cleared', () => {
    const narrow = centeredColumnInsets(420, { left: 48, right: 0 });
    expect(narrow).toEqual({ left: 64, right: 16 });
    const wide = centeredColumnInsets(900, { left: 0, right: 48 });
    expect(wide.right).toBeGreaterThanOrEqual(64);
    expect(900 - wide.left - wide.right).toBe(CONTENT_MAX_WIDTH - 32);
  });
});

describe('ScreenShell and TabBar geometry', () => {
  afterEach(() => {
    mockWindow = { width: 411, height: 891, scale: 2, fontScale: 1 };
  });

  test('phone portrait geometry is unchanged', () => {
    let shell;
    let bar;
    act(() => {
      shell = renderer.create(withInsets(ZERO, <ScreenShell title="Home" />));
      bar = renderer.create(withInsets(ZERO, <TabBar tabs={['Home', 'Log']} activeTab="Home" onTabPress={() => {}} />));
    });
    const content = shellContentStyle(shell);
    expect(content.paddingLeft).toBe(16);
    expect(content.paddingRight).toBe(16);
    expect(content.maxWidth).toBeUndefined();
    const barStyle = tabBarStyle(bar);
    expect(barStyle.left).toBe(16);
    expect(barStyle.right).toBe(16);
  });

  test('tablet landscape centers the content column and tab bar together', () => {
    mockWindow = { width: 1280, height: 800, scale: 2, fontScale: 1 };
    let shell;
    let bar;
    act(() => {
      shell = renderer.create(withInsets(ZERO, <ScreenShell title="Home" />));
      bar = renderer.create(withInsets(ZERO, <TabBar tabs={['Home', 'Log']} activeTab="Home" onTabPress={() => {}} />));
    });
    const content = shellContentStyle(shell);
    const barStyle = tabBarStyle(bar);
    expect(content.paddingLeft).toBe((1280 - CONTENT_MAX_WIDTH) / 2 + 16);
    expect(barStyle.left).toBe(content.paddingLeft);
    expect(barStyle.right).toBe(content.paddingRight);
  });

  test('phone landscape clears a side display cutout', () => {
    mockWindow = { width: 891, height: 411, scale: 2, fontScale: 1 };
    const insets = { top: 0, right: 0, bottom: 21, left: 48 };
    let shell;
    let bar;
    act(() => {
      shell = renderer.create(withInsets(insets, <ScreenShell title="Log" onBack={() => {}} />));
      bar = renderer.create(withInsets(insets, <TabBar tabs={['Home', 'Log']} activeTab="Log" onTabPress={() => {}} />));
    });
    expect(shellContentStyle(shell).paddingLeft).toBeGreaterThanOrEqual(64);
    expect(tabBarStyle(bar).left).toBeGreaterThanOrEqual(64);
  });
});

describe('resize preserves in-progress state', () => {
  afterEach(() => {
    mockWindow = { width: 411, height: 891, scale: 2, fontScale: 1 };
  });

  function Draft() {
    const [text, setText] = useState('');
    return (
      <>
        <TextInput testID="draft" value={text} onChangeText={setText} />
        <Text testID="echo">{text}</Text>
      </>
    );
  }

  test('a draft typed before rotation and unfold is still there afterward', () => {
    let tree;
    const render = () => withInsets(ZERO, <ScreenShell title="Log"><Draft /></ScreenShell>);
    act(() => {
      tree = renderer.create(render());
    });
    const inputBefore = tree.root.findByProps({ testID: 'draft' });
    act(() => inputBefore.props.onChangeText('Squat 3x5 100'));

    for (const size of [{ width: 891, height: 411 }, { width: 1280, height: 800 }, { width: 411, height: 891 }]) {
      mockWindow = { ...size, scale: 2, fontScale: 1 };
      act(() => tree.update(render()));
      expect(tree.root.findByProps({ testID: 'echo' }).props.children).toBe('Squat 3x5 100');
    }
    // Same component instance: re-laid out in place, never remounted.
    expect(tree.root.findByProps({ testID: 'draft' }).instance).toBe(inputBefore.instance);
  });
});

describe('modal orientation support', () => {
  test('modals declare every orientation so iOS never forces a rotation', () => {
    expect(MODAL_SUPPORTED_ORIENTATIONS).toEqual(
      expect.arrayContaining(['portrait', 'landscape', 'landscape-left', 'landscape-right'])
    );
    expect(DIALOG_MAX_WIDTH).toBeLessThanOrEqual(CONTENT_MAX_WIDTH);
  });

  test('every production Modal passes supportedOrientations', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const walk = (dir, acc = []) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (entry.name.endsWith('.js')) acc.push(full);
      }
      return acc;
    };
    const missing = [];
    for (const file of [...walk(path.join(root, 'components')), ...walk(path.join(root, 'screens'))]) {
      const src = fs.readFileSync(file, 'utf8');
      // Props can hold arrow functions, so inspect the opening tag's props up
      // to the first child element rather than stopping at the first `>`.
      for (const match of src.matchAll(/<Modal\s/g)) {
        const tag = src.slice(match.index, src.indexOf('<', match.index + 1));
        if (!tag.includes('supportedOrientations')) missing.push(path.relative(root, file));
      }
    }
    // WebAlertHost renders only on web, where the prop has no effect.
    expect(missing.filter((f) => !f.endsWith('WebAlertHost.js'))).toEqual([]);
  });
});
