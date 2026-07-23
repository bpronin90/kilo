// Large weight-history remap isolation (#592, follow-up to measured #572
// claim 10): WeightHistoryList is a child of WeightScreen, which owns the
// Weight/Note text-input shell state. Before this fix, every keystroke in
// those fields re-rendered WeightScreen and re-created WeightHistoryList's
// element with fresh props, causing the expanded list to remap its entire
// entries array on every keystroke — expensive at the ~1,000-entry scale a
// long-tenured user can reach.
//
// This test renders the real WeightHistoryList with a representative
// 1,000-entry fixture, counts how many times its row-mapping body actually
// runs, and proves that re-rendering the parent with an unrelated prop change
// (simulating a sibling shell keystroke) does not remap the list, while an
// actual entries change still does.

import React from 'react';
import renderer from 'react-test-renderer';
import { WeightHistoryList } from '../components/WeightHistoryList';
import { getWeightDeltaSeverity } from '../lib/format';

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  return { __esModule: true, default: () => null };
}, { virtual: true });

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

function buildEntries(count) {
  const entries = [];
  const base = new Date('2026-01-01T08:00:00Z');
  for (let i = 0; i < count; i += 1) {
    const d = new Date(base.getTime() - i * 86400000);
    entries.push({
      id: `e${i}`,
      date: d.toISOString().slice(0, 10),
      logged_at: d.toISOString(),
      weight_value: 180 + (i % 10) * 0.2,
      weight_unit: 'lb',
      note: '',
    });
  }
  return entries;
}

const ENTRIES_1000 = buildEntries(1000);

// Counts how many times the list body actually maps rows, by wrapping the
// row-producing callback used inside WeightHistoryList's own render (via the
// externally observable getWeightDeltaSeverity call count — it is invoked
// once per rendered row, so its call count is a direct proxy for "did this
// render remap the entries array").
function makeCountingSeverity() {
  const fn = jest.fn(getWeightDeltaSeverity);
  return fn;
}

// Wrapper owning unrelated shell-like state (mirrors WeightScreen owning
// weightValue/weightNote alongside WeightHistoryList) so re-renders driven by
// that unrelated state can be distinguished from entries-driven re-renders.
function Harness({ entries, severityFn, unrelatedTick }) {
  return (
    <WeightHistoryList
      entries={entries}
      editingId={null}
      handleEditEntry={Harness.handleEditEntry}
      handleDelete={Harness.handleDelete}
      getWeightDeltaSeverity={severityFn}
      goalInfo={null}
      // unrelatedTick is intentionally unused by WeightHistoryList; its only
      // purpose is to force Harness itself to re-render without changing any
      // prop WeightHistoryList actually reads, matching a same-value re-render
      // the way React.memo's shallow comparison would see it.
    />
  );
}
Harness.handleEditEntry = () => {};
Harness.handleDelete = () => {};

describe('WeightHistoryList render isolation on a 1,000-entry fixture (#592)', () => {
  test('expanding the list renders every row exactly once', () => {
    const severityFn = makeCountingSeverity();
    let component;
    renderer.act(() => {
      component = renderer.create(
        <Harness entries={ENTRIES_1000} severityFn={severityFn} unrelatedTick={0} />
      );
    });

    // WeightHistoryList starts expanded by default (collapsed=false), so the
    // initial render already maps every row.
    expect(severityFn).toHaveBeenCalledTimes(ENTRIES_1000.length);
  });

  test('re-rendering the parent with unchanged entries/callbacks does not remap the list', () => {
    const severityFn = makeCountingSeverity();
    let component;
    renderer.act(() => {
      component = renderer.create(
        <Harness entries={ENTRIES_1000} severityFn={severityFn} unrelatedTick={0} />
      );
    });
    expect(severityFn).toHaveBeenCalledTimes(ENTRIES_1000.length);
    severityFn.mockClear();

    // Same entries array reference, same stable callbacks — only the parent's
    // own unrelated state changes, exactly like a sibling Weight/Note field
    // keystroke re-rendering WeightScreen without touching WeightHistoryList's
    // own props.
    renderer.act(() => {
      component.update(
        <Harness entries={ENTRIES_1000} severityFn={severityFn} unrelatedTick={1} />
      );
    });

    expect(severityFn).not.toHaveBeenCalled();
  });

  test('an actual entries change still remaps the list', () => {
    const severityFn = makeCountingSeverity();
    let component;
    renderer.act(() => {
      component = renderer.create(
        <Harness entries={ENTRIES_1000} severityFn={severityFn} unrelatedTick={0} />
      );
    });
    severityFn.mockClear();

    const updatedEntries = [...ENTRIES_1000, {
      id: 'new-entry',
      date: '2026-02-01',
      logged_at: '2026-02-01T08:00:00Z',
      weight_value: 179.5,
      weight_unit: 'lb',
      note: '',
    }];

    renderer.act(() => {
      component.update(
        <Harness entries={updatedEntries} severityFn={severityFn} unrelatedTick={0} />
      );
    });

    expect(severityFn).toHaveBeenCalledTimes(updatedEntries.length);
  });
});
