import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { TelegrafExecutionContext } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { ConfigLoaderService } from '../config/config-loader.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly config: ConfigLoaderService) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const telegrafContext =
      TelegrafExecutionContext.create(executionContext).getContext<Context>();

    const senderId = telegrafContext.from?.id;
    if (!senderId) {
      return false;
    }

    const whitelist = this.config.get().users.map((user) => user.telegramId);
    const isAllowed = whitelist.includes(senderId);

    if (!isAllowed) {
      this.logger.warn(
        `Unauthorized access attempt from telegramId=${senderId}`,
      );
      await telegrafContext.reply('⛔ У вас немає доступу до цього бота.');
    }

    return isAllowed;
  }
}
