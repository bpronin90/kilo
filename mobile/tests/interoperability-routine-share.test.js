// Routine share-as-text (#954, Stage 1 of #581).
//
// The point of every assertion here is one property: what leaves the device is
// the envelope plus the routine body EXACTLY as stored, and nothing else.

import fs from 'fs';
import path from 'path';
import React from 'react';
import render from 'react-test-renderer';
import { Share } from 'react-native';
import { Alert } from '../lib/platformAlert';
import {
  ROUTINE_SHARE_HEADER,
  ROUTINE_SHARE_NOTICE_BODY,
  ROUTINE_SHARE_NOTICE_TITLE,
  ROUTINE_COPY_SUCCESS_MESSAGE,
  ROUTINE_COPY_FAILURE_MESSAGE,
  buildRoutineShareText,
  parseRoutineShareText,
  shareRoutine,
  copyRoutineToClipboard,
} from '../lib/interoperability/routineShare';
import { parseWorkoutNote } from '../lib/parser';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import { LogPreviousRoutines } from '../components/LogPreviousRoutines';

// Canonical grammar: an exercise header is a dash immediately followed by a
// non-space (`-Bench Press`); set rows are dash-space (`- 135 5`). #581's
// review caught the spaced-header mistake — these fixtures use the real thing.
const ROUTINE = [
  'Monday',
  '+ Warmup',
  '-Band Pull-Apart',
  '- 0 20',
  '',
  '+ Lifting',
  '-Bench Press',
  '- 135 5',
  '- 155 5 *PR',
  '-- felt strong today',
  '',
  'Thursday',
  '-Deadlift',
  '- 315 3',
].join('\n');

const AB_ROUTINE = `${ROUTINE}\n---\nMonday\n-Squat\n- 225 5\n`;

