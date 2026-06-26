import { z } from 'zod';

export interface ReminderContext {
  reminderId: string;
  fireTimestamp: number;
  retryAttempt: number;
}

export interface InlineButton {
  text: string;
  callbackData: string;
}

export interface BuiltMessage {
  text: string;
  buttons: InlineButton[];
}

export interface ReminderTypeHandler<TParams = unknown> {
  readonly type: string;
  readonly paramsSchema: z.ZodType<TParams>;
  buildMessage(params: TParams, context: ReminderContext): BuiltMessage;
  buildSummary(params: TParams): string;
}
