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
  return `Use the authoritative routine below as the source of truth for exercise names. Normalize exercise names in every target routine to match that authority wherever the exercises correspond. Preserve every other character and structure in each target: weights, reps, dates, weekdays, comments/notes, marks, skipped sets, and Week A/B boundaries. Do not add, remove, reorder, or otherwise edit exercises or sets. If a target name has no clear authoritative match, leave it unchanged.

Return each selected target as complete Kilo-importable routine text, one at a time. Label each result with its exact reference label, for example "Target routine 1: Upper", so duplicate routine titles remain distinguishable. Do not use Markdown fences or return any reference markers. ${FORMAT_GUIDE}${routineBlock(`Authoritative routine: ${text(authority?.title) || 'Untitled Routine'}`, authority)}${targetBlocks}`;
}

/**
 * Explain the portable text grammar without reading any user's routine.
 */
export function buildKiloRoutineFormatPrompt() {
  return `Help me create a routine that I can paste into Kilo's Import Routine screen. ${FORMAT_GUIDE}

First ask about my training goals, schedule, experience, equipment, and preferences. When I ask for the final routine, return only Kilo-importable routine text.`;
}

export const ROUTINE_PROMPT_FORMAT_GUIDE = FORMAT_GUIDE;
