import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { buildConfig } from '../../test/fixtures/config.fixture';

const makeContext = (fromId: number | undefined) => {
  const reply = vi.fn();
  const ctx = {
    from: fromId !== undefined ? { id: fromId } : undefined,
    reply,
  };
  const executionContext = {
    getArgs: () => [ctx],
    getArgByIndex: (idx: number) => (idx === 0 ? ctx : undefined),
    getType: () => 'telegraf',
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, executionContext, reply };
};

describe('AuthGuard', () => {
  let guard: AuthGuard;

  beforeEach(() => {
    const config = { get: () => buildConfig({ users: [{ telegramId: 999, name: 'A', reminders: [] }] }) };
    guard = new AuthGuard(config as any);
  });

  it('пропускає whitelisted користувача', async () => {
    const { executionContext } = makeContext(999);
    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
  });

  it('відмовляє і відповідає не-whitelisted', async () => {
    const { executionContext, reply } = makeContext(111);
    await expect(guard.canActivate(executionContext)).resolves.toBe(false);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('немає доступу'));
  });

  it('відмовляє при відсутньому ctx.from', async () => {
    const { executionContext } = makeContext(undefined);
    await expect(guard.canActivate(executionContext)).resolves.toBe(false);
  });
});
