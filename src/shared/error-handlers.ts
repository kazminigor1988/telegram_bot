import { LoggerService } from '@nestjs/common';

export const registerGlobalErrorHandlers = (logger: LoggerService): void => {
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException');
  });
};
