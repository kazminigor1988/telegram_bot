import { Injectable } from '@nestjs/common';
import { ReminderTypeHandler } from './reminder-type.interface';

@Injectable()
export class ReminderTypeRegistry {
  private readonly handlers = new Map<string, ReminderTypeHandler>();

  register(handler: ReminderTypeHandler) {
    this.handlers.set(handler.type, handler);
  }

  get(type: string): ReminderTypeHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler for reminder type: ${type}`);
    }
    return handler;
  }
}
