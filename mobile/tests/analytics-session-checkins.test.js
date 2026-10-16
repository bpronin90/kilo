import React from 'react';
import render from 'react-test-renderer';
import { AnalyticsFatigueCard } from '../components/AnalyticsFatigueCard';

jest.mock('../components/UI', () => ({ Card: ({ children }) => children }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));

const row = (n, reasons = ['Lower back']) => ({ responded_at: `2026-05-0${n}T10:00:00Z`, reasons, note: null, exercises_skipped: 0, volume_decline_pct: null });

function history({ rough = [], ok = [], pending = [], top_reason = null }) {
  return {
    rough, ok, pending,
    summary: { roughTotal: rough.length, okTotal: ok.length, pendingTotal: pending.length, top_reason },
  };
}

function mount(h, props = {}) {
  let tree;
  render.act(() => {
    tree = render.create(
      <AnalyticsFatigueCard
        checkInHistory={h}
        fatigueExpanded={false}
        setFatigueExpanded={jest.fn()}
        handleCheckInEdit={jest.fn()}
        {...props}
      />,
    );
  });
  return tree.root;
}

const texts = root => root.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join(''));

describe('Session Check-ins collapsed card', () => {
  it('leads with the most common issue and demotes the count', () => {
    const root = mount(history({ rough: [row(1), row(2), row(3)], top_reason: 'Lower back' }));
    const t = texts(root);
    expect(t).toEqual(expect.arrayContaining(['Session Check-ins', 'Most common issue', 'Lower back', '3 flagged sessions']));
    expect(t.indexOf('Lower back')).toBeLessThan(t.indexOf('3 flagged sessions'));
  });

  it('uses singular copy for one flagged session', () => {
    const t = texts(mount(history({ rough: [row(1)], top_reason: 'Lower back' })));
    expect(t).toContain('1 flagged session');
  });

  it('falls back to the count as the value when there is no common reason', () => {
    const t = texts(mount(history({ rough: [row(1, []), row(2, [])] })));
    expect(t).toContain('Session status');
    expect(t.filter(x => x === '2 flagged sessions')).toHaveLength(1);
    expect(t).not.toContain('Most common issue');
  });

  it('says no flagged sessions when only ok check-ins exist', () => {
    const t = texts(mount(history({ ok: [row(1)] })));
    expect(t).toContain('No flagged sessions');
  });

  it('renders the empty state without check-ins', () => {
    expect(texts(mount(history({})))).toContain('No check-ins logged yet.');
  });

  it('keeps disclosure state, toggle callback and unanswered badge', () => {
    const setFatigueExpanded = jest.fn();
    const root = mount(history({ rough: [row(1)], pending: [row(2)], top_reason: 'Lower back' }), { setFatigueExpanded });
    const btn = root.findByProps({ accessibilityLabel: 'Expand session check-in details' });
    expect(btn.props.accessibilityState).toEqual({ expanded: false });
    render.act(() => { btn.props.onPress(); });
    expect(setFatigueExpanded).toHaveBeenCalled();
    expect(texts(root)).toContain('1 unanswered');
  });

  it('keeps expanded history and row editing available', () => {
    const handleCheckInEdit = jest.fn();
    const r = row(1);
    const root = mount(history({ rough: [r], top_reason: 'Lower back' }), { fatigueExpanded: true, handleCheckInEdit });
    expect(texts(root)).toContain('Not great');
    const edit = root.findAll(n => n.props.accessibilityLabel && n.props.accessibilityLabel.startsWith('Edit check-in') && n.props.onPress)[0];
    render.act(() => { edit.props.onPress(); });
    expect(handleCheckInEdit).toHaveBeenCalledWith(r);
  });
});
