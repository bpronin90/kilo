import {
  MAX_REPLY_LENGTH,
  applySelectedChanges,
  buildNormalizationPreview,
  parseNormalizationReply,
} from '../lib/interoperability/routineNormalizationImport';
import {
  NORMALIZATION_PROTOCOL,
  buildHeaderCatalog,
  extractNoteHeaders,
  toStoredCatalog,
} from '../lib/interoperability/normalizationHeaderCatalog';
import { applyHeaderEdits, insertionIndex, planHeaderEdit } from '../lib/interoperability/normalizationHeaderEdits';
import { applyWorkoutNoteTextBatchIfUnchanged, compareAndSetWorkoutNoteText as saveWorkoutNoteTextIfUnchanged } from '../storage/entries/workoutNotes';
import * as Storage from '../storage/entries';
import { canPickTextFile, pickTextFile } from '../lib/platformFilePicker';

jest.mock('../lib/reminderScheduler', () => ({ reconcileWorkoutReminder: () => Promise.resolve() }));

const snapshotOf = (authority, targets) => ({
  version: 1,
  protocol: NORMALIZATION_PROTOCOL,
  authority,
  targets,
  catalog: toStoredCatalog(buildHeaderCatalog(authority, targets)),
});
// A complete valid reply: every ref answered, `choices` keyed by raw header.
const replyFor = (snapshot, choices = {}) => snapshot.catalog.headers.map(h => `${h.ref} => ${choices[h.raw] ?? 'no match'}`).join('\n');
const keysOf = preview => preview.mappings.map(m => m.ref);

// Extract one header from a one-line note and plan an edit against it.
const planFor = (raw, choice) => planHeaderEdit(extractNoteHeaders(`Monday\n${raw}`).headers[0], { descriptor: null, ...choice });

const AUTH = { id: 'auth', title: 'Upper', raw_text: 'Monday\n-Bench Press 3x5\n- 135 5,5,5' };
const T1 = { id: 't1', title: 'Upper', raw_text: 'Monday\n-bench press 3x5\n- 135 5,5,5 *\n-- elbows in\n---\nTuesday\n-Squat*\n- 185 -\n' };
const T2 = { id: 't2', title: 'Upper', raw_text: 'Friday\n-BB Bench 3x5\n- 140 5,5,5' };
const SNAP = snapshotOf(AUTH, [T1, T2]);
const NOTES = [AUTH, T1, T2];

describe('header catalog (#1386)', () => {
  const A = { id: 'a', title: 'Secret Authority Title', raw_text: 'Monday 2026-10-14\n+LIFTING (~30 min)\n-Bench Press 3x5\n- 999 5,5,5 *PR sentinel\n-- authority comment sentinel\n-Farmer\\Carry 2x40\n-Row' };
  const W1 = { id: 'w1', title: 'Week one sentinel title', raw_text: 'Monday 2026-10-14\n+WARMUP\n-bench press 3x5\n- 111 5,5,5\n-- target comment sentinel\n+LIFTING (~30 min)\n-Row 3x8, slow\n222 8,8\n---\nTuesday\n-bench press 3x5\n- 333 5' };
  const W2 = { id: 'w2', title: 'Week one sentinel title', raw_text: 'Wednesday\n+LIFTING\n-bench press 3x5\n-Bench Press 3x5\n3. Row 3x8, slow\nCore: Plank 3x30 sec' };

  test('sends authority names and each distinct raw header once, deduplicated by exact header text', () => {
    const catalog = buildHeaderCatalog(A, [W1, W2]);
    expect(catalog.ok).toBe(true);
    expect(catalog.names).toEqual(['Bench Press', 'Farmer\\Carry', 'Row']);
    expect(catalog.headers.map(h => [h.ref, h.raw])).toEqual([
      ['H1', '-bench press 3x5'],
      ['H2', '-Row 3x8, slow'],
      ['H3', '-Bench Press 3x5'],
      ['H4', '3. Row 3x8, slow'],
      ['H5', 'Core: Plank 3x30 sec'],
    ]);
    expect(catalog.headers[0].occurrences).toEqual([{ noteId: 'w1', line: 2 }, { noteId: 'w1', line: 10 }, { noteId: 'w2', line: 2 }]);
    expect(catalog.routineCount).toBe(2);
    expect(catalog.headerCount).toBe(5);
  });

  test('context is only a day/section label; refs are stable for the same input and never depend on names or titles', () => {
    const catalog = buildHeaderCatalog(A, [W1, W2]);
    expect(catalog.headers[0].where).toBe('Week A · Monday · WARMUP; Week B · Tuesday; Wednesday · LIFTING');
    expect(catalog.headers[1].where).toBe('Week A · Monday · lifting');
    expect(JSON.stringify(buildHeaderCatalog(A, [W1, W2]).headers)).toBe(JSON.stringify(catalog.headers));
    expect(JSON.stringify(catalog.headers)).not.toMatch(/2026|sentinel|999|111|222|333/);
  });

  test('an unreadable authority, empty names, or no headers is a blocked state, never a guess', () => {
    expect(buildHeaderCatalog({ raw_text: 'x'.repeat(200001) }, [W1])).toEqual({ ok: false, reason: expect.stringMatching(/authoritative routine couldn’t be read/) });
    expect(buildHeaderCatalog({ raw_text: 'Monday' }, [W1]).ok).toBe(false);
    expect(buildHeaderCatalog(A, [{ id: 'bad', title: 'Bad', raw_text: 'x'.repeat(200001) }])).toEqual({ ok: false, reason: expect.stringMatching(/“Bad” couldn’t be read/) });
    expect(buildHeaderCatalog(A, [{ id: 'e', title: 'E', raw_text: 'Monday' }]).reason).toMatch(/no exercise headers/);
  });

  test('names that the reply grammar cannot express (or the reserved no match) are never offered', () => {
    const odd = { id: 'o', title: 'O', raw_text: 'Monday\n-no match\n-Row\n-@import-exercise "Tab\\tName"' };
    expect(buildHeaderCatalog(odd, [W1]).names).toEqual(['Row']);
  });
});

