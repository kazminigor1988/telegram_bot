import { describe, it, expect } from 'vitest';
import {
  timeSchema,
  dateSchema,
  repeatSchema,
  reminderSchema,
  userSchema,
  configSchema,
  AppConfig,
  expandSchedule,
  User,
} from './schema';

describe('timeSchema', () => {
  it('приймає валідні HH:mm', () => {
    expect(timeSchema.safeParse('08:00').success).toBe(true);
    expect(timeSchema.safeParse('23:59').success).toBe(true);
    expect(timeSchema.safeParse('00:00').success).toBe(true);
  });

  it('відхиляє невалідні формати', () => {
    expect(timeSchema.safeParse('8:00').success).toBe(false);
    expect(timeSchema.safeParse('24:00').success).toBe(false);
    expect(timeSchema.safeParse('12:60').success).toBe(false);
    expect(timeSchema.safeParse('foo').success).toBe(false);
  });
});

describe('dateSchema', () => {
  it('приймає валідні YYYY-MM-DD', () => {
    expect(dateSchema.safeParse('2026-06-26').success).toBe(true);
    expect(dateSchema.safeParse('2000-01-01').success).toBe(true);
  });

  it('відхиляє невалідні', () => {
    expect(dateSchema.safeParse('26-06-2026').success).toBe(false);
    expect(dateSchema.safeParse('2026/06/26').success).toBe(false);
    expect(dateSchema.safeParse('foo').success).toBe(false);
  });
});

describe('repeatSchema', () => {
  it('приймає валідну конфігурацію повторів', () => {
    expect(repeatSchema.safeParse({ intervalMin: 15, maxRetries: 3 }).success).toBe(true);
  });

  it('відхиляє відʼємний intervalMin', () => {
    expect(repeatSchema.safeParse({ intervalMin: -1, maxRetries: 3 }).success).toBe(false);
  });

  it('відхиляє занадто великий intervalMin', () => {
    expect(repeatSchema.safeParse({ intervalMin: 999, maxRetries: 3 }).success).toBe(false);
  });
});

describe('reminderSchema', () => {
  const baseReminder = {
    id: 'r1',
    type: 'medication' as const,
    params: { name: 'X', dose: '1' },
    times: ['08:00'],
  };

  it('приймає мінімальний медикаментозний reminder', () => {
    expect(reminderSchema.safeParse(baseReminder).success).toBe(true);
  });

  it('приймає reminder з endDate і repeat', () => {
    const result = reminderSchema.safeParse({
      ...baseReminder,
      endDate: '2026-07-02',
      repeat: { intervalMin: 15, maxRetries: 3 },
    });
    expect(result.success).toBe(true);
  });

  it('відхиляє невідомий type', () => {
    expect(reminderSchema.safeParse({ ...baseReminder, type: 'unknown' }).success).toBe(false);
  });

  it('відхиляє пустий times', () => {
    expect(reminderSchema.safeParse({ ...baseReminder, times: [] }).success).toBe(false);
  });
});

describe('userSchema', () => {
  it('відхиляє дублікати reminder.id у межах користувача', () => {
    const result = userSchema.safeParse({
      telegramId: 1,
      name: 'A',
      reminders: [
        { id: 'r1', type: 'medication', params: { name: 'X', dose: '1' }, times: ['08:00'] },
        { id: 'r1', type: 'medication', params: { name: 'Y', dose: '2' }, times: ['09:00'] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('приймає унікальні id', () => {
    const result = userSchema.safeParse({
      telegramId: 1,
      name: 'A',
      reminders: [
        { id: 'r1', type: 'medication', params: { name: 'X', dose: '1' }, times: ['08:00'] },
        { id: 'r2', type: 'medication', params: { name: 'Y', dose: '2' }, times: ['09:00'] },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('configSchema', () => {
  const validConfig = {
    bot: { token: 'abc', timezone: 'Europe/Kyiv' },
    users: [{
      telegramId: 1,
      name: 'A',
      reminders: [{ id: 'r1', type: 'medication', params: { name: 'X', dose: '1' }, times: ['08:00'] }],
    }],
  };

  it('приймає валідний конфіг', () => {
    expect(configSchema.safeParse(validConfig).success).toBe(true);
  });

  it('відхиляє невалідний timezone', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      bot: { ...validConfig.bot, timezone: 'Not/Real' },
    });
    expect(result.success).toBe(false);
  });

  it('відхиляє дублікати telegramId', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      users: [validConfig.users[0], validConfig.users[0]],
    });
    expect(result.success).toBe(false);
  });

  it('AppConfig type inference works', () => {
    const parsed = configSchema.parse(validConfig);
    const typed: AppConfig = parsed;
    expect(typed.bot.token).toBe('abc');
  });
});

describe('expandSchedule', () => {
  it('розгортає вкладені users → reminders → times у плоский список', () => {
    const users: User[] = [
      {
        telegramId: 1,
        name: 'A',
        reminders: [
          { id: 'r1', type: 'medication', params: { name: 'X', dose: '1' }, times: ['08:00', '20:00'] },
          { id: 'r2', type: 'medication', params: { name: 'Y', dose: '2' }, times: ['12:00'] },
        ],
      },
      {
        telegramId: 2,
        name: 'B',
        reminders: [
          { id: 'r3', type: 'medication', params: { name: 'Z', dose: '3' }, times: ['09:00'] },
        ],
      },
    ];

    const result = expandSchedule(users);

    expect(result).toHaveLength(4);
    expect(result.map(slot => `${slot.userId}:${slot.reminder.id}:${slot.time}`)).toEqual([
      '1:r1:08:00',
      '1:r1:20:00',
      '1:r2:12:00',
      '2:r3:09:00',
    ]);
  });

  it('повертає [] для порожнього масиву', () => {
    expect(expandSchedule([])).toEqual([]);
  });
});
