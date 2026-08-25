import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { LogRecoverySection } from '../components/LogRecoverySection';

const BLOCK = {
  id: 'rb880',
  baseline_note_id: 'baseline',
  baseline_note_title: 'Push Day',
  started_at: '2026-08-01T00:00:00.000Z',
  completed_at: null,
  deleted_at: null,
};
const WEEK = {
  id: 'rw880',
  block_id: BLOCK.id,
  note_id: 'recovery-note',
  week_number: 1,
  completed_at: null,
  deleted_at: null,
};
const NOTE = {
  id: WEEK.note_id,
  title: 'Recovery Week',
  raw_text: 'Monday\n-Walk\n30 min',
};

function renderEditor(overrides = {}) {
  let component;
  act(() => {
    component = TestRenderer.create(
      <LogRecoverySection
        blocks={[BLOCK]}
        weeks={[WEEK]}
        notes={[NOTE]}
        viewingNoteId={NOTE.id}
        viewingNote={NOTE}
        editingNoteId={NOTE.id}
        editingTitle={NOTE.title}
        editingText={NOTE.raw_text}
        {...overrides}
      />
    );
  });
  return component;
}

describe('LogRecoverySection — inline save status (#880)', () => {
  let mounted = [];
  afterEach(() => {
    act(() => { mounted.forEach((component) => component.unmount()); });
    mounted = [];
  });

  test('renders the shared pending-convergence truth in reserved space', () => {
    const component = renderEditor({ editingSaveStatus: 'pending' });
    mounted.push(component);
    const label = component.root.findAll(
      (node) => node.type === 'Text' && node.props.children === 'Saved on device · Not yet synced',
    )[0];
    expect(label).toBeTruthy();
    const reserved = component.root.findAll((node) => {
      const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
      return styles.some((style) => style?.minHeight === 28);
    });
    expect(reserved.length).toBeGreaterThan(0);
  });

  test('saving is snapshot-gated by the hook while the real write still disables Save', () => {
    const component = renderEditor({ editingIsSaving: true, editingSaveStatus: null });
    mounted.push(component);
    const save = component.root.findAll(
      (node) => node.props?.accessibilityLabel === 'Save recovery note',
    )[0];
    expect(save.props.accessibilityState.disabled).toBe(true);
    const text = save.findAll((node) => node.type === 'Text')[0];
    expect(text.props.children).toBe('Save');
    expect(component.root.findAll(
      (node) => node.type === 'Text' && node.props.children === 'Saving…',
    )).toHaveLength(0);
  });

  test('focus or typing cancels a pending async restore without changing the input payload', () => {
    const onEditorInteraction = jest.fn();
    const onChangeEditingText = jest.fn();
    const component = renderEditor({ onEditorInteraction, onChangeEditingText });
    mounted.push(component);
    const input = component.root.findAll(
      (node) => node.props?.accessibilityLabel === 'Recovery note text',
    )[0];
    act(() => { input.props.onFocus(); });
    act(() => { input.props.onChangeText('new text'); });
    expect(onEditorInteraction).toHaveBeenCalledTimes(2);
    expect(onChangeEditingText).toHaveBeenCalledWith('new text');
  });
});
