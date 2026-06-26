# Telegram Reminder Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Побудувати локально-запускаємий Telegram-бот на NestJS, який за JSON-конфігом надсилає нагадування про прийом ліків з inline-кнопкою «Прийняв», повторами і опційною датою завершення курсу.

**Architecture:** NestJS-модулі (`Config`, `State`, `Reminders`, `Bot`) з DI singleton-сервісами. Plugin-based reminder types через `ReminderTypeRegistry`. State — лише in-memory (`Map`), без persistence. Long-polling Telegram, запуск у терміналі.

**Tech Stack:** NestJS, TypeScript, nestjs-telegraf, @nestjs/schedule, zod, nestjs-pino + pino-pretty, vitest, date-fns-tz.

**Spec:** [`docs/superpowers/specs/2026-06-26-telegram-reminder-bot-design.md`](../specs/2026-06-26-telegram-reminder-bot-design.md)

---

## File Structure

```
src/
  main.ts                              # bootstrap NestFactory, Logger, error handlers
  app.module.ts                        # imports усіх модулів

  config/
    config.module.ts
    config-loader.service.ts           # OnModuleInit → fs.readFile + zod validate
    schema.ts                          # zod schemas + inferred types + expandSchedule

  bot/
    bot.module.ts                      # TelegrafModule.forRootAsync
    bot.gateway.ts                     # абстракція над telegraf для send()
    auth.guard.ts                      # whitelist по telegramId
    commands/
      start.command.ts                 # /start
      next.command.ts                  # /next handler
      next.logic.ts                    # pure: collectTodaysSlots, renderSection
    actions/
      ack.action.ts                    # callback "ack:userId:reminderId:fireTs"

  reminders/
    reminders.module.ts
    expiry.util.ts                     # pure: isReminderExpired(reminder, todayIso)
    scheduler.service.ts               # OnApplicationBootstrap → cron jobs + fire()
    repeat-engine.service.ts           # setTimeout retries + cancel()
    types/
      reminder-type.interface.ts       # interface + ReminderContext + InlineButton
      reminder-type.registry.ts        # @Injectable, Map<string, handler>
      medication.handler.ts            # перший plugin

  state/
    state.module.ts
    state.store.ts                     # @Injectable, in-memory Map

  shared/
    logger.config.ts                   # nestjs-pino config
    error-handlers.ts                  # registerGlobalErrorHandlers
    time.util.ts                       # formatInTimezone, isValidTimezone

test/
  fixtures/
    config.fixture.ts                  # buildConfig({ overrides }), buildUser, buildReminder

vitest.config.ts
.env.example
.gitignore
config.example.json
README.md
```

**Тести розміщуються поряд з тестованим файлом** (collocated `*.spec.ts`). Це спрощує навігацію і робить ясною покриваність.

---

## Tasks

### Task 1: Initialize NestJS project

**Files:**
- Create (via CLI): `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `src/main.ts`, `src/app.module.ts`, `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`, `.gitignore`, `.eslintrc.js`, `.prettierrc`

- [ ] **Step 1: Run nest CLI**

```bash
cd /Users/i.kazmin/Projects/telegram-bot
npx -y @nestjs/cli@latest new . --skip-git --package-manager npm
```

When prompted to use the current directory, confirm. The CLI will scaffold the standard structure and run `npm install`.

- [ ] **Step 2: Initialize git in the project**

```bash
git init
git add -A
git commit -m "chore: initial NestJS scaffold via nest new"
```

- [ ] **Step 3: Remove default app controller/service (we don't need HTTP)**

Delete: `src/app.controller.ts`, `src/app.controller.spec.ts`, `src/app.service.ts`.

Replace `src/app.module.ts` content with:

```ts
import { Module } from '@nestjs/common';

@Module({
  imports: [],
  providers: [],
})
export class AppModule {}
```

Replace `src/main.ts` content with a temporary stub:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.init();
}

bootstrap();
```

- [ ] **Step 4: Verify project builds**

Run: `npm run build`
Expected: completes with no errors, creates `dist/`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove default HTTP controllers, prepare for bot bootstrap"
```

---

### Task 2: Replace jest with vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Delete: jest config blocks from `package.json`

- [ ] **Step 1: Uninstall jest, install vitest + swc**

```bash
npm uninstall jest @types/jest ts-jest @nestjs/testing
npm install -D vitest @vitest/coverage-v8 unplugin-swc @swc/core @nestjs/testing
```

> `@nestjs/testing` залишається — потрібен для `Test.createTestingModule`.

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['**/*.spec.ts', '**/main.ts', '**/*.module.ts'],
    },
  },
});
```

- [ ] **Step 3: Update package.json scripts**

Replace the `test`-related scripts under `"scripts"`:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:cov": "vitest run --coverage"
}
```

Remove any `jest` block from `package.json`.

- [ ] **Step 4: Remove old `*.spec.ts` left over after Task 1**

Already removed in Task 1 step 3.

- [ ] **Step 5: Smoke-test vitest with a trivial test**

Create `src/smoke.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: 1 test passed.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm src/smoke.spec.ts
git add -A
git commit -m "chore: replace jest with vitest"
```

---

### Task 3: Install runtime dependencies

- [ ] **Step 1: Install Telegram + scheduling + validation + logging + date utils**

```bash
npm install nestjs-telegraf telegraf @nestjs/schedule cron zod nestjs-pino pino pino-pretty date-fns date-fns-tz
```

- [ ] **Step 2: Verify build still works**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install runtime dependencies"
```

---

### Task 4: shared/time.util.ts — `formatInTimezone`

**Files:**
- Create: `src/shared/time.util.ts`
- Create: `src/shared/time.util.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/shared/time.util.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatInTimezone } from './time.util';

describe('formatInTimezone', () => {
  it('форматує UTC ISO у локальний рядок Europe/Kyiv', () => {
    const utc = new Date('2026-06-26T05:30:00.000Z'); // 08:30 у Києві (літо, UTC+3)
    expect(formatInTimezone(utc, 'Europe/Kyiv', 'yyyy-MM-dd HH:mm')).toBe('2026-06-26 08:30');
  });

  it('повертає лише дату для формату yyyy-MM-dd', () => {
    const utc = new Date('2026-06-26T22:00:00.000Z'); // 01:00 наступного дня у Києві
    expect(formatInTimezone(utc, 'Europe/Kyiv', 'yyyy-MM-dd')).toBe('2026-06-27');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/time.util.spec.ts`
Expected: FAIL — `Cannot find module './time.util'`.

- [ ] **Step 3: Implement**

Create `src/shared/time.util.ts`:

```ts
import { formatInTimeZone } from 'date-fns-tz';

export const formatInTimezone = (date: Date, timezone: string, pattern: string): string => {
  return formatInTimeZone(date, timezone, pattern);
};
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/shared/time.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/time.util.ts src/shared/time.util.spec.ts
git commit -m "feat(shared): add formatInTimezone utility"
```

---

### Task 5: shared/time.util.ts — `isValidTimezone`

**Files:**
- Modify: `src/shared/time.util.ts`
- Modify: `src/shared/time.util.spec.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/shared/time.util.spec.ts`:

```ts
import { isValidTimezone } from './time.util';

describe('isValidTimezone', () => {
  it('повертає true для валідних IANA timezone', () => {
    expect(isValidTimezone('Europe/Kyiv')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
  });

  it('повертає false для невалідних', () => {
    expect(isValidTimezone('Not/Real')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/shared/time.util.spec.ts`
Expected: FAIL — `isValidTimezone is not exported`.

- [ ] **Step 3: Implement**

Append to `src/shared/time.util.ts`:

```ts
export const isValidTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/shared/time.util.spec.ts`
Expected: 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/shared/time.util.ts src/shared/time.util.spec.ts
git commit -m "feat(shared): add isValidTimezone validator"
```

---

### Task 6: shared/error-handlers.ts

**Files:**
- Create: `src/shared/error-handlers.ts`
- Create: `src/shared/error-handlers.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/shared/error-handlers.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerGlobalErrorHandlers } from './error-handlers';

