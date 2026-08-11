import React, { useEffect, useId, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getCaptchaConfig } from '../lib/captchaConfig';

let scriptPromise;

function loadTurnstile() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Browser security verification is unavailable.'));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-kilo-turnstile]');
      const script = existing || document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.kiloTurnstile = 'true';
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Security verification failed to load.')));
      script.onerror = () => reject(new Error('Security verification failed to load.'));
      if (!existing) document.head.appendChild(script);
    }).catch((error) => {
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise;
}

export function CaptchaChallenge({ onToken, onExpired, onError, resetKey = 0 }) {
  const reactId = useId();
  const containerId = `kilo-turnstile-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const widgetRef = useRef(null);
  const config = getCaptchaConfig('web');

  useEffect(() => {
    if (!config.configured) {
      if (config.required) onError?.('configuration');
      return undefined;
    }
    let active = true;
    let turnstileApi;
    loadTurnstile().then((turnstile) => {
      if (!active) return;
      turnstileApi = turnstile;
      widgetRef.current = turnstile.render(`#${containerId}`, {
        sitekey: config.siteKey,
        size: 'flexible',
        callback: (token) => onToken?.(token),
        'expired-callback': () => onExpired?.(),
        'timeout-callback': () => onExpired?.(),
        'error-callback': (code) => {
          onError?.(String(code || 'challenge'));
          return true;
        },
      });
    }).catch(() => {
      if (active) onError?.('load');
    });
    return () => {
      active = false;
      if (turnstileApi && widgetRef.current != null) {
        turnstileApi.remove(widgetRef.current);
      }
      widgetRef.current = null;
    };
  }, [config.configured, config.required, config.siteKey, containerId, onError, onExpired, onToken, resetKey]);

  if (!config.configured) {
    return config.required ? (
      <Text style={styles.error} accessibilityLabel="Security verification error">
        Security verification is unavailable in this build.
      </Text>
    ) : null;
  }
  return <View nativeID={containerId} style={styles.container} accessibilityLabel="Security verification" />;
}

const styles = StyleSheet.create({
  container: { minHeight: 70, width: '100%' },
  error: { color: '#B42318', fontSize: 14 },
});
