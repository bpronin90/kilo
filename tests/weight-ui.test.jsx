import { render, screen, fireEvent } from '@testing-library/react'
import { waitFor } from '@testing-library/react'
import '../parser.jsx'
import '../components/ui.jsx'
import '../screens/weight.jsx'
import '../screens/home.jsx'

const { parseWeightEntry } = window

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

function renderHome() {
  const Component = window.KiloHome
  return render(React.createElement(Component, { goToTab: () => {}, openSession: () => {} }))
}

function getHomeQuickLogButton() {
  return screen.getByPlaceholderText('000.0').closest('div').parentElement.querySelector('button')
}

beforeEach(() => {
  seedWeights()
})

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

describe('KiloHome quick-log button state', () => {
  test('disabled when entry is empty', () => {
    renderHome()
    expect(getHomeQuickLogButton()).toBeDisabled()
  })

  test('enabled once entry has a value', () => {
    renderHome()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '180' } })
    expect(getHomeQuickLogButton()).not.toBeDisabled()
  })
})

describe('KiloHome quick-log success feedback', () => {
  test('shows "✓ Saved successfully" in logged-today view', async () => {
    renderHome()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '178' } })
    fireEvent.click(getHomeQuickLogButton())
    await waitFor(() => {
      expect(
        screen.queryByText('✓ Saved successfully') || screen.queryByText('✓ Weight saved')
      ).toBeTruthy()
    })
  })
})

describe('KiloHome quick-log failure feedback', () => {
  test('unit suffix shows format error', async () => {
    renderHome()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '180lbs' } })
    fireEvent.click(getHomeQuickLogButton())
    await screen.findByText('✕ Enter a number only (e.g. 180 or 180.4)')
  })

  test('whitespace-only entry shows required error', async () => {
    renderHome()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '   ' } })
    fireEvent.click(getHomeQuickLogButton())
    await screen.findByText('✕ Weight is required')
  })
})

describe('KiloHome quick-log persistence shape', () => {
  test('writes canonical fields to localStorage', () => {
    renderHome()
    fireEvent.change(screen.getByPlaceholderText('000.0'), { target: { value: '179' } })
    fireEvent.click(getHomeQuickLogButton())

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

describe('parseWeightEntry — accepted', () => {
  test('integer', () => {
    const r = parseWeightEntry('180')
    expect(r.ok).toBe(true)
    expect(r.weight_value).toBe(180)
    expect(r.weight_unit).toBe('lb')
  })

  test('decimal', () => {
    const r = parseWeightEntry('180.4')
    expect(r.ok).toBe(true)
    expect(r.weight_value).toBe(180.4)
  })

  test('trailing-zero decimal', () => {
    const r = parseWeightEntry('167.0')
    expect(r.ok).toBe(true)
    expect(r.weight_value).toBe(167.0)
  })

  test('surrounding whitespace trimmed', () => {
    const r = parseWeightEntry(' 167.0 ')
    expect(r.ok).toBe(true)
    expect(r.weight_value).toBe(167.0)
  })

  test('logged_at is a valid ISO timestamp', () => {
    const r = parseWeightEntry('180')
    expect(r.ok).toBe(true)
    expect(typeof r.logged_at).toBe('string')
    expect(isNaN(Date.parse(r.logged_at))).toBe(false)
  })
})

describe('parseWeightEntry — rejected', () => {
  test('empty string → missing_required_field', () => {
    const r = parseWeightEntry('')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('missing_required_field')
  })

  test('null → missing_required_field', () => {
    const r = parseWeightEntry(null)
    expect(r.ok).toBe(false)
    expect(r.category).toBe('missing_required_field')
  })

  test('whitespace-only → missing_required_field', () => {
    const r = parseWeightEntry('   ')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('missing_required_field')
  })

  test('unit suffix "180 lb" → invalid_field_value', () => {
    const r = parseWeightEntry('180 lb')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('unit suffix "180lbs" → invalid_field_value', () => {
    const r = parseWeightEntry('180lbs')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('comma decimal "180,4" → invalid_field_value', () => {
    const r = parseWeightEntry('180,4')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('inline note "180 / felt light" → invalid_field_value', () => {
    const r = parseWeightEntry('180 / felt light')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('date prefix "2026-05-08 180.4" → invalid_field_value', () => {
    const r = parseWeightEntry('2026-05-08 180.4')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('prose "one eighty" → invalid_field_value', () => {
    const r = parseWeightEntry('one eighty')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('zero → invalid_field_value', () => {
    const r = parseWeightEntry('0')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('negative "-5" → invalid_field_value', () => {
    const r = parseWeightEntry('-5')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })
})

describe('parseWeightEntry — edit-path cases now blocked', () => {
  test('"180lbs" blocked — parseFloat would have returned 180', () => {
    expect(parseWeightEntry('180lbs').ok).toBe(false)
  })

  test('"0" blocked — parseFloat > 0 check would allow NaN edge cases', () => {
    expect(parseWeightEntry('0').ok).toBe(false)
  })

  test('"-5" blocked — was rejected by parseFloat sign check but now via parser', () => {
    expect(parseWeightEntry('-5').ok).toBe(false)
  })

  test('"   " blocked — parseFloat returns NaN, parser returns missing_required_field', () => {
    const r = parseWeightEntry('   ')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('missing_required_field')
  })
})
