import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AckAction } from './ack.action';
import { StateStore } from '../../state/state.store';

describe('AckAction.onAck', () => {
  let state: StateStore;
  let repeat: { cancel: ReturnType<typeof vi.fn> };
  let action: AckAction;

  beforeEach(() => {
    state = new StateStore();
    repeat = { cancel: vi.fn() };
    action = new AckAction(state, repeat as any);
  });

  it('викликає cancel + clear для активного нагадування', async () => {
    state.markActive(123, 'r1', {
      fireTs: 0, messageId: 1, retryAttempt: 0, maxRetries: 3, intervalMs: 60_000,
    });

    const answerCbQuery = vi.fn();
    const editMessageReplyMarkup = vi.fn();
    const ctx = {
      match: ['ack:123:r1:1000', '123', 'r1', '1000'],
      answerCbQuery,
      editMessageReplyMarkup,
    } as any;

    await action.onAck(ctx);

    expect(repeat.cancel).toHaveBeenCalledWith(123, 'r1');
    expect(state.get(123, 'r1')).toBeUndefined();
    expect(answerCbQuery).toHaveBeenCalledWith('Зафіксовано ✅');
    expect(editMessageReplyMarkup).toHaveBeenCalled();
  });

  it('повертає "Вже зафіксовано" для idempotent повтору', async () => {
    const answerCbQuery = vi.fn();
    const editMessageReplyMarkup = vi.fn();
    const ctx = {
      match: ['ack:123:r1:1000', '123', 'r1', '1000'],
      answerCbQuery,
      editMessageReplyMarkup,
    } as any;

    await action.onAck(ctx);

    expect(answerCbQuery).toHaveBeenCalledWith('Вже зафіксовано');
  });

  it('тихо ігнорує помилку editMessageReplyMarkup', async () => {
    const ctx = {
      match: ['ack:123:r1:1000', '123', 'r1', '1000'],
      answerCbQuery: vi.fn(),
      editMessageReplyMarkup: vi.fn().mockRejectedValue(new Error('message is not modified')),
    } as any;

    await expect(action.onAck(ctx)).resolves.toBeUndefined();
  });
});
