import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { StateStore } from '../state/state.store';
import { RepeatEngineService } from './repeat-engine.service';
import { ReminderTypeRegistry } from './types/reminder-type.registry';
import { MedicationHandler } from './types/medication.handler';
import { ConfigLoaderService } from '../config/config-loader.service';
import { BOT_GATEWAY } from '../bot/bot.gateway';
import { buildConfig, buildReminder } from '../../test/fixtures/config.fixture';

describe('SchedulerService.fire', () => {
  let scheduler: SchedulerService;
  let state: StateStore;
  let repeat: {
    scheduleNext: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  let bot: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    bot = { send: vi.fn().mockResolvedValue({ message_id: 42 }) };
    repeat = { scheduleNext: vi.fn(), cancel: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchedulerService,
        StateStore,
        ReminderTypeRegistry,
        MedicationHandler,
        { provide: RepeatEngineService, useValue: repeat },
        { provide: BOT_GATEWAY, useValue: bot },
        {
          provide: ConfigLoaderService,
          useValue: { get: () => buildConfig() },
        },
        { provide: SchedulerRegistry, useValue: { addCronJob: vi.fn() } },
      ],
    }).compile();

    scheduler = moduleRef.get(SchedulerService);
    state = moduleRef.get(StateStore);
    moduleRef
      .get(ReminderTypeRegistry)
      .register(moduleRef.get(MedicationHandler));
  });

  it('пропускає fire, якщо reminder expired', async () => {
    const reminder = buildReminder({ endDate: '2000-01-01' });
    await scheduler.fire(123, reminder);

    expect(bot.send).not.toHaveBeenCalled();
    expect(state.get(123, reminder.id)).toBeUndefined();
  });

  it('викликає bot.send і markActive для свіжого reminder', async () => {
    const reminder = buildReminder({
      id: 'r1',
      repeat: { intervalMin: 15, maxRetries: 3 },
    });

    await scheduler.fire(123, reminder);

    expect(bot.send).toHaveBeenCalledOnce();
    const active = state.get(123, 'r1');
    expect(active).toBeDefined();
    expect(active!.messageId).toBe(42);
    expect(active!.retryAttempt).toBe(0);
    expect(active!.maxRetries).toBe(3);
    expect(active!.intervalMs).toBe(15 * 60_000);
  });

  it('викликає repeat.scheduleNext, якщо reminder має repeat', async () => {
    const reminder = buildReminder({
      id: 'r1',
      repeat: { intervalMin: 15, maxRetries: 3 },
    });

    await scheduler.fire(123, reminder);

    expect(repeat.scheduleNext).toHaveBeenCalledWith(123, reminder);
  });

  it('НЕ викликає scheduleNext, якщо repeat відсутній', async () => {
    const reminder = buildReminder({ id: 'r1' });
    delete (reminder as { repeat?: unknown }).repeat;

    await scheduler.fire(123, reminder);

    expect(repeat.scheduleNext).not.toHaveBeenCalled();
  });

  it('при помилці bot.send не кидає, не маркує state і не планує retry', async () => {
    const reminder = buildReminder({
      id: 'r1',
      repeat: { intervalMin: 15, maxRetries: 3 },
    });
    bot.send.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(scheduler.fire(123, reminder)).resolves.toBeUndefined();

    expect(state.get(123, 'r1')).toBeUndefined();
    expect(repeat.scheduleNext).not.toHaveBeenCalled();
  });
});

describe('SchedulerService.onApplicationBootstrap', () => {
  it('реєструє по одному cron-job на кожен (user, reminder, time)', async () => {
    const addCronJob = vi.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchedulerService,
        StateStore,
        ReminderTypeRegistry,
        MedicationHandler,
        {
          provide: RepeatEngineService,
          useValue: { scheduleNext: vi.fn(), cancel: vi.fn() },
        },
        { provide: BOT_GATEWAY, useValue: { send: vi.fn() } },
        {
          provide: ConfigLoaderService,
          useValue: {
            get: () =>
              buildConfig({
                users: [
                  {
                    telegramId: 1,
                    name: 'A',
                    reminders: [
                      buildReminder({ id: 'r1', times: ['08:00', '20:00'] }),
                      buildReminder({ id: 'r2', times: ['12:00'] }),
                    ],
                  },
                ],
              }),
          },
        },
        { provide: SchedulerRegistry, useValue: { addCronJob } },
      ],
    }).compile();

    moduleRef
      .get(ReminderTypeRegistry)
      .register(moduleRef.get(MedicationHandler));
    moduleRef.get(SchedulerService).onApplicationBootstrap();

    expect(addCronJob).toHaveBeenCalledTimes(3);
    const jobNames = addCronJob.mock.calls.map((call) => call[0]);
    expect(jobNames).toEqual(['1:r1:08:00', '1:r1:20:00', '1:r2:12:00']);
  });
});
