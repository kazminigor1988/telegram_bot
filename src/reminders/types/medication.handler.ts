import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BuiltMessage, ReminderContext, ReminderTypeHandler } from './reminder-type.interface';

export const medicationParamsSchema = z.object({
  name: z.string().min(1),
  dose: z.string().min(1),
  mealTiming: z.enum(['before', 'after', 'with']).optional(),
});

export type MedicationParams = z.infer<typeof medicationParamsSchema>;

const MEAL_TIMING_LABEL: Record<NonNullable<MedicationParams['mealTiming']>, string> = {
  before: 'до їжі',
  after: 'після їжі',
  with: 'під час їжі',
};

@Injectable()
export class MedicationHandler implements ReminderTypeHandler<MedicationParams> {
  readonly type = 'medication';
  readonly paramsSchema = medicationParamsSchema;

  buildMessage(params: MedicationParams, context: ReminderContext): BuiltMessage {
    const food = params.mealTiming ? ` (${MEAL_TIMING_LABEL[params.mealTiming]})` : '';
    const prefix = context.retryAttempt === 0 ? '💊 Час прийняти' : '⏰ Нагадую ще раз';
    return {
      text: `${prefix} *${params.name}* — ${params.dose}${food}`,
      buttons: [{ text: '✅ Прийняв', callbackData: '__ACK__' }],
    };
  }

  buildSummary(params: MedicationParams): string {
    return `💊 ${params.name} — ${params.dose}`;
  }
}
