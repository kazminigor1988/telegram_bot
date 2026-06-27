import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerGlobalErrorHandlers } from './error-handlers';

describe('registerGlobalErrorHandlers', () => {
  const originalListeners = {
    unhandledRejection: process.listeners('unhandledRejection'),
    uncaughtException: process.listeners('uncaughtException'),
  };

  afterEach(() => {
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
    originalListeners.unhandledRejection.forEach((listener) =>
      process.on('unhandledRejection', listener),
    );
    originalListeners.uncaughtException.forEach((listener) =>
      process.on('uncaughtException', listener),
    );
  });

  it('логує unhandledRejection через переданий logger', () => {
    const logger = {
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    registerGlobalErrorHandlers(logger);
    process.emit('unhandledRejection', new Error('boom'), Promise.resolve());
    expect(logger.error).toHaveBeenCalled();
  });

  it('логує uncaughtException через переданий logger', () => {
    const logger = {
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    registerGlobalErrorHandlers(logger);
    process.emit('uncaughtException', new Error('boom2'));
    expect(logger.error).toHaveBeenCalled();
  });
});
