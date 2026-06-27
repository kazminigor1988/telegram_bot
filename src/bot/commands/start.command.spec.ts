import { describe, it, expect, vi } from 'vitest';
import { StartCommand } from './start.command';
import { buildConfig } from '../../../test/fixtures/config.fixture';

describe('StartCommand.onStart', () => {
  it('відповідає привітанням з імʼям з конфігу', async () => {
    const reply = vi.fn();
    const ctx = { from: { id: 123 }, reply } as any;

    const config = {
      get: () =>
        buildConfig({
          users: [{ telegramId: 123, name: 'Igor', reminders: [] }],
        }),
    };
    const command = new StartCommand(config as any);

    await command.onStart(ctx);

    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain('Igor');
  });
});
