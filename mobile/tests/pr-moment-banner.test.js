import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { PRMomentBanner } from '../components/PRMomentBanner';
import { ThemeProvider } from '../theme/ThemeContext';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

jest.mock('../lib/unitPreference', () => ({
  useWeightUnit: () => 'lb',
}));

test('applies shell clearance to the rendered PR banner', async () => {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <ThemeProvider>
        <PRMomentBanner
          moment={{ weight_value: 225, rep_count: 5 }}
          onDismiss={() => {}}
          style={{ marginBottom: 88 }}
        />
      </ThemeProvider>
    );
  });

  const json = tree.toJSON();
  const style = Object.assign({}, ...json.props.style);
  expect(style.marginBottom).toBe(88);
  act(() => { tree.unmount(); });
});
