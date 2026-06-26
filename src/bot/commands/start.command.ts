import { UseGuards } from '@nestjs/common';
import { Ctx, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { AuthGuard } from '../auth.guard';
import { ConfigLoaderService } from '../../config/config-loader.service';

@Update()
@UseGuards(AuthGuard)
export class StartCommand {
  constructor(private readonly config: ConfigLoaderService) {}

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    const senderId = ctx.from!.id;
    const user = this.config.get().users.find(
      candidate => candidate.telegramId === senderId,
    );

    await ctx.reply(
      `Привіт, ${user!.name}! 👋\n` +
      `Я надсилатиму нагадування за розкладом.\n` +
      `Команда /next покаже список на сьогодні.`,
    );
  }
}
