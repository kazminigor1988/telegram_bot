import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StateModule } from '../state/state.module';
import { BotModule } from '../bot/bot.module';
import { SchedulerService } from './scheduler.service';
import { RepeatEngineService } from './repeat-engine.service';
import { ReminderTypeRegistry } from './types/reminder-type.registry';
import { MedicationHandler } from './types/medication.handler';

@Module({
  imports: [ScheduleModule.forRoot(), StateModule, forwardRef(() => BotModule)],
  providers: [
    SchedulerService,
    RepeatEngineService,
    ReminderTypeRegistry,
    MedicationHandler,
  ],
  exports: [RepeatEngineService],
})
export class RemindersModule implements OnModuleInit {
  constructor(
    private readonly registry: ReminderTypeRegistry,
    private readonly medication: MedicationHandler,
  ) {}

  onModuleInit() {
    this.registry.register(this.medication);
  }
}