describe('registerGlobalErrorHandlers', () => {
  const originalListeners = {
    unhandledRejection: process.listeners('unhandledRejection'),
    uncaughtException: process.listeners('uncaughtException'),
  };

  afterEach(() => {
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
    originalListeners.unhandledRejection.forEach(l => process.on('unhandledRejection', l));
    originalListeners.uncaughtException.forEach(l => process.on('uncaughtException', l));
  });

  it('логує unhandledRejection через переданий logger', () => {
    const logger = { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    registerGlobalErrorHandlers(logger as any);
    process.emit('unhandledRejection', new Error('boom') as any, Promise.resolve());
    expect(logger.error).toHaveBeenCalled();
  });

  it('логує uncaughtException через переданий logger', () => {
    const logger = { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    registerGlobalErrorHandlers(logger as any);
    process.emit('uncaughtException', new Error('boom2'));
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/shared/error-handlers.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/shared/error-handlers.ts`:

```ts
import { LoggerService } from '@nestjs/common';

export const registerGlobalErrorHandlers = (logger: LoggerService): void => {
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException');
  });
};
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/shared/error-handlers.spec.ts`
Expected: 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/shared/error-handlers.ts src/shared/error-handlers.spec.ts
git commit -m "feat(shared): add global error handlers"
```

---

### Task 7: shared/logger.config.ts

**Files:**
- Create: `src/shared/logger.config.ts`

No test — це обʼєкт конфігурації; перевіряється при bootstrap у Task 36.

- [ ] **Step 1: Create config**

Create `src/shared/logger.config.ts`:

```ts
import { Params } from 'nestjs-pino';

export const loggerConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { singleLine: true } },
    redact: ['*.token', 'token', '*.TELEGRAM_BOT_TOKEN'],
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/logger.config.ts
git commit -m "feat(shared): add pino logger config"
```

---

### Task 8: config/schema.ts — `timeSchema`, `dateSchema`, `repeatSchema`

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/schema.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `src/config/schema.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { timeSchema, dateSchema, repeatSchema } from './schema';

describe('timeSchema', () => {
  it('приймає валідні HH:mm', () => {
    expect(timeSchema.safeParse('08:00').success).toBe(true);
    expect(timeSchema.safeParse('23:59').success).toBe(true);
    expect(timeSchema.safeParse('00:00').success).toBe(true);
  });

  it('відхиляє невалідні формати', () => {
    expect(timeSchema.safeParse('8:00').success).toBe(false);
    expect(timeSchema.safeParse('24:00').success).toBe(false);
    expect(timeSchema.safeParse('12:60').success).toBe(false);
    expect(timeSchema.safeParse('foo').success).toBe(false);
  });
});

describe('dateSchema', () => {
  it('приймає валідні YYYY-MM-DD', () => {
    expect(dateSchema.safeParse('2026-06-26').success).toBe(true);
    expect(dateSchema.safeParse('2000-01-01').success).toBe(true);
  });

  it('відхиляє невалідні', () => {
    expect(dateSchema.safeParse('26-06-2026').success).toBe(false);
    expect(dateSchema.safeParse('2026/06/26').success).toBe(false);
    expect(dateSchema.safeParse('foo').success).toBe(false);
  });
});

describe('repeatSchema', () => {
  it('приймає валідну конфігурацію повторів', () => {
    expect(repeatSchema.safeParse({ intervalMin: 15, maxRetries: 3 }).success).toBe(true);
  });

  it('відхиляє відʼємний intervalMin', () => {
    expect(repeatSchema.safeParse({ intervalMin: -1, maxRetries: 3 }).success).toBe(false);
  });

  it('відхиляє занадто великий intervalMin', () => {
    expect(repeatSchema.safeParse({ intervalMin: 999, maxRetries: 3 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/config/schema.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/config/schema.ts`:

```ts
import { z } from 'zod';

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const repeatSchema = z.object({
  intervalMin: z.number().int().positive().max(180),
  maxRetries: z.number().int().min(0).max(10),
});
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/config/schema.spec.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/schema.spec.ts
git commit -m "feat(config): add base zod schemas (time, date, repeat)"
```

---

### Task 9: reminders/types — interface + handler contract

**Files:**
- Create: `src/reminders/types/reminder-type.interface.ts`

No test — це suite з типів і інтерфейсу.

- [ ] **Step 1: Implement interface**

Create `src/reminders/types/reminder-type.interface.ts`:

```ts
import { z } from 'zod';

export interface ReminderContext {
  reminderId: string;
  fireTimestamp: number;
  retryAttempt: number;
}

export interface InlineButton {
  text: string;
  callbackData: string;
}

export interface BuiltMessage {
  text: string;
  buttons: InlineButton[];
}

export interface ReminderTypeHandler<TParams = unknown> {
  readonly type: string;
  readonly paramsSchema: z.ZodType<TParams>;
  buildMessage(params: TParams, context: ReminderContext): BuiltMessage;
  buildSummary(params: TParams): string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/reminders/types/reminder-type.interface.ts
git commit -m "feat(reminders): add reminder type handler interface"
```

---

### Task 10: MedicationHandler — `paramsSchema`

**Files:**
- Create: `src/reminders/types/medication.handler.ts`
- Create: `src/reminders/types/medication.handler.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `src/reminders/types/medication.handler.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MedicationHandler } from './medication.handler';

describe('MedicationHandler.paramsSchema', () => {
  const handler = new MedicationHandler();

  it('приймає валідні params', () => {
    const result = handler.paramsSchema.safeParse({
      name: 'Вітамін D',
      dose: '1 таблетка',
    });
    expect(result.success).toBe(true);
  });

  it('приймає params з withFood: true', () => {
    const result = handler.paramsSchema.safeParse({
      name: 'X',
      dose: '1',
      withFood: true,
    });
    expect(result.success).toBe(true);
  });

  it('відхиляє пустий name', () => {
    const result = handler.paramsSchema.safeParse({ name: '', dose: '1' });
    expect(result.success).toBe(false);
  });

  it('відхиляє відсутній dose', () => {
    const result = handler.paramsSchema.safeParse({ name: 'X' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/reminders/types/medication.handler.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (skeleton + paramsSchema)**

Create `src/reminders/types/medication.handler.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BuiltMessage, ReminderContext, ReminderTypeHandler } from './reminder-type.interface';

export const medicationParamsSchema = z.object({
  name: z.string().min(1),
  dose: z.string().min(1),
  withFood: z.boolean().optional(),
});

export type MedicationParams = z.infer<typeof medicationParamsSchema>;

@Injectable()
export class MedicationHandler implements ReminderTypeHandler<MedicationParams> {
  readonly type = 'medication';
  readonly paramsSchema = medicationParamsSchema;

  buildMessage(_params: MedicationParams, _context: ReminderContext): BuiltMessage {
    throw new Error('not implemented');
  }

  buildSummary(_params: MedicationParams): string {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/reminders/types/medication.handler.spec.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reminders/types/medication.handler.ts src/reminders/types/medication.handler.spec.ts
git commit -m "feat(reminders): add MedicationHandler skeleton + params schema"
```

---

### Task 11: MedicationHandler — `buildMessage`

**Files:**
- Modify: `src/reminders/types/medication.handler.ts`
- Modify: `src/reminders/types/medication.handler.spec.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/reminders/types/medication.handler.spec.ts`:

```ts
describe('MedicationHandler.buildMessage', () => {
  const handler = new MedicationHandler();
  const baseCtx = { reminderId: 'r1', fireTimestamp: 0, retryAttempt: 0 };

  it('містить назву і дозу', () => {
    const { text } = handler.buildMessage(
      { name: 'Вітамін D', dose: '1 таблетка' },
      baseCtx,
    );
    expect(text).toContain('Вітамін D');
    expect(text).toContain('1 таблетка');
  });

  it('додає "(під час їжі)" при withFood: true', () => {
    const { text } = handler.buildMessage(
      { name: 'X', dose: '1', withFood: true },
      baseCtx,
    );
    expect(text).toContain('(під час їжі)');
  });

  it('використовує "Час прийняти" при retryAttempt=0', () => {
    const { text } = handler.buildMessage({ name: 'X', dose: '1' }, baseCtx);
    expect(text).toContain('Час прийняти');
  });

  it('використовує "Нагадую ще раз" при retryAttempt>0', () => {
    const { text } = handler.buildMessage(
      { name: 'X', dose: '1' },
      { ...baseCtx, retryAttempt: 1 },
    );
    expect(text).toContain('Нагадую ще раз');
  });

  it('повертає одну кнопку з placeholder __ACK__', () => {
    const { buttons } = handler.buildMessage({ name: 'X', dose: '1' }, baseCtx);
    expect(buttons).toEqual([{ text: '✅ Прийняв', callbackData: '__ACK__' }]);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/reminders/types/medication.handler.spec.ts`
Expected: 5 new tests fail with `not implemented`.

- [ ] **Step 3: Implement buildMessage**

Replace the `buildMessage` body in `src/reminders/types/medication.handler.ts`:

```ts
  buildMessage(params: MedicationParams, context: ReminderContext): BuiltMessage {
    const food = params.withFood ? ' (під час їжі)' : '';
    const prefix = context.retryAttempt === 0 ? '💊 Час прийняти' : '⏰ Нагадую ще раз';
    return {
      text: `${prefix} *${params.name}* — ${params.dose}${food}`,
      buttons: [{ text: '✅ Прийняв', callbackData: '__ACK__' }],
    };
  }
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/reminders/types/medication.handler.spec.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reminders/types/medication.handler.ts src/reminders/types/medication.handler.spec.ts
git commit -m "feat(reminders): implement MedicationHandler.buildMessage"
```

---

### Task 12: MedicationHandler — `buildSummary`

**Files:**
- Modify: `src/reminders/types/medication.handler.ts`
- Modify: `src/reminders/types/medication.handler.spec.ts`

- [ ] **Step 1: Add failing test**

Append to `src/reminders/types/medication.handler.spec.ts`:

```ts
describe('MedicationHandler.buildSummary', () => {
  const handler = new MedicationHandler();

  it('форматує "💊 NAME — DOSE"', () => {
    expect(handler.buildSummary({ name: 'Вітамін D', dose: '1 таблетка' }))
      .toBe('💊 Вітамін D — 1 таблетка');
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/reminders/types/medication.handler.spec.ts`
Expected: 1 new test fails.

- [ ] **Step 3: Implement**

Replace `buildSummary` body:

```ts
  buildSummary(params: MedicationParams): string {
    return `💊 ${params.name} — ${params.dose}`;
  }
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/reminders/types/medication.handler.spec.ts`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reminders/types/medication.handler.ts src/reminders/types/medication.handler.spec.ts
git commit -m "feat(reminders): implement MedicationHandler.buildSummary"
```

---

### Task 13: Complete config/schema.ts — `reminderSchema`, `userSchema`, `configSchema`, types

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/schema.spec.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/config/schema.spec.ts`:

```ts
import { reminderSchema, userSchema, configSchema, AppConfig } from './schema';

describe('reminderSchema', () => {
  const baseReminder = {
    id: 'r1',
    type: 'medication' as const,
    params: { name: 'X', dose: '1' },
    times: ['08:00'],
  };

  it('приймає мінімальний медикаментозний reminder', () => {
    expect(reminderSchema.safeParse(baseReminder).success).toBe(true);
  });

  it('приймає reminder з endDate і repeat', () => {
    const result = reminderSchema.safeParse({
      ...baseReminder,
      endDate: '2026-07-02',
      repeat: { intervalMin: 15, maxRetries: 3 },
    });
    expect(result.success).toBe(true);
  });

  it('відхиляє невідомий type', () => {
    expect(reminderSchema.safeParse({ ...baseReminder, type: 'unknown' }).success).toBe(false);
  });

  it('відхиляє пустий times', () => {
    expect(reminderSchema.safeParse({ ...baseReminder, times: [] }).success).toBe(false);
  });
});

describe('userSchema', () => {
  it('відхиляє дублікати reminder.id у межах користувача', () => {
    const result = userSchema.safeParse({
      telegramId: 1,
      name: 'A',
      reminders: [
        { id: 'r1', type: 'medication', params: { name: 'X', dose: '1' }, times: ['08:00'] },
        { id: 'r1', type: 'medication', params: { name: 'Y', dose: '2' }, times: ['09:00'] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('приймає унікальні id', () => {
    const result = userSchema.safeParse({
      telegramId: 1,
      name: 'A',
      reminders: [
        { id: 'r1', type: 'medication', params: { name: 'X', dose: '1' }, times: ['08:00'] },
        { id: 'r2', type: 'medication', params: { name: 'Y', dose: '2' }, times: ['09:00'] },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('configSchema', () => {
  const validConfig = {
    bot: { token: 'abc', timezone: 'Europe/Kyiv' },
    users: [{
      telegramId: 1,
      name: 'A',
      reminders: [{ id: 'r1', type: 'medication', params: { name: 'X', dose: '1' }, times: ['08:00'] }],
    }],
  };

  it('приймає валідний конфіг', () => {
    expect(configSchema.safeParse(validConfig).success).toBe(true);
  });

  it('відхиляє невалідний timezone', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      bot: { ...validConfig.bot, timezone: 'Not/Real' },
    });
    expect(result.success).toBe(false);
  });

  it('відхиляє дублікати telegramId', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      users: [validConfig.users[0], validConfig.users[0]],
    });
    expect(result.success).toBe(false);
  });

  it('AppConfig type inference works', () => {
    const parsed = configSchema.parse(validConfig);
    const _typed: AppConfig = parsed; // compile-time check
    expect(_typed.bot.token).toBe('abc');
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/config/schema.spec.ts`
Expected: new tests fail — exports not found.

- [ ] **Step 3: Implement**

Append to `src/config/schema.ts`:

```ts
import { medicationParamsSchema } from '../reminders/types/medication.handler';
import { isValidTimezone } from '../shared/time.util';

export const reminderSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('medication'),
    params: medicationParamsSchema,
    times: z.array(timeSchema).min(1),
    endDate: dateSchema.optional(),
    repeat: repeatSchema.optional(),
  }),
]);

export const userSchema = z.object({
  telegramId: z.number().int().positive(),
  name: z.string().min(1),
  reminders: z.array(reminderSchema)
    .refine(arr => new Set(arr.map(r => r.id)).size === arr.length, 'reminder ids must be unique'),
});

export const configSchema = z.object({
  bot: z.object({
    token: z.string().min(1),
    timezone: z.string().refine(isValidTimezone, 'invalid IANA timezone'),
  }),
  users: z.array(userSchema).min(1)
    .refine(arr => new Set(arr.map(u => u.telegramId)).size === arr.length, 'telegramId must be unique'),
});

export type AppConfig = z.infer<typeof configSchema>;
export type Reminder = z.infer<typeof reminderSchema>;
export type User = z.infer<typeof userSchema>;
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/config/schema.spec.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/schema.spec.ts
git commit -m "feat(config): complete configSchema with discriminated reminder union"
```

---

### Task 14: config/schema.ts — `expandSchedule` pure function

**Files:**
- Modify: `src/config/schema.ts`
- Create: `src/config/expand-schedule.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/config/expand-schedule.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { expandSchedule, User } from './schema';

describe('expandSchedule', () => {
  it('розгортає вкладені users → reminders → times у плоский список', () => {
    const users: User[] = [
      {
        telegramId: 1,
        name: 'A',
        reminders: [
          { id: 'r1', type: 'medication', params: { name: 'X', dose: '1' }, times: ['08:00', '20:00'] },
          { id: 'r2', type: 'medication', params: { name: 'Y', dose: '2' }, times: ['12:00'] },
        ],
      },
      {
        telegramId: 2,
        name: 'B',
        reminders: [
          { id: 'r3', type: 'medication', params: { name: 'Z', dose: '3' }, times: ['09:00'] },
        ],
      },
    ];

    const result = expandSchedule(users);

    expect(result).toHaveLength(4);
    expect(result.map(slot => `${slot.userId}:${slot.reminder.id}:${slot.time}`)).toEqual([
      '1:r1:08:00',
      '1:r1:20:00',
      '1:r2:12:00',
      '2:r3:09:00',
    ]);
  });

  it('повертає [] для порожнього масиву', () => {
    expect(expandSchedule([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/config/expand-schedule.spec.ts`
Expected: FAIL — `expandSchedule is not exported`.

- [ ] **Step 3: Implement**

Append to `src/config/schema.ts`:

```ts
export interface ScheduledSlot {
  userId: number;
  reminder: Reminder;
  time: string;
}

export const expandSchedule = (users: User[]): ScheduledSlot[] => {
  return users
    .map(user =>
      user.reminders.map(reminder =>
        reminder.times.map(time => ({
          userId: user.telegramId,
          reminder,
          time,
        })),
      ),
    )
    .flat(2);
};
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/config/expand-schedule.spec.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/expand-schedule.spec.ts
git commit -m "feat(config): add expandSchedule pure function"
```

---

### Task 15: Create test fixtures

**Files:**
- Create: `test/fixtures/config.fixture.ts`

- [ ] **Step 1: Implement fixtures**

Create `test/fixtures/config.fixture.ts`:

```ts
import { AppConfig, Reminder, User } from '../../src/config/schema';

interface ReminderOverrides extends Partial<Omit<Reminder, 'type' | 'params'>> {
  params?: Partial<{ name: string; dose: string; withFood: boolean }>;
}

export const buildReminder = (overrides: ReminderOverrides = {}): Reminder => ({
  id: 'r1',
  type: 'medication',
  params: { name: 'Test Med', dose: '1 таблетка', ...(overrides.params ?? {}) },
  times: ['08:00'],
  ...overrides,
}) as Reminder;

export const buildUser = (overrides: Partial<User> = {}): User => ({
  telegramId: 123,
  name: 'Test User',
  reminders: [buildReminder()],
  ...overrides,
});

export const buildConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  bot: { token: 'test-token', timezone: 'Europe/Kyiv', ...(overrides.bot ?? {}) },
  users: overrides.users ?? [buildUser()],
});
```

- [ ] **Step 2: Update tsconfig to include test/**

Open `tsconfig.json`. Ensure `"include"` covers `test/**/*` (default config from `nest new` may not):

```json
{
  "include": ["src/**/*", "test/**/*"]
}
```

If `include` is absent, add it. If `exclude` lists `test`, remove it.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/config.fixture.ts tsconfig.json
git commit -m "test: add config fixtures"
```

---

### Task 16: ConfigLoaderService — read + parse + zod-validate

**Files:**
- Create: `src/config/config-loader.service.ts`
- Create: `src/config/config-loader.service.spec.ts`
- Create temp test fixture: `test/fixtures/test-config.json`

- [ ] **Step 1: Write failing test**

Create `test/fixtures/test-config.json`:

```json
{
  "bot": { "token": "${TEST_BOT_TOKEN}", "timezone": "Europe/Kyiv" },
  "users": [{
    "telegramId": 123,
    "name": "Test",
    "reminders": [{
      "id": "r1",
      "type": "medication",
      "params": { "name": "X", "dose": "1" },
      "times": ["08:00"]
    }]
  }]
}
```

Create `src/config/config-loader.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { ConfigLoaderService } from './config-loader.service';

const FIXTURE_PATH = path.resolve(__dirname, '../../test/fixtures/test-config.json');

describe('ConfigLoaderService', () => {
  beforeEach(() => {
    process.env.TEST_BOT_TOKEN = 'resolved-test-token';
  });
  afterEach(() => {
    delete process.env.TEST_BOT_TOKEN;
  });

  it('завантажує + валідує + резолвить env-токен', async () => {
    const service = new ConfigLoaderService(FIXTURE_PATH);
    await service.onModuleInit();
    expect(service.get().bot.token).toBe('resolved-test-token');
    expect(service.get().bot.timezone).toBe('Europe/Kyiv');
  });

  it('кидає помилку, якщо файл не знайдено', async () => {
    const service = new ConfigLoaderService('/no/such/file.json');
    await expect(service.onModuleInit()).rejects.toThrow();
  });

  it('кидає помилку, якщо env-змінна не задана', async () => {
    delete process.env.TEST_BOT_TOKEN;
    const service = new ConfigLoaderService(FIXTURE_PATH);
    await expect(service.onModuleInit()).rejects.toThrow(/TEST_BOT_TOKEN/);
  });

  it('кидає помилку при невалідному JSON', async () => {
    const badPath = path.resolve(__dirname, '../../test/fixtures/bad-config.json');
    const fs = await import('node:fs/promises');
    await fs.writeFile(badPath, '{ not valid json');
    try {
      const service = new ConfigLoaderService(badPath);
      await expect(service.onModuleInit()).rejects.toThrow();
    } finally {
      await fs.unlink(badPath);
    }
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/config/config-loader.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/config/config-loader.service.ts`:

```ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfig, configSchema } from './schema';

@Injectable()
export class ConfigLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ConfigLoaderService.name);
  private cachedConfig: AppConfig | null = null;

  constructor(private readonly configPath: string = path.resolve(process.cwd(), 'config.json')) {}

  async onModuleInit(): Promise<void> {
    const raw = await fs.readFile(this.configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const resolved = this.resolveEnvPlaceholders(parsed);
    this.cachedConfig = configSchema.parse(resolved);
    this.logger.log(`Config loaded from ${this.configPath}`);
  }

  get(): AppConfig {
    if (!this.cachedConfig) {
      throw new Error('Config not loaded yet — onModuleInit must run first');
    }
    return this.cachedConfig;
  }

  /** Recursively replace ${ENV_VAR} placeholders in string values. */
  private resolveEnvPlaceholders(value: unknown): unknown {
    if (typeof value === 'string') {
      const match = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(value);
      if (match) {
        const envValue = process.env[match[1]];
        if (envValue === undefined) {
          throw new Error(`Environment variable ${match[1]} is not set`);
        }
        return envValue;
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(item => this.resolveEnvPlaceholders(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, this.resolveEnvPlaceholders(val)]),
      );
    }
    return value;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/config/config-loader.service.spec.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/config-loader.service.ts src/config/config-loader.service.spec.ts test/fixtures/test-config.json
git commit -m "feat(config): add ConfigLoaderService with env placeholder resolution"
```

---

### Task 17: ConfigModule

**Files:**
- Create: `src/config/config.module.ts`

- [ ] **Step 1: Implement**

Create `src/config/config.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigLoaderService } from './config-loader.service';

@Global()
@Module({
  providers: [ConfigLoaderService],
  exports: [ConfigLoaderService],
})
export class ConfigModule {}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/config.module.ts
git commit -m "feat(config): add global ConfigModule"
```

---

### Task 18: ReminderTypeRegistry

**Files:**
- Create: `src/reminders/types/reminder-type.registry.ts`
- Create: `src/reminders/types/reminder-type.registry.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/reminders/types/reminder-type.registry.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ReminderTypeRegistry } from './reminder-type.registry';
import { MedicationHandler } from './medication.handler';

describe('ReminderTypeRegistry', () => {
  let registry: ReminderTypeRegistry;
  let handler: MedicationHandler;

  beforeEach(() => {
    registry = new ReminderTypeRegistry();
    handler = new MedicationHandler();
  });

  it('повертає зареєстрований handler за type', () => {
    registry.register(handler);
    expect(registry.get('medication')).toBe(handler);
  });

  it('кидає помилку для невідомого type', () => {
    expect(() => registry.get('unknown')).toThrow(/No handler for reminder type/);
  });

  it('register другий раз з тим самим type замінює handler', () => {
    registry.register(handler);
    const replacement = new MedicationHandler();
    registry.register(replacement);
    expect(registry.get('medication')).toBe(replacement);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/reminders/types/reminder-type.registry.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/reminders/types/reminder-type.registry.ts`:

```ts
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
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/reminders/types/reminder-type.registry.spec.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reminders/types/reminder-type.registry.ts src/reminders/types/reminder-type.registry.spec.ts
git commit -m "feat(reminders): add ReminderTypeRegistry"
```

---

### Task 19: StateStore

**Files:**
- Create: `src/state/state.store.ts`
- Create: `src/state/state.store.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/state/state.store.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore, ActiveReminder } from './state.store';

const sample: ActiveReminder = {
  fireTs: 1000,
  messageId: 42,
  retryAttempt: 0,
  maxRetries: 3,
  intervalMs: 60_000,
};

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  it('markActive + get повертає те, що записали', () => {
    store.markActive(1, 'r1', sample);
    expect(store.get(1, 'r1')).toEqual(sample);
  });

  it('get для відсутнього ключа повертає undefined', () => {
    expect(store.get(1, 'nope')).toBeUndefined();
  });

  it('update перезаписує існуючий запис', () => {
    store.markActive(1, 'r1', sample);
    store.update(1, 'r1', { ...sample, retryAttempt: 2 });
    expect(store.get(1, 'r1')!.retryAttempt).toBe(2);
  });

  it('clear видаляє запис', () => {
    store.markActive(1, 'r1', sample);
    store.clear(1, 'r1');
    expect(store.get(1, 'r1')).toBeUndefined();
  });

  it('clear для відсутнього ключа — no-op', () => {
    expect(() => store.clear(1, 'never-existed')).not.toThrow();
  });

  it('різні users не перетинаються', () => {
    store.markActive(1, 'r1', sample);
    store.markActive(2, 'r1', { ...sample, messageId: 99 });
    expect(store.get(1, 'r1')!.messageId).toBe(42);
    expect(store.get(2, 'r1')!.messageId).toBe(99);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/state/state.store.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/state/state.store.ts`:

```ts
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
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/state/state.store.spec.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/state.store.ts src/state/state.store.spec.ts
git commit -m "feat(state): add in-memory StateStore"
```

---

### Task 20: StateModule

**Files:**
- Create: `src/state/state.module.ts`

- [ ] **Step 1: Implement**

Create `src/state/state.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { StateStore } from './state.store';

@Module({
  providers: [StateStore],
  exports: [StateStore],
})
export class StateModule {}
```

- [ ] **Step 2: Commit**

```bash
git add src/state/state.module.ts
git commit -m "feat(state): add StateModule"
```

---

### Task 21: reminders/expiry.util.ts — `isReminderExpired`

**Files:**
- Create: `src/reminders/expiry.util.ts`
- Create: `src/reminders/expiry.util.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/reminders/expiry.util.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isReminderExpired } from './expiry.util';
import { buildReminder } from '../../test/fixtures/config.fixture';

describe('isReminderExpired', () => {
  it('повертає false, якщо endDate відсутня', () => {
    const reminder = buildReminder({ endDate: undefined });
    expect(isReminderExpired(reminder, '2030-01-01')).toBe(false);
  });

  it('повертає false, якщо today < endDate', () => {
    const reminder = buildReminder({ endDate: '2026-07-02' });
    expect(isReminderExpired(reminder, '2026-06-26')).toBe(false);
  });

  it('повертає false, якщо today === endDate (inclusive)', () => {
    const reminder = buildReminder({ endDate: '2026-07-02' });
    expect(isReminderExpired(reminder, '2026-07-02')).toBe(false);
  });

  it('повертає true, якщо today > endDate', () => {
    const reminder = buildReminder({ endDate: '2026-07-02' });
    expect(isReminderExpired(reminder, '2026-07-03')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/reminders/expiry.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/reminders/expiry.util.ts`:

```ts
import { Reminder } from '../config/schema';

/**
 * endDate inclusive: повертає true коли today > endDate.
 * Лексикографічне порівняння YYYY-MM-DD працює коректно завдяки сортувальному формату.
 */
export const isReminderExpired = (reminder: Reminder, todayIso: string): boolean => {
  if (!reminder.endDate) {
    return false;
  }
  return todayIso > reminder.endDate;
};
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/reminders/expiry.util.spec.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reminders/expiry.util.ts src/reminders/expiry.util.spec.ts
git commit -m "feat(reminders): add isReminderExpired pure helper"
```

---

### Task 22: BotGateway interface + token

**Files:**
- Create: `src/bot/bot.gateway.ts`

No test — це абстракція з заглушкою. Реальна імплементація буде у Task 33.

- [ ] **Step 1: Implement contract**

Create `src/bot/bot.gateway.ts`:

```ts
import { InlineButton } from '../reminders/types/reminder-type.interface';

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface SentMessage {
  message_id: number;
}

export const BOT_GATEWAY = Symbol('BOT_GATEWAY');

export interface BotGateway {
  send(userId: number, text: string, buttons: InlineKeyboardButton[]): Promise<SentMessage>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/bot/bot.gateway.ts
git commit -m "feat(bot): add BotGateway interface + DI token"
```

---

### Task 23: SchedulerService — `fire()` (без cron registration)

**Files:**
- Create: `src/reminders/scheduler.service.ts`
- Create: `src/reminders/scheduler.service.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/reminders/scheduler.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { StateStore } from '../state/state.store';
import { RepeatEngineService } from './repeat-engine.service';
import { ReminderTypeRegistry } from './types/reminder-type.registry';
import { MedicationHandler } from './types/medication.handler';
import { ConfigLoaderService } from '../config/config-loader.service';
import { BOT_GATEWAY } from '../bot/bot.gateway';
import { buildConfig, buildReminder } from '../../test/fixtures/config.fixture';

describe('SchedulerService.fire', () => {
  let scheduler: SchedulerService;
  let state: StateStore;
  let repeat: { scheduleNext: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
  let bot: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    bot = { send: vi.fn().mockResolvedValue({ message_id: 42 }) };
    repeat = { scheduleNext: vi.fn(), cancel: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchedulerService,
        StateStore,
        ReminderTypeRegistry,
        MedicationHandler,
        { provide: RepeatEngineService, useValue: repeat },
        { provide: BOT_GATEWAY, useValue: bot },
        { provide: ConfigLoaderService, useValue: { get: () => buildConfig() } },
        { provide: SchedulerRegistry, useValue: { addCronJob: vi.fn() } },
      ],
    }).compile();

    scheduler = moduleRef.get(SchedulerService);
    state = moduleRef.get(StateStore);
    moduleRef.get(ReminderTypeRegistry).register(moduleRef.get(MedicationHandler));
  });

  it('пропускає fire, якщо reminder expired', async () => {
    const reminder = buildReminder({ endDate: '2000-01-01' });
    await scheduler.fire(123, reminder);

    expect(bot.send).not.toHaveBeenCalled();
    expect(state.get(123, reminder.id)).toBeUndefined();
  });

  it('викликає bot.send і markActive для свіжого reminder', async () => {
    const reminder = buildReminder({
      id: 'r1',
      repeat: { intervalMin: 15, maxRetries: 3 },
    });

    await scheduler.fire(123, reminder);

    expect(bot.send).toHaveBeenCalledOnce();
    const active = state.get(123, 'r1');
    expect(active).toBeDefined();
    expect(active!.messageId).toBe(42);
    expect(active!.retryAttempt).toBe(0);
    expect(active!.maxRetries).toBe(3);
    expect(active!.intervalMs).toBe(15 * 60_000);
  });

  it('викликає repeat.scheduleNext, якщо reminder має repeat', async () => {
    const reminder = buildReminder({
      id: 'r1',
      repeat: { intervalMin: 15, maxRetries: 3 },
    });

    await scheduler.fire(123, reminder);

    expect(repeat.scheduleNext).toHaveBeenCalledWith(123, reminder);
  });

  it('НЕ викликає scheduleNext, якщо repeat відсутній', async () => {
    const reminder = buildReminder({ id: 'r1' });
    delete (reminder as any).repeat;

    await scheduler.fire(123, reminder);

    expect(repeat.scheduleNext).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/reminders/scheduler.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/reminders/scheduler.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Reminder } from '../config/schema';
import { ConfigLoaderService } from '../config/config-loader.service';
import { BOT_GATEWAY, BotGateway, InlineKeyboardButton } from '../bot/bot.gateway';
import { StateStore } from '../state/state.store';
import { ReminderTypeRegistry } from './types/reminder-type.registry';
import { RepeatEngineService } from './repeat-engine.service';
import { InlineButton } from './types/reminder-type.interface';
import { isReminderExpired } from './expiry.util';
import { formatInTimezone } from '../shared/time.util';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly config: ConfigLoaderService,
    private readonly registry: ReminderTypeRegistry,
    private readonly state: StateStore,
    private readonly repeat: RepeatEngineService,
    @Inject(BOT_GATEWAY) private readonly bot: BotGateway,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  async fire(userId: number, reminder: Reminder): Promise<void> {
    const timezone = this.config.get().bot.timezone;
    const today = formatInTimezone(new Date(), timezone, 'yyyy-MM-dd');
    if (isReminderExpired(reminder, today)) {
      this.logger.log(`Reminder ${reminder.id} expired (today=${today}, endDate=${reminder.endDate}) — skipping`);
      return;
    }

    const fireTs = Date.now();
    const handler = this.registry.get(reminder.type);
    const { text, buttons } = handler.buildMessage(reminder.params, {
      reminderId: reminder.id,
      fireTimestamp: fireTs,
      retryAttempt: 0,
    });

    const message = await this.bot.send(
      userId,
      text,
      this.toTelegramButtons(buttons, userId, reminder.id, fireTs),
    );

    this.state.markActive(userId, reminder.id, {
      fireTs,
      messageId: message.message_id,
      retryAttempt: 0,
      maxRetries: reminder.repeat?.maxRetries ?? 0,
      intervalMs: (reminder.repeat?.intervalMin ?? 0) * 60_000,
    });

    if (reminder.repeat) {
      this.repeat.scheduleNext(userId, reminder);
    }
  }

  private toTelegramButtons(
    buttons: InlineButton[],
    userId: number,
    reminderId: string,
    fireTs: number,
  ): InlineKeyboardButton[] {
    return buttons.map(button => ({
      text: button.text,
      callback_data: `ack:${userId}:${reminderId}:${fireTs}`,
    }));
  }
}
```

Also pre-create empty stub for `repeat-engine.service.ts` so DI compiles (we implement it in Task 25):

Create `src/reminders/repeat-engine.service.ts`:

```ts
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
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/reminders/scheduler.service.spec.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reminders/scheduler.service.ts src/reminders/scheduler.service.spec.ts src/reminders/repeat-engine.service.ts
git commit -m "feat(reminders): add SchedulerService.fire (with RepeatEngine stub)"
```

---

### Task 24: SchedulerService — `onApplicationBootstrap` (cron registration)

**Files:**
- Modify: `src/reminders/scheduler.service.ts`
- Modify: `src/reminders/scheduler.service.spec.ts`

- [ ] **Step 1: Add failing test**

Append to `src/reminders/scheduler.service.spec.ts`:

```ts
describe('SchedulerService.onApplicationBootstrap', () => {
  it('реєструє по одному cron-job на кожен (user, reminder, time)', async () => {
    const addCronJob = vi.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchedulerService,
        StateStore,
        ReminderTypeRegistry,
        MedicationHandler,
        { provide: RepeatEngineService, useValue: { scheduleNext: vi.fn(), cancel: vi.fn() } },
        { provide: BOT_GATEWAY, useValue: { send: vi.fn() } },
        {
          provide: ConfigLoaderService,
          useValue: {
            get: () => buildConfig({
              users: [{
                telegramId: 1,
                name: 'A',
                reminders: [
                  buildReminder({ id: 'r1', times: ['08:00', '20:00'] }),
                  buildReminder({ id: 'r2', times: ['12:00'] }),
                ],
              }],
            }),
          },
        },
        { provide: SchedulerRegistry, useValue: { addCronJob } },
      ],
    }).compile();

    moduleRef.get(ReminderTypeRegistry).register(moduleRef.get(MedicationHandler));
    moduleRef.get(SchedulerService).onApplicationBootstrap();

    expect(addCronJob).toHaveBeenCalledTimes(3);
    const jobNames = addCronJob.mock.calls.map(call => call[0]);
    expect(jobNames).toEqual(['1:r1:08:00', '1:r1:20:00', '1:r2:12:00']);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/reminders/scheduler.service.spec.ts`
Expected: new test fails — `onApplicationBootstrap is not a function`.

- [ ] **Step 3: Implement**

Add to `src/reminders/scheduler.service.ts`:

```ts
import { OnApplicationBootstrap } from '@nestjs/common';
import { CronJob } from 'cron';
import { expandSchedule, ScheduledSlot } from '../config/schema';
```

Modify the class to implement `OnApplicationBootstrap`:

```ts
export class SchedulerService implements OnApplicationBootstrap {
  // ... existing constructor and methods ...

  onApplicationBootstrap(): void {
    const { bot, users } = this.config.get();
    const slots = expandSchedule(users);
    slots.forEach(slot => this.registerCron(slot, bot.timezone));
    this.logger.log(`Scheduled ${slots.length} reminder slots`);
  }

  private registerCron(slot: ScheduledSlot, timezone: string): void {
    const [hh, mm] = slot.time.split(':');
    const cronExpr = `${mm} ${hh} * * *`;
    const jobName = `${slot.userId}:${slot.reminder.id}:${slot.time}`;

    const job = new CronJob(
      cronExpr,
      () => { void this.fire(slot.userId, slot.reminder); },
      null,
      true,
      timezone,
    );
    this.schedulerRegistry.addCronJob(jobName, job);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/reminders/scheduler.service.spec.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reminders/scheduler.service.ts src/reminders/scheduler.service.spec.ts
git commit -m "feat(reminders): register cron jobs on application bootstrap"
```

---

### Task 25: RepeatEngineService — `scheduleNext` + `cancel`

**Files:**
- Modify: `src/reminders/repeat-engine.service.ts`
- Create: `src/reminders/repeat-engine.service.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/reminders/repeat-engine.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { RepeatEngineService } from './repeat-engine.service';
import { StateStore } from '../state/state.store';
import { ReminderTypeRegistry } from './types/reminder-type.registry';
import { MedicationHandler } from './types/medication.handler';
import { BOT_GATEWAY } from '../bot/bot.gateway';
import { buildReminder } from '../../test/fixtures/config.fixture';

describe('RepeatEngineService', () => {
  let engine: RepeatEngineService;
  let state: StateStore;
  let bot: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.useFakeTimers();
    bot = { send: vi.fn().mockResolvedValue({ message_id: 99 }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RepeatEngineService,
        StateStore,
        ReminderTypeRegistry,
        MedicationHandler,
        { provide: BOT_GATEWAY, useValue: bot },
      ],
    }).compile();

    engine = moduleRef.get(RepeatEngineService);
    state = moduleRef.get(StateStore);
    moduleRef.get(ReminderTypeRegistry).register(moduleRef.get(MedicationHandler));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('викликає bot.send через intervalMs і збільшує retryAttempt', async () => {
    const reminder = buildReminder({ id: 'r1', repeat: { intervalMin: 15, maxRetries: 3 } });
    state.markActive(123, 'r1', {
      fireTs: Date.now(),
      messageId: 1,
      retryAttempt: 0,
      maxRetries: 3,
      intervalMs: 15 * 60_000,
    });

    engine.scheduleNext(123, reminder);
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(bot.send).toHaveBeenCalledOnce();
    expect(state.get(123, 'r1')!.retryAttempt).toBe(1);
    expect(state.get(123, 'r1')!.messageId).toBe(99);
  });

  it('не викликає bot.send, якщо state.get → undefined (acked у вікно)', async () => {
    const reminder = buildReminder({ id: 'r1', repeat: { intervalMin: 1, maxRetries: 3 } });
    state.markActive(123, 'r1', {
      fireTs: Date.now(),
      messageId: 1,
      retryAttempt: 0,
      maxRetries: 3,
      intervalMs: 60_000,
    });

    engine.scheduleNext(123, reminder);
    state.clear(123, 'r1');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(bot.send).not.toHaveBeenCalled();
  });

  it('зупиняється на maxRetries і очищує state', async () => {
    const reminder = buildReminder({ id: 'r1', repeat: { intervalMin: 1, maxRetries: 3 } });
    state.markActive(123, 'r1', {
      fireTs: Date.now(),
      messageId: 1,
      retryAttempt: 3,
      maxRetries: 3,
      intervalMs: 60_000,
    });

    engine.scheduleNext(123, reminder);

    expect(state.get(123, 'r1')).toBeUndefined();
  });

  it('cancel відміняє запланований повтор', async () => {
    const reminder = buildReminder({ id: 'r1', repeat: { intervalMin: 1, maxRetries: 3 } });
    state.markActive(123, 'r1', {
      fireTs: Date.now(),
      messageId: 1,
      retryAttempt: 0,
      maxRetries: 3,
      intervalMs: 60_000,
    });

    engine.scheduleNext(123, reminder);
    engine.cancel(123, 'r1');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(bot.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/reminders/repeat-engine.service.spec.ts`
Expected: FAIL — `not implemented` errors.

- [ ] **Step 3: Implement**

Replace contents of `src/reminders/repeat-engine.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Reminder } from '../config/schema';
import { StateStore } from '../state/state.store';
import { ReminderTypeRegistry } from './types/reminder-type.registry';
import { BOT_GATEWAY, BotGateway, InlineKeyboardButton } from '../bot/bot.gateway';
import { InlineButton } from './types/reminder-type.interface';

@Injectable()
export class RepeatEngineService {
  private readonly logger = new Logger(RepeatEngineService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly state: StateStore,
    private readonly registry: ReminderTypeRegistry,
    @Inject(BOT_GATEWAY) private readonly bot: BotGateway,
  ) {}

  scheduleNext(userId: number, reminder: Reminder): void {
    const key = `${userId}:${reminder.id}`;
    this.clearTimer(key);

    const active = this.state.get(userId, reminder.id);
    if (!active) {
      return;
    }
    if (active.retryAttempt >= active.maxRetries) {
      this.logger.warn(`Max retries reached: ${key}`);
      this.state.clear(userId, reminder.id);
      return;
    }

    const timer = setTimeout(
      () => { void this.fireRetry(userId, reminder); },
      active.intervalMs,
    );
    this.timers.set(key, timer);
  }

  cancel(userId: number, reminderId: string): void {
    this.clearTimer(`${userId}:${reminderId}`);
  }

  private async fireRetry(userId: number, reminder: Reminder): Promise<void> {
    const active = this.state.get(userId, reminder.id);
    if (!active) {
      return;
    }

    const nextAttempt = active.retryAttempt + 1;
    const handler = this.registry.get(reminder.type);
    const { text, buttons } = handler.buildMessage(reminder.params, {
      reminderId: reminder.id,
      fireTimestamp: active.fireTs,
      retryAttempt: nextAttempt,
    });

    const message = await this.bot.send(
      userId,
      text,
      this.toTelegramButtons(buttons, userId, reminder.id, active.fireTs),
    );

    this.state.update(userId, reminder.id, {
      ...active,
      retryAttempt: nextAttempt,
      messageId: message.message_id,
    });

    this.scheduleNext(userId, reminder);
  }

  private toTelegramButtons(
    buttons: InlineButton[],
    userId: number,
    reminderId: string,
    fireTs: number,
  ): InlineKeyboardButton[] {
    return buttons.map(button => ({
      text: button.text,
      callback_data: `ack:${userId}:${reminderId}:${fireTs}`,
    }));
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
    }
    this.timers.delete(key);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/reminders/repeat-engine.service.spec.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reminders/repeat-engine.service.ts src/reminders/repeat-engine.service.spec.ts
git commit -m "feat(reminders): implement RepeatEngineService (scheduleNext, cancel, fireRetry)"
```

---

### Task 26: RemindersModule

**Files:**
- Create: `src/reminders/reminders.module.ts`

- [ ] **Step 1: Implement**

Create `src/reminders/reminders.module.ts`:

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/reminders/reminders.module.ts
git commit -m "feat(reminders): add RemindersModule wiring handlers via registry"
```

---

### Task 27: AuthGuard

**Files:**
- Create: `src/bot/auth.guard.ts`
- Create: `src/bot/auth.guard.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/bot/auth.guard.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { buildConfig } from '../../test/fixtures/config.fixture';

const makeContext = (fromId: number | undefined) => {
  const reply = vi.fn();
  const ctx = {
    from: fromId !== undefined ? { id: fromId } : undefined,
    reply,
  };
  const executionContext = {
    getArgByIndex: (idx: number) => (idx === 0 ? ctx : undefined),
    getType: () => 'telegraf',
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, executionContext, reply };
};

describe('AuthGuard', () => {
  let guard: AuthGuard;

  beforeEach(() => {
    const config = { get: () => buildConfig({ users: [{ telegramId: 999, name: 'A', reminders: [] }] }) };
    guard = new AuthGuard(config as any);
  });

  it('пропускає whitelisted користувача', async () => {
    const { executionContext } = makeContext(999);
    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
  });

  it('відмовляє і відповідає не-whitelisted', async () => {
    const { executionContext, reply } = makeContext(111);
    await expect(guard.canActivate(executionContext)).resolves.toBe(false);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('не маєте доступу'));
  });

  it('відмовляє при відсутньому ctx.from', async () => {
    const { executionContext } = makeContext(undefined);
    await expect(guard.canActivate(executionContext)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/bot/auth.guard.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/bot/auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { TelegrafExecutionContext } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { ConfigLoaderService } from '../config/config-loader.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly config: ConfigLoaderService) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const telegrafContext = TelegrafExecutionContext
      .create(executionContext)
      .getContext<Context>();

    const senderId = telegrafContext.from?.id;
    if (!senderId) {
      return false;
    }

    const whitelist = this.config.get().users.map(user => user.telegramId);
    const isAllowed = whitelist.includes(senderId);

    if (!isAllowed) {
      this.logger.warn(`Unauthorized access attempt from telegramId=${senderId}`);
      await telegrafContext.reply('⛔ У вас немає доступу до цього бота.');
    }

    return isAllowed;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/bot/auth.guard.spec.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/bot/auth.guard.ts src/bot/auth.guard.spec.ts
git commit -m "feat(bot): add AuthGuard with whitelist by telegramId"
```

---

### Task 28: StartCommand

**Files:**
- Create: `src/bot/commands/start.command.ts`
- Create: `src/bot/commands/start.command.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/bot/commands/start.command.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { StartCommand } from './start.command';
import { buildConfig } from '../../../test/fixtures/config.fixture';

describe('StartCommand.onStart', () => {
  it('відповідає привітанням з імʼям з конфігу', async () => {
    const reply = vi.fn();
    const ctx = { from: { id: 123 }, reply } as any;

    const config = { get: () => buildConfig({ users: [{ telegramId: 123, name: 'Igor', reminders: [] }] }) };
    const command = new StartCommand(config as any);

    await command.onStart(ctx);

    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain('Igor');
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/bot/commands/start.command.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/bot/commands/start.command.ts`:

```ts
import { UseGuards } from '@nestjs/common';
import { Ctx, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { AuthGuard } from '../auth.guard';
import { ConfigLoaderService } from '../../config/config-loader.service';

@Update()
@UseGuards(AuthGuard)
export class StartCommand {
  constructor(private readonly config: ConfigLoaderService) {}

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    const senderId = ctx.from!.id;
    const user = this.config.get().users.find(
      candidate => candidate.telegramId === senderId,
    );

    await ctx.reply(
      `Привіт, ${user!.name}! 👋\n` +
      `Я надсилатиму нагадування за розкладом.\n` +
      `Команда /next покаже список на сьогодні.`,
    );
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/bot/commands/start.command.spec.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/start.command.ts src/bot/commands/start.command.spec.ts
git commit -m "feat(bot): add /start command"
```

---

### Task 29: next.logic.ts — `collectTodaysSlots` + `renderSection`

**Files:**
- Create: `src/bot/commands/next.logic.ts`
- Create: `src/bot/commands/next.logic.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/bot/commands/next.logic.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { collectTodaysSlots, renderSection } from './next.logic';
import { buildReminder } from '../../../test/fixtures/config.fixture';

describe('collectTodaysSlots', () => {
  it('розгортає reminders у плоский, сортований за часом список', () => {
    const reminders = [
      buildReminder({ id: 'a', times: ['20:00', '08:00'] }),
      buildReminder({ id: 'b', times: ['14:00'] }),
    ];
    const slots = collectTodaysSlots(reminders, '2026-06-26');
    expect(slots.map(slot => `${slot.reminder.id}@${slot.time}`)).toEqual([
      'a@08:00',
      'b@14:00',
      'a@20:00',
    ]);
  });

  it('фільтрує expired reminder за endDate', () => {
    const reminders = [
      buildReminder({ id: 'a', endDate: '2026-06-25', times: ['08:00'] }),
      buildReminder({ id: 'b', endDate: '2026-06-26', times: ['09:00'] }),
      buildReminder({ id: 'c', times: ['10:00'] }),
    ];
    const slots = collectTodaysSlots(reminders, '2026-06-26');
    expect(slots.map(slot => slot.reminder.id)).toEqual(['b', 'c']);
  });
});

describe('renderSection', () => {
  it('повертає null для порожнього списку', () => {
    expect(renderSection('Title', [], () => 'summary')).toBeNull();
  });

  it('форматує заголовок + рядки', () => {
    const slots = [
      { reminder: buildReminder({ id: 'r1' }), time: '08:00' },
      { reminder: buildReminder({ id: 'r2' }), time: '20:00' },
    ];
    const result = renderSection('Title', slots, slot => `summary-${slot.reminder.id}`);
    expect(result).toBe('Title\n• 08:00 — summary-r1\n• 20:00 — summary-r2');
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/bot/commands/next.logic.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/bot/commands/next.logic.ts`:

```ts
import { Reminder } from '../../config/schema';
import { isReminderExpired } from '../../reminders/expiry.util';

export interface Slot {
  reminder: Reminder;
  time: string;
}

export const collectTodaysSlots = (reminders: Reminder[], todayIso: string): Slot[] => {
  return reminders
    .filter(reminder => !isReminderExpired(reminder, todayIso))
    .map(reminder => reminder.times.map(time => ({ reminder, time })))
    .flat()
    .sort((left, right) => left.time.localeCompare(right.time));
};

export const renderSection = (
  title: string,
  slots: Slot[],
  summaryOf: (slot: Slot) => string,
): string | null => {
  if (slots.length === 0) {
    return null;
  }
  const lines = slots.map(slot => `• ${slot.time} — ${summaryOf(slot)}`);
  return `${title}\n${lines.join('\n')}`;
};
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/bot/commands/next.logic.spec.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/next.logic.ts src/bot/commands/next.logic.spec.ts
git commit -m "feat(bot): add collectTodaysSlots + renderSection pure helpers"
```

---

### Task 30: NextCommand

**Files:**
- Create: `src/bot/commands/next.command.ts`
- Create: `src/bot/commands/next.command.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/bot/commands/next.command.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextCommand } from './next.command';
import { ReminderTypeRegistry } from '../../reminders/types/reminder-type.registry';
import { MedicationHandler } from '../../reminders/types/medication.handler';
import { buildConfig, buildReminder } from '../../../test/fixtures/config.fixture';

describe('NextCommand.onNext', () => {
  let registry: ReminderTypeRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-26T10:00:00.000Z')); // 13:00 у Києві (літо UTC+3)
    registry = new ReminderTypeRegistry();
    registry.register(new MedicationHandler());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('виводить past і upcoming окремими секціями', async () => {
    const reply = vi.fn();
    const ctx = { from: { id: 1 }, reply } as any;

    const config = {
      get: () => buildConfig({
        users: [{
          telegramId: 1,
          name: 'A',
          reminders: [
            buildReminder({ id: 'r1', params: { name: 'Vit D', dose: '1' } as any, times: ['08:00', '20:00'] }),
          ],
        }],
      }),
    };

    const command = new NextCommand(config as any, registry);
    await command.onNext(ctx);

    const message = reply.mock.calls[0][0] as string;
    expect(message).toContain('Вже минули');
    expect(message).toContain('08:00');
    expect(message).toContain('Ще будуть');
    expect(message).toContain('20:00');
  });

  it('повертає "немає нагадувань", якщо список порожній', async () => {
    const reply = vi.fn();
    const ctx = { from: { id: 1 }, reply } as any;

    const config = {
      get: () => buildConfig({
        users: [{ telegramId: 1, name: 'A', reminders: [] }],
      }),
    };

    const command = new NextCommand(config as any, registry);
    await command.onNext(ctx);

    expect(reply.mock.calls[0][0]).toContain('немає');
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/bot/commands/next.command.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/bot/commands/next.command.ts`:

```ts
import { UseGuards } from '@nestjs/common';
import { Command, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { AuthGuard } from '../auth.guard';
import { ConfigLoaderService } from '../../config/config-loader.service';
import { ReminderTypeRegistry } from '../../reminders/types/reminder-type.registry';
import { formatInTimezone } from '../../shared/time.util';
import { Slot, collectTodaysSlots, renderSection } from './next.logic';

@Update()
@UseGuards(AuthGuard)
export class NextCommand {
  constructor(
    private readonly config: ConfigLoaderService,
    private readonly registry: ReminderTypeRegistry,
  ) {}

  @Command('next')
  async onNext(@Ctx() ctx: Context): Promise<void> {
    const senderId = ctx.from!.id;
    const config = this.config.get();
    const user = config.users.find(candidate => candidate.telegramId === senderId)!;

    const today = formatInTimezone(new Date(), config.bot.timezone, 'yyyy-MM-dd');
    const currentTime = formatInTimezone(new Date(), config.bot.timezone, 'HH:mm');

    const slots = collectTodaysSlots(user.reminders, today);
    const past = slots.filter(slot => slot.time < currentTime);
    const upcoming = slots.filter(slot => slot.time >= currentTime);

    const summaryOf = (slot: Slot) => {
      const handler = this.registry.get(slot.reminder.type);
      return handler.buildSummary(slot.reminder.params);
    };

    const sections = [
      renderSection('✅ *Вже минули:*', past, summaryOf),
      renderSection('⏰ *Ще будуть:*', upcoming, summaryOf),
    ].filter((section): section is string => section !== null);

    const message = sections.length === 0
      ? '📭 На сьогодні нагадувань немає.'
      : `📋 *Нагадування на сьогодні (${currentTime}):*\n\n${sections.join('\n\n')}`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/bot/commands/next.command.spec.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/next.command.ts src/bot/commands/next.command.spec.ts
git commit -m "feat(bot): add /next command with past/upcoming split"
```

---

### Task 31: AckAction

**Files:**
- Create: `src/bot/actions/ack.action.ts`
- Create: `src/bot/actions/ack.action.spec.ts`

- [ ] **Step 1: Write failing test**

Create `src/bot/actions/ack.action.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AckAction } from './ack.action';
import { StateStore } from '../../state/state.store';

describe('AckAction.onAck', () => {
  let state: StateStore;
  let repeat: { cancel: ReturnType<typeof vi.fn> };
  let action: AckAction;

  beforeEach(() => {
    state = new StateStore();
    repeat = { cancel: vi.fn() };
    action = new AckAction(state, repeat as any);
  });

  it('викликає cancel + clear для активного нагадування', async () => {
    state.markActive(123, 'r1', {
      fireTs: 0, messageId: 1, retryAttempt: 0, maxRetries: 3, intervalMs: 60_000,
    });

    const answerCbQuery = vi.fn();
    const editMessageReplyMarkup = vi.fn();
    const ctx = {
      match: ['ack:123:r1:1000', '123', 'r1', '1000'],
      answerCbQuery,
      editMessageReplyMarkup,
    } as any;

    await action.onAck(ctx);

    expect(repeat.cancel).toHaveBeenCalledWith(123, 'r1');
    expect(state.get(123, 'r1')).toBeUndefined();
    expect(answerCbQuery).toHaveBeenCalledWith('Зафіксовано ✅');
    expect(editMessageReplyMarkup).toHaveBeenCalled();
  });

  it('повертає "Вже зафіксовано" для idempotent повтору', async () => {
    const answerCbQuery = vi.fn();
    const editMessageReplyMarkup = vi.fn();
    const ctx = {
      match: ['ack:123:r1:1000', '123', 'r1', '1000'],
      answerCbQuery,
      editMessageReplyMarkup,
    } as any;

    await action.onAck(ctx);

    expect(answerCbQuery).toHaveBeenCalledWith('Вже зафіксовано');
  });

  it('тихо ігнорує помилку editMessageReplyMarkup', async () => {
    const ctx = {
      match: ['ack:123:r1:1000', '123', 'r1', '1000'],
      answerCbQuery: vi.fn(),
      editMessageReplyMarkup: vi.fn().mockRejectedValue(new Error('message is not modified')),
    } as any;

    await expect(action.onAck(ctx)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx vitest run src/bot/actions/ack.action.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/bot/actions/ack.action.ts`:

```ts
import { Logger, UseGuards } from '@nestjs/common';
import { Action, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { AuthGuard } from '../auth.guard';
import { StateStore } from '../../state/state.store';
import { RepeatEngineService } from '../../reminders/repeat-engine.service';

@Update()
@UseGuards(AuthGuard)
export class AckAction {
  private readonly logger = new Logger(AckAction.name);

  constructor(
    private readonly state: StateStore,
    private readonly repeat: RepeatEngineService,
  ) {}

  @Action(/^ack:(\d+):([^:]+):(\d+)$/)
  async onAck(@Ctx() ctx: Context & { match: RegExpExecArray }): Promise<void> {
    const [, userIdRaw, reminderId] = ctx.match;
    const userId = Number(userIdRaw);

    const wasActive = this.state.get(userId, reminderId) !== undefined;
    this.repeat.cancel(userId, reminderId);
    this.state.clear(userId, reminderId);

    await ctx.answerCbQuery(wasActive ? 'Зафіксовано ✅' : 'Вже зафіксовано');

    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (error) {
      this.logger.debug({ err: error }, 'editMessageReplyMarkup ignored');
    }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/bot/actions/ack.action.spec.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/bot/actions/ack.action.ts src/bot/actions/ack.action.spec.ts
git commit -m "feat(bot): add AckAction with idempotent handling"
```

---

### Task 32: BotGateway implementation (TelegrafBotGateway)

**Files:**
- Create: `src/bot/telegraf-bot.gateway.ts`

No unit test — це обгортка над Telegraf. Smoke перевіримо вручну у Task 38.

- [ ] **Step 1: Implement**

Create `src/bot/telegraf-bot.gateway.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { BotGateway, InlineKeyboardButton, SentMessage } from './bot.gateway';

@Injectable()
export class TelegrafBotGateway implements BotGateway {
  constructor(@InjectBot() private readonly bot: Telegraf) {}

  async send(
    userId: number,
    text: string,
    buttons: InlineKeyboardButton[],
  ): Promise<SentMessage> {
    const message = await this.bot.telegram.sendMessage(userId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [buttons],
      },
    });
    return { message_id: message.message_id };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/bot/telegraf-bot.gateway.ts
git commit -m "feat(bot): add Telegraf-backed BotGateway implementation"
```

---

### Task 33: BotModule

**Files:**
- Create: `src/bot/bot.module.ts`

- [ ] **Step 1: Implement**

Create `src/bot/bot.module.ts`:

```ts
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
      useFactory: (config: ConfigLoaderService) => ({
        token: config.get().bot.token,
      }),
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
```

- [ ] **Step 2: Commit**

```bash
git add src/bot/bot.module.ts
git commit -m "feat(bot): add BotModule wiring Telegraf, commands, actions"
```

---

### Task 34: AppModule + main.ts wiring

**Files:**
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Wire AppModule**

Replace `src/app.module.ts`:

```ts
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
```

- [ ] **Step 2: Wire main.ts**

Replace `src/main.ts`:

```ts
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

bootstrap();
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app.module.ts src/main.ts
git commit -m "feat: wire AppModule and bootstrap with logger + error handlers"
```

---

### Task 35: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: всі тести проходять, 0 fails.

- [ ] **Step 2: If anything fails — fix the source of the failure**

Не комітьте «зеленяк через зміну тесту». Якщо тест ламається — або реалізація не відповідає дизайну, або тест неправильний. Виправити **корінь**, не симптом.

- [ ] **Step 3: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: ensure full suite green"
```

(якщо нічого не змінилось — пропустіть)

---

### Task 36: .env.example, .gitignore, config.example.json

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `config.example.json`

- [ ] **Step 1: Create .env.example**

Create `.env.example`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
LOG_LEVEL=info
NODE_ENV=development
```

- [ ] **Step 2: Update .gitignore**

Append to `.gitignore` (it was created by `nest new`):

```
.env
config.json
```

- [ ] **Step 3: Create config.example.json**

Create `config.example.json`:

```json
{
  "bot": {
    "token": "${TELEGRAM_BOT_TOKEN}",
    "timezone": "Europe/Kyiv"
  },
  "users": [
    {
      "telegramId": 0,
      "name": "Your Name",
      "reminders": [
        {
          "id": "morning-vitamin-d",
          "type": "medication",
          "params": {
            "name": "Вітамін D",
            "dose": "1 таблетка",
            "withFood": true
          },
          "times": ["08:00", "20:00"],
          "repeat": {
            "intervalMin": 15,
            "maxRetries": 3
          }
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add .env.example .gitignore config.example.json
git commit -m "docs: add .env.example, config.example.json, ignore secrets"
```

---

### Task 37: README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Create `README.md`:

```markdown
# Telegram Reminder Bot

Локально-запускаємий Telegram-бот на NestJS, що надсилає нагадування за JSON-конфігом. Перший use case — нагадування про прийом ліків з підтвердженням і повторами.

## Швидкий старт

1. **Створити бот** через [@BotFather](https://t.me/BotFather) → отримати токен.
2. **Дізнатись свій `telegramId`** — написати [@userinfobot](https://t.me/userinfobot).
3. **Установити залежності:**
   ```bash
   npm install
   ```
4. **Налаштувати:**
   ```bash
   cp .env.example .env             # вписати TELEGRAM_BOT_TOKEN
   cp config.example.json config.json   # вписати свій telegramId та reminders
   ```
5. **Запустити:**
   ```bash
   npm run start:dev
   ```
6. **Перевірити у Telegram:** `/start` → отримати привітання; `/next` → побачити розклад на сьогодні; чекати найближчого `time` — мають прийти inline-кнопки.

## Команди боту

- `/start` — перевірка авторизації + привітання
- `/next` — список нагадувань на сьогодні (поділених на «вже минули» / «ще будуть»)

## Структура конфігу

Див. [`config.example.json`](./config.example.json) і повний дизайн у [`docs/superpowers/specs/2026-06-26-telegram-reminder-bot-design.md`](./docs/superpowers/specs/2026-06-26-telegram-reminder-bot-design.md).

Ключові поля reminder:
- `id` — унікальний рядок у межах користувача
- `type` — `medication` (наразі єдиний; розширюється через plugin handlers)
- `params` — типозалежні параметри (для medication: `name`, `dose`, опційно `withFood`)
- `times` — масив `"HH:mm"` (часовий пояс з `bot.timezone`)
- `endDate` (опційно) — `YYYY-MM-DD` inclusive, останній день курсу
- `repeat` (опційно) — `{ intervalMin, maxRetries }`

## Розробка

```bash
npm run start:dev        # запуск з watch-mode
npm test                 # vitest run
npm run test:watch       # vitest watch-mode
npm run test:cov         # coverage report
npm run lint             # eslint --fix
npm run build            # compile to dist/
```

## Особливості реалізації

- **State лише in-memory.** Активні непідтверджені нагадування зберігаються у `Map`. При рестарті процесу — очищується. Нові повтори стартують з наступного запланованого `times`.
- **Plugin-based reminder types.** Додати новий тип = (1) реалізувати `ReminderTypeHandler`, (2) додати до `RemindersModule.providers` + register у `OnModuleInit`, (3) додати у discriminated union в `config/schema.ts`.
- **Авторизація.** Whitelist за `telegramId` з конфігу. Не-whitelisted отримує відмову.

## Дизайн

Повний дизайн-документ і діаграми: [`docs/superpowers/specs/`](./docs/superpowers/specs/).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with quick-start and structure"
```

---

### Task 38: Manual smoke test (the last step)

This task is **not automated** — it verifies the entire system end-to-end via real Telegram.

- [ ] **Step 1: Create a bot and get token**

Via [@BotFather](https://t.me/BotFather).

- [ ] **Step 2: Configure**

```bash
cp .env.example .env
# edit .env: set real TELEGRAM_BOT_TOKEN
cp config.example.json config.json
# edit config.json: set your real telegramId, set times to a moment soon (e.g., 2 minutes ahead)
```

- [ ] **Step 3: Run the bot**

```bash
npm run start:dev
```

Expect log: `Scheduled N reminder slots` і `Telegram Reminder Bot started`.

- [ ] **Step 4: Verify `/start`**

In Telegram chat with your bot send `/start`. You should get the welcome message with your `name` from config.

- [ ] **Step 5: Verify `/next`**

Send `/next`. You should see a message with two possible sections («Вже минули» / «Ще будуть») depending on current time.

- [ ] **Step 6: Verify scheduled fire**

Wait until the configured time. You should receive a Markdown reminder with «✅ Прийняв» button.

- [ ] **Step 7: Verify ack**

Click the button. You should see «Зафіксовано ✅» popup. The button should disappear.

- [ ] **Step 8: Verify retry (optional)**

Set a reminder with `repeat: { intervalMin: 1, maxRetries: 2 }` and a `time` 1-2 minutes away. Do **not** click the button. You should receive 2 more reminders, one minute apart. After the 3rd (initial + 2 retries) — no more.

- [ ] **Step 9: Verify unauthorized rejection**

From a different Telegram account (not in `config.json`) send `/start`. You should get `⛔ У вас немає доступу до цього бота.`

- [ ] **Step 10: Document any issues**

If anything diverges from expected — open `docs/superpowers/specs/2026-06-26-telegram-reminder-bot-design.md` and confirm whether it's a bug or a spec discrepancy.

---

## Self-Review (do not commit)

**Spec coverage:**

| Spec section | Implemented in |
|---|---|
| Контекст: 2-5 users, whitelist | Task 27 (AuthGuard) |
| `endDate` inclusive | Task 21 (`isReminderExpired`) |
| Inline ack + repeat | Tasks 23, 25, 31 |
| Stack: NestJS, telegraf, schedule, zod, pino | Tasks 1-3, 33-34 |
| In-memory state, no persistence | Task 19 (StateStore — no snapshot/restore) |
| `/start`, `/next` | Tasks 28, 30 |
| `nest new` scaffold | Task 1 |
| `map + .flat(N)` style | Tasks 14, 29 |
| Multi-line method bodies | All tasks |
| Full descriptive names | All tasks |
| Singleton StateStore | Tasks 19, 20 (one StateModule, exported) |
| pino + redact for token | Tasks 7, 34 |
| Plugin registry + DI registration | Tasks 18, 26 (OnModuleInit) |
| Idempotent ack with try/catch | Task 31 |
| `/next` past/upcoming split | Tasks 29, 30 |
| Sequence/State/C4 diagrams | (separate `.puml` files, no implementation needed) |

**Placeholders:** none — every step has actual code or actual command.

**Type consistency:**
- `Slot` defined in both `next.logic.ts` (Task 29) і `next.command.ts` (Task 30 imports it).
- `BotGateway` interface (Task 22) used by `TelegrafBotGateway` (Task 32) and injected via `BOT_GATEWAY` token in `SchedulerService`/`RepeatEngineService` (Tasks 23, 25).
- `ScheduledSlot` defined in `schema.ts` (Task 14), used in `SchedulerService.onApplicationBootstrap` (Task 24).
- `ActiveReminder` defined in `state.store.ts` (Task 19), used in `SchedulerService.fire` (Task 23) і `RepeatEngineService` (Task 25).

All consistent.

---

## Done

When all tasks complete and Task 38 verifies manually — the bot is functional. Next steps post-launch:

- Add new reminder type (see "Особливості реалізації" у README) — water tracking, exercise, etc.
- Add `/status` command showing what's pending acks right now.
- Add `/skip <id>` to skip the next scheduled fire without confirmation.
- Consider audit log if you want history visible in `/next` («minulі — прийняв/пропустив»).
