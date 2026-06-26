import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { ConfigLoaderService } from './config-loader.service';

const FIXTURE_PATH = path.resolve(__dirname, '../../test/fixtures/test-config.json');

describe('ConfigLoaderService', () => {
  beforeEach(() => {
    process.env.TEST_BOT_TOKEN = 'resolved-test-token';
  });
  afterEach(() => {
    delete process.env.TEST_BOT_TOKEN;
  });

  it('завантажує + валідує + резолвить env-токен', async () => {
    const service = new ConfigLoaderService(FIXTURE_PATH);
    await service.onModuleInit();
    expect(service.get().bot.token).toBe('resolved-test-token');
    expect(service.get().bot.timezone).toBe('Europe/Kyiv');
  });

  it('кидає помилку, якщо файл не знайдено', async () => {
    const service = new ConfigLoaderService('/no/such/file.json');
    await expect(service.onModuleInit()).rejects.toThrow();
  });

  it('кидає помилку, якщо env-змінна не задана', async () => {
    delete process.env.TEST_BOT_TOKEN;
    const service = new ConfigLoaderService(FIXTURE_PATH);
    await expect(service.onModuleInit()).rejects.toThrow(/TEST_BOT_TOKEN/);
  });

  it('кидає помилку при невалідному JSON', async () => {
    const badPath = path.resolve(__dirname, '../../test/fixtures/bad-config.json');
    await fs.writeFile(badPath, '{ not valid json');
    try {
      const service = new ConfigLoaderService(badPath);
      await expect(service.onModuleInit()).rejects.toThrow();
    } finally {
      await fs.unlink(badPath);
    }
  });
});
