import { Injectable } from '@nestjs/common';
import { Reminder } from '../config/schema';

@Injectable()
export class RepeatEngineService {
  scheduleNext(_userId: number, _reminder: Reminder): void {
    throw new Error('not implemented');
  }

  cancel(_userId: number, _reminderId: string): void {
    throw new Error('not implemented');
  }
}
