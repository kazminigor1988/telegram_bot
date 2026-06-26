import { Injectable } from '@nestjs/common';

export interface ActiveReminder {
  fireTs: number;
  messageId: number;
  retryAttempt: number;
  maxRetries: number;
  intervalMs: number;
}

@Injectable()
export class StateStore {
  private readonly map = new Map<string, ActiveReminder>();

  markActive(userId: number, reminderId: string, data: ActiveReminder) {
    this.map.set(this.key(userId, reminderId), data);
  }

  get(userId: number, reminderId: string): ActiveReminder | undefined {
    return this.map.get(this.key(userId, reminderId));
  }

  update(userId: number, reminderId: string, data: ActiveReminder) {
    this.map.set(this.key(userId, reminderId), data);
  }

  clear(userId: number, reminderId: string) {
    this.map.delete(this.key(userId, reminderId));
  }

  private key(userId: number, reminderId: string) {
    return `${userId}:${reminderId}`;
  }
}
