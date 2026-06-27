import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextCommand } from './next.command';
import { ReminderTypeRegistry } from '../../reminders/types/reminder-type.registry';
import { MedicationHandler } from '../../reminders/types/medication.handler';
import {
  buildConfig,
  buildReminder,
} from '../../../test/fixtures/config.fixture';

describe('NextCommand.onNext', () => {
  let registry: ReminderTypeRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-26T10:00:00.000Z'));
    registry = new ReminderTypeRegistry();
    registry.register(new MedicationHandler());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('виводить past і upcoming окремими секціями', async () => {
    const reply = vi.fn();
    const ctx = { from: { id: 1 }, reply } as any;

    const config = {
      get: () =>
        buildConfig({
          users: [
            {
              telegramId: 1,
              name: 'A',
              reminders: [
                buildReminder({
                  id: 'r1',
                  params: { name: 'Vit D', dose: '1' },
                  times: ['08:00', '20:00'],
                }),
              ],
            },
          ],
        }),
    };

    const command = new NextCommand(config as any, registry);
    await command.onNext(ctx);

    const message = reply.mock.calls[0][0] as string;
    expect(message).toContain('Вже минули');
    expect(message).toContain('08:00');
    expect(message).toContain('Ще будуть');
    expect(message).toContain('20:00');
  });

  it('повертає "немає нагадувань", якщо список порожній', async () => {
    const reply = vi.fn();
    const ctx = { from: { id: 1 }, reply } as any;

    const config = {
      get: () =>
        buildConfig({
          users: [{ telegramId: 1, name: 'A', reminders: [] }],
        }),
    };

    const command = new NextCommand(config as any, registry);
    await command.onNext(ctx);

    expect(reply.mock.calls[0][0]).toContain('немає');
  });
});
