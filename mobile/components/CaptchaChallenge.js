// Jest/non-platform fallback. Metro resolves the .web/.native implementations
// in application builds; keeping this inert fallback makes component tests
// independent of a live challenge provider.
import React from 'react';
import { View } from 'react-native';

export function CaptchaChallenge() {
  return <View accessibilityLabel="Security verification" />;
}
