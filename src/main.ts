import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { registerGlobalErrorHandlers } from './shared/error-handlers';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  registerGlobalErrorHandlers(logger);
  app.enableShutdownHooks();

  await app.init();
  logger.log('Telegram Reminder Bot started');
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
