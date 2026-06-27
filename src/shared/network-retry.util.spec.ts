import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isNetworkError, retryOnNetworkError } from './network-retry.util';

describe('isNetworkError', () => {
  it.each([
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENOTFOUND',
    'EPIPE',
  ])('повертає true для code=%s', (code) => {
    expect(isNetworkError(Object.assign(new Error('boom'), { code }))).toBe(
      true,
    );
  });

  it('повертає false для довільного коду', () => {
    expect(
      isNetworkError(Object.assign(new Error('boom'), { code: 'EBADARG' })),
    ).toBe(false);
  });

  it('повертає false для помилки без code', () => {
    expect(isNetworkError(new Error('boom'))).toBe(false);
  });

  it('повертає false для не-обʼєктів', () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError('string')).toBe(false);
  });
});

describe('retryOnNetworkError', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const econnreset = () =>
    Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

  it('повертає результат без затримки, якщо перша спроба успішна', async () => {
    const op = vi.fn().mockResolvedValue('ok');

    await expect(retryOnNetworkError(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('робить до 4 спроб (3 ретраї) із затримками 500/1000/1500 між ними', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(econnreset())
      .mockRejectedValueOnce(econnreset())
      .mockRejectedValueOnce(econnreset())
      .mockResolvedValueOnce('ok');

    const promise = retryOnNetworkError(op);

    await vi.advanceTimersByTimeAsync(0);
    expect(op).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(op).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(op).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(1500);
    expect(op).toHaveBeenCalledTimes(4);

    await expect(promise).resolves.toBe('ok');
  });

  it('кидає мережеву помилку після вичерпання 3 ретраїв (4 спроб)', async () => {
    const op = vi.fn().mockRejectedValue(econnreset());

    const promise = retryOnNetworkError(op);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);

    await expect(promise).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(op).toHaveBeenCalledTimes(4);
  });

  it('кидає одразу на не-мережевій помилці без ретраю', async () => {
    const badRequest = Object.assign(new Error('400 Bad Request'), {
      code: 'EBADREQ',
    });
    const op = vi.fn().mockRejectedValue(badRequest);

    await expect(retryOnNetworkError(op)).rejects.toBe(badRequest);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('перериває ретраї, якщо посеред послідовності прилітає не-мережева помилка', async () => {
    const badRequest = Object.assign(new Error('400'), { code: 'EBADREQ' });
    const op = vi
      .fn()
      .mockRejectedValueOnce(econnreset())
      .mockRejectedValueOnce(badRequest);

    const promise = retryOnNetworkError(op);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).rejects.toBe(badRequest);
    expect(op).toHaveBeenCalledTimes(2);
  });
});
