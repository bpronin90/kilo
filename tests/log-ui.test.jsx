import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import '../src/parser.jsx'
import '../src/components/ui.jsx'
import '../src/screens/log.jsx'

// 2026-05-11 is a Monday
const TODAY = '2026-05-11'

function seedExercises() {
  global.KILO_EXERCISES = [
    { id: 'ex_bench', name: 'Bench Press', day: 'monday', sets: 3, repMin: 5, repMax: 8, po: true, isWarmup: false },
  ]
}

function renderLog(goToTab = vi.fn()) {
  return render(React.createElement(window.KiloLog, { goToTab }))
}

beforeEach(() => {
  global.KILO_TODAY = TODAY
  global.dayOfWeek = () => 'monday'
  global.KILO_PT = []
  global.KILO_SESSIONS = []
  seedExercises()
})

afterEach(() => {
  global.KILO_TODAY = '2026-05-09'
  global.dayOfWeek = undefined
  global.KILO_EXERCISES = []
})

describe('duplicate-session banner', () => {
  test('shows banner when today split is already logged', () => {
    global.KILO_SESSIONS = [{
      id: 's_dup_1',
      entry_type: 'workout',
      date: TODAY,
      day: 'monday',
      exercises: [],
      items: [],
      saved_at: '2026-05-11T09:00:00.000Z',
    }]
    renderLog()
    expect(screen.getByText(/already logged today/)).toBeInTheDocument()
  })

  test('does not show banner when no session exists for today', () => {
    renderLog()
    expect(screen.queryByText(/already logged today/)).not.toBeInTheDocument()
  })

  test('does not show banner when a session exists for a different day', () => {
    global.KILO_SESSIONS = [{
      id: 's_other_1',
      entry_type: 'workout',
      date: TODAY,
      day: 'wednesday',
      exercises: [],
      items: [],
      saved_at: '2026-05-11T09:00:00.000Z',
    }]
    renderLog()
    expect(screen.queryByText(/already logged today/)).not.toBeInTheDocument()
  })
})

describe('save-success state', () => {
  test('shows Workout saved heading after valid save', async () => {
    renderLog()
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '135 5,5,5' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('Workout saved')
  })

  test('offers View Stats button after save', async () => {
    renderLog()
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '135 5,5,5' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('View Stats')
  })

  test('offers Back to Home button after save', async () => {
    renderLog()
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '135 5,5,5' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('Back to Home')
  })

  test('View Stats navigates to stats tab', async () => {
    const goToTab = vi.fn()
    render(React.createElement(window.KiloLog, { goToTab }))
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '135 5,5,5' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('View Stats')
    fireEvent.click(screen.getByText('View Stats'))
    expect(goToTab).toHaveBeenCalledWith('stats')
  })

  test('Back to Home navigates to home tab', async () => {
    const goToTab = vi.fn()
    render(React.createElement(window.KiloLog, { goToTab }))
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '135 5,5,5' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('Back to Home')
    fireEvent.click(screen.getByText('Back to Home'))
    expect(goToTab).toHaveBeenCalledWith('home')
  })
})
