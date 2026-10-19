import React from 'react';
import renderer from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';
import { SessionGauge } from '../components/UI';
import { ThemeContext, KuaStyleContext } from '../theme/ThemeContext';
import {
  LightColors,
  DarkColors,
  HardCourtLightColors,
  HardCourtDarkColors,
} from '../theme/colors';

function mount({ colors = LightColors, kua = null, props = {} }) {
  let tree;
  renderer.act(() => {
    tree = renderer.create(
      <ThemeContext.Provider value={{ colors, mode: 'light', kuaPalette: kua }}>
        <KuaStyleContext.Provider value={kua}>
          <SessionGauge count={8} total={20} showDeload showTitle={false} {...props} />
        </KuaStyleContext.Provider>
      </ThemeContext.Provider>,
    );
  });
  return tree.root;
}

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const textNode = (root, label) => root.findAllByType(Text).find((t) => [].concat(t.props.children).join('') === label);
const segments = (root) => root.findAllByType(View).filter((v) => flat(v).flex && flat(v).height === '100%');
const marker = (root) => root.findAllByType(View).find((v) => flat(v).borderWidth === 3);

describe('SessionGauge KUA tokens (#1462)', () => {
  test.each([
    ['light', LightColors, HardCourtLightColors],
    ['dark', DarkColors, HardCourtDarkColors],
  ])('%s: labels, count, marker and zones resolve through KUA roles', (_m, colors, kua) => {
    const root = mount({ colors, kua });
    expect(flat(textNode(root, 'Since deload')).color).toBe(kua.onSurfaceVariant);
    expect(flat(textNode(root, 'Total')).color).toBe(kua.onSurfaceVariant);
    expect(flat(textNode(root, 'Building')).color).toBe(kua.onSurfaceVariant);
    expect(flat(textNode(root, '20')).color).toBe(kua.onSurface);
    // count 8 = warn zone: count, caption and marker use the semantic warning token
    expect(flat(textNode(root, '8')).color).toBe(kua.warning);
    expect(flat(textNode(root, 'Fatigue setting in')).color).toBe(kua.warning);
    expect(flat(marker(root)).borderColor).toBe(kua.warning);
    expect(flat(marker(root)).backgroundColor).toBe(kua.surfaceCard);
    expect(segments(root).map((s) => flat(s).backgroundColor)).toEqual([kua.success, kua.warning, kua.errorText]);
  });

  test('error zone uses the AA error ink, not the danger fill', () => {
    const root = mount({ colors: DarkColors, kua: HardCourtDarkColors, props: { count: 12 } });
    expect(flat(textNode(root, 'Plan deload asap')).color).toBe(HardCourtDarkColors.errorText);
  });

  test('legacy context (no KUA gate) is unchanged', () => {
    const root = mount({ colors: LightColors, kua: null });
    expect(flat(textNode(root, 'Since deload')).color).toBe(LightColors.textMuted);
    expect(flat(textNode(root, '20')).color).toBe(LightColors.text);
    expect(flat(textNode(root, 'Fatigue setting in')).color).toBe(LightColors.caution);
    expect(segments(root).map((s) => flat(s).backgroundColor)).toEqual([LightColors.success, LightColors.caution, LightColors.error]);
  });

  test('deload disabled hides advisory; paused shows frozen stats and muted note', () => {
    const off = mount({ colors: LightColors, kua: HardCourtLightColors, props: { showDeload: false } });
    expect(textNode(off, 'Building')).toBeUndefined();
    expect(textNode(off, 'Since deload')).toBeUndefined();
    expect(textNode(off, 'Total')).toBeDefined();

    const paused = mount({ colors: LightColors, kua: HardCourtLightColors, props: { paused: true, showDeload: false } });
    expect(textNode(paused, 'Since last deload')).toBeDefined();
    expect(textNode(paused, 'Sessions logged')).toBeDefined();
    expect(flat(textNode(paused, 'Baseline training is paused during Recovery.')).color).toBe(HardCourtLightColors.onSurfaceVariant);
    expect(flat(textNode(paused, '8')).color).toBe(HardCourtLightColors.onSurface);
  });

  test('stat labels do not truncate under large text / narrow width', () => {
    const root = mount({ colors: LightColors, kua: HardCourtLightColors });
    root.findAllByType(Text).forEach((t) => expect(t.props.numberOfLines).toBeUndefined());
  });
});
