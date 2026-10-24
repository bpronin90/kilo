import React from 'react';
import { Circle, Line } from 'react-native-svg';

// Hollow ring around the latest recorded weigh-in (Redesign v3, #1603). Drawn
// last, so it stays visible whether or not another point is selected; the
// chart's text description names it, so the ring is never the only carrier.
export function LatestWeighInMarker({ cx, cy, color }) {
  return <Circle testID="latest-weigh-in-ring" cx={cx} cy={cy} r={7} fill="none" stroke={color} strokeWidth={2} />;
}

// Dashed target line for a verified active goal.
export function GoalTargetLine({ y, x1, x2, color }) {
  return (
    <Line
      testID="weight-goal-line"
      x1={x1}
      y1={y}
      x2={x2}
      y2={y}
      stroke={color}
      strokeWidth={1.5}
      strokeDasharray="6,5"
    />
  );
}
