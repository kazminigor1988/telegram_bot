import { Module, forwardRef } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigLoaderService } from '../config/config-loader.service';
import { StateModule } from '../state/state.module';
import { RemindersModule } from '../reminders/reminders.module';
import { AuthGuard } from './auth.guard';
import { StartCommand } from './commands/start.command';
import { NextCommand } from './commands/next.command';
import { AckAction } from './actions/ack.action';
import { TelegrafBotGateway } from './telegraf-bot.gateway';
import { BOT_GATEWAY } from './bot.gateway';

@Module({
  imports: [
    StateModule,
    forwardRef(() => RemindersModule),
    TelegrafModule.forRootAsync({
      inject: [ConfigLoaderService],
      useFactory: async (config: ConfigLoaderService) => {
        await config.load();
        return { token: config.get().bot.token };
      },
    }),
  ],
  providers: [
    AuthGuard,
    StartCommand,
    NextCommand,
    AckAction,
    TelegrafBotGateway,
    { provide: BOT_GATEWAY, useExisting: TelegrafBotGateway },
  ],
  exports: [BOT_GATEWAY],
})
export class BotModule {}