describe('parseNormalizationReply grammar (#1386)', () => {
  const catalog = { headers: ['H1', 'H2', 'H3'].map(ref => ({ ref })) };
  const parse = text => parseNormalizationReply(text, catalog);
  const ALL = 'H1 => no match\nH2 => Lat Pulldown\nH3 => Lat Pulldown | pack shoulder down on eccentric';

  test('accepts match, descriptor, no match, any order, LF/CRLF and exactly one final newline', () => {
    const ok = parse(ALL);
    expect(ok.ok).toBe(true);
    expect([...ok.choices]).toEqual([
      ['H1', { kind: 'none' }],
      ['H2', { kind: 'match', name: 'Lat Pulldown', descriptor: null }],
      ['H3', { kind: 'match', name: 'Lat Pulldown', descriptor: 'pack shoulder down on eccentric' }],
    ]);
    expect(parse(`${ALL}\n`).ok).toBe(true);
    expect(parse(ALL.replace(/\n/g, '\r\n')).ok).toBe(true);
    expect(parse(`${ALL.replace(/\n/g, '\r\n')}\r\n`).ok).toBe(true);
    expect(parse('H3 => no match\nH1 => no match\nH2 => no match').ok).toBe(true);
  });

  test('escapes: \\\\ is a backslash and \\| is a pipe in names and descriptors', () => {
    const ok = parse('H1 => A\\\\B\\|C | cue \\| with pipe \\\\ and slash\nH2 => no match\nH3 => no match');
    expect(ok.choices.get('H1')).toEqual({ kind: 'match', name: 'A\\B|C', descriptor: 'cue | with pipe \\ and slash' });
  });

  const malformed = {
    emptyReply: '',
    onlyNewline: '\n',
    blankInterior: 'H1 => no match\n\nH2 => no match\nH3 => no match',
    twoFinalNewlines: `${ALL}\n\n`,
    leadingBlank: `\n${ALL}`,
    fencedWithBlankInside: `\`\`\`\n${ALL}\n\n\`\`\``,
    fencedLeadingBlankInside: `\`\`\`\n\n${ALL}\n\`\`\``,
    fencedPaddedPayload: `\`\`\`\n ${ALL}\n\`\`\``,
    fencedBareCR: `\`\`\`\n${ALL.replace('H1 =>', 'H1\r=>')}\n\`\`\``,
    fencedMixedEndings: `\`\`\`\n${ALL.replace('\n', '\r\n')}\n\`\`\``,
    prose: `Sure! Here you go:\n${ALL}`,
    proseAfter: `${ALL}\nHope that helps`,
    leadingSpace: ` ${ALL}`,
    trailingSpace: ALL.replace('H1 => no match', 'H1 => no match '),
    lowercaseRef: ALL.replace('H1', 'h1'),
    leadingZero: ALL.replace('H1', 'H01'),
    zeroRef: ALL.replace('H1', 'H0'),
    noSpaces: ALL.replace('H1 => no match', 'H1=>no match'),
    doubleSpace: ALL.replace('H1 => no match', 'H1  => no match'),
    wrongArrow: ALL.replace('H1 => no match', 'H1 -> no match'),
    emptyName: ALL.replace('H2 => Lat Pulldown', 'H2 => '),
    emptyDescriptor: ALL.replace('| pack shoulder down on eccentric', '| '),
    noSpaceAfterPipe: ALL.replace('| pack', '|pack'),
    noSpaceBeforePipe: ALL.replace('Pulldown | pack', 'Pulldown| pack'),
    doubleSpaceBeforePipe: ALL.replace('Pulldown | pack', 'Pulldown  | pack'),
    doubleSpaceAfterPipe: ALL.replace('Pulldown | pack', 'Pulldown |  pack'),
    secondDelimiter: ALL.replace('eccentric', 'eccentric | more'),
    unescapedPipeInField: ALL.replace('pack shoulder', 'pack|shoulder'),
    unknownEscape: ALL.replace('pack', 'pa\\nck'),
    danglingEscape: 'H1 => Lat Pulldown\\\nH2 => no match\nH3 => no match',
    danglingEscapeEnd: ALL.replace('eccentric', 'eccentric\\'),
    control: ALL.replace('pack', 'pa\tck'),
    loneCarriageReturn: ALL.replace('pack', 'pa\rck'),
    doubleCarriageReturn: ALL.replace('H1 => no match', 'H1 => no match\r\r'),
    lineSeparator: ALL.replace('pack', 'pa ck'),
    unknownRef: `${ALL}\nH4 => no match`,
    duplicateRef: `${ALL}\nH1 => no match`,
    missingRef: 'H1 => no match\nH2 => no match',
    hugeRef: `${ALL}\nH99999999999999999999 => no match`,
  };
  test.each(Object.entries(malformed))('%s is rejected for the whole reply', (_name, text) => {
    const result = parse(text);
    expect(result.ok).toBe(false);
    expect(result.errorCount).toBeGreaterThan(0);
  });

  test('unknown, duplicate and missing refs are named and nothing is inferred from order', () => {
    expect(parse(`${ALL}\nH4 => no match`).errors).toEqual([expect.stringMatching(/H4 wasn’t in the prompt/)]);
    expect(parse(`${ALL}\nH1 => no match`).errors).toEqual(['H1 appears more than once.']);
    expect(parse('H1 => no match\nH3 => no match').errors).toEqual(['H2 has no reply line.']);
  });

  test('every problem within the line bound is retained (the screen limits only what it shows)', () => {
    const many = parse('nope\n'.repeat(23));
    expect(many.ok).toBe(false);
    expect(many.errors.length).toBe(24);
    expect(many.errorCount).toBe(many.errors.length);
  });

  test('far more lines than headers is one error; the slack still reports per line', () => {
    const huge = parse('x\n'.repeat(524288));
    expect(huge.errors).toEqual(['The reply has 524288 lines but there are only 3 headers. Reply with exactly one line per header.']);
    const atSlack = parse('x\n'.repeat(23));
    expect(atSlack.errors.filter(e => /^Line \d+ isn/.test(e)).length).toBe(23);
    expect(parse('x\n'.repeat(24)).errors.length).toBe(1);
    const worst = parse('x\n'.repeat(23)).errors.map(e => `- ${e}`).join('\n');
    expect(worst.length).toBeLessThan(5000);
  });

  describe('code fence (#1389)', () => {
    const wrap = (body, tag = '') => `\`\`\`${tag}\n${body}\n\`\`\``;
    test.each([
      ['plain fence', wrap(ALL)],
      ['text tag', wrap(ALL, 'text')],
      ['final payload newline', `\`\`\`\n${ALL}\n\n`.slice(0, -1) + '```'],
      ['CRLF', wrap(ALL).replace(/\n/g, '\r\n')],
      ['CRLF with final newline', `\`\`\`text\r\n${ALL.replace(/\n/g, '\r\n')}\r\n\`\`\``],
      ['outside whitespace', `\n \n${wrap(ALL, 'text')}\n\n  `],
    ])('%s parses exactly like the unfenced reply', (_label, text) => {
      const result = parse(text);
      expect(result.errors).toEqual([]);
      expect([...result.choices]).toEqual([...parse(ALL).choices]);
    });

    test.each([
      ['two blocks', `${wrap('H1 => no match')}\n${wrap('H2 => no match\nH3 => no match')}`, /more than one code block/],
      ['text before', `Here you go:\n${wrap(ALL)}`, /text before the code block/],
      ['text after', `${wrap(ALL)}\nHope that helps`, /text after the code block/],
      ['unclosed', `\`\`\`text\n${ALL}`, /never closed/],
      ['one-line fence', `\`\`\`${ALL.split('\n')[0]}\`\`\``, /on its own line/],
    ])('%s gives one specific fence message and no choices', (_label, text, message) => {
      const result = parse(text);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([expect.stringMatching(message)]);
      expect(result.choices.size).toBe(0);
    });
  });

  describe('lost line breaks (#1389)', () => {
    const joined = 'H1 => no match H2 => Lat Pulldown | pack shoulder down H3 => no match';
    test.each([['unfenced', joined], ['fenced', `\`\`\`text\n${joined}\n\`\`\``], ['crlf', `${joined}\r\n`]])('%s gives exactly one actionable error', (_label, text) => {
      const result = parse(text);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(['The reply lost its line breaks — every answer is on one line. In the chat app, use the Copy button on the code block, then paste again.']);
      expect(result.errorCount).toBe(1);
      expect(result.choices.size).toBe(0);
    });
  });

  describe('missing refs are grouped into ranges (#1389)', () => {
    const many = n => ({ headers: Array.from({ length: n }, (_, i) => ({ ref: `H${i + 1}` })) });
    test('a long run, singletons and disjoint ranges stay accurate', () => {
      expect(parseNormalizationReply('', many(72)).errors.slice(-1)).toEqual(['H1–H72 have no reply line.']);
      const answered = [3, 4, 8, 10].map(n => `H${n} => no match`).join('\n');
      expect(parseNormalizationReply(answered, many(12)).errors).toEqual([
        'H1–H2 have no reply line.', 'H5–H7 have no reply line.', 'H9 has no reply line.', 'H11–H12 have no reply line.',
      ]);
    });
    test('refs are grouped numerically, not as text', () => {
      const answered = Array.from({ length: 12 }, (_, i) => i + 1).filter(n => n !== 2 && n !== 10 && n !== 11).map(n => `H${n} => no match`).join('\n');
      expect(parseNormalizationReply(answered, many(12)).errors).toEqual(['H2 has no reply line.', 'H10–H11 have no reply line.']);
    });
    test('the preview keeps every grouped problem', () => {
      const p = buildNormalizationPreview(Array.from({ length: 6 }, (_, i) => `bad ${i}`).join('\n'), SNAP, NOTES);
      expect(p.replyErrors.length).toBeGreaterThan(0);
      expect(p.replyErrorCount).toBe(p.replyErrors.length);
    });
  });

  test('an oversized reply is rejected before it is split', () => {
    const spy = jest.spyOn(String.prototype, 'split');
    const result = parse(`H1 => ${'x'.repeat(MAX_REPLY_LENGTH)}`);
    expect(result).toEqual(expect.objectContaining({ ok: false, tooLarge: true }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('reply grammar audit: exact accepted language, malformed input blocks Apply (#1386)', () => {
  const authority = { id: 'ga', title: 'A', raw_text: 'Monday\n-Bench Press 3x5\n-Row 3x8' };
  const target = { id: 'gt', title: 'T', raw_text: 'Monday\n-bench 3x5, slow\n- 135 5\n-row 3x8\n- 50 8' };
  const snap = snapshotOf(authority, [target]);
  const notes = [authority, target];
  const OUT = 'Monday\n-Bench Press 3x5\n- 135 5\n-- slow\n-Row 3x8\n- 50 8';
  const V1 = 'H1 => Bench Press | slow';
  const V2 = 'H2 => Row';
  const preview = reply => buildNormalizationPreview(reply, snap, notes);

  test.each([
    ['LF', `${V1}\n${V2}`],
    ['LF + one final LF', `${V1}\n${V2}\n`],
    ['CRLF', `${V1}\r\n${V2}`],
    ['CRLF + one final CRLF', `${V1}\r\n${V2}\r\n`],
    ['reordered', `${V2}\n${V1}`],
  ])('accepts %s and writes the exact reconstruction', (_label, reply) => {
    const p = preview(reply);
    expect(p.replyErrorCount).toBe(0);
    expect(p.rejected).toEqual([]);
    expect(applySelectedChanges(p.entries[0])).toBe(OUT);
  });

  const malformed = {
    emptyReply: '',
    onlyLF: '\n',
    onlyCRLF: '\r\n',
    onlyCR: '\r',
    loneFinalCR: `${V1}\n${V2}\r`,
    loneInteriorCR: `${V1}\r${V2}`,
    loneCRBeforeRef: `\r${V1}\n${V2}`,
    crInName: `H1 => Bench\rPress | slow\n${V2}`,
    crInDescriptor: `H1 => Bench Press | sl\row\n${V2}`,
    crInCrlfReply: `H1 => Bench Press | sl\row\r\n${V2}`,
    doubleCRBeforeLF: `${V1}\r\r\n${V2}`,
    mixedCrlfThenLf: `${V1}\r\n${V2}\n`,
    mixedLfThenCrlf: `${V1}\n${V2}\r\n`,
    twoFinalLF: `${V1}\n${V2}\n\n`,
    twoFinalCRLF: `${V1}\r\n${V2}\r\n\r\n`,
    finalCrlfThenLf: `${V1}\r\n${V2}\r\n\n`,
    leadingBlank: `\n${V1}\n${V2}`,
    interiorBlank: `${V1}\n\n${V2}`,
    interiorBlankCrlf: `${V1}\r\n\r\n${V2}`,
    whitespaceOnlyLine: `${V1}\n \n${V2}`,
    tabOnlyLine: `${V1}\n\t\n${V2}`,
    bomStart: `\uFEFF${V1}\n${V2}`,
    zeroWidthBeforeRef: `\u200B${V1}\n${V2}`,
    zeroWidthInArrow: `H1 =\u200B> Bench Press | slow\n${V2}`,
    nulInField: `H1 => Bench Press | sl\u0000ow\n${V2}`,
    tabInField: `H1 => Bench Press | sl\tow\n${V2}`,
    nelInField: `H1 => Bench Press | sl\u0085ow\n${V2}`,
    trailingSpaceBeforeLF: `${V1} \n${V2}`,
    trailingSpaceBeforeCRLF: `${V1} \r\n${V2}`,
    trailingSpaceAfterNoMatch: `H1 => no match \n${V2}`,
    trailingSpaceLastLine: `${V1}\n${V2} `,
    arrowDoubleArrowChar: `H1 ⇒ Bench Press | slow\n${V2}`,
    arrowFullwidth: `H1 ＝＞ Bench Press | slow\n${V2}`,
    arrowNbsp: `H1\u00A0=> Bench Press | slow\n${V2}`,
    arrowAngle: `H1 =〉 Bench Press | slow\n${V2}`,
    leadingZeroRef: `H01 => Bench Press | slow\n${V2}`,
    zeroRef: `H0 => Bench Press | slow\n${V1}\n${V2}`,
    lowercaseRef: `h1 => Bench Press | slow\n${V2}`,
    missingSpaces: `H1=>Bench Press | slow\n${V2}`,
    leadingSpace: ` ${V1}\n${V2}`,
    doubleSpaceAfterArrow: `H1 =>  Bench Press | slow\n${V2}`,
    escapedPipeThenNoDelimiterSpace: `H1 => Bench Press\\|| slow\n${V2}`,
    danglingBackslashLineEnd: `${V1}\\\n${V2}`,
    danglingBackslashReplyEnd: `${V1}\n${V2}\\`,
    emptyDescriptorSpaced: `H1 => Bench Press | \n${V2}`,
    emptyDescriptorBare: `H1 => Bench Press |\n${V2}`,
    lineSeparatorAsNewline: `${V1}\u2028${V2}`,
    paragraphSeparatorAsNewline: `${V1}\u2029${V2}`,
    lineSeparatorInField: `H1 => Bench Press | sl\u2028ow\n${V2}`,
    nelAsNewline: `${V1}\u0085${V2}`,
    // U+FEFF is JS whitespace, so at a field edge it is edge whitespace.
    bomAtDescriptorStart: `H1 => Bench Press | \uFEFFslow\n${V2}`,
  };
  test.each(Object.entries(malformed))('%s is malformed: the whole reply is blocked and no edit text exists', (_name, reply) => {
    const p = preview(reply);
    expect(p.replyErrorCount).toBeGreaterThan(0);
    expect(p.entries).toEqual([]);
    expect(p.mappings).toEqual([]);
    expect(parseNormalizationReply(reply, snap.catalog).ok).toBe(false);
  });

  test.each([
    ['reserved text with a descriptor', `H1 => no match | slow\n${V2}`],
    ['zero-width space in the name', `H1 => Bench\u200B Press | slow\n${V2}`],
    ['zero-width space in the descriptor', `H1 => Bench Press | slow\u200B\n${V2}`],
    ['BOM inside the descriptor', `H1 => Bench Press | sl\uFEFFow\n${V2}`],
    ['escaped pipe at the name end', `H1 => Bench Press\\| | slow\n${V2}`],
    ['escaped backslash at the descriptor end', `H1 => Bench Press | slow\\\\\n${V2}`],
  ])('%s parses but is rejected for that header and never written', (_label, reply) => {
    const p = preview(reply);
    expect(p.replyErrorCount).toBe(0);
    expect(p.rejected.map(r => r.ref)).toEqual(['H1']);
    expect(p.mappings.map(m => m.ref)).toEqual(['H2']);
    // Only the independent H2 rename lands; H1 keeps its exact original bytes.
    expect(applySelectedChanges(p.entries[0])).toBe('Monday\n-bench 3x5, slow\n- 135 5\n-Row 3x8\n- 50 8');
  });

  test('an escaped pipe or backslash at a field end round-trips exactly when the original has it', () => {
    const auth = { id: 'ea', title: 'A', raw_text: 'Monday\n-Bench Press 3x5' };
    for (const [tail, escaped] of [['|', '\\|'], ['\\', '\\\\']]) {
      const t = { id: 'et', title: 'T', raw_text: `Monday\n-bench 3x5, slow${tail}` };
      const s = snapshotOf(auth, [t]);
      const p = buildNormalizationPreview(`H1 => Bench Press | slow${escaped}`, s, [auth, t]);
      expect(p.rejected).toEqual([]);
      expect(applySelectedChanges(p.entries[0])).toBe(`Monday\n-Bench Press 3x5\n-- slow${tail}`);
      expect(buildNormalizationPreview(`H1 => Bench Press | slow${escaped}\r`, s, [auth, t]).replyErrorCount).toBeGreaterThan(0);
    }
  });
});

describe('buildNormalizationPreview (#1386)', () => {
  test('a reply of no match lines proposes nothing and writes nothing', () => {
    const preview = buildNormalizationPreview(replyFor(SNAP), SNAP, NOTES);
    expect(preview.replyErrorCount).toBe(0);
    expect(preview.mappings).toEqual([]);
    expect(preview.noMatchCount).toBe(SNAP.catalog.headers.length);
    expect(preview.entries.map(e => applySelectedChanges(e))).toEqual([null, null]);
  });

  test('matches by ref regardless of order, applies bytes outside headers untouched incl. CRLF and trailing newline', () => {
    const crlf = { ...T2, raw_text: 'Friday\r\n-BB Bench 3x5\r\n- 140 5,5,5\r\n' };
    const snap = snapshotOf(AUTH, [T1, crlf]);
    const lines = replyFor(snap, { '-bench press 3x5': 'Bench Press', '-BB Bench 3x5': 'Bench Press' }).split('\n').reverse().join('\n');
    const preview = buildNormalizationPreview(lines, snap, [AUTH, T1, crlf]);
    expect(preview.mappings.map(m => `${m.oldHeader}>${m.newName}`)).toEqual(['-bench press 3x5>Bench Press', '-BB Bench 3x5>Bench Press']);
    expect(applySelectedChanges(preview.entries[0])).toBe(T1.raw_text.replace('-bench press', '-Bench Press'));
    expect(applySelectedChanges(preview.entries[1])).toBe('Friday\r\n-Bench Press 3x5\r\n- 140 5,5,5\r\n');
  });

  test('deselected mappings, targets and occurrences are not applied', () => {
    const preview = buildNormalizationPreview(replyFor(SNAP, { '-bench press 3x5': 'Bench Press', '-BB Bench 3x5': 'Bench Press' }), SNAP, NOTES);
    const only = occurrence => occurrence.ref === preview.mappings[1].ref;
    expect(applySelectedChanges(preview.entries[0], only)).toBeNull();
    expect(applySelectedChanges(preview.entries[1], only)).toBe('Friday\n-Bench Press 3x5\n- 140 5,5,5');
    const noOccurrence = occurrence => occurrence.key !== 't2:1';
    expect(applySelectedChanges(preview.entries[1], noOccurrence)).toBeNull();
  });

  test('a structural reply error blocks everything even when other lines are valid', () => {
    const good = replyFor(SNAP, { '-bench press 3x5': 'Bench Press' });
    for (const bad of [`${good}\nextra`, good.replace('H2 => no match', 'H2 => no match |'), `Here:\n${good}`]) {
      const preview = buildNormalizationPreview(bad, SNAP, NOTES);
      expect(preview.entries).toEqual([]);
      expect(preview.mappings).toEqual([]);
      expect(preview.replyErrorCount).toBeGreaterThan(0);
    }
  });

  test('a semantically invalid mapping is reported and never applied; independent mappings still proceed', () => {
    const preview = buildNormalizationPreview(replyFor(SNAP, { '-bench press 3x5': 'Bench Press', '-BB Bench 3x5': 'Conventional Deadlift' }), SNAP, NOTES);
    expect(keysOf(preview)).toEqual(['H1']);
    expect(preview.rejected).toEqual([{ ref: 'H3', header: '-BB Bench 3x5', problem: expect.stringMatching(/isn’t an exercise name in the authoritative routine/) }]);
    expect(applySelectedChanges(preview.entries[1])).toBeNull();
  });

  test.each([
    ['not in authority, no descriptor', 'Bench'],
    ['wrong case', 'bench press'],
    ['reserved text with a descriptor', 'no match | cue'],
    ['extra descriptor', 'Bench Press | invented'],
  ])('a name that is not exactly an authority name is rejected: %s', (_label, choice) => {
    const preview = buildNormalizationPreview(replyFor(SNAP, { '-BB Bench 3x5': choice }), SNAP, NOTES);
    expect(preview.mappings).toEqual([]);
    expect(preview.rejected).toHaveLength(1);
  });

  test('a mapping to the header’s own current name is a no-op, not an edit', () => {
    const same = { id: 'same', title: 'Same', raw_text: 'Monday\n-Bench Press 3x5' };
    const snap = snapshotOf(AUTH, [same]);
    const preview = buildNormalizationPreview(replyFor(snap, { '-Bench Press 3x5': 'Bench Press' }), snap, [AUTH, same]);
    expect(preview.mappings).toEqual([]);
    expect(preview.rejected).toEqual([]);
    expect(preview.unchangedCount).toBe(1);
    // "No match" in another case is only an (unknown) name, never the no-op.
    expect(buildNormalizationPreview(replyFor(snap, { '-Bench Press 3x5': 'No match' }), snap, [AUTH, same]).rejected).toHaveLength(1);
  });

  test('an oversized reply is rejected before parsing and unsupported or tampered snapshots are not routed', () => {
    expect(buildNormalizationPreview('x'.repeat(MAX_REPLY_LENGTH + 1), SNAP, NOTES).tooLarge).toBe(true);
    const { protocol, ...legacy } = SNAP;
    expect(buildNormalizationPreview(replyFor(SNAP), legacy, NOTES).unsupported).toBe(true);
    expect(buildNormalizationPreview(replyFor(SNAP), { ...SNAP, catalog: { ...SNAP.catalog, names: ['Other'] } }, NOTES).inconsistent).toBe(true);
    const moved = { ...SNAP, catalog: { ...SNAP.catalog, headers: SNAP.catalog.headers.map((h, i) => (i ? h : { ...h, occurrences: [{ noteId: 't1', line: 3 }] })) } };
    expect(buildNormalizationPreview(replyFor(SNAP), moved, NOTES).inconsistent).toBe(true);
  });

  test('stale authority blocks the batch; stale or deleted target blocks only that target', () => {
    const reply = replyFor(SNAP, { '-bench press 3x5': 'Bench Press', '-BB Bench 3x5': 'Bench Press' });
    expect(buildNormalizationPreview(reply, SNAP, [{ ...AUTH, raw_text: 'x' }, T1, T2]).authorityStale).toBe(true);
    expect(buildNormalizationPreview(reply, SNAP, [T1, T2]).authorityStale).toBe(true);
    const preview = buildNormalizationPreview(reply, SNAP, [AUTH, { ...T1, raw_text: 'edited' }, T2]);
    expect(preview.entries[0].problems[0]).toMatch(/edited after/);
    expect(preview.entries[1].occurrences).toHaveLength(1);
    expect(preview.mappings.map(m => [m.ref, m.occurrenceCount])).toEqual([['H3', 1]]);
    expect(buildNormalizationPreview(reply, SNAP, [AUTH, T2]).entries[0].problems[0]).toMatch(/no longer exists/);
  });
});

describe('planHeaderEdit rebuilds headers from the original bytes (#1383 safety carried over)', () => {
  const ok = (raw, choice) => {
    const plan = planFor(raw, choice);
    expect(plan.problem).toBeUndefined();
    return plan;
  };
  const rejected = (raw, choice) => expect(planFor(raw, choice).ok).toBe(false);

  test.each([
    ['-Single-Leg RDL 2x8 each leg, light', 'Single-Leg RDL', 'each leg, light', '-Single-Leg RDL 2x8'],
    ['-DB Bench Press 3x6-8, step up', 'DB Bench Press', 'step up', '-DB Bench Press 3x6-8'],
    ['-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)', 'Lat Pulldown', 'pack shoulder down on eccentric', '-Lat Pulldown 2x10-12'],
    ['-Deadlift — trial sets, slow and controlled', 'Deadlift', 'trial sets, slow and controlled', '-Deadlift'],
  ])('owner example %s', (raw, name, descriptor, body) => {
    expect(ok(raw, { name, descriptor })).toEqual({ ok: true, newBody: body, comment: descriptor });
    // The descriptor is required, exact, and the only thing that moves.
    rejected(raw, { name, descriptor: null });
    rejected(raw, { name, descriptor: `${descriptor}, extra` });
    rejected(raw, { name, descriptor: descriptor.replace(/^./, c => c.toUpperCase()) });
    rejected(raw, { name, descriptor: descriptor.slice(0, -1) });
    rejected(raw, { name, descriptor: descriptor.replace(/ /, '  ') });
  });

  test('descriptor must match: omission, paraphrase, recasing, internal punctuation, invention, partial drops', () => {
    const raw = '-Single-Leg RDL 2x8 each leg, light';
    const name = 'Single-Leg RDL';
    for (const descriptor of ['each leg', 'light', 'each leg light', 'each leg; light!', 'Each leg, light', 'each leg, light, slow', 'one leg, light', 'light, each leg']) {
      rejected(raw, { name, descriptor });
    }
    expect(ok(raw, { name, descriptor: 'each leg, light' }).newBody).toBe('-Single-Leg RDL 2x8');
    // Text on both sides of the prescription joins in one note.
    const both = '-Bench Press (paused) 3x5 light';
    for (const descriptor of ['paused, light', 'paused; light', 'paused light']) expect(ok(both, { name: 'Bench Press', descriptor }).newBody).toBe('-Bench Press 3x5');
    rejected(both, { name: 'Bench Press', descriptor: 'paused' });
    rejected(both, { name: 'Bench Press', descriptor: 'light, paused' });
  });

  test('a descriptor is rejected where the header has none, and missing where it has one', () => {
    rejected('-bench 3x5', { name: 'Bench Press', descriptor: 'cue' });
    expect(ok('-bench 3x5', { name: 'Bench Press' }).comment).toBeNull();
    expect(ok('-BB Bench 3x5', { name: 'Bench Press' }).newBody).toBe('-Bench Press 3x5');
  });

  test('prescription, spacing, loads, ranges, marks and numbering survive byte-for-byte', () => {
    expect(ok('-bench   3x6-8 *PR', { name: 'Bench Press' }).newBody).toBe('-Bench Press   3x6-8 *PR');
    expect(ok('-bench 4×6–8, tempo', { name: 'Bench Press', descriptor: 'tempo' }).newBody).toBe('-Bench Press 4×6–8');
    expect(ok('-bench @135 3x5, paused', { name: 'Bench Press', descriptor: 'paused' }).newBody).toBe('-Bench Press @135 3x5');
    expect(ok('2b. bench 3x5, tempo', { name: 'Bench Press', descriptor: 'tempo' }).newBody).toBe('2b. Bench Press 3x5');
    expect(ok('Core: plank 3x30s', { name: 'Core: Plank' }).newBody).toBe('Core: Plank 3x30s');
    expect(ok('-Squat *', { name: 'Back Squat' }).newBody).toBe('-Back Squat *');
    // A mark glued to the name stays glued to the (exact) chosen name.
    expect(ok('-Squat*', { name: 'Back Squat' }).newBody).toBe('-Back Squat*');
    // Text after the prescription and a mark stays in the header, never moved.
    rejected('-Bench 3x5 paused *PR', { name: 'Bench Press', descriptor: 'paused' });
    expect(ok('-Bench 3x5 *PR paused', { name: 'Bench Press' }).newBody).toBe('-Bench Press 3x5 *PR paused');
  });

  test('a load or rep-range endpoint can never leave the header', () => {
    const name = 'Bench Press';
    for (const descriptor of ['35 3x5, paused', '135 3x5, paused', '3x5, paused', '@135 paused']) rejected('-bench @135 3x5, paused', { name, descriptor });
    for (const descriptor of ['-8 paused', '8 paused', '5-8 paused']) rejected('-bench 3x5-8 paused', { name, descriptor });
    for (const descriptor of ['/8 paused', '8 paused']) rejected('-bench 3x5/8 paused', { name, descriptor });
    expect(ok('-bench 3x5-8 paused', { name, descriptor: 'paused' }).newBody).toBe('-Bench Press 3x5-8');
    expect(ok('-bench 3x5/8 paused', { name, descriptor: 'paused' }).newBody).toBe('-Bench Press 3x5/8');
    // A unit or word glued to the prescription is an ambiguous boundary.
    rejected('-bench 3x5kg heavy', { name, descriptor: 'kg heavy' });
    rejected('-bench 3x5kg heavy', { name, descriptor: 'heavy' });
  });

  test('a timed declaration keeps its unit and meaning', () => {
    const name = 'Plank';
    for (const descriptor of ['sec, slow', 'sec slow', 's, slow', '3x30 sec, slow', null]) rejected('-plank 3x30 sec, slow', { name, descriptor });
    rejected('-plank 3x30sec slow', { name, descriptor: 'sec slow' });
    rejected('-plank 30-45 s, slow', { name, descriptor: 's, slow' });
    rejected('-plank 3x30s, slow', { name, descriptor: 's, slow' });
    expect(ok('-plank 3x30sec slow', { name, descriptor: 'slow' }).newBody).toBe('-Plank 3x30sec');
    expect(ok('-plank 3x30s, slow', { name, descriptor: 'slow' }).newBody).toBe('-Plank 3x30s');
    // The parser folds a spaced unit into the name ("Plank 3x30 sec"), so the
    // rebuilt header could not read as the exact chosen name: left unapplied.
    rejected('-plank 3x30 sec, slow', { name, descriptor: 'slow' });
    rejected('-plank 30-45 s, slow', { name, descriptor: 'slow' });
  });

  test('scalar durations stay in the header; a separated duration is descriptor text', () => {
    for (const descriptor of ['min easy', '5 min easy', '5', 'easy 5 min', null]) rejected('-bike 5 min easy', { name: 'Bike', descriptor });
    // The parser keeps a spaced duration in the name, so this stays unapplied.
    rejected('-bike 5 min easy', { name: 'Bike 5 min', descriptor: 'easy' });
    expect(ok('-bike, 5 min easy', { name: 'Bike', descriptor: '5 min easy' }).newBody).toBe('-Bike');
    expect(ok('-Bench | 2 sec pause 3x5', { name: 'Bench Press', descriptor: '2 sec pause' }).newBody).toBe('-Bench Press 3x5');
    rejected('-Bench | 2 sec pause 3x5', { name: 'Bench Press', descriptor: 'sec pause' });
    rejected('-Bench | 2 sec pause 3x5', { name: 'Bench Press', descriptor: '3 sec pause' });
    rejected('-Bench | 2 sec pause 3x5', { name: 'Bench Press', descriptor: null });
  });

  test('declaration and name-read changes are rejected', () => {
    // A chosen name that itself carries a prescription would change what the row means.
    rejected('-Hold 3x5', { name: 'Hold 3x30 sec' });
    // A spaced prescription is folded into the name by the parser, so it cannot be normalized.
    rejected('-bench 3 x 5', { name: 'Bench Press' });
    rejected('-Bench3x5', { name: 'Bench Press' });
    // A header with no name ahead of its prescription.
    rejected('-3x5', { name: 'Bench Press' });
  });

  test.each([':', ';', ',', ' |', ' (', ' [', ' {', ' <', ' "', ' —', ' –', ' -', ' /', ' ~', ' #', ' !', " '", ' ‘', ' .'])('an alias rename cannot drop a "%s"-separated cue', sep => {
    const close = { ' (': ')', ' [': ']', ' {': '}', ' <': '>', ' "': '"', " '": "'", ' ‘': '’' }[sep] || '';
    const raw = `-Dumbbell Bench Press${sep} paused${close} 3x5`;
    rejected(raw, { name: 'DB Bench Press', descriptor: null });
    expect(ok(raw, { name: 'DB Bench Press', descriptor: 'paused' }).newBody).toBe('-DB Bench Press 3x5');
    rejected(raw, { name: 'DB Bench Press', descriptor: 'paused)' });
  });

  test('in-word name punctuation stays part of an alias name; spaced "&"/"+" join name words', () => {
    expect(ok("-Farmer's Walk 3x40", { name: 'Farmer Carry' }).newBody).toBe('-Farmer Carry 3x40');
    expect(ok('-Single-Leg Leg Press 3x8', { name: 'Single Leg Press' }).newBody).toBe('-Single Leg Press 3x8');
    expect(ok('-Clean & Jerk 3x2', { name: 'C&J' }).newBody).toBe('-C&J 3x2');
    expect(ok('-Clean + Jerk 3x2', { name: 'C+J' }).newBody).toBe('-C+J 3x2');
    expect(ok('-push/pull row 3x5', { name: 'Push/Pull Row' }).newBody).toBe('-Push/Pull Row 3x5');
    rejected("-Dumbbell Bench Press 'paused' 3x5", { name: 'DB Bench Press', descriptor: null });
    // The spaced slash separates a cue and the unseparated alias cue stays an accepted limitation.
    expect(ok('-Bench Press / paused 3x5', { name: 'Bench Press', descriptor: 'paused' }).newBody).toBe('-Bench Press 3x5');
    expect(ok('-Bench Pressing 3x5', { name: 'Bench Press' }).newBody).toBe('-Bench Press 3x5');
  });

  test('numbers in the replaced name cannot vanish; a leading symbol that is not a separator is kept', () => {
    rejected('-Squat 5/3/1', { name: 'Back Squat' });
    rejected('-21s Curl', { name: 'Curl' });
    expect(ok('-45° Incline Press', { name: 'Incline Press 45°' }).newBody).toBe('-Incline Press 45°');
    const name = 'Bench Press';
    expect(ok('-Bench Press 3x5, +5 lb', { name, descriptor: '+5 lb' }).comment).toBe('+5 lb');
    rejected('-Bench Press 3x5, +5 lb', { name, descriptor: '5 lb' });
    expect(ok('-Bench Press 3x5 @ RPE 8', { name, descriptor: '@ RPE 8' }).comment).toBe('@ RPE 8');
  });

  test('a pipe or backslash inside the original text is escaped in the reply and compared unescaped', () => {
    const header = { id: 'p', title: 'P', raw_text: 'Monday\n-bench 3x5 a | b \\ c' };
    const authority = { id: 'a', title: 'A', raw_text: 'Monday\n-Farmer\\Carry 2x40\n-Bench Press 3x5' };
    const snap = snapshotOf(authority, [header]);
    const good = buildNormalizationPreview('H1 => Bench Press | a \\| b \\\\ c', snap, [authority, header]);
    expect(good.rejected).toEqual([]);
    expect(applySelectedChanges(good.entries[0])).toBe('Monday\n-Bench Press 3x5\n-- a | b \\ c');
    // The unescaped forms are malformed, not repaired.
    expect(buildNormalizationPreview('H1 => Bench Press | a | b \\ c', snap, [authority, header]).replyErrorCount).toBeGreaterThan(0);
    expect(buildNormalizationPreview('H1 => Bench Press | a \\| b \\ c', snap, [authority, header]).replyErrorCount).toBeGreaterThan(0);
    // An authority name with a backslash is chosen through its escape.
    const named = { id: 'n', title: 'N', raw_text: 'Monday\n-farmer carry 2x40' };
    const snap2 = snapshotOf(authority, [named]);
    const ok2 = buildNormalizationPreview('H1 => Farmer\\\\Carry', snap2, [authority, named]);
    expect(applySelectedChanges(ok2.entries[0])).toBe('Monday\n-Farmer\\Carry 2x40');
  });

  test('only ONE introducing separator and one enclosing pair go; further punctuation is content', () => {
    const name = 'Bench Press';
    // Repro: the minus after the separator is part of the descriptor.
    expect(ok('-bench 3x5, -5 lb', { name, descriptor: '-5 lb' }).comment).toBe('-5 lb');
    rejected('-bench 3x5, -5 lb', { name, descriptor: '5 lb' });
    for (const [raw, kept, dropped] of [
      ['-bench 3x5, --heavy', '--heavy', 'heavy'],
      ['-bench 3x5; ...slow', '...slow', 'slow'],
      ['-bench 3x5 - -slow', '-slow', 'slow'],
      ['-bench 3x5: !!go', '!!go', 'go'],
      ['-bench 3x5, , slow', ', slow', 'slow'],
      ['-bench 3x5, ((light))', '((light))', 'light'],
      ['-bench 3x5, (light) (heavy)', '(light) (heavy)', 'light heavy'],
      ['-bench 3x5 slow!!', 'slow!!', 'slow'],
      ['-bench 3x5 slow,,', 'slow,,', 'slow,'],
      ['-bench 3x5 slow --', 'slow --', 'slow'],
      ['-bench 3x5 "(a)"', '"(a)"', '(a)'],
      ['-bench 3x5, -- -', '-- -', '--'],
    ]) {
      expect(ok(raw, { name, descriptor: kept }).comment).toBe(kept);
      rejected(raw, { name, descriptor: dropped });
    }
    // Text after the prescription keeps its trailing punctuation.
    expect(ok('-bench 3x5 slow -', { name, descriptor: 'slow -' }).comment).toBe('slow -');
    rejected('-bench 3x5 slow -', { name, descriptor: 'slow' });
    // A single wrapped pair still unwraps, and a glued separator is not an introducing one.
    expect(ok('-bench 3x5, (light)', { name, descriptor: 'light' }).comment).toBe('light');
    expect(ok('-bench 3x5,paused', { name, descriptor: 'paused' }).comment).toBe('paused');
    expect(ok('-bench 3x5 -heavy', { name, descriptor: '-heavy' }).comment).toBe('-heavy');
    rejected('-bench 3x5 -heavy', { name, descriptor: 'heavy' });
    // Both sides of the prescription clean independently, one token each.
    expect(ok('-bench, -a 3x5, -b', { name, descriptor: '-a, -b' }).comment).toBe('-a, -b');
    rejected('-bench, -a 3x5, -b', { name, descriptor: 'a, b' });
  });

  test('only a separator and one enclosing bracket pair are dropped from the moved text', () => {
    const name = 'Bench Press';
    expect(ok('-Bench Press 3x5 (a (b) c)', { name, descriptor: '(a (b) c)' }).newBody).toBe('-Bench Press 3x5');
    rejected('-Bench Press 3x5 (a (b) c)', { name, descriptor: 'a (b) c' });
    expect(ok('-Bench Press 3x5 (a) (b)', { name, descriptor: '(a) (b)' }).comment).toBe('(a) (b)');
    expect(ok('-Bench Press 3x5 step up!', { name, descriptor: 'step up!' }).comment).toBe('step up!');
    expect(ok("-Bench Press 3x5 'til failure", { name, descriptor: "'til failure" }).comment).toBe("'til failure");
    expect(ok('-Bench Press, paused, 3x5', { name, descriptor: 'paused' }).comment).toBe('paused');
  });

  // The rule: per part, only edge whitespace, one introducing separator and one
  // pair enclosing ALL of it; part A (name..prescription) alone also loses one
  // separator directly before the prescription. Nothing else is dropped.
  test('trailing punctuation after the prescription is descriptor text and must be returned exactly', () => {
    const name = 'Bench Press';
    for (const tail of [';', ',', '.', '!', ':', ' -', '-', ' —', ' |', '|', ';;', '!?', ' ...']) {
      const raw = `-bench 3x5, slow${tail}`;
      expect(ok(raw, { name, descriptor: `slow${tail}` }).comment).toBe(`slow${tail}`);
      rejected(raw, { name, descriptor: 'slow' });
      if (tail.length > 1) rejected(raw, { name, descriptor: `slow${tail.slice(0, -1)}`.trimEnd() });
    }
    // Brackets unwrap only when one pair encloses ALL of the part.
    expect(ok('-bench 3x5 (slow);', { name, descriptor: '(slow);' }).comment).toBe('(slow);');
    rejected('-bench 3x5 (slow);', { name, descriptor: 'slow;' });
    rejected('-bench 3x5 (slow);', { name, descriptor: 'slow' });
    expect(ok('-bench 3x5 (a) b', { name, descriptor: '(a) b' }).comment).toBe('(a) b');
    rejected('-bench 3x5 (a) b', { name, descriptor: 'a b' });
    expect(ok('-bench 3x5, (slow!)', { name, descriptor: 'slow!' }).comment).toBe('slow!');
    rejected('-bench 3x5, (slow!)', { name, descriptor: 'slow' });
  });

  test('ahead of the prescription only ONE separator before it is framing; with no prescription the tail is kept', () => {
    const name = 'Bench Press';
    for (const sep of [',', ';', ':', ' -', ' —', ' |']) {
      const raw = `-bench, slow${sep} 3x5`;
      expect(ok(raw, { name, descriptor: 'slow' }).newBody).toBe('-Bench Press 3x5');
      rejected(raw, { name, descriptor: `slow${sep.trim()}` });
    }
    // A run or a non-separator mark before the prescription is content.
    expect(ok('-bench, slow;; 3x5', { name, descriptor: 'slow;' }).comment).toBe('slow;');
    rejected('-bench, slow;; 3x5', { name, descriptor: 'slow' });
    for (const tail of ['!', '.', '?', '...']) {
      expect(ok(`-bench, slow${tail} 3x5`, { name, descriptor: `slow${tail}` }).comment).toBe(`slow${tail}`);
      rejected(`-bench, slow${tail} 3x5`, { name, descriptor: 'slow' });
    }
    expect(ok('-bench, (slow), 3x5', { name, descriptor: 'slow' }).newBody).toBe('-Bench Press 3x5');
    // No prescription: the whole remainder is descriptor, trailing punctuation included.
    for (const tail of [';', ',', ' -', ':', '|']) {
      const raw = `-Deadlift — slow${tail}`;
      expect(ok(raw, { name: 'Deadlift', descriptor: `slow${tail}` }).newBody).toBe('-Deadlift');
      rejected(raw, { name: 'Deadlift', descriptor: 'slow' });
    }
  });

  test('a descriptor spanning both parts keeps each part’s own punctuation', () => {
    const name = 'Bench Press';
    const raw = '-bench, slow; 3x5, fast;';
    for (const descriptor of ['slow, fast;', 'slow; fast;', 'slow fast;']) expect(ok(raw, { name, descriptor }).comment).toBe(descriptor);
    for (const descriptor of ['slow, fast', 'slow;, fast;', 'fast;, slow', 'slow', 'fast;']) rejected(raw, { name, descriptor });
    expect(ok('-bench (paused) 3x5 (light);', { name, descriptor: 'paused, (light);' }).comment).toBe('paused, (light);');
    rejected('-bench (paused) 3x5 (light);', { name, descriptor: 'paused, light' });
  });

  test('repro: a dropped trailing separator after the prescription is rejected end to end and writes nothing', async () => {
    await Storage.replaceWorkoutNotesRaw([]);
    const authority = { id: 'ra', title: 'A', raw_text: 'Monday\n-Bench Press 3x5' };
    const target = { id: 'rt', title: 'T', raw_text: 'Monday\n-bench 3x5, slow;\n- 135 5,5,5' };
    const snap = snapshotOf(authority, [target]);
    const bad = buildNormalizationPreview('H1 => Bench Press | slow', snap, [authority, target]);
    expect(bad.mappings).toEqual([]);
    expect(bad.rejected).toEqual([{ ref: 'H1', header: '-bench 3x5, slow;', problem: expect.stringMatching(/doesn’t match the header’s own text “slow;”/) }]);
    expect(applySelectedChanges(bad.entries[0])).toBeNull();
    const good = buildNormalizationPreview('H1 => Bench Press | slow;', snap, [authority, target]);
    expect(good.rejected).toEqual([]);
    expect(applySelectedChanges(good.entries[0])).toBe('Monday\n-Bench Press 3x5\n- 135 5,5,5\n-- slow;');
  });
});

describe('insertionIndex and applyHeaderEdits', () => {
  const text = 'Mon\n-A 3x5\n- 1 5\n-- c\n-B 3x5\n\n+X\n-C 3x5\n-- n\n---\n-D 3x5\n- 9 5';
  const { lines, boundaries } = extractNoteHeaders(text);
  const at = header => insertionIndex(lines, header, boundaries);

  test('lands after the last set, before trailing comments, never past the next exercise, section or divider', () => {
    expect(at(1)).toBe(2);
    expect(at(4)).toBe(4);
    expect(at(7)).toBe(7);
    expect(at(10)).toBe(11);
  });

  test('bare, dashed, skip and recovered rows count as sets', () => {
    const rows = 'Mon\n-A 3x5\n- 1 5\n2 5,5\n-\n3 -\n-230 5\n-- c\n-B 3x5';
    const note = extractNoteHeaders(rows);
    expect(insertionIndex(note.lines, 1, note.boundaries)).toBe(6);
  });

  test('edits apply bottom-up to the original bytes, CRLF and the final newline included', () => {
    const original = 'Mon\r\n-a (x) 3x5\r\n- 1 5\r\n-b (y)\r\n';
    const note = extractNoteHeaders(original);
    const out = applyHeaderEdits(original, [
      { line: 1, newBody: '-A 3x5', comment: 'x', insertAfter: insertionIndex(note.lines, 1, note.boundaries) },
      { line: 3, newBody: '-B', comment: 'y', insertAfter: insertionIndex(note.lines, 3, note.boundaries) },
    ]);
    expect(out).toBe('Mon\r\n-A 3x5\r\n- 1 5\r\n-- x\r\n-B\r\n-- y\r\n');
    expect(applyHeaderEdits('Mon\r\n-a (x)', [{ line: 1, newBody: '-A', comment: 'x', insertAfter: 1 }])).toBe('Mon\r\n-A\r\n-- x');
    expect(applyHeaderEdits('Mon\n  -a 3x5  \n', [{ line: 1, newBody: '-A 3x5', comment: null, insertAfter: 1 }])).toBe('Mon\n  -A 3x5  \n');
  });
});

describe('owner descriptor examples apply through the batch write (#1383, compact #1386)', () => {
  const AUTHORITY = { id: 'a1383', title: 'Lower', raw_text: 'MONDAY — Lower\n-Single-Leg RDL\n-DB Bench Press 3x6-8\n-Lat Pulldown\n-Deadlift' };
  const ORIG = [
    'MONDAY — Lower', '+WARMUP', '-Plank', '+LIFTING',
    '-Single-Leg RDL 2x8 each leg, light', '25 8,8', '-- existing note', '- 30 8 *PR',
    '-DB Bench Press 3x6-8, step up', '85 8,8,8', '90 -', '-- felt good',
    '-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)',
    '-Deadlift — trial sets, slow and controlled', '135 5,5', '-',
    '---', 'MONDAY — Lower', '-Single-Leg RDL 2x8 each leg', '- 20 8,8', '',
  ].join('\n');
  const RESULT = [
    'MONDAY — Lower', '+WARMUP', '-Plank', '+LIFTING',
    '-Single-Leg RDL 2x8', '25 8,8', '-- existing note', '- 30 8 *PR', '-- each leg, light',
    '-DB Bench Press 3x6-8', '85 8,8,8', '90 -', '-- step up', '-- felt good',
    '-Lat Pulldown 2x10-12', '-- pack shoulder down on eccentric',
    '-Deadlift', '135 5,5', '-', '-- trial sets, slow and controlled',
    '---', 'MONDAY — Lower', '-Single-Leg RDL 2x8', '- 20 8,8', '-- each leg', '',
  ].join('\n');
  const TARGET = { id: 'b1383', title: 'Lower', raw_text: ORIG };
  const TWIN = { id: 'c1383', title: 'Lower', raw_text: 'MONDAY — Lower\n-DB Bench Press 3x6-8, step up\n85 8,8,8' };
  const TWIN_OUT = 'MONDAY — Lower\n-DB Bench Press 3x6-8\n85 8,8,8\n-- step up';
  const snap = snapshotOf(AUTHORITY, [TARGET, TWIN]);
  const notes = [AUTHORITY, TARGET, TWIN];
  const CHOICES = {
    '-Single-Leg RDL 2x8 each leg, light': 'Single-Leg RDL | each leg, light',
    '-DB Bench Press 3x6-8, step up': 'DB Bench Press | step up',
    '-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)': 'Lat Pulldown | pack shoulder down on eccentric',
    '-Deadlift — trial sets, slow and controlled': 'Deadlift | trial sets, slow and controlled',
    '-Single-Leg RDL 2x8 each leg': 'Single-Leg RDL | each leg',
  };
  const full = (extra = {}) => buildNormalizationPreview(replyFor(snap, { ...CHOICES, ...extra }), snap, notes);

  beforeEach(async () => { await Storage.replaceWorkoutNotesRaw([]); });

  test('all four examples (bare, dashed, skip rows; no-set; repeats across notes and weeks) reach the store byte-exactly', async () => {
    const p = full();
    expect(p.rejected).toEqual([]);
    expect(p.mappings.map(m => [m.ref, m.newName, m.descriptor, m.occurrenceCount, m.noteCount])).toEqual([
      ['H2', 'Single-Leg RDL', 'each leg, light', 1, 1],
      ['H3', 'DB Bench Press', 'step up', 2, 2],
      ['H4', 'Lat Pulldown', 'pack shoulder down on eccentric', 1, 1],
      ['H5', 'Deadlift', 'trial sets, slow and controlled', 1, 1],
      ['H6', 'Single-Leg RDL', 'each leg', 1, 1],
    ]);
    const items = p.entries.map(entry => ({ id: entry.id, expected_raw_text: entry.snapshot, next_raw_text: applySelectedChanges(entry) }));
    expect(items).toEqual([
      { id: 'b1383', expected_raw_text: ORIG, next_raw_text: RESULT },
      { id: 'c1383', expected_raw_text: TWIN.raw_text, next_raw_text: TWIN_OUT },
    ]);
    for (const note of notes) await Storage.saveWorkoutNoteItem(note);
    const request = { authority: { id: AUTHORITY.id, expected_raw_text: AUTHORITY.raw_text, accepted_raw_texts: [] }, items };
    const result = await applyWorkoutNoteTextBatchIfUnchanged(request);
    expect(result.saved.map(r => r.id)).toEqual(['b1383', 'c1383']);
    const stored = await Storage.loadWorkoutNotes();
    expect(stored.find(n => n.id === 'b1383').raw_text).toBe(RESULT);
    expect(stored.find(n => n.id === 'c1383').raw_text).toBe(TWIN_OUT);
    // Retrying the same request lands the same text once: no duplicate comment.
    await applyWorkoutNoteTextBatchIfUnchanged(request);
    expect((await Storage.loadWorkoutNotes()).find(n => n.id === 'b1383').raw_text).toBe(RESULT);
  });

  test('repeated headers keep separate write locations; one mapping or one occurrence can be deselected', () => {
    const p = full();
    const sameHeader = p.entries.flatMap(e => e.occurrences).filter(o => o.ref === 'H3');
    expect(sameHeader.map(o => o.key)).toEqual(['b1383:8', 'c1383:1']);
    // Deselecting the week-B mapping removes both its rename and its inserted note.
    const noWeekB = applySelectedChanges(p.entries[0], o => o.ref !== 'H6');
    expect(noWeekB).toBe(RESULT.replace('-Single-Leg RDL 2x8\n- 20 8,8\n-- each leg\n', '-Single-Leg RDL 2x8 each leg\n- 20 8,8\n'));
    // One occurrence of a repeated header: the twin note is untouched, the target is not.
    expect(applySelectedChanges(p.entries[1], o => o.key !== 'c1383:1')).toBeNull();
    expect(applySelectedChanges(p.entries[0], o => o.key !== 'b1383:8')).toBe(RESULT.replace('-DB Bench Press 3x6-8\n85 8,8,8\n90 -\n-- step up\n', '-DB Bench Press 3x6-8, step up\n85 8,8,8\n90 -\n'));
  });

  test('duplicate-title notes are told apart by id, and the same header twice in one note is two locations', () => {
    const twice = { id: 'tw', title: 'Lower', raw_text: 'Monday\n-bench 3x5\n- 1 5\n---\nMonday\n-bench 3x5\n- 2 5' };
    const s = snapshotOf(AUTHORITY, [twice, { ...twice, id: 'tw2' }]);
    const p = buildNormalizationPreview(replyFor(s, { '-bench 3x5': 'DB Bench Press' }), s, [AUTHORITY, twice, { ...twice, id: 'tw2' }]);
    expect(p.mappings[0]).toEqual(expect.objectContaining({ occurrenceCount: 4, noteCount: 2 }));
    expect(p.entries.map(e => e.occurrences.map(o => o.key))).toEqual([['tw:1', 'tw:5'], ['tw2:1', 'tw2:5']]);
    expect(applySelectedChanges(p.entries[1])).toBe('Monday\n-DB Bench Press 3x5\n- 1 5\n---\nMonday\n-DB Bench Press 3x5\n- 2 5');
  });

  test('CRLF text keeps CRLF everywhere, including inserted comments', () => {
    const crlf = { ...TARGET, raw_text: ORIG.replace(/\n/g, '\r\n') };
    const s = snapshotOf(AUTHORITY, [crlf]);
    const p = buildNormalizationPreview(replyFor(s, CHOICES), s, [AUTHORITY, crlf]);
    expect(applySelectedChanges(p.entries[0])).toBe(RESULT.replace(/\n/g, '\r\n'));
  });

  test('every non-header line is reconstructed byte-for-byte from the original, whatever the reply says', () => {
    const p = full();
    const out = applySelectedChanges(p.entries[0]).split('\n');
    const kept = ORIG.split('\n').filter(line => !Object.keys(CHOICES).includes(line) && !/^-(Lat Pulldown|Deadlift —)/.test(line));
    expect(out.filter(line => kept.includes(line))).toEqual(kept);
    expect(out).toHaveLength(ORIG.split('\n').length + 5);
  });

  const bad = {
    descriptorMissing: { '-DB Bench Press 3x6-8, step up': 'DB Bench Press' },
    descriptorOnClean: { '-Single-Leg RDL 2x8 each leg': 'Single-Leg RDL' },
    paraphrased: { '-Deadlift — trial sets, slow and controlled': 'Deadlift | trial sets, go slow' },
    partialDrop: { '-Single-Leg RDL 2x8 each leg, light': 'Single-Leg RDL | each leg' },
    recased: { '-DB Bench Press 3x6-8, step up': 'DB Bench Press | Step Up' },
    internalPunctuation: { '-Single-Leg RDL 2x8 each leg, light': 'Single-Leg RDL | each leg light' },
    invented: { '-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)': 'Lat Pulldown | pack shoulder down on eccentric, slow' },
    prescriptionInDescriptor: { '-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)': 'Lat Pulldown | 2x10-12 pack shoulder down on eccentric' },
    rangeEndpointMoved: { '-DB Bench Press 3x6-8, step up': 'DB Bench Press | 8, step up' },
    notAuthorityName: { '-Deadlift — trial sets, slow and controlled': 'Conventional Deadlift | trial sets, slow and controlled' },
  };
  test.each(Object.entries(bad))('rejects %s and writes nothing for it', async (_name, choices) => {
    for (const note of notes) await Storage.saveWorkoutNoteItem(note);
    const [raw] = Object.keys(choices);
    const header = snap.catalog.headers.find(h => h.raw === raw);
    const p = buildNormalizationPreview(replyFor(snap, choices), snap, notes);
    expect(p.rejected.map(r => r.ref)).toEqual([header.ref]);
    expect(p.mappings).toEqual([]);
    expect(p.entries.map(e => applySelectedChanges(e))).toEqual([null, null]);
    expect((await Storage.loadWorkoutNotes()).find(n => n.id === 'b1383').raw_text).toBe(ORIG);
  });

  test('an uncertain movement answered no match proposes nothing for it', () => {
    const p = full({ '-DB Bench Press 3x6-8, step up': 'no match' });
    expect(p.entries[1].occurrences).toEqual([]);
    expect(applySelectedChanges(p.entries[1])).toBeNull();
    expect(p.noMatchCount).toBe(2);
  });

  test('a stale or deleted target and a changed authority produce no write', async () => {
    for (const note of notes) await Storage.saveWorkoutNoteItem(note);
    const p = full();
    const items = p.entries.map(entry => ({ id: entry.id, expected_raw_text: entry.snapshot, next_raw_text: applySelectedChanges(entry) }));
    const authority = { id: AUTHORITY.id, expected_raw_text: AUTHORITY.raw_text, accepted_raw_texts: [] };
    await Storage.saveWorkoutNoteItem({ ...TWIN, raw_text: 'edited' });
    const result = await applyWorkoutNoteTextBatchIfUnchanged({ authority, items });
    expect(result.skipped).toEqual([expect.objectContaining({ id: 'c1383', status: 'stale' })]);
    expect((await Storage.loadWorkoutNotes()).find(n => n.id === 'c1383').raw_text).toBe('edited');
    await Storage.saveWorkoutNoteItem({ ...AUTHORITY, raw_text: `${AUTHORITY.raw_text}\n-Row` });
    await Storage.saveWorkoutNoteItem(TARGET);
    expect((await applyWorkoutNoteTextBatchIfUnchanged({ authority, items })).authority).toBe('stale');
    expect((await Storage.loadWorkoutNotes()).find(n => n.id === 'b1383').raw_text).toBe(ORIG);
    expect(buildNormalizationPreview(replyFor(snap, CHOICES), snap, [AUTHORITY, TWIN]).entries[0].problems[0]).toMatch(/no longer exists/);
  });
});

describe('saveWorkoutNoteTextIfUnchanged', () => {
  beforeEach(async () => { await Storage.replaceWorkoutNotesRaw([]); });
  const OUT = 'Friday\n-Bench Press 3x5\n- 140 5,5,5';

  test('writes only while the note still holds the prompt snapshot', async () => {
    await Storage.saveWorkoutNoteItem({ ...T2, recovery_block_id: 'blk' });
    expect(await saveWorkoutNoteTextIfUnchanged('t2', T2.raw_text, OUT)).toBe('saved');
    const saved = (await Storage.loadWorkoutNotes()).find(n => n.id === 't2');
    expect(saved.raw_text).toBe(OUT);
    expect(saved.recovery_block_id).toBe('blk');
    // Retry after an interrupted write/enqueue: already-landed text is rewritten, not rejected.
    expect(await saveWorkoutNoteTextIfUnchanged('t2', T2.raw_text, OUT)).toBe('saved');
  });

  test('never overwrites newer text or resurrects a missing note', async () => {
    await Storage.saveWorkoutNoteItem({ ...T2, raw_text: 'newer' });
    expect(await saveWorkoutNoteTextIfUnchanged('t2', T2.raw_text, OUT)).toBe('stale');
    expect((await Storage.loadWorkoutNotes()).find(n => n.id === 't2').raw_text).toBe('newer');
    expect(await saveWorkoutNoteTextIfUnchanged('gone', 'a', 'b')).toBe('missing');
  });
});

describe('platformFilePicker (native)', () => {
  const fileReading = body => jest.fn().mockImplementation(function File(asset) { this.asset = asset; this.text = async () => body; });

  test('android and ios offer file picking', () => {
    expect(canPickTextFile({ platform: 'android' })).toBe(true);
    expect(canPickTextFile({ platform: 'ios' })).toBe(true);
  });

  test('reads the cached copy locally and returns null on cancel', async () => {
    const documentPicker = { getDocumentAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/r.txt', size: 10 }] }) };
    const File = fileReading('H1 => no match');
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('fetch must not be used'); });
    await expect(pickTextFile({ platform: 'android', documentPicker, File })).resolves.toBe('H1 => no match');
    expect(documentPicker.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ copyToCacheDirectory: true }));
    expect(File).toHaveBeenCalledWith('file:///cache/r.txt');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    documentPicker.getDocumentAsync.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickTextFile({ platform: 'ios', documentPicker, File })).resolves.toBeNull();
  });

  test('rejects oversized files', async () => {
    const documentPicker = { getDocumentAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x', size: 5 * 1024 * 1024 }] }) };
    await expect(pickTextFile({ platform: 'android', documentPicker, File: fileReading('') })).rejects.toThrow(/too large/);
  });
});
