import { Reminder } from '../config/schema';

/**
 * endDate inclusive: повертає true коли today > endDate.
 * Лексикографічне порівняння YYYY-MM-DD працює коректно завдяки сортувальному формату.
 */
export const isReminderExpired = (
  reminder: Reminder,
  todayIso: string,
): boolean => {
  if (!reminder.endDate) {
    return false;
  }
  return todayIso > reminder.endDate;
};