function pressableByLabel(root, label) {
  return root.findAll(n => n.props && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
}

// #1021: Edit/Copy/Share/Share-as-Image on the CURRENT routine card (only —
// LogPreviousRoutines' saved-routine controls are unaffected) now live behind
// its consolidated three-dot menu (`accessibilityLabel: "Routine actions"`).
// Open it before reaching any of those controls, exactly as a real tap on the
// trigger would.
function openMenu(root) {
  const trigger = pressableByLabel(root, 'Routine actions');
  render.act(() => { trigger.props.onPress({ stopPropagation: jest.fn() }); });
}

describe('routine share envelope', () => {
  test('build composes marker, title, date, blank separator, then the body verbatim', () => {
    const text = buildRoutineShareText({ title: 'Upper/Lower A', rawText: ROUTINE, exportedAt: new Date(2026, 8, 5) });
    expect(text.split('\n').slice(0, 4)).toEqual([
      ROUTINE_SHARE_HEADER,
      '#title: Upper/Lower A',
      '#exported: 2026-09-05',
      '',
    ]);
    expect(text.endsWith(ROUTINE)).toBe(true);
  });

  test('strip recovers the body byte-for-byte, including leading/trailing whitespace', () => {
    const body = `  ${ROUTINE}\n\n`;
    const parsed = parseRoutineShareText(buildRoutineShareText({ title: 'T', rawText: body }));
    expect(parsed.body).toBe(body);
    expect(parsed.hasEnvelope).toBe(true);
    expect(parsed.version).toBe('v1');
    expect(parsed.title).toBe('T');
  });

  test('the round-tripped body parses identically to the original', () => {
    const original = parseWorkoutNote(AB_ROUTINE);
    const round = parseWorkoutNote(parseRoutineShareText(buildRoutineShareText({ title: 'AB', rawText: AB_ROUTINE })).body);
    expect(JSON.stringify(round)).toBe(JSON.stringify(original));
    // The fixture is genuinely parseable, so "identical" is not two empties.
    expect(original.sections.some(s => (s.exercises || []).length > 0)).toBe(true);
  });

  test('annotations, marks, and the A/B separator survive the trip', () => {
    const body = parseRoutineShareText(buildRoutineShareText({ rawText: AB_ROUTINE })).body;
    expect(body).toContain('-- felt strong today');
    expect(body).toContain('- 155 5 *PR');
    expect(body).toContain('\n---\n');
  });

  test('a missing title omits the #title line entirely and strips to null', () => {
    for (const title of [undefined, null, '', '   ']) {
      const text = buildRoutineShareText({ title, rawText: ROUTINE });
      expect(text).not.toContain('#title:');
      expect(parseRoutineShareText(text).title).toBeNull();
    }
  });

  test('a title keeps Unicode and colons, and can never forge extra header lines', () => {
    const text = buildRoutineShareText({ title: 'Push: 上半身 💪\nInjected', rawText: ROUTINE });
    expect(parseRoutineShareText(text).title).toBe('Push: 上半身 💪 Injected');
  });

  test('Unicode in the body round-trips unchanged', () => {
    const body = 'Måndag\n-Bänkpress 上半身 💪\n- 60 5\n-- déjà vú';
    expect(parseRoutineShareText(buildRoutineShareText({ rawText: body })).body).toBe(body);
  });

  test('CRLF and bare CR line endings normalize to the same parse as LF', () => {
    const text = buildRoutineShareText({ title: 'T', rawText: ROUTINE });
    for (const reflowed of [text.replace(/\n/g, '\r\n'), text.replace(/\n/g, '\r')]) {
      const parsed = parseRoutineShareText(reflowed);
      expect(parsed.body).toBe(ROUTINE);
      expect(parsed.title).toBe('T');
    }
  });

  test('bare routine text with no marker is treated as a body, not rejected', () => {
    const parsed = parseRoutineShareText(ROUTINE);
    expect(parsed.hasEnvelope).toBe(false);
    expect(parsed.body).toBe(ROUTINE);
  });

  test('a future version marker is consumed as metadata, best-effort body', () => {
    const parsed = parseRoutineShareText(`#kilo-routine v2\n#title: Later\n#future: x\n\n${ROUTINE}`);
    expect(parsed.version).toBe('v2');
    expect(parsed.title).toBe('Later');
    expect(parsed.body).toBe(ROUTINE);
  });

  test('leading share-sheet blank lines and an empty body are handled without throwing', () => {
    expect(parseRoutineShareText(`\n\n${buildRoutineShareText({ rawText: '' })}`).body).toBe('');
    expect(parseRoutineShareText(null).body).toBe('');
    expect(buildRoutineShareText().startsWith(ROUTINE_SHARE_HEADER)).toBe(true);
  });

  test('nothing but title, export date, and body ever reaches the share text', () => {
    const note = {
      id: 'wn_2026-01-02_abc',
      title: 'Private Routine',
      raw_text: ROUTINE,
      saved_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-03-04T00:00:00.000Z',
      user_id: 'user-9',
      email: 'someone@example.com',
      one_k_exercises: ['Bench Press'],
      deleted_at: null,
      weight_entries: [{ weight_value_lb: 180 }],
      fatigue_checkins: [{ score: 3 }],
      recovery_blocks: [{ id: 'rb1' }],
    };
    const text = buildRoutineShareText({ title: note.title, rawText: note.raw_text });
    for (const secret of ['wn_2026-01-02', '2026-01-02T00', '2026-03-04T00', 'user-9', 'someone@example.com', 'one_k_exercises', '180', 'fatigue', 'recovery_blocks', 'rb1']) {
      expect(text).not.toContain(secret);
    }
    expect(text.split('\n').filter(l => l.startsWith('#'))).toHaveLength(3);
  });
});

describe('export feeds import (#955)', () => {
  test('what Share as Text produces is exactly what Import previews and saves', () => {
    const { analyzeRoutineImportText } = require('../lib/interoperability/routineShare');
    const shared = buildRoutineShareText({ title: 'Upper/Lower A', rawText: AB_ROUTINE });
    const analysis = analyzeRoutineImportText(shared);
    expect(analysis.canImport).toBe(true);
    expect(analysis.body).toBe(AB_ROUTINE);
    expect(analysis.envelopeTitle).toBe('Upper/Lower A');
  });
});

describe('shareRoutine: notice before the platform share', () => {
  test('the notice precedes sharing and cancelling shares nothing', () => {
    const alert = jest.fn();
    const share = jest.fn().mockResolvedValue({ action: 'sharedAction' });
    shareRoutine({ title: 'T', rawText: ROUTINE }, { alert, share });
    expect(share).not.toHaveBeenCalled();
    const [title, body, buttons] = alert.mock.calls[0];
    expect(title).toBe(ROUTINE_SHARE_NOTICE_TITLE);
    expect(body).toBe(ROUTINE_SHARE_NOTICE_BODY);
    expect(buttons[0].style).toBe('cancel');
    expect(buttons[0].onPress).toBeUndefined();
  });

  test('acknowledging hands the composed text to the platform share API', async () => {
    const alert = jest.fn();
    const share = jest.fn().mockResolvedValue({ action: 'sharedAction' });
    shareRoutine({ title: 'T', rawText: ROUTINE, exportedAt: new Date(2026, 8, 5) }, { alert, share });
    alert.mock.calls[0][2][1].onPress();
    expect(share).toHaveBeenCalledWith({
      message: buildRoutineShareText({ title: 'T', rawText: ROUTINE, exportedAt: new Date(2026, 8, 5) }),
    });
    expect(parseRoutineShareText(share.mock.calls[0][0].message).body).toBe(ROUTINE);
  });

  test('a rejected share sheet does not surface an unhandled rejection', () => {
    const alert = jest.fn();
    shareRoutine({ rawText: ROUTINE }, { alert, share: () => Promise.reject(new Error('dismissed')) });
    expect(() => alert.mock.calls[0][2][1].onPress()).not.toThrow();
  });

  // #721/#954 review: a direct `import { Alert } from 'react-native'` here is
  // dead on web for a multi-button dialog, which would silently kill the
  // notice AND the share behind it. The repo-wide guard lives in
  // platform-alert.test.js; this is the local, module-specific one.
  test('the notice goes through lib/platformAlert, never react-native Alert', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/interoperability/routineShare.js'), 'utf8');
    for (const match of source.matchAll(/import \{([^}]*)\} from ['"]react-native['"]/g)) {
      expect(match[1].split(',').map(n => n.trim())).not.toContain('Alert');
    }
    expect(source).toMatch(/from '\.\.\/platformAlert'/);
  });

  test('the default flow uses the platform Alert and Share', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    try {
      shareRoutine({ title: 'T', rawText: ROUTINE });
      alertSpy.mock.calls[0][2][1].onPress();
      expect(shareSpy).toHaveBeenCalledWith({ message: expect.stringContaining(ROUTINE) });
    } finally {
      alertSpy.mockRestore();
      shareSpy.mockRestore();
    }
  });
});

