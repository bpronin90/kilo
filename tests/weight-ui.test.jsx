import '../parser.jsx'

// parseWeightEntry tests for the weight screen log and edit paths.
// The edit path was previously bypassing parseWeightEntry (used raw parseFloat);
// these tests lock the requirement that both paths use the same validation.

const { parseWeightEntry } = window

// ── Accepted inputs (log and edit path) ───────────────────────────────────────

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

// ── Rejected inputs — must fail in both log and edit paths ────────────────────

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

// ── Edit-path bypass: cases previously accepted by parseFloat, now blocked ────

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
