// Local-only prompt templates for working with a Kilo routine in an external
// LLM. These builders deliberately accept plain note data and return strings:
// they do not read storage, call a network service, or mutate a routine.

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
 * Build a prompt that makes one routine authoritative for exercise naming and
 * returns each selected target unchanged except for those names.
 */
export function buildExerciseNameNormalizationPrompt({ authority, targets = [] } = {}) {
  const targetBlocks = targets.map((routine, index) => routineBlock(`Target routine ${index + 1}: ${text(routine?.title) || 'Untitled Routine'}`, routine)).join('');
  return `Use the authoritative routine below as the source of truth for exercise names. Apply these rules to every selected target routine:

1. Match conservatively. Treat a target exercise as a match only when you are highly confident it is the same movement as one authoritative exercise, even if it is written with shorthand, a spelling or punctuation difference, a different prescription, or extra descriptor text. If the exercises are merely related or similar, or the match is uncertain, leave that header exactly as it is. Do not invent exercises, and do not use any routine other than the authoritative routine as the source of names. If an authoritative name itself looks ambiguous or untidy, use it as written or leave the target unchanged; never invent a cleaner name.
2. Use the authoritative name exactly. For a confident match, replace the target header's name with the authoritative exercise name, character for character, keeping the target header's own structure (its leading dash or number and any marks such as *). Never copy the authoritative routine's prescription into the target.
3. Preserve the target prescription exactly. Keep the target's own sets-by-reps prescription (such as 2x8 or 3x6-8) in the header with the same numbers, rep ranges, spelling, and spacing. The prescription is not descriptor text and must not move.
4. Move all remaining descriptor text to one "-- " note. Any other text in the target header beyond the name and prescription (cues, qualifiers, intensity, side notes) goes into a single comment line that starts with "-- " (two dashes and a space). Do not decide that phrases such as "each leg", "light", or "step up" are redundant and drop them. Keep the descriptor's wording, capitalization, and internal punctuation exactly; you may remove only the separator before it (such as a comma or dash) and parentheses that enclose all of it. Do not paraphrase, summarize, or delete any of its words.
5. Place that note directly after the exercise's logged sets, or directly after its header when it has no sets. Logged sets include rows with a leading "- " (for example "- 135 5,5,5"), bare rows without a dash (for example "135 5,5,5"), and skipped rows (for example "135 -"). Leave existing comments where they are, and never move the note past the next exercise, day heading, section marker, or Week A/B divider.
6. Preserve everything else. Keep weights, reps, session and history columns, dates, existing comments, day headings, section markers (such as +WARMUP), Week A/B "---" dividers, structural marks, exercise order, and all unrelated whitespace and text exactly as written. Do not add, remove, reorder, or otherwise edit exercises or sets. A target with no confident match must be returned completely unchanged.

Examples (the authoritative names here only illustrate the transformation; always use the names in the authoritative routine below):
- Authority "Single-Leg RDL": header "-Single-Leg RDL 2x8 each leg, light" becomes "-Single-Leg RDL 2x8", with the note "-- each leg, light".
- Authority "DB Bench Press": header "-DB Bench Press 3x6-8, step up" becomes "-DB Bench Press 3x6-8", with the note "-- step up".
- Authority "Lat Pulldown": header "-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)" becomes "-Lat Pulldown 2x10-12", with the note "-- pack shoulder down on eccentric".
- Authority "Deadlift": header "-Deadlift — trial sets, slow and controlled" becomes "-Deadlift", with the note "-- trial sets, slow and controlled".

For example, this target exercise:
-DB Bench Press 3x6-8, step up
85 8,8,8
90 -
-- felt good

is returned as:
-DB Bench Press 3x6-8
85 8,8,8
90 -
-- step up
-- felt good

Return each selected target as complete Kilo-importable routine text, one at a time. Label each result with its exact reference label, for example "Target routine 1: Upper", on its own line directly before that routine's text, so duplicate routine titles remain distinguishable. Return every target, even when nothing changed, and do not add explanations, a summary, or a change list. Do not use Markdown fences or return any reference markers. ${FORMAT_GUIDE}${routineBlock(`Authoritative routine: ${text(authority?.title) || 'Untitled Routine'}`, authority)}${targetBlocks}`;
}

/**
 * Explain the portable text grammar without reading any user's routine.
 */
export function buildKiloRoutineFormatPrompt() {
  return `Help me create a routine that I can paste into Kilo's Import Routine screen. ${FORMAT_GUIDE}

First ask about my training goals, schedule, experience, equipment, and preferences. When I ask for the final routine, return only Kilo-importable routine text.`;
}

export const ROUTINE_PROMPT_FORMAT_GUIDE = FORMAT_GUIDE;