describe('Share Routine is reachable from the current and saved routines', () => {
  test('the current routine card shares the routine it is showing', () => {
    const onShareRoutine = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <LogActiveRoutineCard
          workoutNoteTitle="Current"
          hasABWeeks={false}
          effectiveActiveWeek="A"
          handleToggleWeek={jest.fn()}
          enterCurrentEditor={jest.fn()}
          handleNoteBodyPress={jest.fn()}
          toggleCollapsed={jest.fn()}
          isCollapsed={false}
          dayGroups={[]}
          trackedLifts={{}}
          handleToggleTrack={jest.fn()}
          roughNoteId="n1"
          currentId="n1"
          roughFlaggedNames={new Set()}
          activeEditText={ROUTINE}
          onShareRoutine={onShareRoutine}
        />
      );
    });
    openMenu(component.root);
    const share = pressableByLabel(component.root, 'Share routine');
    render.act(() => { share.props.onPress({ stopPropagation: jest.fn() }); });
    expect(onShareRoutine).toHaveBeenCalledWith({ title: 'Current', rawText: ROUTINE });
  });

  // The A/B regression: `activeEditText` is Week A only, so a card that shared
  // it would drop Week B and the `---` separator from an A/B routine.
  test('an A/B current routine shares both halves, not the viewed week', () => {
    const onShareRoutine = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <LogActiveRoutineCard
          workoutNoteTitle="Current"
          hasABWeeks
          effectiveActiveWeek="A"
          handleToggleWeek={jest.fn()}
          enterCurrentEditor={jest.fn()}
          handleNoteBodyPress={jest.fn()}
          toggleCollapsed={jest.fn()}
          isCollapsed={false}
          dayGroups={[]}
          trackedLifts={{}}
          handleToggleTrack={jest.fn()}
          roughNoteId="n1"
          currentId="n1"
          roughFlaggedNames={new Set()}
          activeEditText={ROUTINE}
          routineRawText={AB_ROUTINE}
          onShareRoutine={onShareRoutine}
        />
      );
    });
    openMenu(component.root);
    const share = pressableByLabel(component.root, 'Share routine');
    render.act(() => { share.props.onPress({ stopPropagation: jest.fn() }); });
    expect(onShareRoutine).toHaveBeenCalledWith({ title: 'Current', rawText: AB_ROUTINE });
    const shared = parseRoutineShareText(buildRoutineShareText(onShareRoutine.mock.calls[0][0])).body;
    expect(shared).toBe(AB_ROUTINE);
    expect(shared).toContain('\n---\n');
    expect(shared).toContain('-Squat'); // Week B, which activeEditText omits
  });

  test('a saved routine shares its full stored body, not the viewed week', () => {
    const note = { id: 'r1', title: 'Saved', raw_text: AB_ROUTINE, saved_at: '2026-01-02T00:00:00.000Z' };
    const onShareRoutine = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <LogPreviousRoutines
          otherNotes={[note]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId="r1"
          viewingNote={note}
          viewingNoteDayGroups={[]}
          viewingHasABWeeks
          viewingEffectiveWeek="A"
          viewingActiveText={ROUTINE}
          handleToggleViewingWeek={jest.fn()}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
          expanded
          onToggleExpanded={jest.fn()}
          onShareRoutine={onShareRoutine}
        />
      );
    });
    const share = pressableByLabel(component.root, 'Share routine Saved');
    render.act(() => { share.props.onPress(); });
    expect(onShareRoutine).toHaveBeenCalledWith({ title: 'Saved', rawText: AB_ROUTINE });
  });
});

