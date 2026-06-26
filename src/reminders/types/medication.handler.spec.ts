import { describe, it, expect } from 'vitest';
import { MedicationHandler } from './medication.handler';

describe('MedicationHandler.paramsSchema', () => {
  const handler = new MedicationHandler();

  it('приймає валідні params', () => {
    const result = handler.paramsSchema.safeParse({
      name: 'Вітамін D',
      dose: '1 таблетка',
    });
    expect(result.success).toBe(true);
  });

  it.each(['before', 'after', 'with'] as const)('приймає params з mealTiming: %s', (mealTiming) => {
    const result = handler.paramsSchema.safeParse({
      name: 'X',
      dose: '1',
      mealTiming,
    });
    expect(result.success).toBe(true);
  });

  it('відхиляє невалідний mealTiming', () => {
    const result = handler.paramsSchema.safeParse({
      name: 'X',
      dose: '1',
      mealTiming: 'sometime',
    });
    expect(result.success).toBe(false);
  });

  it('відхиляє пустий name', () => {
    const result = handler.paramsSchema.safeParse({ name: '', dose: '1' });
    expect(result.success).toBe(false);
  });

  it('відхиляє відсутній dose', () => {
    const result = handler.paramsSchema.safeParse({ name: 'X' });
    expect(result.success).toBe(false);
  });
});

describe('MedicationHandler.buildMessage', () => {
  const handler = new MedicationHandler();
  const baseCtx = { reminderId: 'r1', fireTimestamp: 0, retryAttempt: 0 };

  it('містить назву і дозу', () => {
    const { text } = handler.buildMessage(
      { name: 'Вітамін D', dose: '1 таблетка' },
      baseCtx,
    );
    expect(text).toContain('Вітамін D');
    expect(text).toContain('1 таблетка');
  });

  it('додає "(до їжі)" при mealTiming: before', () => {
    const { text } = handler.buildMessage(
      { name: 'X', dose: '1', mealTiming: 'before' },
      baseCtx,
    );
    expect(text).toContain('(до їжі)');
  });

  it('додає "(після їжі)" при mealTiming: after', () => {
    const { text } = handler.buildMessage(
      { name: 'X', dose: '1', mealTiming: 'after' },
      baseCtx,
    );
    expect(text).toContain('(після їжі)');
  });

  it('додає "(під час їжі)" при mealTiming: with', () => {
    const { text } = handler.buildMessage(
      { name: 'X', dose: '1', mealTiming: 'with' },
      baseCtx,
    );
    expect(text).toContain('(під час їжі)');
  });

  it('не додає food-suffix, якщо mealTiming відсутній', () => {
    const { text } = handler.buildMessage(
      { name: 'X', dose: '1' },
      baseCtx,
    );
    expect(text).not.toMatch(/\(.*їжі\)/);
  });

  it('використовує "Час прийняти" при retryAttempt=0', () => {
    const { text } = handler.buildMessage({ name: 'X', dose: '1' }, baseCtx);
    expect(text).toContain('Час прийняти');
  });

  it('використовує "Нагадую ще раз" при retryAttempt>0', () => {
    const { text } = handler.buildMessage(
      { name: 'X', dose: '1' },
      { ...baseCtx, retryAttempt: 1 },
    );
    expect(text).toContain('Нагадую ще раз');
  });

  it('повертає одну кнопку з placeholder __ACK__', () => {
    const { buttons } = handler.buildMessage({ name: 'X', dose: '1' }, baseCtx);
    expect(buttons).toEqual([{ text: '✅ Прийняв', callbackData: '__ACK__' }]);
  });
});

describe('MedicationHandler.buildSummary', () => {
  const handler = new MedicationHandler();

  it('форматує "💊 NAME — DOSE"', () => {
    expect(handler.buildSummary({ name: 'Вітамін D', dose: '1 таблетка' }))
      .toBe('💊 Вітамін D — 1 таблетка');
  });
});
