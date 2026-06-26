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

  it('приймає params з withFood: true', () => {
    const result = handler.paramsSchema.safeParse({
      name: 'X',
      dose: '1',
      withFood: true,
    });
    expect(result.success).toBe(true);
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

  it('додає "(під час їжі)" при withFood: true', () => {
    const { text } = handler.buildMessage(
      { name: 'X', dose: '1', withFood: true },
      baseCtx,
    );
    expect(text).toContain('(під час їжі)');
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
