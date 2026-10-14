import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { useTheme, useKuaStyle } from '../theme/ThemeContext';
import { useKuaTypography } from '../theme/typography';
import { useReducedMotion } from '../lib/useReducedMotion';
import { KiloWordmark } from './KiloWordmark';

// App-level startup overlay (#1372). The shell mounts the real app beneath it
// and Home reports when its bounded LOCAL reads have settled (populated, empty,
// failed, or honestly unverified) through `AppLocalReadyContext`. That report
// is a one-way latch per shell instance: a device-wipe remount builds a new
// shell, so it starts a new wait, and a stale Home from the old shell can only
// reach the old shell's setter. Nothing else — tab changes, theme changes,
// retries, later refreshes — can show the overlay again.
export const AppLocalReadyContext = createContext(null);

export function useAppLocalReadyLatch() {
  const [localReady, setLocalReady] = useState(false);
  const markLocalReady = useCallback(() => setLocalReady(true), []);
  return [localReady, markLocalReady];
}

export const STARTUP_LOADING_LABEL = 'Loading your training';

// One loop: plates slide in largest first, the bar settles, a brief hold, then
// the plates fade off their sleeves for the next pass. Reveal never waits for
// a loop to finish — the overlay simply unmounts.
export const STARTUP_LOOP_MS = 1100;

// Barbell geometry (dp). Overall 184 × 48: sleeve 38 | collar 3 | shaft 102 |
// collar 3 | sleeve 38. Plates sit on the sleeves, heaviest against the collar.
const BAR_WIDTH = 184;
const BAR_HEIGHT = 48;
const SLEEVE_WIDTH = 38;
const COLLAR_WIDTH = 3;
const PLATE_GAP = 1;
const PLATE_TRAVEL = 22;
export const BARBELL_GEOMETRY = Object.freeze({
  width: BAR_WIDTH,
  height: BAR_HEIGHT,
  shaft: { width: 102, height: 3 },
  sleeve: { width: SLEEVE_WIDTH, height: 4 },
  collar: { width: COLLAR_WIDTH, height: 12 },
  // Heaviest → lightest, which is also the order they slide in.
  plates: [
    { key: 'heavy', width: 6, height: 38, start: 0, end: 0.2 },
    { key: 'medium', width: 5, height: 28, start: 0.14, end: 0.34 },
    { key: 'light', width: 4.5, height: 20, start: 0.28, end: 0.48 },
  ],
});

const SETTLE_START = 0.48;
const SETTLE_END = 0.56;
const FADE_START = 0.88;

// The native driver cannot run an interpolation's `easing`, so each eased move
// is sampled into a few linear stops along a cubic ease-out instead.
const EASE_OUT = Easing.out(Easing.cubic);
const EASE_STEPS = 6;
function easedStops(start, end, from, to) {
  const inputRange = [];
  const outputRange = [];
  for (let i = 0; i <= EASE_STEPS; i += 1) {
    const t = i / EASE_STEPS;
    inputRange.push(start + (end - start) * t);
    outputRange.push(from + (to - from) * EASE_OUT(t));
  }
  return { inputRange, outputRange };
}
function track(stops) {
  const inputRange = stops.flatMap((s) => s.inputRange);
  const outputRange = stops.flatMap((s) => s.outputRange);
  return { inputRange, outputRange, extrapolate: 'clamp' };
}

// Left-edge x of each loaded plate on the left sleeve, packed outward from the
// collar. The right side mirrors it.
function plateOffsets() {
  let edge = SLEEVE_WIDTH - PLATE_GAP;
  return BARBELL_GEOMETRY.plates.map((plate) => {
    const left = edge - plate.width;
    edge = left - PLATE_GAP;
    return left;
  });
}
const PLATE_LEFTS = plateOffsets();

function plateMotion(progress, plate, side) {
  if (!progress) return null;
  const outward = side === 'left' ? -PLATE_TRAVEL : PLATE_TRAVEL;
  return {
    opacity: progress.interpolate({
      inputRange: [0, plate.start, plate.end, FADE_START, 1],
      outputRange: [0, 0, 1, 1, 0],
      extrapolate: 'clamp',
    }),
    transform: [{
      translateX: progress.interpolate(track([
        { inputRange: [0], outputRange: [outward] },
        easedStops(plate.start, plate.end, outward, 0),
        { inputRange: [1], outputRange: [0] },
      ])),
    }],
  };
}

// Drives the loop only while motion is allowed. `useReducedMotion` reports
// reduced until the OS preference is known, so nothing animates on a guess.
function useLoopProgress(animate) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return undefined;
    progress.setValue(0);
    const loop = Animated.loop(Animated.timing(progress, {
      toValue: 1,
      duration: STARTUP_LOOP_MS,
      easing: Easing.linear,
      useNativeDriver: Platform.OS !== 'web',
    }));
    loop.start();
    return () => {
      loop.stop();
      progress.stopAnimation();
    };
  }, [animate, progress]);
  return animate ? progress : null;
}

