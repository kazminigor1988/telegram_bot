import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { StateModule } from './state/state.module';
import { RemindersModule } from './reminders/reminders.module';
import { BotModule } from './bot/bot.module';
import { loggerConfig } from './shared/logger.config';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule,
    StateModule,
    RemindersModule,
    BotModule,
  ],
})
export class AppModule {}
