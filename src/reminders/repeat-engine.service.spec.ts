import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { RepeatEngineService } from './repeat-engine.service';
import { StateStore } from '../state/state.store';
import { ReminderTypeRegistry } from './types/reminder-type.registry';
import { MedicationHandler } from './types/medication.handler';
import { BOT_GATEWAY } from '../bot/bot.gateway';
import { buildReminder } from '../../test/fixtures/config.fixture';

describe('RepeatEngineService', () => {
  let engine: RepeatEngineService;
  let state: StateStore;
  let bot: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.useFakeTimers();
    bot = { send: vi.fn().mockResolvedValue({ message_id: 99 }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RepeatEngineService,
        StateStore,
        ReminderTypeRegistry,
        MedicationHandler,
        { provide: BOT_GATEWAY, useValue: bot },
      ],
    }).compile();

    engine = moduleRef.get(RepeatEngineService);
    state = moduleRef.get(StateStore);
    moduleRef.get(ReminderTypeRegistry).register(moduleRef.get(MedicationHandler));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('викликає bot.send через intervalMs і збільшує retryAttempt', async () => {
    const reminder = buildReminder({ id: 'r1', repeat: { intervalMin: 15, maxRetries: 3 } });
    state.markActive(123, 'r1', {
      fireTs: Date.now(),
      messageId: 1,
      retryAttempt: 0,
      maxRetries: 3,
      intervalMs: 15 * 60_000,
    });

    engine.scheduleNext(123, reminder);
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(bot.send).toHaveBeenCalledOnce();
    expect(state.get(123, 'r1')!.retryAttempt).toBe(1);
    expect(state.get(123, 'r1')!.messageId).toBe(99);
  });

  it('не викликає bot.send, якщо state.get → undefined (acked у вікно)', async () => {
    const reminder = buildReminder({ id: 'r1', repeat: { intervalMin: 1, maxRetries: 3 } });
    state.markActive(123, 'r1', {
      fireTs: Date.now(),
      messageId: 1,
      retryAttempt: 0,
      maxRetries: 3,
      intervalMs: 60_000,
    });

    engine.scheduleNext(123, reminder);
    state.clear(123, 'r1');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(bot.send).not.toHaveBeenCalled();
  });

  it('зупиняється на maxRetries і очищує state', async () => {
    const reminder = buildReminder({ id: 'r1', repeat: { intervalMin: 1, maxRetries: 3 } });
    state.markActive(123, 'r1', {
      fireTs: Date.now(),
      messageId: 1,
      retryAttempt: 3,
      maxRetries: 3,
      intervalMs: 60_000,
    });

    engine.scheduleNext(123, reminder);

    expect(state.get(123, 'r1')).toBeUndefined();
  });

  it('cancel відміняє запланований повтор', async () => {
    const reminder = buildReminder({ id: 'r1', repeat: { intervalMin: 1, maxRetries: 3 } });
    state.markActive(123, 'r1', {
      fireTs: Date.now(),
      messageId: 1,
      retryAttempt: 0,
      maxRetries: 3,
      intervalMs: 60_000,
    });

    engine.scheduleNext(123, reminder);
    engine.cancel(123, 'r1');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(bot.send).not.toHaveBeenCalled();
  });
});
