import { formatInTimeZone } from 'date-fns-tz';

export const formatInTimezone = (date: Date, timezone: string, pattern: string): string => {
  return formatInTimeZone(date, timezone, pattern);
};
