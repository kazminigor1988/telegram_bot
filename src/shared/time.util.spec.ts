import { describe, it, expect } from 'vitest';
import { formatInTimezone, isValidTimezone } from './time.util';

describe('formatInTimezone', () => {
  it('форматує UTC ISO у локальний рядок Europe/Kyiv', () => {
    const utc = new Date('2026-06-26T05:30:00.000Z');
    expect(formatInTimezone(utc, 'Europe/Kyiv', 'yyyy-MM-dd HH:mm')).toBe(
      '2026-06-26 08:30',
    );
  });

  it('повертає лише дату для формату yyyy-MM-dd', () => {
    const utc = new Date('2026-06-26T22:00:00.000Z');
    expect(formatInTimezone(utc, 'Europe/Kyiv', 'yyyy-MM-dd')).toBe(
      '2026-06-27',
    );
  });
});

describe('isValidTimezone', () => {
  it('повертає true для валідних IANA timezone', () => {
    expect(isValidTimezone('Europe/Kyiv')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
  });

  it('повертає false для невалідних', () => {
    expect(isValidTimezone('Not/Real')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});
