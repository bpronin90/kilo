// #1494: workout-only parser consumers must not evaluate the preference /
// profile-storage / React chain.
const FAIL = (name) => () => { throw new Error(`prohibited import evaluated: ${name}`); };

describe('pure workout parser import boundary', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => {
    ['react', '../lib/unitPreference', '../storage/entries/profileStorage', '@react-native-async-storage/async-storage'].forEach(m => jest.dontMock(m));
  });

  function mockProhibited() {
    jest.doMock('react', FAIL('react'));
    jest.doMock('../lib/unitPreference', FAIL('unitPreference'));
    jest.doMock('../storage/entries/profileStorage', FAIL('profileStorage'));
    jest.doMock('@react-native-async-storage/async-storage', FAIL('async-storage'));
  }

  test('workoutPure loads without react, unitPreference, or profile storage', () => {
    mockProhibited();
    const pure = require('../lib/parser/workoutPure');
    expect(pure.parseWorkoutNote('Bench\n5x5 135').ok).toBe(true);
    expect(pure.normalizeExerciseKey).toEqual(expect.any(Function));
    expect(pure.parseWeightEntry).toBeUndefined();
  });

  test('noteSections loads under failing mocks for prohibited dependencies', () => {
    mockProhibited();
    const mod = require('../hooks/entries/noteSections');
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  test.each([
    ['hooks/entries/noteSections', '../hooks/entries/noteSections'],
    ['screens/log/currentRoutineSave', '../screens/log/currentRoutineSave'],
    ['screens/analytics/analyticsDerivations', '../screens/analytics/analyticsDerivations'],
  ])('%s source imports the pure barrel, not the parser barrel', (_n, rel) => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, rel + '.js'), 'utf8');
    expect(src).not.toMatch(/from '\.\.\/\.\.\/lib\/parser'/);
    expect(src).toMatch(/lib\/parser\/workoutPure/);
  });

  test('public parser barrel stays compatible and keeps preference default', () => {
    const barrel = require('../lib/parser');
    const pure = require('../lib/parser/workoutPure');
    for (const key of Object.keys(pure)) expect(barrel[key]).toBe(pure[key]);
    expect(barrel.parseWeightEntry).toEqual(expect.any(Function));
    expect(barrel.parseWeightEntry('180')).toMatchObject({ ok: true, weight_value: 180, weight_unit: 'lb' });
  });
});
