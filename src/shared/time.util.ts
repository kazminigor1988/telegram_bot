import { formatInTimeZone } from 'date-fns-tz';

export const formatInTimezone = (
  date: Date,
  timezone: string,
  pattern: string,
): string => {
  return formatInTimeZone(date, timezone, pattern);
};

export const isValidTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};
