import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BuiltMessage, ReminderContext, ReminderTypeHandler } from './reminder-type.interface';

export const medicationParamsSchema = z.object({
  name: z.string().min(1),
  dose: z.string().min(1),
  withFood: z.boolean().optional(),
});

export type MedicationParams = z.infer<typeof medicationParamsSchema>;

@Injectable()
export class MedicationHandler implements ReminderTypeHandler<MedicationParams> {
  readonly type = 'medication';
  readonly paramsSchema = medicationParamsSchema;

  buildMessage(params: MedicationParams, context: ReminderContext): BuiltMessage {
    const food = params.withFood ? ' (під час їжі)' : '';
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
