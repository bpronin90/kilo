import React from 'react'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'

// Source files use React as a global (React.useState, etc.)
global.React = React

// Design tokens — mirrors components/ui.jsx KILO_C
global.KILO_C = {
  bg: '#0a0a0a', bg2: '#111111', surface: '#161616', surface2: '#1c1c1c',
  border: '#262626', border2: '#333333', ink: '#f5f5f5', ink2: '#a3a3a3',
  ink3: '#737373', ink4: '#525252', accent: '#ff5b1f', accent2: '#ff7a47',
  accentDim: 'rgba(255,91,31,0.14)', green: '#84cc16', yellow: '#facc15',
  red: '#ef4444', blue: '#60a5fa',
}
global.KILO_FONT = "'Inter', system-ui, sans-serif"
global.KILO_MONO = "'JetBrains Mono', monospace"

// MVP runtime globals
global.KILO_TODAY = '2026-05-09'
global.KILO_WEIGHTS = []
global.KILO_GOALS = []
global.KILO_SESSIONS = []
global.KILO_EXERCISES = []
// 2026-05-09 is a Saturday
global.KILO_SPLIT = {
  sunday:    { label: 'Rest',  sub: 'Recovery' },
  monday:    { label: 'Lower', sub: 'Squat · Deadlift' },
  tuesday:   { label: 'Rest',  sub: 'Recovery' },
  wednesday: { label: 'Upper', sub: 'Bench · OHP' },
  thursday:  { label: 'Rest',  sub: 'Recovery' },
  friday:    { label: 'Lower', sub: 'Squat · Deadlift' },
  saturday:  { label: 'Rest',  sub: 'Recovery' },
}

afterEach(() => {
  cleanup()
  global.KILO_WEIGHTS = []
  localStorage.clear()
})
