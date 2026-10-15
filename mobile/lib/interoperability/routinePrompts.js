// Local-only prompt templates for working with a Kilo routine in an external
// LLM. These builders deliberately accept plain note data and return strings:
// they do not read storage, call a network service, or mutate a routine.
import { buildHeaderCatalog, escapeReplyField } from './normalizationHeaderCatalog.js';

const FORMAT_GUIDE = `Kilo routine text is plain text. Use a day heading followed by exercise headers and optional logged sets:

Monday
-Bench Press 3x5-8
- 135 5,5,5
-- Keep shoulders pinned

Wednesday
-Squat 3x5
- 185 5,5,5

Use a standalone --- line only to divide Week A from Week B. Keep comments on lines beginning with --. Exercise headers begin with one dash; logged sets begin with a dash and a space. Do not add Markdown fences, explanations, or metadata to final importable routine text.`;

function text(value) {
  return value == null ? '' : String(value);
}

function routineBlock(label, routine) {
  // These delimiters are reference-only prompt framing, deliberately unlike
  // Kilo's standalone `---` Week A/B token. The prompt also tells the model
  // never to return them, so they cannot be mistaken for routine content.
  return `\n\n<<< BEGIN KILO ROUTINE REFERENCE: ${label} >>>\n${text(routine?.raw_text)}\n<<< END KILO ROUTINE REFERENCE >>>`;
}

/**
 * Build a conversational planning prompt for one selected routine. The first
 * response is explicitly discussion, so users can iterate before asking for a
 * final Kilo-ready routine.
 */
export function buildRoutinePlanningPrompt(routine) {
  return `I want to plan or update this Kilo workout routine. Start by discussing my goals, constraints, recovery, exercise preferences, and proposed changes. Ask useful questions before writing a replacement routine. Do not produce final importable routine text until I explicitly ask for it.

When I ask for the final version, return only the complete Kilo-importable routine text, with no Markdown fence, explanation, or reference markers. ${FORMAT_GUIDE}${routineBlock(`Selected routine: ${text(routine?.title) || 'Untitled Routine'}`, routine)}`;
}

/**
 * Build the compact Normalize prompt (#1386): only the authority's exercise
 * NAMES and each distinct raw target exercise header (with its H-ref and a
 * day/section context) are sent. No note body, logged set, date or comment is
 * included. The model answers one `H<n> => ...` line per header; Kilo keeps the
 * original notes locally and rebuilds every edit itself. Returns '' when no
 * safe catalog can be extracted, never a full-note fallback.
 */
export function buildExerciseNameNormalizationPrompt({ authority, targets = [], catalog = null } = {}) {
  const built = catalog || buildHeaderCatalog(authority, targets);
  if (!built.ok) return '';
  const names = built.names.map(escapeReplyField).join('\n');
  const headers = built.headers.map(h => `${h.ref}\nheader: ${h.raw}${h.where ? `\nwhere: ${h.where}` : ''}`).join('\n\n');
  return `Match each numbered exercise header below to the authoritative exercise names and reply with one line per header. Apply these rules to every header:

1. Match conservatively. Treat a header as a match only when you are highly confident it is the same movement as one authoritative exercise name, even if it is written with shorthand, a spelling or punctuation difference, a different prescription, or extra descriptor text. If the movements are merely related or similar, or the match is uncertain, reply "no match" for that header. Do not invent exercises, and use only the authoritative names listed below. If an authoritative name itself looks ambiguous or untidy, use it as written or reply "no match"; never invent a cleaner name.
2. Use the authoritative name exactly. For a confident match, reply with the authoritative exercise name, character for character, copied from the list. Never copy an authoritative prescription into a header. Kilo keeps each header's own structure itself (its leading dash or number, prescription, and any marks such as *), so do not rewrite the header.
3. The prescription stays in the header. The header's own sets-by-reps or time prescription (such as 2x8, 3x6-8, or 3x30 sec), any @load, and any marks stay exactly as they are and are never part of the descriptor.
4. Give all remaining descriptor text. Any other text in the header beyond the name and prescription (cues, qualifiers, intensity, side notes) is the descriptor. Give it after the name, keeping its wording, capitalization, and internal punctuation exactly; you may remove only the separator before it (such as a comma or dash) and brackets that enclose all of it. Do not decide that phrases such as "each leg", "light", or "step up" are redundant and drop them. Do not paraphrase, summarize, or delete any of its words. Kilo moves it into one "-- " note. When a header has no descriptor, give none. If you cannot give the descriptor exactly as written, reply "no match" for that header instead.

Reply with exactly one line for every header, in any order, and nothing else. Each line is exactly one of:

H3 => no match
H3 => Lat Pulldown
H3 => Lat Pulldown | pack shoulder down on eccentric

Write the header number exactly as shown, then " => " (a space, an equals sign, a greater-than sign, a space). "no match" is literal lowercase text and leaves that header unchanged. A match is the authoritative name, optionally followed by " | " (a space, a vertical bar, a space) and the descriptor; never write " | " when there is no descriptor. Inside a name or descriptor, write each backslash as \\\\ and each vertical bar as \\| ; no other escapes exist. Do not add Markdown fences, explanations, headings, blank lines, or leading or trailing spaces. Any other reply is rejected without being applied. Kilo makes the changes itself from the original notes, so never return routine text.

Examples (the authoritative names here only illustrate the reply format; always use the names in the authoritative list below):
- Authority "Single-Leg RDL": header "-Single-Leg RDL 2x8 each leg, light" is answered "H1 => Single-Leg RDL | each leg, light".
- Authority "DB Bench Press": header "-DB Bench Press 3x6-8, step up" is answered "H2 => DB Bench Press | step up".
- Authority "Lat Pulldown": header "-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)" is answered "H3 => Lat Pulldown | pack shoulder down on eccentric".
- Authority "Deadlift": header "-Deadlift — trial sets, slow and controlled" is answered "H4 => Deadlift | trial sets, slow and controlled".
- A header for a related but different movement is answered "H5 => no match".

<<< BEGIN KILO AUTHORITATIVE EXERCISE NAMES >>>
${names}
<<< END KILO AUTHORITATIVE EXERCISE NAMES >>>

<<< BEGIN KILO EXERCISE HEADERS >>>
${headers}
<<< END KILO EXERCISE HEADERS >>>`;
}

/**
 * Explain the portable text grammar without reading any user's routine.
 */
export function buildKiloRoutineFormatPrompt() {
  return `Help me create a routine that I can paste into Kilo's Import Routine screen. ${FORMAT_GUIDE}

First ask about my training goals, schedule, experience, equipment, and preferences. When I ask for the final routine, return only Kilo-importable routine text.`;
}

export const ROUTINE_PROMPT_FORMAT_GUIDE = FORMAT_GUIDE;
