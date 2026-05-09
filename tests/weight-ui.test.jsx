import { render, screen, fireEvent } from '@testing-library/react'
import '../parser.jsx'
import '../components/ui.jsx'
import '../screens/weight.jsx'
import '../screens/home.jsx'

// Seed enough entries for rolling-avg calculations in KiloWeight to stay non-null
function seedWeights(n = 8, baseWeight = 180) {
  const entries = []
  for (let i = 0; i < n; i++) {
    const d = new Date('2026-04-30')
    d.setDate(d.getDate() + i + 1)
    const iso = d.toISOString()
    entries.push({
      id: `w_seed_${i}`,
      entry_type: 'weight',
      weight_value: baseWeight,
      weight_unit: 'lb',
      logged_at: iso,
      saved_at: iso,
      note_text: null,
      date: iso.slice(0, 10),
      weight: baseWeight,
    })
  }
  global.KILO_WEIGHTS = entries
}

function renderWeight() {
  const Component = window.KiloWeight
  return render(React.createElement(Component, { goToTab: () => {} }))
}

beforeEach(() => {
  seedWeights()
})

// ── Log button state ──────────────────────────────────────────────────────────

describe('Log button state', () => {
  test('disabled when entry is empty', () => {
    renderWeight()
    expect(screen.getByText('Log')).toBeDisabled()
  })

  test('enabled once entry has a value', () => {
    renderWeight()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '180' } })
    expect(screen.getByText('Log')).not.toBeDisabled()
  })
})

// ── Success feedback ──────────────────────────────────────────────────────────

describe('success feedback', () => {
  test('shows "✓ Weight saved successfully" after valid integer', async () => {
    renderWeight()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '178' } })
    fireEvent.click(screen.getByText('Log'))
    await screen.findByText('✓ Weight saved successfully')
  })

  test('shows success after valid decimal', async () => {
    renderWeight()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '178.5' } })
    fireEvent.click(screen.getByText('Log'))
    await screen.findByText('✓ Weight saved successfully')
  })

  test('button changes to "Saved" after success', async () => {
    renderWeight()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '180' } })
    fireEvent.click(screen.getByText('Log'))
    await screen.findByText('Saved')
  })
})

// ── Failure feedback ──────────────────────────────────────────────────────────

describe('failure feedback', () => {
  test('unit suffix shows format error', async () => {
    renderWeight()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '180lbs' } })
    fireEvent.click(screen.getByText('Log'))
    await screen.findByText('✕ Enter a number only (e.g. 180 or 180.4)')
  })

  test('whitespace-only entry shows required error', async () => {
    renderWeight()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Log'))
    await screen.findByText('✕ Weight is required')
  })

  test('prose input shows format error', async () => {
    renderWeight()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: 'heavy' } })
    fireEvent.click(screen.getByText('Log'))
    await screen.findByText('✕ Enter a number only (e.g. 180 or 180.4)')
  })
})

// ── Persistence shape ─────────────────────────────────────────────────────────

describe('persisted entry shape', () => {
  test('writes canonical fields to localStorage', () => {
    renderWeight()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '179' } })
    fireEvent.click(screen.getByText('Log'))

    const stored = JSON.parse(localStorage.getItem('kilo_weight_entries') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      entry_type: 'weight',
      weight_value: 179,
      weight_unit: 'lb',
    })
    expect(typeof stored[0].id).toBe('string')
    expect(typeof stored[0].logged_at).toBe('string')
    expect(typeof stored[0].saved_at).toBe('string')
  })

  test('id has expected w_ prefix', () => {
    renderWeight()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '180' } })
    fireEvent.click(screen.getByText('Log'))

    const stored = JSON.parse(localStorage.getItem('kilo_weight_entries') || '[]')
    expect(stored[0].id).toMatch(/^w_/)
  })
})

// ── KiloHome quick-log (dashboard weight entry) ───────────────────────────────

function renderHome() {
  const Component = window.KiloHome
  return render(React.createElement(Component, { goToTab: () => {}, openSession: () => {} }))
}

describe('KiloHome quick-log button state', () => {
  test('disabled when entry is empty', () => {
    renderHome()
    // There are two "Log" buttons on the page (tab label + quick-log); the quick-log
    // button is the <button> element, the tab label is a plain span.
    const logBtns = screen.getAllByRole('button', { name: /^Log$/i })
    const quickLog = logBtns[logBtns.length - 1]
    expect(quickLog).toBeDisabled()
  })

  test('enabled once entry has a value', () => {
    renderHome()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '180' } })
    const logBtns = screen.getAllByRole('button', { name: /^Log$/i })
    expect(logBtns[logBtns.length - 1]).not.toBeDisabled()
  })
})

describe('KiloHome quick-log success feedback', () => {
  // After a valid log, loggedToday flips true and the form swaps to the
  // "already logged" stats view. Success is shown there as "✓ Saved successfully".
  test('shows "✓ Saved successfully" in logged-today view', async () => {
    renderHome()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '178' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Log$/i }).at(-1))
    await screen.findByText('✓ Saved successfully')
  })
})

describe('KiloHome quick-log failure feedback', () => {
  test('unit suffix shows format error', async () => {
    renderHome()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '180lbs' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Log$/i }).at(-1))
    await screen.findByText('✕ Enter a number only (e.g. 180 or 180.4)')
  })

  test('whitespace-only entry shows required error', async () => {
    renderHome()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '   ' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Log$/i }).at(-1))
    await screen.findByText('✕ Weight is required')
  })
})

describe('KiloHome quick-log persistence shape', () => {
  test('writes canonical fields to localStorage', () => {
    renderHome()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '179' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Log$/i }).at(-1))

    const stored = JSON.parse(localStorage.getItem('kilo_weight_entries') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      entry_type: 'weight',
      weight_value: 179,
      weight_unit: 'lb',
    })
    expect(typeof stored[0].id).toBe('string')
    expect(typeof stored[0].logged_at).toBe('string')
    expect(typeof stored[0].saved_at).toBe('string')
  })
})
