// Auth error message normalization (#1564).
//
// supabase-js surfaces provider failures as `error.message`, and some of those
// messages are not readable text: an opaque provider 500 on sign-up arrives as
// the literal string "{}", and thrown errors may carry an empty, missing, or
// non-string message. useAuthSession passes these straight into the
// { ok: false, error } result that AccountScreen renders verbatim, so the user
// saw a bare "{}" instead of feedback.
//
// usableAuthMessage keeps a real message (trimmed) and otherwise returns the
// caller's action-specific fallback. It never stringifies objects and never
// guesses a cause from an opaque failure, so no provider internals or
// account-existence hints leak through the fallback.

// Placeholder strings that serializers produce for empty or object values.
const PLACEHOLDER_MESSAGES = new Set(['[object object]', 'undefined', 'null']);

// A message that is a serialized JSON object/array ("{}", '{"code":500}',
// "[]") is a raw provider payload, not user-facing text.
function looksLikeSerializedPayload(text) {
  return (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'));
}

export function usableAuthMessage(message, fallback) {
  if (typeof message !== 'string') return fallback;
  const text = message.trim();
  if (!text) return fallback;
  if (PLACEHOLDER_MESSAGES.has(text.toLowerCase())) return fallback;
  if (looksLikeSerializedPayload(text)) return fallback;
  return text;
}

// The { ok: false, error } result shape for a resolved SDK error object.
export function authErrorResult(error, fallback) {
  return { ok: false, error: usableAuthMessage(error?.message, fallback) };
}
