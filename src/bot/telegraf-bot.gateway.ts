import { Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { BotGateway, InlineKeyboardButton, SentMessage } from './bot.gateway';
import { retryOnNetworkError } from '../shared/network-retry.util';

@Injectable()
export class TelegrafBotGateway implements BotGateway {
  constructor(@InjectBot() private readonly bot: Telegraf) {}

  async send(
    userId: number,
    text: string,
    buttons: InlineKeyboardButton[],
  ): Promise<SentMessage> {
    return retryOnNetworkError(async () => {
      const message = await this.bot.telegram.sendMessage(userId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [buttons],
        },
      });
      return { message_id: message.message_id };
    });
  }
}
