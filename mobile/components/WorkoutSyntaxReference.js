// Shared workout syntax example used by empty state and tests.
// This constant prevents drift between displayed guidance and parser expectations.
// The example must parse into the expected section, exercise, and sets structure.

export const WORKOUT_SYNTAX_EXAMPLE = 'Monday\n+Lifting\n-Bench\n135 5,5,5\n140 5,5\n-\n145 5';

export const WORKOUT_SYNTAX_ROWS = [
  'Monday',
  '+Lifting',
  '-Bench',
  '135 5,5,5',
  '140 5,5',
  '-',
  '145 5',
];
