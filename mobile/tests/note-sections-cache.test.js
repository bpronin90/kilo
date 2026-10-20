import {
  getNoteSections,
  getNoteSectionsCacheSize,
  NOTE_SECTIONS_CACHE_LIMIT,
} from '../hooks/entries/noteSections';

const text = (n) => `Bench Press\n${100 + n}x5`;

describe('noteSections cache', () => {
  test('missing/empty input returns empty and is not cached', () => {
    const before = getNoteSectionsCacheSize();
    expect(getNoteSections(null)).toEqual([]);
    expect(getNoteSections(undefined)).toEqual([]);
    expect(getNoteSections({ id: 'e1', raw_text: '' })).toEqual([]);
    expect(getNoteSections({ id: 'e2' })).toEqual([]);
    expect(getNoteSectionsCacheSize()).toBe(before);
  });

  test('unchanged entry returns same reference; edits under same ID reparse', () => {
    const a = getNoteSections({ id: 'edit', raw_text: text(1) });
    expect(getNoteSections({ id: 'edit', raw_text: text(1) })).toBe(a);
    const b = getNoteSections({ id: 'edit', raw_text: text(2) });
    expect(b).not.toBe(a);
    expect(b).not.toEqual(a);
    expect(getNoteSections({ id: 'edit', raw_text: text(2) })).toBe(b);
    const c = getNoteSections({ id: 'edit', raw_text: text(1) });
    expect(c).toEqual(a);
  });

  test('anonymous notes key by text; duplicate text under different IDs stays separate', () => {
    const anon1 = getNoteSections({ raw_text: text(7) });
    expect(getNoteSections({ raw_text: text(7) })).toBe(anon1);
    const x = getNoteSections({ id: 'dupX', raw_text: text(8) });
    const y = getNoteSections({ id: 'dupY', raw_text: text(8) });
    expect(x).not.toBe(y);
    expect(x).toEqual(y);
    expect(getNoteSections({ id: 'dupX', raw_text: text(8) })).toBe(x);
    expect(getNoteSections({ id: 'dupY', raw_text: text(8) })).toBe(y);
  });

  test('size stays bounded above capacity and evicted entries reparse equivalently', () => {
    const first = getNoteSections({ id: 'first', raw_text: text(0) });
    for (let i = 0; i < NOTE_SECTIONS_CACHE_LIMIT + 50; i += 1) {
      getNoteSections({ id: `bulk-${i}`, raw_text: text(i) });
      expect(getNoteSectionsCacheSize()).toBeLessThanOrEqual(NOTE_SECTIONS_CACHE_LIMIT);
    }
    expect(getNoteSectionsCacheSize()).toBe(NOTE_SECTIONS_CACHE_LIMIT);
    const again = getNoteSections({ id: 'first', raw_text: text(0) });
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });

  test('eviction follows access order (LRU)', () => {
    const refs = [];
    for (let i = 0; i < NOTE_SECTIONS_CACHE_LIMIT; i += 1) {
      refs.push(getNoteSections({ id: `lru-${i}`, raw_text: text(i) }));
    }
    // Touch lru-0 so lru-1 is least recent; one new entry evicts lru-1 only.
    expect(getNoteSections({ id: 'lru-0', raw_text: text(0) })).toBe(refs[0]);
    getNoteSections({ id: 'lru-new', raw_text: text(99999) });
    expect(getNoteSections({ id: 'lru-0', raw_text: text(0) })).toBe(refs[0]);
    expect(getNoteSections({ id: 'lru-2', raw_text: text(2) })).toBe(refs[2]);
    const re = getNoteSections({ id: 'lru-1', raw_text: text(1) });
    expect(re).not.toBe(refs[1]);
    expect(re).toEqual(refs[1]);
  });
});
