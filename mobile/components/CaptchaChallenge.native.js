import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { getCaptchaConfig } from '../lib/captchaConfig';

function challengeHtml(siteKey) {
  // The site key is public configuration, but still validate/encode it before
  // placing it in HTML so an invalid build variable cannot become markup.
  const encodedSiteKey = JSON.stringify(siteKey);
  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https://challenges.cloudflare.com 'unsafe-inline'; connect-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'unsafe-inline'" />
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=ready" defer></script>
<style>html,body,#challenge{margin:0;padding:0;width:100%;min-height:70px;background:transparent}</style>
<script>
function send(type, value) { window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, value: value || '' })); }
function ready() {
  turnstile.render('#challenge', {
    sitekey: ${encodedSiteKey}, size: 'flexible',
    callback: function(token) { send('token', token); },
    'expired-callback': function() { send('expired'); },
    'timeout-callback': function() { send('expired'); },
    'error-callback': function(code) { send('error', String(code || 'challenge')); return true; }
  });
}
</script></head><body><div id="challenge"></div></body></html>`;
}

export function CaptchaChallenge({ onToken, onExpired, onError, resetKey = 0 }) {
  const config = getCaptchaConfig('native');
  const source = useMemo(() => (
    config.configured ? { html: challengeHtml(config.siteKey), baseUrl: config.origin } : null
  ), [config.configured, config.origin, config.siteKey, resetKey]);

  if (!config.configured) {
    return config.required ? (
      <Text style={styles.error} accessibilityLabel="Security verification error">
        Security verification is unavailable in this build.
      </Text>
    ) : null;
  }

  const handleMessage = (event) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === 'token' && message.value) onToken?.(message.value);
      else if (message.type === 'expired') onExpired?.();
      else if (message.type === 'error') onError?.(message.value || 'challenge');
    } catch {
      onError?.('invalid-response');
    }
  };

  return (
    <View style={styles.container} accessibilityLabel="Security verification">
      <WebView
        key={resetKey}
        source={source}
        originWhitelist={[config.origin, 'https://challenges.cloudflare.com', 'about:blank', 'about:srcdoc']}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
        onError={() => onError?.('load')}
        scrollEnabled={false}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 90, width: '100%' },
  webview: { backgroundColor: 'transparent' },
  error: { color: '#B42318', fontSize: 14 },
});
