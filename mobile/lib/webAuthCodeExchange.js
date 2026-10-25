// Web auth-callback code exchange (#1640).
//
// supabase-js is configured with detectSessionInUrl:false, so the `?code=` that
// GitHub OAuth and password-reset links return with is exchanged here, once,
// AFTER the auth hook has subscribed. That ordering is what delivers
// PASSWORD_RECOVERY to the app, and the exchange result (not whatever session
// happens to be stored) is the only proof a callback worked: a rejected or
// replayed code can never be mistaken for success by a retained older session.

let inflight = null;

function takeCode() {
  if (typeof window === 'undefined') return null;
  const match = /[?&]code=([^&#]*)/.exec(window.location?.search || '');
  if (!match) return null;
  // '' marks a present-but-unusable code (empty or undecodable): still a
  // callback, and a failed one, not "no callback".
  let code = '';
  try {
    code = decodeURIComponent(match[1]);
  } catch (e) {
    code = '';
  }
  // Drop the single-use code from the address bar so a reload or share cannot
  // replay it. Best-effort: the exchange does not depend on it.
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    window.history?.replaceState?.(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch (e) {
    // ignore
  }
  return code;
}

// Resolves to null when the page carries no code, else the exchange outcome
// `{ session }` or `{ error }` (a malformed or empty code is an error). Memoized so a remount (or a second hook
// instance) reuses the one exchange instead of replaying the consumed code.
export function exchangeWebCallbackCode(client) {
  if (inflight) return inflight;
  const code = takeCode();
  if (code === null || typeof client?.auth?.exchangeCodeForSession !== 'function') return Promise.resolve(null);
  if (!code) {
    inflight = Promise.resolve({ error: new Error('malformed code') });
    return inflight;
  }
  inflight = Promise.resolve()
    .then(() => client.auth.exchangeCodeForSession(code))
    .then(({ data, error }) => (error || !data?.session ? { error: error || new Error('no session') } : { session: data.session }))
    .catch((error) => ({ error }));
  return inflight;
}

export function resetWebCallbackExchangeForTests() {
  inflight = null;
}