export function StartupBarbell({ animate }) {
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const styles = useMemo(() => createBarbellStyles(colors, kua), [colors, kua]);
  const progress = useLoopProgress(animate);
  const settle = progress ? {
    transform: [{
      translateY: progress.interpolate(track([
        { inputRange: [0], outputRange: [0] },
        easedStops(SETTLE_START, SETTLE_END, 0, 1),
        { inputRange: [FADE_START, 1], outputRange: [1, 0] },
      ])),
    }],
  } : null;
  const plates = (side) => BARBELL_GEOMETRY.plates.map((plate, i) => {
    const left = side === 'left' ? PLATE_LEFTS[i] : BAR_WIDTH - PLATE_LEFTS[i] - plate.width;
    const PlateView = progress ? Animated.View : View;
    return (
      <PlateView
        key={`${side}-${plate.key}`}
        testID={`startup-plate-${side}-${plate.key}`}
        style={[
          styles.plate,
          { left, width: plate.width, height: plate.height, top: (BAR_HEIGHT - plate.height) / 2 },
          plateMotion(progress, plate, side),
        ]}
      />
    );
  });
  const Group = progress ? Animated.View : View;
  return (
    <Group testID="startup-barbell" style={[styles.bar, settle]}>
      <View style={[styles.sleeve, { left: 0 }]} />
      <View style={[styles.sleeve, { right: 0 }]} />
      <View style={[styles.collar, { left: SLEEVE_WIDTH }]} />
      <View style={[styles.collar, { right: SLEEVE_WIDTH }]} />
      <View testID="startup-shaft" style={styles.shaft} />
      {plates('left')}
      {plates('right')}
    </Group>
  );
}

// Opaque, full-screen, and modal while mounted: it takes every touch and is
// the only accessible element, announced once as one loading status. The
// shell hides the content underneath from accessibility at the same time.
export function AppStartupOverlay() {
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const typography = useKuaTypography();
  const styles = useMemo(() => createOverlayStyles(colors, kua, typography), [colors, kua, typography]);
  const reduceMotion = useReducedMotion();
  return (
    <View
      testID="app-startup-overlay"
      style={styles.overlay}
      onStartShouldSetResponder={() => true}
      accessible
      accessibilityViewIsModal
      importantForAccessibility="yes"
      accessibilityRole="progressbar"
      accessibilityLabel={STARTUP_LOADING_LABEL}
      accessibilityState={{ busy: true }}
    >
      {/* Offsets the wordmark's own -8 header nudge so the mark centers. */}
      <View style={styles.wordmarkSlot}>
        <KiloWordmark />
      </View>
      <View style={styles.barbellSlot}>
        <StartupBarbell animate={!reduceMotion} />
      </View>
      <Text style={styles.copy}>{`${STARTUP_LOADING_LABEL}…`}</Text>
    </View>
  );
}

const createBarbellStyles = (colors, kua) => {
  const metal = kua ? kua.onSurfaceVariant : colors.textMuted;
  return StyleSheet.create({
    bar: { width: BAR_WIDTH, height: BAR_HEIGHT },
    shaft: {
      position: 'absolute',
      left: SLEEVE_WIDTH + COLLAR_WIDTH,
      top: (BAR_HEIGHT - BARBELL_GEOMETRY.shaft.height) / 2,
      width: BARBELL_GEOMETRY.shaft.width,
      height: BARBELL_GEOMETRY.shaft.height,
      borderRadius: 1.5,
      backgroundColor: metal,
    },
    sleeve: {
      position: 'absolute',
      top: (BAR_HEIGHT - BARBELL_GEOMETRY.sleeve.height) / 2,
      width: SLEEVE_WIDTH,
      height: BARBELL_GEOMETRY.sleeve.height,
      borderRadius: 2,
      backgroundColor: metal,
    },
    collar: {
      position: 'absolute',
      top: (BAR_HEIGHT - BARBELL_GEOMETRY.collar.height) / 2,
      width: COLLAR_WIDTH,
      height: BARBELL_GEOMETRY.collar.height,
      borderRadius: 1,
      backgroundColor: kua ? kua.onSurface : colors.text,
    },
    plate: {
      position: 'absolute',
      borderRadius: 1.5,
      backgroundColor: kua ? kua.primary : colors.accent,
    },
  });
};

const createOverlayStyles = (colors, kua, typography) => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    elevation: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: kua ? kua.background : colors.background,
  },
  wordmarkSlot: {
    paddingLeft: 8,
  },
  barbellSlot: {
    marginTop: 40,
    marginBottom: 20,
  },
  copy: {
    ...typography['body-md'],
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textAlign: 'center',
  },
});
