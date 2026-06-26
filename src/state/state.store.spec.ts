import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore, ActiveReminder } from './state.store';

const sample: ActiveReminder = {
  fireTs: 1000,
  messageId: 42,
  retryAttempt: 0,
  maxRetries: 3,
  intervalMs: 60_000,
};

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  it('markActive + get повертає те, що записали', () => {
    store.markActive(1, 'r1', sample);
    expect(store.get(1, 'r1')).toEqual(sample);
  });

  it('get для відсутнього ключа повертає undefined', () => {
    expect(store.get(1, 'nope')).toBeUndefined();
  });

  it('update перезаписує існуючий запис', () => {
    store.markActive(1, 'r1', sample);
    store.update(1, 'r1', { ...sample, retryAttempt: 2 });
    expect(store.get(1, 'r1')!.retryAttempt).toBe(2);
  });

  it('clear видаляє запис', () => {
    store.markActive(1, 'r1', sample);
    store.clear(1, 'r1');
    expect(store.get(1, 'r1')).toBeUndefined();
  });

  it('clear для відсутнього ключа — no-op', () => {
    expect(() => store.clear(1, 'never-existed')).not.toThrow();
  });

  it('різні users не перетинаються', () => {
    store.markActive(1, 'r1', sample);
    store.markActive(2, 'r1', { ...sample, messageId: 99 });
    expect(store.get(1, 'r1')!.messageId).toBe(42);
    expect(store.get(2, 'r1')!.messageId).toBe(99);
  });
});
