import { describe, it, expect, beforeEach } from 'vitest';
import { ReminderTypeRegistry } from './reminder-type.registry';
import { MedicationHandler } from './medication.handler';

describe('ReminderTypeRegistry', () => {
  let registry: ReminderTypeRegistry;
  let handler: MedicationHandler;

  beforeEach(() => {
    registry = new ReminderTypeRegistry();
    handler = new MedicationHandler();
  });

  it('повертає зареєстрований handler за type', () => {
    registry.register(handler);
    expect(registry.get('medication')).toBe(handler);
  });

  it('кидає помилку для невідомого type', () => {
    expect(() => registry.get('unknown')).toThrow(/No handler for reminder type/);
  });

  it('register другий раз з тим самим type замінює handler', () => {
    registry.register(handler);
    const replacement = new MedicationHandler();
    registry.register(replacement);
    expect(registry.get('medication')).toBe(replacement);
  });
});
