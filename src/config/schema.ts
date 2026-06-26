import { z } from 'zod';
import { medicationParamsSchema } from '../reminders/types/medication.handler';
import { isValidTimezone } from '../shared/time.util';

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const repeatSchema = z.object({
  intervalMin: z.number().int().positive().max(180),
  maxRetries: z.number().int().min(0).max(10),
});

export const reminderSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('medication'),
    params: medicationParamsSchema,
    times: z.array(timeSchema).min(1),
    endDate: dateSchema.optional(),
    repeat: repeatSchema.optional(),
  }),
]);

export const userSchema = z.object({
  telegramId: z.number().int().positive(),
  name: z.string().min(1),
  reminders: z.array(reminderSchema)
    .refine(arr => new Set(arr.map(reminder => reminder.id)).size === arr.length, 'reminder ids must be unique'),
});

export const configSchema = z.object({
  bot: z.object({
    token: z.string().min(1),
    timezone: z.string().refine(isValidTimezone, 'invalid IANA timezone'),
  }),
  users: z.array(userSchema).min(1)
    .refine(arr => new Set(arr.map(user => user.telegramId)).size === arr.length, 'telegramId must be unique'),
});

export type AppConfig = z.infer<typeof configSchema>;
export type Reminder = z.infer<typeof reminderSchema>;
export type User = z.infer<typeof userSchema>;

export interface ScheduledSlot {
  userId: number;
  reminder: Reminder;
  time: string;
}

export const expandSchedule = (users: User[]): ScheduledSlot[] => {
  return users
    .map(user =>
      user.reminders.map(reminder =>
        reminder.times.map(time => ({
          userId: user.telegramId,
          reminder,
          time,
        })),
      ),
    )
    .flat(2);
};
