import { Module } from '@nestjs/common';
import { StateStore } from './state.store';

@Module({
  providers: [StateStore],
  exports: [StateStore],
})
export class StateModule {}
