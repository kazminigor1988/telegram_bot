import { z } from 'zod';

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const repeatSchema = z.object({
  intervalMin: z.number().int().positive().max(180),
  maxRetries: z.number().int().min(0).max(10),
});