describe('copyRoutineToClipboard (#956)', () => {
  const fixedDate = new Date(2026, 8, 5);

  test('writes exactly the buildRoutineShareText payload, full A/B body included', async () => {
    const copy = jest.fn().mockResolvedValue(undefined);
    await copyRoutineToClipboard(
      { title: 'Upper/Lower A', rawText: AB_ROUTINE, exportedAt: fixedDate },
      { copy, systemConfirms: () => false },
    );
    expect(copy).toHaveBeenCalledWith(
      buildRoutineShareText({ title: 'Upper/Lower A', rawText: AB_ROUTINE, exportedAt: fixedDate }),
    );
    // The written text round-trips to the whole stored routine — both halves
    // and the separator — never a week slice.
    const written = copy.mock.calls[0][0];
    const body = parseRoutineShareText(written).body;
    expect(body).toBe(AB_ROUTINE);
    expect(body).toContain('\n---\n');
    expect(body).toContain('-Squat');
  });

  test('success routes an app confirmation everywhere except where the OS shows its own', async () => {
    const copy = jest.fn().mockResolvedValue(undefined);
    await expect(
      copyRoutineToClipboard({ rawText: ROUTINE }, { copy, systemConfirms: () => false }),
    ).resolves.toEqual({ ok: true, showConfirmation: true });
    await expect(
      copyRoutineToClipboard({ rawText: ROUTINE }, { copy, systemConfirms: () => true }),
    ).resolves.toEqual({ ok: true, showConfirmation: false });
  });

  test('a rejected clipboard write reports failure and never success', async () => {
    const copy = jest.fn().mockRejectedValue(new Error('NotAllowedError'));
    const result = await copyRoutineToClipboard(
      { rawText: ROUTINE },
      { copy, systemConfirms: () => true },
    );
    expect(result).toEqual({ ok: false, showConfirmation: true });
  });

  test('exposes distinct success and failure copy for the surface status line', () => {
    expect(ROUTINE_COPY_SUCCESS_MESSAGE).toEqual(expect.any(String));
    expect(ROUTINE_COPY_FAILURE_MESSAGE).toEqual(expect.any(String));
    expect(ROUTINE_COPY_SUCCESS_MESSAGE).not.toBe(ROUTINE_COPY_FAILURE_MESSAGE);
  });
});
