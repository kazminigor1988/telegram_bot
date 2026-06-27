import { Logger, UseGuards } from '@nestjs/common';
import { Command, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { AuthGuard } from '../auth.guard';
import { ConfigLoaderService } from '../../config/config-loader.service';
import { ReminderTypeRegistry } from '../../reminders/types/reminder-type.registry';
import { formatInTimezone } from '../../shared/time.util';
import { Slot, collectTodaysSlots, renderSection } from './next.logic';

@Update()
@UseGuards(AuthGuard)
export class NextCommand {
  private readonly logger = new Logger(NextCommand.name);

  constructor(
    private readonly config: ConfigLoaderService,
    private readonly registry: ReminderTypeRegistry,
  ) {}

  @Command('next')
  async onNext(@Ctx() ctx: Context): Promise<void> {
    const senderId = ctx.from!.id;
    const config = this.config.get();
    const user = config.users.find(
      (candidate) => candidate.telegramId === senderId,
    )!;

    this.logger.log(
      `/next command from telegramId=${senderId} name=${user.name}`,
    );

    const today = formatInTimezone(
      new Date(),
      config.bot.timezone,
      'yyyy-MM-dd',
    );
    const currentTime = formatInTimezone(
      new Date(),
      config.bot.timezone,
      'HH:mm',
    );

    const slots = collectTodaysSlots(user.reminders, today);
    const past = slots.filter((slot) => slot.time < currentTime);
    const upcoming = slots.filter((slot) => slot.time >= currentTime);

    const summaryOf = (slot: Slot) => {
      const handler = this.registry.get(slot.reminder.type);
      return handler.buildSummary(slot.reminder.params);
    };

    const sections = [
      renderSection('✅ *Вже минули:*', past, summaryOf),
      renderSection('⏰ *Ще будуть:*', upcoming, summaryOf),
    ].filter((section): section is string => section !== null);

    const message =
      sections.length === 0
        ? '📭 На сьогодні нагадувань немає.'
        : `📋 *Нагадування на сьогодні (${currentTime}):*\n\n${sections.join('\n\n')}`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  }
}
