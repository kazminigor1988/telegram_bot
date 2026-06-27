import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Reminder, ScheduledSlot, expandSchedule } from '../config/schema';
import { ConfigLoaderService } from '../config/config-loader.service';
import { BOT_GATEWAY } from '../bot/bot.gateway';
import type { BotGateway, InlineKeyboardButton } from '../bot/bot.gateway';
import { StateStore } from '../state/state.store';
import { ReminderTypeRegistry } from './types/reminder-type.registry';
import { RepeatEngineService } from './repeat-engine.service';
import { InlineButton } from './types/reminder-type.interface';
import { isReminderExpired } from './expiry.util';
import { formatInTimezone } from '../shared/time.util';

@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly config: ConfigLoaderService,
    private readonly registry: ReminderTypeRegistry,
    private readonly state: StateStore,
    private readonly repeat: RepeatEngineService,
    @Inject(BOT_GATEWAY) private readonly bot: BotGateway,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const { bot, users } = this.config.get();
    const slots = expandSchedule(users);
    slots.forEach((slot) => this.registerCron(slot, bot.timezone));
    this.logger.log(`Scheduled ${slots.length} reminder slots`);
  }

  private registerCron(slot: ScheduledSlot, timezone: string): void {
    const [hh, mm] = slot.time.split(':');
    const cronExpr = `${mm} ${hh} * * *`;
    const jobName = `${slot.userId}:${slot.reminder.id}:${slot.time}`;

    const job = new CronJob(
      cronExpr,
      () => {
        void this.fire(slot.userId, slot.reminder);
      },
      null,
      true,
      timezone,
    );
    this.schedulerRegistry.addCronJob(jobName, job);
  }

  async fire(userId: number, reminder: Reminder): Promise<void> {
    const timezone = this.config.get().bot.timezone;
    const today = formatInTimezone(new Date(), timezone, 'yyyy-MM-dd');
    if (isReminderExpired(reminder, today)) {
      this.logger.log(
        `Reminder ${reminder.id} expired (today=${today}, endDate=${reminder.endDate}) — skipping`,
      );
      return;
    }

    const fireTs = Date.now();
    const handler = this.registry.get(reminder.type);
    const { text, buttons } = handler.buildMessage(reminder.params, {
      reminderId: reminder.id,
      fireTimestamp: fireTs,
      retryAttempt: 0,
    });

    try {
      const message = await this.bot.send(
        userId,
        text,
        this.toTelegramButtons(buttons, userId, reminder.id, fireTs),
      );

      this.logger.log(
        `Reminder sent telegramId=${userId} reminderId=${reminder.id} messageId=${message.message_id} text="${text}"`,
      );

      this.state.markActive(userId, reminder.id, {
        fireTs,
        messageId: message.message_id,
        retryAttempt: 0,
        maxRetries: reminder.repeat?.maxRetries ?? 0,
        intervalMs: (reminder.repeat?.intervalMin ?? 0) * 60_000,
      });

      if (reminder.repeat) {
        this.repeat.scheduleNext(userId, reminder);
      }
    } catch (err: unknown) {
      this.logger.error(
        { err },
        `Reminder send failed telegramId=${userId} reminderId=${reminder.id}`,
      );
    }
  }

  private toTelegramButtons(
    buttons: InlineButton[],
    userId: number,
    reminderId: string,
    fireTs: number,
  ): InlineKeyboardButton[] {
    return buttons.map((button) => ({
      text: button.text,
      callback_data: `ack:${userId}:${reminderId}:${fireTs}`,
    }));
  }
}
