// Pure normalizer behind useAuthSession's readable auth failures (#1564).
import { authErrorResult, usableAuthMessage } from '../lib/authErrorMessage';

const FALLBACK = 'Account could not be created. Try again later.';

describe('usableAuthMessage', () => {
  test.each([
    ['empty string', ''],
    ['whitespace only', ' \n\t '],
    ['literal {}', '{}'],
    ['{} with surrounding whitespace', '  {}  '],
    ['serialized provider object', '{"code":500,"msg":"gomail: 550"}'],
    ['empty array', '[]'],
    ['[object Object]', '[object Object]'],
    ['"undefined"', 'undefined'],
    ['"null"', 'null'],
    ['null', null],
    ['undefined', undefined],
    ['number', 500],
    ['object', { code: 'unexpected_failure' }],
    ['array', ['x']],
    ['boolean', true],
  ])('%s returns the fallback', (_label, message) => {
    expect(usableAuthMessage(message, FALLBACK)).toBe(FALLBACK);
  });

  test('keeps a useful message, trimmed', () => {
    expect(usableAuthMessage('Invalid login credentials', FALLBACK)).toBe('Invalid login credentials');
    expect(usableAuthMessage('  Email rate limit exceeded \n', FALLBACK)).toBe('Email rate limit exceeded');
  });

  test('keeps messages that merely contain braces', () => {
    expect(usableAuthMessage('Password must include {letters}', FALLBACK)).toBe('Password must include {letters}');
  });
});

describe('authErrorResult', () => {
  test('builds the failure shape from a resolved SDK error', () => {
    expect(authErrorResult({ message: '{}', status: 500 }, FALLBACK)).toEqual({ ok: false, error: FALLBACK });
    expect(authErrorResult({ message: 'Signups not allowed' }, FALLBACK)).toEqual({ ok: false, error: 'Signups not allowed' });
  });

  test('tolerates a null or missing error object', () => {
    expect(authErrorResult(null, FALLBACK)).toEqual({ ok: false, error: FALLBACK });
    expect(authErrorResult(undefined, FALLBACK)).toEqual({ ok: false, error: FALLBACK });
  });
});
