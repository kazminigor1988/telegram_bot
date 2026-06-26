import { Logger, UseGuards } from '@nestjs/common';
import { Action, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { AuthGuard } from '../auth.guard';
import { StateStore } from '../../state/state.store';
import { RepeatEngineService } from '../../reminders/repeat-engine.service';

@Update()
@UseGuards(AuthGuard)
export class AckAction {
  private readonly logger = new Logger(AckAction.name);

  constructor(
    private readonly state: StateStore,
    private readonly repeat: RepeatEngineService,
  ) {}

  @Action(/^ack:(\d+):([^:]+):(\d+)$/)
  async onAck(@Ctx() ctx: Context & { match: RegExpExecArray }): Promise<void> {
    const [, userIdRaw, reminderId] = ctx.match;
    const userId = Number(userIdRaw);

    const wasActive = this.state.get(userId, reminderId) !== undefined;
    this.repeat.cancel(userId, reminderId);
    this.state.clear(userId, reminderId);

    this.logger.log(
      `Ack received telegramId=${userId} reminderId=${reminderId} wasActive=${wasActive}`,
    );

    await ctx.answerCbQuery(wasActive ? 'Зафіксовано ✅' : 'Вже зафіксовано');

    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (error) {
      this.logger.debug({ err: error }, 'editMessageReplyMarkup ignored');
    }
  }
}
