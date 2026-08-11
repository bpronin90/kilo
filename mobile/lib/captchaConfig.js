const SITE_KEY_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

function isReleaseRuntime() {
  if (typeof __DEV__ !== 'undefined') return !__DEV__;
  return process.env.NODE_ENV === 'production';
}

export function getCaptchaConfig(platformOS) {
  const siteKey = (process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || '').trim();
  const configured = SITE_KEY_PATTERN.test(siteKey);
  const required = configured || isReleaseRuntime();
  const rawOrigin = (process.env.EXPO_PUBLIC_TURNSTILE_ORIGIN || '').trim();
  let origin = null;

  if (rawOrigin) {
    try {
      const parsed = new URL(rawOrigin);
      if (parsed.protocol === 'https:') origin = parsed.origin;
    } catch {
      origin = null;
    }
  }

  // Native Turnstile runs in a WebView and needs a stable HTTPS base origin
  // registered in Cloudflare's hostname allowlist. Web uses its current page
  // origin and therefore does not require this second public value.
  const fullyConfigured = configured && (platformOS === 'web' || Boolean(origin));
  return {
    siteKey: configured ? siteKey : null,
    origin,
    required,
    configured: fullyConfigured,
  };
}

export function captchaConfigurationError(platformOS) {
  const config = getCaptchaConfig(platformOS);
  if (!config.required || config.configured) return null;
  return 'Security verification is unavailable in this build. Please update the app or try again later.';
}
