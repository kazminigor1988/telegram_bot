import { describe, it, expect } from 'vitest';
import { formatInTimezone } from './time.util';

describe('formatInTimezone', () => {
  it('форматує UTC ISO у локальний рядок Europe/Kyiv', () => {
    const utc = new Date('2026-06-26T05:30:00.000Z');
    expect(formatInTimezone(utc, 'Europe/Kyiv', 'yyyy-MM-dd HH:mm')).toBe('2026-06-26 08:30');
  });

  it('повертає лише дату для формату yyyy-MM-dd', () => {
    const utc = new Date('2026-06-26T22:00:00.000Z');
    expect(formatInTimezone(utc, 'Europe/Kyiv', 'yyyy-MM-dd')).toBe('2026-06-27');
  });
});
