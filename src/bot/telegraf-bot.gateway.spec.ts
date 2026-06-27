import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Telegraf } from 'telegraf';
import { TelegrafBotGateway } from './telegraf-bot.gateway';

describe('TelegrafBotGateway.send', () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  let gateway: TelegrafBotGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    sendMessage = vi.fn();
    const fakeBot = { telegram: { sendMessage } } as unknown as Telegraf;
    gateway = new TelegrafBotGateway(fakeBot);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const econnreset = () =>
    Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

  it('повертає message_id при успішному надсиланні з першої спроби', async () => {
    sendMessage.mockResolvedValueOnce({ message_id: 42 });

    await expect(gateway.send(1, 'hi', [])).resolves.toEqual({
      message_id: 42,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('переживає ECONNRESET у перших 3 спробах і повертає результат 4-ї', async () => {
    sendMessage
      .mockRejectedValueOnce(econnreset())
      .mockRejectedValueOnce(econnreset())
      .mockRejectedValueOnce(econnreset())
      .mockResolvedValueOnce({ message_id: 7 });

    const promise = gateway.send(1, 'hi', []);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);

    await expect(promise).resolves.toEqual({ message_id: 7 });
    expect(sendMessage).toHaveBeenCalledTimes(4);
  });

  it('кидає ECONNRESET після 4 невдалих спроб', async () => {
    sendMessage.mockRejectedValue(econnreset());

    const promise = gateway.send(1, 'hi', []);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);

    await expect(promise).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(sendMessage).toHaveBeenCalledTimes(4);
  });
});
