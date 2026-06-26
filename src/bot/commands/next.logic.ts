import { Reminder } from '../../config/schema';
import { isReminderExpired } from '../../reminders/expiry.util';

export interface Slot {
  reminder: Reminder;
  time: string;
}

export const collectTodaysSlots = (reminders: Reminder[], todayIso: string): Slot[] => {
  return reminders
    .filter(reminder => !isReminderExpired(reminder, todayIso))
    .map(reminder => reminder.times.map(time => ({ reminder, time })))
    .flat()
    .sort((left, right) => left.time.localeCompare(right.time));
};

export const renderSection = (
  title: string,
  slots: Slot[],
  summaryOf: (slot: Slot) => string,
): string | null => {
  if (slots.length === 0) {
    return null;
  }
  const lines = slots.map(slot => `• ${slot.time} — ${summaryOf(slot)}`);
  return `${title}\n${lines.join('\n')}`;
};
