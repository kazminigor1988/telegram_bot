import { describe, it, expect } from 'vitest';
import { collectTodaysSlots, renderSection } from './next.logic';
import { buildReminder } from '../../../test/fixtures/config.fixture';

describe('collectTodaysSlots', () => {
  it('розгортає reminders у плоский, сортований за часом список', () => {
    const reminders = [
      buildReminder({ id: 'a', times: ['20:00', '08:00'] }),
      buildReminder({ id: 'b', times: ['14:00'] }),
    ];
    const slots = collectTodaysSlots(reminders, '2026-06-26');
    expect(slots.map((slot) => `${slot.reminder.id}@${slot.time}`)).toEqual([
      'a@08:00',
      'b@14:00',
      'a@20:00',
    ]);
  });

  it('фільтрує expired reminder за endDate', () => {
    const reminders = [
      buildReminder({ id: 'a', endDate: '2026-06-25', times: ['08:00'] }),
      buildReminder({ id: 'b', endDate: '2026-06-26', times: ['09:00'] }),
      buildReminder({ id: 'c', times: ['10:00'] }),
    ];
    const slots = collectTodaysSlots(reminders, '2026-06-26');
    expect(slots.map((slot) => slot.reminder.id)).toEqual(['b', 'c']);
  });
});

describe('renderSection', () => {
  it('повертає null для порожнього списку', () => {
    expect(renderSection('Title', [], () => 'summary')).toBeNull();
  });

  it('форматує заголовок + рядки', () => {
    const slots = [
      { reminder: buildReminder({ id: 'r1' }), time: '08:00' },
      { reminder: buildReminder({ id: 'r2' }), time: '20:00' },
    ];
    const result = renderSection(
      'Title',
      slots,
      (slot) => `summary-${slot.reminder.id}`,
    );
    expect(result).toBe('Title\n• 08:00 — summary-r1\n• 20:00 — summary-r2');
  });
});
