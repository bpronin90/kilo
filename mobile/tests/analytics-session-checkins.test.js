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

describe('Session Check-ins inside the Routine Health panel (#1602)', () => {
  const okRow = (n) => ({ ...row(n, []), reasons: [] });

  it('renders the same summary and disclosure without a card, led by the recent strip', () => {
    const setFatigueExpanded = jest.fn();
    const root = mount(history({ rough: [row(2)], ok: [okRow(1), okRow(3)], top_reason: 'Lower back' }), { contained: false, setFatigueExpanded });
    const strip = root.findByProps({ testID: 'session-checkin-strip' });
    expect(strip.props.accessibilityLabel).toBe('Last 3 check-ins: 1 flagged, 2 no issue');
    expect(texts(strip)).toEqual(['!']);
    expect(texts(root)).toEqual(expect.arrayContaining(['Session Check-ins', 'Most common issue', 'Lower back', '1 flagged session']));
    const btn = root.findByProps({ accessibilityLabel: 'Expand session check-in details' });
    render.act(() => { btn.props.onPress(); });
    expect(setFatigueExpanded).toHaveBeenCalled();
  });

  it('keeps at most the ten most recent check-ins and names unanswered ones', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...okRow(1), responded_at: `2026-05-${String(i + 10).padStart(2, '0')}T10:00:00Z` }));
    const root = mount(history({ ok: many, pending: [okRow(1), okRow(2)] }), { contained: false });
    const strip = root.findByProps({ testID: 'session-checkin-strip' });
    expect(strip.props.accessibilityLabel).toBe('Last 10 check-ins: 0 flagged, 9 no issue, 1 unanswered');
  });

  it('the empty state stays the same copy without a card', () => {
    const root = mount(history({}), { contained: false });
    expect(texts(root)).toContain('No check-ins logged yet.');
    expect(root.findAllByProps({ testID: 'session-checkin-strip' })).toHaveLength(0);
  });

  it('keeps row editing reachable when expanded', () => {
    const handleCheckInEdit = jest.fn();
    const r = row(1);
    const root = mount(history({ rough: [r], top_reason: 'Lower back' }), { contained: false, fatigueExpanded: true, handleCheckInEdit });
    const edit = root.findAll(n => n.props.accessibilityLabel && n.props.accessibilityLabel.startsWith('Edit check-in') && n.props.onPress)[0];
    render.act(() => { edit.props.onPress(); });
    expect(handleCheckInEdit).toHaveBeenCalledWith(r);
  });
});
