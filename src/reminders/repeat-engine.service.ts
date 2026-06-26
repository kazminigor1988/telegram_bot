import { Inject, Injectable, Logger } from '@nestjs/common';
import { Reminder } from '../config/schema';
import { StateStore } from '../state/state.store';
import { ReminderTypeRegistry } from './types/reminder-type.registry';
import { BOT_GATEWAY } from '../bot/bot.gateway';
import type { BotGateway, InlineKeyboardButton } from '../bot/bot.gateway';
import { InlineButton } from './types/reminder-type.interface';

@Injectable()
export class RepeatEngineService {
  private readonly logger = new Logger(RepeatEngineService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly state: StateStore,
    private readonly registry: ReminderTypeRegistry,
    @Inject(BOT_GATEWAY) private readonly bot: BotGateway,
  ) {}

  scheduleNext(userId: number, reminder: Reminder): void {
    const key = `${userId}:${reminder.id}`;
    this.clearTimer(key);

    const active = this.state.get(userId, reminder.id);
    if (!active) {
      return;
    }
    if (active.retryAttempt >= active.maxRetries) {
      this.logger.warn(`Max retries reached: ${key}`);
      this.state.clear(userId, reminder.id);
      return;
    }

    const timer = setTimeout(
      () => { void this.fireRetry(userId, reminder); },
      active.intervalMs,
    );
    this.timers.set(key, timer);
  }

  cancel(userId: number, reminderId: string): void {
    this.clearTimer(`${userId}:${reminderId}`);
  }

  private async fireRetry(userId: number, reminder: Reminder): Promise<void> {
    const active = this.state.get(userId, reminder.id);
    if (!active) {
      return;
    }

    const nextAttempt = active.retryAttempt + 1;
    const handler = this.registry.get(reminder.type);
    const { text, buttons } = handler.buildMessage(reminder.params, {
      reminderId: reminder.id,
      fireTimestamp: active.fireTs,
      retryAttempt: nextAttempt,
    });

    const message = await this.bot.send(
      userId,
      text,
      this.toTelegramButtons(buttons, userId, reminder.id, active.fireTs),
    );

    this.logger.log(
      `Retry sent telegramId=${userId} reminderId=${reminder.id} attempt=${nextAttempt}/${active.maxRetries} messageId=${message.message_id} text="${text}"`,
    );

    this.state.update(userId, reminder.id, {
      ...active,
      retryAttempt: nextAttempt,
      messageId: message.message_id,
    });

    this.scheduleNext(userId, reminder);
  }

  private toTelegramButtons(
    buttons: InlineButton[],
    userId: number,
    reminderId: string,
    fireTs: number,
  ): InlineKeyboardButton[] {
    return buttons.map(button => ({
      text: button.text,
      callback_data: `ack:${userId}:${reminderId}:${fireTs}`,
    }));
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
    }
    this.timers.delete(key);
  }
}
