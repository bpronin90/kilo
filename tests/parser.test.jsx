import '../src/parser.jsx'

const { parseWeightEntry, parseWorkoutRow, parseWorkoutEntry } = window

// ── parseWeightEntry ──────────────────────────────────────────────────────────

describe('parseWeightEntry', () => {
  test('accepts plain integer', () => {
    const r = parseWeightEntry('180')
    expect(r.ok).toBe(true)
    expect(r.weight_value).toBe(180)
    expect(r.weight_unit).toBe('lb')
    expect(typeof r.logged_at).toBe('string')
  })

  test('accepts decimal', () => {
    const r = parseWeightEntry('180.4')
    expect(r.ok).toBe(true)
    expect(r.weight_value).toBe(180.4)
  })

  test('accepts surrounding whitespace', () => {
    const r = parseWeightEntry('  180  ')
    expect(r.ok).toBe(true)
    expect(r.weight_value).toBe(180)
  })

  test('rejects empty string', () => {
    const r = parseWeightEntry('')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('missing_required_field')
  })

  test('rejects null', () => {
    const r = parseWeightEntry(null)
    expect(r.ok).toBe(false)
    expect(r.category).toBe('missing_required_field')
  })

  test('rejects whitespace-only string', () => {
    const r = parseWeightEntry('   ')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('missing_required_field')
  })

  test('rejects unit suffix', () => {
    const r = parseWeightEntry('180lbs')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
    expect(r.error).toMatch(/number only/i)
  })

  test('rejects sign prefix', () => {
    const r = parseWeightEntry('+180')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('rejects negative', () => {
    const r = parseWeightEntry('-5')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('rejects zero', () => {
    const r = parseWeightEntry('0')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('rejects prose', () => {
    const r = parseWeightEntry('one eighty')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('rejects comma-formatted number', () => {
    const r = parseWeightEntry('1,80')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })
})

// ── parseWorkoutRow ───────────────────────────────────────────────────────────

describe('parseWorkoutRow', () => {
  test('blank input is ok+blank', () => {
    expect(parseWorkoutRow('')).toMatchObject({ ok: true, blank: true })
  })

  test('null input is ok+blank', () => {
    expect(parseWorkoutRow(null)).toMatchObject({ ok: true, blank: true })
  })

  test('dash is ok+skipped', () => {
    expect(parseWorkoutRow('-')).toMatchObject({ ok: true, skipped: true })
  })

  test('standalone rep-group with comma', () => {
    const r = parseWorkoutRow('8,8,8')
    expect(r.ok).toBe(true)
    expect(r.sets).toHaveLength(3)
    expect(r.sets.every(s => s.weight_value === null)).toBe(true)
    expect(r.sets[0].rep_count).toBe(8)
  })

  test('rejects single integer — ambiguous with load', () => {
    const r = parseWorkoutRow('8')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('weight + single-rep group', () => {
    const r = parseWorkoutRow('135 5')
    expect(r.ok).toBe(true)
    expect(r.sets).toHaveLength(1)
    expect(r.sets[0].weight_value).toBe(135)
    expect(r.sets[0].weight_unit).toBe('lb')
    expect(r.sets[0].rep_count).toBe(5)
  })

  test('weight + multi-rep group', () => {
    const r = parseWorkoutRow('135 8,8,8')
    expect(r.ok).toBe(true)
    expect(r.sets).toHaveLength(3)
    expect(r.sets.every(s => s.weight_value === 135)).toBe(true)
  })

  test('multiple weight/rep pairs', () => {
    const r = parseWorkoutRow('135 5,5 145 3,3')
    expect(r.ok).toBe(true)
    expect(r.sets).toHaveLength(4)
    expect(r.sets[0].weight_value).toBe(135)
    expect(r.sets[2].weight_value).toBe(145)
  })

  test('decimal load', () => {
    const r = parseWorkoutRow('67.5 6,6')
    expect(r.ok).toBe(true)
    expect(r.sets[0].weight_value).toBe(67.5)
  })

  test('normalizes spaces around commas', () => {
    const r = parseWorkoutRow('135 8, 8, 8')
    expect(r.ok).toBe(true)
    expect(r.sets).toHaveLength(3)
  })

  test('rejects weight with no following reps', () => {
    const r = parseWorkoutRow('135')
    expect(r.ok).toBe(false)
  })

  test('rejects zero weight', () => {
    const r = parseWorkoutRow('0 8,8')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('rejects zero reps', () => {
    const r = parseWorkoutRow('135 0,8')
    expect(r.ok).toBe(false)
    expect(r.category).toBe('invalid_field_value')
  })

  test('set_index increments across pairs', () => {
    // '100 3,3' → 2 sets, '110 2' → 1 set = 3 sets total, indices 1..3
    const r = parseWorkoutRow('100 3,3 110 2')
    expect(r.ok).toBe(true)
    const indices = r.sets.map(s => s.set_index)
    expect(indices).toEqual([1, 2, 3])
  })
})

// ── parseWorkoutEntry ─────────────────────────────────────────────────────────

describe('parseWorkoutEntry', () => {
  test('returns ok with canonical fields for valid items', () => {
    const items = [
      { exerciseName: 'Squat', raw: '135 5,5,5' },
      { exerciseName: 'Deadlift', raw: '225 5' },
    ]
    const r = parseWorkoutEntry(items, '2026-05-09')
    expect(r.ok).toBe(true)
    expect(r.workout_date).toBe('2026-05-09')
    expect(r.items).toHaveLength(2)
  })

  test('item has canonical shape', () => {
    const r = parseWorkoutEntry([{ exerciseName: 'Squat', raw: '135 5,5,5' }], '2026-05-09')
    const item = r.items[0]
    expect(item).toMatchObject({
      exercise_name: 'Squat',
      result_kind: 'sets',
      note_text: null,
      position: 1,
    })
    expect(Array.isArray(item.sets)).toBe(true)
  })

  test('set has canonical shape', () => {
    const r = parseWorkoutEntry([{ exerciseName: 'Squat', raw: '135 5,5' }], '2026-05-09')
    const set = r.items[0].sets[0]
    expect(set).toMatchObject({
      rep_count: 5,
      weight_value: 135,
      weight_unit: 'lb',
      duration_seconds: null,
      assistance_value: null,
      assistance_unit: null,
      note_text: null,
    })
    expect(typeof set.set_index).toBe('number')
  })

  test('skips blank rows', () => {
    const items = [
      { exerciseName: 'Squat', raw: '135 5,5' },
      { exerciseName: 'Bench', raw: '' },
      { exerciseName: 'Deadlift', raw: '-' },
    ]
    const r = parseWorkoutEntry(items, '2026-05-09')
    expect(r.ok).toBe(true)
    expect(r.items).toHaveLength(1)
  })

  test('fails structural_violation when all items are blank', () => {
    const r = parseWorkoutEntry(
      [{ exerciseName: 'Squat', raw: '' }, { exerciseName: 'Bench', raw: '-' }],
      '2026-05-09',
    )
    expect(r.ok).toBe(false)
    expect(r.category).toBe('structural_violation')
  })

  test('returns row errors for invalid input', () => {
    const items = [
      { exerciseName: 'Squat', raw: '135 5,5' },
      { exerciseName: 'Bench', raw: 'bad input' },
    ]
    const r = parseWorkoutEntry(items, '2026-05-09')
    expect(r.ok).toBe(false)
    expect(r.rowErrors).toHaveLength(1)
    expect(r.rowErrors[0].exerciseName).toBe('Bench')
  })

  test('position increments across included items', () => {
    const items = [
      { exerciseName: 'A', raw: '100 5' },
      { exerciseName: 'B', raw: '-' },
      { exerciseName: 'C', raw: '200 3' },
    ]
    const r = parseWorkoutEntry(items, '2026-05-09')
    expect(r.items[0].position).toBe(1)
    expect(r.items[1].position).toBe(2)
  })

  test('defaults workout_date to KILO_TODAY when not supplied', () => {
    const r = parseWorkoutEntry([{ exerciseName: 'Squat', raw: '135 5' }])
    expect(r.workout_date).toBe('2026-05-09')
  })
})
