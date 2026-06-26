import { describe, it, expect } from 'vitest';
import { isReminderExpired } from './expiry.util';
import { buildReminder } from '../../test/fixtures/config.fixture';

describe('isReminderExpired', () => {
  it('повертає false, якщо endDate відсутня', () => {
    const reminder = buildReminder({ endDate: undefined });
    expect(isReminderExpired(reminder, '2030-01-01')).toBe(false);
  });

  it('повертає false, якщо today < endDate', () => {
    const reminder = buildReminder({ endDate: '2026-07-02' });
    expect(isReminderExpired(reminder, '2026-06-26')).toBe(false);
  });

  it('повертає false, якщо today === endDate (inclusive)', () => {
    const reminder = buildReminder({ endDate: '2026-07-02' });
    expect(isReminderExpired(reminder, '2026-07-02')).toBe(false);
  });

  it('повертає true, якщо today > endDate', () => {
    const reminder = buildReminder({ endDate: '2026-07-02' });
    expect(isReminderExpired(reminder, '2026-07-03')).toBe(true);
  });
});
