import { AppConfig, Reminder, User } from '../../src/config/schema';

type ReminderOverrides = Partial<Omit<Reminder, 'type' | 'params'>> & {
  params?: Partial<{ name: string; dose: string; withFood: boolean }>;
};

export const buildReminder = (overrides: ReminderOverrides = {}): Reminder => ({
  id: 'r1',
  type: 'medication',
  params: { name: 'Test Med', dose: '1 таблетка', ...(overrides.params ?? {}) },
  times: ['08:00'],
  ...overrides,
}) as Reminder;

export const buildUser = (overrides: Partial<User> = {}): User => ({
  telegramId: 123,
  name: 'Test User',
  reminders: [buildReminder()],
  ...overrides,
});

export const buildConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  bot: { token: 'test-token', timezone: 'Europe/Kyiv', ...(overrides.bot ?? {}) },
  users: overrides.users ?? [buildUser()],
});
